export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { dataDir, getProject, saveProject, saveUpload } from "@/lib/store";
import { buildSrt, concatMixedToMp3, concatMp3Parts, concatWavParts, normalizeVoice, writeSilenceMp3 } from "@/lib/ffmpeg";
import { FREE_VOICES, checkEspeak, chunkText, espeakToWav, fetchTtsMp3, freeTierNote } from "@/lib/free";
import { checkEdgeTts, edgeTtsMp3 } from "@/lib/edgevoice";
import { checkKokoro, kokoroTtsWav } from "@/lib/kokoro";
import { checkElevenlabs, fetchElevenlabsMp3 } from "@/lib/elevenlabs";
import { CHUNK_GAP_SEC, HOSTED_TO_EDGE, edgeVoiceFor, resolveVoiceEngines, type VoiceEngine } from "@/lib/voice";
import { MAX_SCRIPT } from "@/lib/validate";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST narration:
 * - { narrationScript } → save script (syncs per-scene segments when counts match)
 * - { audioDataUrl, filename } → attach uploaded audio
 * - { clearAudio: true } → remove audio
 * - { tts: true, voice?: "nova"|...|"eleven" } → best available voice engine:
 *   edge neural → local Kokoro neural → hosted AI → offline robot
 *   ("eleven" = paid ElevenLabs key first, then free fallbacks).
 *   One MP3 per scene segment + breathing pauses + loudness polish, joined
 *   locally. Anonymous hosted tier ≈1 req/15s — progress returned, nothing faked.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const p = await getProject(params.id);
  if (!p) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }

  if (typeof body.narrationScript === "string") {
    if (body.narrationScript.length > MAX_SCRIPT) return NextResponse.json({ error: "Narration too long." }, { status: 400 });
    p.narrationScript = body.narrationScript;
    const lines = body.narrationScript.split("\n").filter(Boolean);
    if (lines.length === p.scenes.length) {
      p.scenes = p.scenes.map((s, i) => ({ ...s, narrationSegment: lines[i], caption: s.caption || lines[i].slice(0, 90) }));
    }
  }
  if (typeof body.audioDataUrl === "string") {
    try {
      const rel = await saveUpload(p.id, "audio", String(body.filename ?? "narration.mp3"), body.audioDataUrl, /^audio\/(mpeg|wav|ogg|x-wav|webm)$/, 25 * 1024 * 1024);
      p.narrationAudioPath = rel;
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Audio upload failed." }, { status: 400 });
    }
  }
  if (body.clearAudio === true) p.narrationAudioPath = undefined;

  if (body.tts === true) {
    const rawVoice = String(body.voice);
    const voice = rawVoice === "eleven" || (FREE_VOICES as readonly string[]).includes(rawVoice) ? rawVoice : "aria";
    const rate = body.rate === "slow" || body.rate === "fast" ? body.rate : ("normal" as "slow" | "normal" | "fast");
    const ordered = p.sceneOrder
      .map((sid) => p.scenes.find((s) => s.id === sid))
      .filter((s): s is NonNullable<typeof s> => Boolean(s));
    const segments = ordered.map((s) => s.narrationSegment?.trim() || s.caption?.trim() || "");
    const usable = segments.map((t, i) => ({ text: t, scene: i + 1 })).filter((x) => x.text);
    if (!usable.length) {
      return NextResponse.json({ error: "Write a narration script first (or keep scene captions) — there is no text to speak." }, { status: 400 });
    }
    // Engine chain (all free) — best voice actually available on THIS pc:
    // natural ids: edge neural → local Kokoro neural → hosted AI → offline robot;
    // hosted-only ids: hosted AI → closest edge neural → Kokoro → offline robot.
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
      return NextResponse.json(
        {
          error:
            (voice === "eleven" ? `ElevenLabs: ${eleven.detail} ` : "") +
            "No voice engine available: edge-tts missing, Kokoro CLI missing, hosted TTS refused and eSpeak NG not installed. " +
            "Fix (all free): pip install edge-tts, OR winget install eSpeak-NG.eSpeak-NG, OR register at https://auth.pollinations.ai and set POLLINATIONS_TOKEN."
        },
        { status: 502 }
      );
    }
    const primary: VoiceEngine = chain[0];
    try {
      const dir = path.join(dataDir(), "media", p.id, "audio");
      await fs.mkdir(dir, { recursive: true });
      // Flatten every chunk first so engines can run them in parallel.
      const tasks: string[] = [];
      for (const u of usable) {
        for (const chunk of chunkText(u.text, primary === "hosted" ? 700 : 1200)) tasks.push(chunk);
      }
      const runStamp = Date.now();
      const ext = primary === "offline" ? "wav" : "mp3";
      const partFor = (i: number, e = ext) => path.join(dir, `tts_${runStamp}_${i}.${e}`);
      const parts: string[] = new Array(tasks.length);

      // Per-chunk fallback chain: primary first, then everything else that
      // could work (hosted attempts are paced to ≈1/16s on the free tier).
      // Kokoro is CPU-bound: run it solo (concurrency 1) to avoid overload.
      const attemptOrder: VoiceEngine[] = [
        primary,
        ...resolveVoiceEngines(voice, { edge: edgeOk, kokoro: kokoroOk, hosted: true, offline: offlineOk, eleven: eleven.ok }).filter((e) => e !== primary)
      ];
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
              // eSpeak is CPU-bound: slower rate + wider gaps read less robotic.
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

      // Concurrent syntheses (Kokoro is CPU-bound → solo when primary).
      const CONC = primary === "kokoro" ? 1 : 3;
      const usedEngines: VoiceEngine[] = new Array(tasks.length);
      let cursor = 0;
      const worker = async () => {
        while (cursor < tasks.length) {
          const i = cursor++;
          await synthOne(tasks[i], i);
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONC, tasks.length) }, () => worker()));
      // Breathing pauses between chunks (natural pacing, not rushed).
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
      // Broadcast-style loudness polish; never fail the voiceover over polish.
      const outAbs = path.join(dir, `voiceover_${Date.now()}.mp3`);
      try {
        await normalizeVoice(joinedAbs, outAbs);
      } catch {
        await fs.copyFile(joinedAbs, outAbs);
      }
      for (const part of [...parts, gapAbs, joinedAbs]) await fs.unlink(part).catch(() => undefined);
      p.narrationAudioPath = path.relative(dataDir(), outAbs).replace(/\\/g, "/");
      await saveProject(p);
      const fellBack = usedEngines.some((e) => e !== primary);
      return NextResponse.json({
        project: p,
        engine: primary,
        note:
          primary === "eleven"
            ? fellBack
              ? "ElevenLabs hit a limit mid-way (quota/auth) — continued with free engines so nothing was lost. Check ELEVENLABS_API_KEY/quota."
              : "ElevenLabs studio voiceover ready (paid key, polished + pauses)."
            : primary === "hosted"
            ? `Free AI voiceover ready (${voice}), loudness-polished with natural pauses. ${freeTierNote()}`
            : primary === "edge"
              ? fellBack
                ? `Natural voiceover ready (${edgeVoiceFor(voice)}) — a chunk fell back to a local engine (network hiccup), polished + pauses.`
                : `Natural voiceover ready (${edgeVoiceFor(voice)}, free neural voice, no key) — polished + pauses.`
              : primary === "kokoro"
                ? "Local Kokoro neural voiceover ready (same Kokoro-82M family as FluxNote + Local AI Voice Studio — CPU, no key, offline after first model download) — polished + pauses."
                : "Offline robot voiceover ready (eSpeak NG). For a natural voice: pip install edge-tts, then pick Aria/Guy/Emma/Nabanita/Pradeep."
      });
    } catch (e) {
      await saveProject(p);
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Voiceover failed.", project: p },
        { status: e instanceof Error && /rate-limited/i.test(e.message) ? 429 : 502 }
      );
    }
  }

  await saveProject(p);
  return NextResponse.json({ project: p });
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const p = await getProject(params.id);
  if (!p) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const srt = buildSrt(p, p.sceneOrder);
  return new NextResponse(srt, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
