import { promises as fs } from "fs";
import path from "path";
import { dataDir, getProject, newId, saveProject } from "./store";
import {
  concatMixedToMp3,
  concatMp3Parts,
  concatWavParts,
  normalizeVoice,
  writeSilenceMp3
} from "./ffmpeg";
import { checkEspeak, chunkText, espeakToWav, fetchTtsMp3, freeTierNote } from "./free";
import { checkEdgeTts, edgeTtsMp3 } from "./edgevoice";
import { checkKokoro, kokoroTtsWav } from "./kokoro";
import { checkElevenlabs, fetchElevenlabsMp3 } from "./elevenlabs";
import { CHUNK_GAP_SEC, HOSTED_TO_EDGE, edgeVoiceFor, resolveVoiceEngines, type VoiceEngine } from "./voice";
import type { GenerationJob } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Background voiceover worker — the fix for "Request timed out after 600s".
 * Narration synthesis (edge/Kokoro/hosted chunks + join + polish) runs INSIDE
 * the job poll, so the browser polls fast responses while the server works.
 * Idempotent-ish: reruns regenerate from scratch; finished audio is kept.
 */

export function createVoiceoverJob(
  voice: string,
  rate: "slow" | "normal" | "fast"
): GenerationJob {
  const now = new Date().toISOString();
  return {
    id: newId("job_"),
    sceneId: "voiceover",
    providerId: "voiceover",
    status: "queued",
    progress: 0,
    logs: [`Voiceover queued (${voice}, ${rate}). Runs in the background — keep this page open.`],
    voice,
    voiceRate: rate,
    createdAt: now,
    updatedAt: now
  };
}

export function voiceoverNote(primary: VoiceEngine, voice: string, fellBack: boolean): string {
  if (primary === "eleven") {
    return fellBack
      ? "ElevenLabs hit a limit mid-way (quota/auth) — continued with free engines so nothing was lost. Check ELEVENLABS_API_KEY/quota."
      : "ElevenLabs studio voiceover ready (paid key, polished + pauses).";
  }
  if (primary === "hosted") {
    return `Free AI voiceover ready (${voice}), loudness-polished with natural pauses. ${freeTierNote()}`;
  }
  if (primary === "edge") {
    return fellBack
      ? `Natural voiceover ready (${edgeVoiceFor(voice)}) — a chunk fell back to a local engine (network hiccup), polished + pauses.`
      : `Natural voiceover ready (${edgeVoiceFor(voice)}, free neural voice, no key) — polished + pauses.`;
  }
  if (primary === "kokoro") {
    return "Local Kokoro neural voiceover ready (same Kokoro-82M family as FluxNote + Local AI Voice Studio — CPU, no key, offline after first model download) — polished + pauses.";
  }
  return "Offline robot voiceover ready (eSpeak NG). For a natural voice: pip install edge-tts, then pick Aria/Guy/Emma/Nabanita/Pradeep.";
}

async function patchJob(projectId: string, jobId: string, patch: Partial<GenerationJob>, log?: string): Promise<void> {
  const p = await getProject(projectId);
  if (!p) return;
  const j = p.jobs.find((x) => x.id === jobId);
  if (!j || j.status === "cancelled") return;
  Object.assign(j, patch, { updatedAt: new Date().toISOString() });
  if (log) j.logs.push(log);
  await saveProject(p);
}

export async function runVoiceoverTask(projectId: string, jobId: string): Promise<void> {
  const boot = await getProject(projectId);
  const bootJob = boot?.jobs.find((j) => j.id === jobId);
  if (!boot || !bootJob || ["succeeded", "failed", "cancelled"].includes(bootJob.status)) return;
  const voice = bootJob.voice ?? "aria";
  const rate = bootJob.voiceRate ?? "normal";

  const fail = async (msg: string) => {
    await patchJob(projectId, jobId, { status: "failed", error: msg }, msg);
  };

  await patchJob(projectId, jobId, { status: "processing", progress: 3 }, "Voiceover started…");
  const p0 = (await getProject(projectId))!;
  const ordered = p0.sceneOrder
    .map((sid) => p0.scenes.find((s) => s.id === sid))
    .filter((s): s is NonNullable<typeof s> => Boolean(s));
  const segments = ordered.map((s) => s.narrationSegment?.trim() || s.caption?.trim() || "");
  const usable = segments.map((t, i) => ({ text: t, scene: i + 1 })).filter((x) => x.text);
  if (!usable.length) {
    await fail("Write a narration script first (or keep scene captions) — there is no text to speak.");
    return;
  }

  const edgeOk = (await checkEdgeTts()).ok;
  const kokoroOk = (await checkKokoro()).ok;
  let hostedOk = false;
  if (!edgeOk || HOSTED_TO_EDGE[voice]) {
    try {
      await fetchTtsMp3("voice check", voice);
      hostedOk = true;
    } catch {
      hostedOk = false;
    }
  }
  const offlineOk = (await checkEspeak()).ok;
  const eleven = await checkElevenlabs();
  const chain = resolveVoiceEngines(voice, { edge: edgeOk, kokoro: kokoroOk, hosted: hostedOk, offline: offlineOk, eleven: eleven.ok });
  if (!chain.length) {
    await fail(
      (voice === "eleven" ? `ElevenLabs: ${eleven.detail} ` : "") +
      "No voice engine available: edge-tts missing, Kokoro CLI missing, hosted TTS refused and eSpeak NG not installed. " +
      "Fix (all free): pip install edge-tts, OR winget install eSpeak-NG.eSpeak-NG, OR register at https://auth.pollinations.ai and set POLLINATIONS_TOKEN."
    );
    return;
  }
  const primary = chain[0];
  const attemptOrder: VoiceEngine[] = [
    primary,
    ...resolveVoiceEngines(voice, { edge: edgeOk, kokoro: kokoroOk, hosted: true, offline: offlineOk, eleven: eleven.ok }).filter((e) => e !== primary)
  ];

  const dir = path.join(dataDir(), "media", projectId, "audio");
  await fs.mkdir(dir, { recursive: true });
  const tasks: string[] = [];
  for (const u of usable) {
    for (const chunk of chunkText(u.text, primary === "hosted" ? 700 : 1200)) tasks.push(chunk);
  }
  const runStamp = Date.now();
  const ext = primary === "offline" ? "wav" : "mp3";
  const partFor = (i: number, e = ext) => path.join(dir, `tts_${runStamp}_${i}.${e}`);
  const parts: string[] = new Array(tasks.length);
  const usedEngines: VoiceEngine[] = new Array(tasks.length);

  async function synthOne(text: string, i: number): Promise<void> {
    let lastErr = "";
    for (const eng of attemptOrder) {
      try {
        if (eng === "eleven") {
          const buf = await fetchElevenlabsMp3(text);
          await fs.writeFile(partFor(i), buf);
        } else if (eng === "edge") {
          await edgeTtsMp3(text, edgeVoiceFor(voice), partFor(i), rate);
        } else if (eng === "kokoro") {
          await kokoroTtsWav(text, voice, partFor(i, "wav"), rate);
        } else if (eng === "hosted") {
          for (let tries = 0; tries < 40; tries++) {
            const lockFile = path.join(dataDir(), "free-lock.json");
            let last = 0;
            try { last = Number(JSON.parse(await fs.readFile(lockFile, "utf-8")).at ?? 0); } catch { /* none */ }
            if (Date.now() - last >= 16000) break;
            await sleep(5000);
          }
          const buf = await fetchTtsMp3(text, voice);
          await fs.writeFile(partFor(i), buf);
          await fs.writeFile(path.join(dataDir(), "free-lock.json"), JSON.stringify({ at: Date.now() }), "utf-8");
        } else {
          await espeakToWav(text, partFor(i, "wav"), 150);
        }
        parts[i] = eng === "offline" || eng === "kokoro" ? partFor(i, "wav") : partFor(i);
        usedEngines[i] = eng;
        return;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    throw new Error(lastErr || "All voice engines failed for a chunk.");
  }

  try {
    const CONC = primary === "kokoro" ? 1 : 3;
    let cursor = 0;
    let done = 0;
    const worker = async () => {
      while (cursor < tasks.length) {
        const i = cursor++;
        await synthOne(tasks[i], i);
        done++;
        await patchJob(projectId, jobId, { progress: Math.min(85, 5 + Math.round((done / tasks.length) * 80)) });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONC, tasks.length) }, () => worker()));

    await patchJob(projectId, jobId, { progress: 88 }, "Joining + polishing voice…");
    const gapAbs = path.join(dir, `gap_${runStamp}.mp3`);
    await writeSilenceMp3(gapAbs, CHUNK_GAP_SEC);
    const withGaps: string[] = [];
    parts.forEach((pt, i) => {
      withGaps.push(pt);
      if (i < parts.length - 1) withGaps.push(gapAbs);
    });
    const joinedAbs = path.join(dir, `voiceover_joined_${runStamp}.${ext}`);
    const hasWav = withGaps.some((x) => x.endsWith(".wav"));
    if (ext === "wav" || (hasWav && withGaps.every((x) => x.endsWith(".wav")))) {
      await concatWavParts(withGaps, joinedAbs);
    } else if (hasWav) {
      await concatMixedToMp3(withGaps, joinedAbs);
    } else {
      await concatMp3Parts(withGaps, joinedAbs);
    }
    const outAbs = path.join(dir, `voiceover_${Date.now()}.mp3`);
    try {
      await normalizeVoice(joinedAbs, outAbs);
    } catch {
      await fs.copyFile(joinedAbs, outAbs);
    }
    for (const part of [...parts, gapAbs, joinedAbs]) await fs.unlink(part).catch(() => undefined);

    const fin = await getProject(projectId);
    if (!fin) throw new Error("Project vanished mid-voiceover.");
    fin.narrationAudioPath = path.relative(dataDir(), outAbs).replace(/\\/g, "/");
    await saveProject(fin);
    const fellBack = usedEngines.some((e) => e !== primary);
    await patchJob(projectId, jobId, { status: "succeeded", progress: 100 }, voiceoverNote(primary, voice, fellBack));
  } catch (e) {
    await fail(e instanceof Error ? e.message : "Voiceover failed.");
  }
}
