export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { dataDir, getProject, saveProject, saveUpload, newId } from "@/lib/store";
import { checkFfmpeg } from "@/lib/providers";
import {
  buildAttribution,
  copyrightRiskOfTitle,
  exportDisclaimer,
  isValidLicense,
  rightsConfirmError,
} from "@/lib/copyright";
import { downloadStockToMedia, generateSafeMusicBed, isSafeStockUrl } from "@/lib/stock";
import {
  MAX_SOURCE_BYTES,
  cutSegment,
  downloadYouTube,
  isYouTubeUrl,
  planShorts,
  probeVideo,
  toVertical720x1280
} from "@/lib/source";
import { indexJob } from "@/lib/providers";
import type { GenerationJob, ScenePlan } from "@/lib/types";

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

/**
 * Source-video hub (all FREE, local tools) — copyright-strike protected:
 * - POST { youtubeUrl, confirmRights:true, license } → import public YouTube video.
 *   Rights: ONLY nijer / licensed / public-domain / CC. confirmRights + license mandatory.
 * - POST { upload: { filename, dataUrl }, license? } → upload mp4/webm/mov (≤300MB).
 * - POST { action: "shorts", segSec?, startSec?, muteSource? } → vertical Shorts + scenes.
 *   muteSource:true = source audio strip (music-claim risk thakle etai safe).
 * - POST { stockUrl, attribution? } → Wikimedia Commons file import (allow-listed, CC-safe).
 * - POST { action: "safe-music", mood?, durSec? } → 100% copyright-free generated bed.
 * - GET → source info + shorts list + rights + safe-source catalog.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const p = await getProject(params.id);
  if (!p) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body must be JSON." }, { status: 400 }); }

  // ---- YouTube import (rights-gated) ----
  if (typeof body.youtubeUrl === "string") {
    const url = body.youtubeUrl.trim();
    if (!isYouTubeUrl(url)) {
      return NextResponse.json({ error: "Only youtube.com/watch, /shorts, /live or youtu.be links are accepted." }, { status: 400 });
    }
    if (body.confirmRights !== true || !isValidLicense(body.license)) {
      return NextResponse.json({ error: rightsConfirmError() }, { status: 403 });
    }
    try {
      const rel = `media/source/${p.id}/source.mp4`.replace(/\\/g, "/");
      await downloadYouTube(url, path.join(dataDir(), rel));
      const probe = await probeVideo(path.join(dataDir(), rel));
      const risk = copyrightRiskOfTitle(url);
      p.sourceVideoPath = rel;
      p.sourceDurationSec = Math.round(probe.durationSec * 10) / 10;
      p.sourceTitle = url;
      p.sourceUrl = url;
      p.sourceLicense = String(body.license);
      p.rightsConfirmedAt = new Date().toISOString();
      p.sourceAttribution = buildAttribution({ title: url, sourceUrl: url, license: body.license as never });
      await saveProject(p);
      return NextResponse.json({
        project: p,
        risk: risk.risky ? risk.reason : undefined,
        audioWarning:
          "Source audio te onner music thakle Content ID claim asbe — Shorts katar somoy muteSource:true + free voiceover/safe-music use koro.",
        note: `Imported ${fmtTime(probe.durationSec)} (${probe.width}x${probe.height}) [${body.license}]. Strike-free thakte nijer/license/CC content-i use koro.`
      });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Import failed." }, { status: 422 });
    }
  }

  // ---- Copyright-safe stock import (Wikimedia allow-list) ----
  if (typeof body.stockUrl === "string") {
    if (!isSafeStockUrl(body.stockUrl)) {
      return NextResponse.json(
        { error: "Only upload.wikimedia.org / commons.wikimedia.org links allowed (copyright-safe allow-list)." },
        { status: 400 }
      );
    }
    try {
      const rel = await downloadStockToMedia(p.id, body.stockUrl.trim());
      return NextResponse.json({
        ok: true,
        stockPath: rel,
        attribution:
          typeof body.attribution === "string" && body.attribution.length > 0
            ? body.attribution
            : buildAttribution({ title: "Wikimedia Commons file", sourceUrl: body.stockUrl }),
        note: "CC/public-domain stock saved. Description e attribution rakho — tahole strike risk nei."
      });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Stock import failed." }, { status: 422 });
    }
  }

  // ---- 100% copyright-free safe music bed ----
  if (body.action === "safe-music") {
    const ff = await checkFfmpeg();
    if (!ff.ok) {
      return NextResponse.json({ error: "FFmpeg is required. Install with: winget install Gyan.FFmpeg" }, { status: 422 });
    }
    const mood = body.mood === "tension" ? "tension" : body.mood === "hopeful" ? "hopeful" : "ambient";
    const durSec = Math.max(3, Math.min(120, Math.round(Number(body.durSec) || 30)));
    try {
      const rel = `media/source/${p.id}/safe-music-${mood}.m4a`.replace(/\\/g, "/");
      await generateSafeMusicBed(rel, durSec, mood);
      p.safeMusicPath = rel;
      await saveProject(p);
      return NextResponse.json({
        project: p,
        musicPath: rel,
        note: `Safe ${mood} bed (${durSec}s) tomar PC te generate holo — kono sample nei, Content ID claim impossible.`
      });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Safe music failed." }, { status: 422 });
    }
  }

  // ---- Direct upload ----
  if (body.upload && typeof body.upload === "object") {
    const up = body.upload as Record<string, string>;
    try {
      const rel = await saveUpload(
        p.id, "source", up.filename ?? "upload.mp4", up.dataUrl ?? "",
        /^video\/(mp4|webm|quicktime|x-matroska)$/, 300 * 1024 * 1024
      );
      const probe = await probeVideo(path.join(dataDir(), rel));
      if (probe.durationSec > 1800) {
        await fs.unlink(path.join(dataDir(), rel)).catch(() => undefined);
        return NextResponse.json({ error: "Video is longer than 20 minutes — use a shorter one." }, { status: 400 });
      }
      p.sourceVideoPath = rel;
      p.sourceDurationSec = Math.round(probe.durationSec * 10) / 10;
      p.sourceTitle = up.filename ?? "upload";
      await saveProject(p);
      return NextResponse.json({ project: p, note: `Uploaded ${fmtTime(probe.durationSec)} of video.` });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed." }, { status: 400 });
    }
  }

  // ---- Cut Shorts ----
  if (body.action === "shorts") {
    if (!p.sourceVideoPath) {
      return NextResponse.json({ error: "Import a YouTube video or upload one first." }, { status: 400 });
    }
    const ff = await checkFfmpeg();
    if (!ff.ok) {
      return NextResponse.json({ error: "FFmpeg is required for cutting. Install with: winget install Gyan.FFmpeg" }, { status: 422 });
    }
    const segSec = Math.max(5, Math.min(60, Math.round(Number(body.segSec) || 30)));
    const startSec = Math.max(0, Number(body.startSec) || 0);
    const total = Math.max(0, (p.sourceDurationSec ?? 0) - startSec);
    if (total < 3) return NextResponse.json({ error: "Start time is past the end of the video." }, { status: 400 });
    const maxParts = Math.max(1, Math.min(40, Math.round(Number(body.maxParts) || 12)));
    const muteSource = body.muteSource === true;
    const plan = planShorts(total, segSec).slice(0, maxParts);
    try {
      const srcAbs = path.join(dataDir(), p.sourceVideoPath);
      const shorts: Array<{ path: string; startSec: number; lenSec: number }> = [];
      const now = new Date().toISOString();
      for (const [i, seg] of plan.entries()) {
        const absStart = Math.round((startSec + seg.start) * 10) / 10;
        // Cut horizontal segment, then convert to vertical Shorts.
        const cutRel = `media/source/${p.id}/cut_${i}.mp4`.replace(/\\/g, "/");
        await cutSegment(srcAbs, absStart, seg.len, cutRel);
        const vRel = `media/shorts/${p.id}/short_${i}_${Date.now()}.mp4`.replace(/\\/g, "/");
        await toVertical720x1280(path.join(dataDir(), cutRel), vRel, p.settings.quality === "best", muteSource);
        await fs.unlink(path.join(dataDir(), cutRel)).catch(() => undefined);
        shorts.push({ path: vRel, startSec: absStart, lenSec: seg.len });
      }
      p.shorts = shorts;
      // Attach every Short as a real scene + finished take, so preview / takes /
      // voiceover / export flows work unchanged. Appended after existing scenes.
      const base = p.scenes.length;
      for (const [i, sh] of shorts.entries()) {
        const scene: ScenePlan = {
          id: uuidv4(),
          index: base + i,
          durationSec: Math.max(2, Math.min(60, Math.round(sh.lenSec))),
          title: `Short ${base + i + 1}`,
          visualPrompt: `Imported vertical short ${base + i + 1} (source ${fmtTime(sh.startSec)}–${fmtTime(sh.startSec + sh.lenSec)}). No text overlays, no watermark.`,
          camera: "Center-cropped vertical 9:16",
          lighting: "Source lighting",
          transitionIn: i === 0 ? "Fade in from black" : "Hard cut",
          transitionOut: "Fade to black",
          characterIds: [],
          narrationSegment: "",
          caption: `Short ${base + i + 1} (${fmtTime(sh.startSec)}–${fmtTime(sh.startSec + sh.lenSec)})`,
          sound: muteSource ? "Muted (copyright-safe) — add free voiceover/safe-music" : "Source audio"
        };
        p.scenes.push(scene);
        p.sceneOrder.push(scene.id);
        const job: GenerationJob = {
          id: newId("job_"),
          sceneId: scene.id,
          providerId: "import",
          status: "succeeded",
          progress: 100,
          clipPath: sh.path,
          posterPath: sh.path,
          logs: [`Imported Short ${i + 1}: ${fmtTime(sh.startSec)}–${fmtTime(sh.startSec + sh.lenSec)} of source, vertical 9:16.`],
          createdAt: now,
          updatedAt: now
        };
        p.jobs.push(job);
        await indexJob(p.id, job.id);
      }
      await saveProject(p);
      return NextResponse.json({
        project: p,
        muted: muteSource,
        note: muteSource
          ? `${shorts.length} Shorts cut MUTED (copyright-safe) — ekhon free voiceover + safe-music bosao, strike risk nei.`
          : `${shorts.length} Shorts cut (vertical 9:16) and attached as scenes. Music thakle Content ID risk — muteSource:true use koro.`
      });
    } catch (e) {
      await saveProject(p);
      return NextResponse.json({ error: e instanceof Error ? e.message : "Cutting failed.", project: p }, { status: 422 });
    }
  }

  return NextResponse.json({ error: "Give youtubeUrl (+confirmRights+license), upload, stockUrl, or action 'shorts'/'safe-music'." }, { status: 400 });
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const p = await getProject(params.id);
  if (!p) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const [yt, ff] = await Promise.all([
    import("@/lib/source").then((m) => m.checkYtdlp()),
    checkFfmpeg()
  ]);
  return NextResponse.json({
    source: p.sourceVideoPath
      ? {
        path: p.sourceVideoPath,
        durationSec: p.sourceDurationSec ?? 0,
        title: p.sourceTitle ?? "",
        url: p.sourceUrl,
        license: p.sourceLicense,
        rightsConfirmedAt: p.rightsConfirmedAt,
        attribution: p.sourceAttribution
      }
      : null,
    shorts: p.shorts ?? [],
    safeMusic: p.safeMusicPath ?? null,
    tools: {
      ytdlp: yt.ok
        ? { ok: true }
        : { ok: false, help: "Install free with: winget install yt-dlp.yt-dlp" },
      ffmpeg: ff.ok ? { ok: true } : { ok: false, help: "Install free with: winget install Gyan.FFmpeg" }
    },
    limits: { maxBytes: MAX_SOURCE_BYTES, maxSec: 1200, segMin: 5, segMax: 60 },
    rights: "Only nijer / licensed / public-domain / CC video use koro. YouTube import e confirmRights:true + license mandatory. Music thakle muteSource:true + safe-music.",
    disclaimer: exportDisclaimer(Boolean(p.sourceVideoPath)),
    safeSources: [
      "Wikimedia Commons (CC/public-domain, attribution soho) — GET /api/stock?q=...",
      "ZEN R Safe Music Bed (100% generated, zero claim) — POST action safe-music",
      "Reference packs (horror/cinematic/anime/doc) — GET /api/stock/packs"
    ]
  });
}
