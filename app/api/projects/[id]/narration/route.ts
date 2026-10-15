export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getProject, saveProject, saveUpload, pushJob } from "@/lib/store";
import { indexJob } from "@/lib/providers";
import { buildSrt } from "@/lib/ffmpeg";
import { FREE_VOICES } from "@/lib/free";
import { createVoiceoverJob } from "@/lib/voiceover";
import { MAX_SCRIPT } from "@/lib/validate";

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
    // Fast ACK: synthesis runs as a background job (poll /api/jobs/[id]) —
    // no more 600s request timeouts. Resume-safe: rerun continues the job.
    const ordered = p.sceneOrder
      .map((sid) => p.scenes.find((s) => s.id === sid))
      .filter((s): s is NonNullable<typeof s> => Boolean(s));
    const hasText = ordered.some((s) => (s.narrationSegment?.trim() || s.caption?.trim()));
    if (!hasText) {
      return NextResponse.json({ error: "Write a narration script first (or keep scene captions) — there is no text to speak." }, { status: 400 });
    }
    // One active voiceover at a time per project (resume instead of duplicate).
    const existing = (p.jobs ?? []).find((j) => j.providerId === "voiceover" && (j.status === "queued" || j.status === "processing"));
    if (existing) {
      return NextResponse.json({ job: existing, note: "Voiceover already running — polling the same job." }, { status: 200 });
    }
    const job = createVoiceoverJob(voice, rate);
    await pushJob(p.id, job);
    await indexJob(p.id, job.id);
    return NextResponse.json({ job, note: `Voiceover queued (${voice}). Poll /api/jobs/${job.id} — keep this page open.` }, { status: 201 });
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
