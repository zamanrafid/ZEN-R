export const dynamic = "force-dynamic";
export const maxDuration = 600;

import { NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import {
  hyperframesExportDir,
  hyperframesRenderStatus,
  renderHyperframesExport
} from "@/lib/hyperframes-render";
import { promises as fs } from "fs";
import path from "path";

/** GET: render status (exported? rendered? download path?) */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const p = await getProject(params.id);
  if (!p) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const s = await hyperframesRenderStatus(p.id);
  return NextResponse.json({ ok: true, ...s });
}

/**
 * POST /api/projects/[id]/hyperframes/render — one-click local MP4 render.
 * Requires: export first (POST ../hyperframes), Chrome + FFmpeg on this PC.
 * 100% FREE, no key, deterministic. Long job: up to 10 min.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const p = await getProject(params.id);
  if (!p) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const dir = hyperframesExportDir(p.id);
  try {
    await fs.stat(path.join(dir, "index.html"));
  } catch {
    return NextResponse.json(
      { error: "Export first: POST /api/projects/[id]/hyperframes, then render." },
      { status: 409 }
    );
  }
  const r = await renderHyperframesExport(p.id);
  if (!r.ok) {
    return NextResponse.json(
      { error: "Hyperframes render failed. Chrome + FFmpeg are required on this PC.", log: r.log },
      { status: 500 }
    );
  }
  return NextResponse.json({
    ok: true,
    mp4: r.mp4Rel,
    download: `/api/media/${r.mp4Rel}`,
    note: "Ultimate Hyperframes MP4 rendered locally — FREE, watermark-free from ZEN R."
  });
}
