export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { getProject } from "@/lib/store";
import { buildDatasetManifest, toJsonl } from "@/lib/dataset";

/**
 * GET /api/projects/[id]/dataset — training-dataset export (Unsloth / diffusers LoRA).
 * Your approved stills + exact prompts → JSONL. Train later on an NVIDIA GPU
 * (Unsloth Desktop / cloud) — this PC only PREPARES the dataset, honestly.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const p = await getProject(params.id);
  if (!p) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  const rows = buildDatasetManifest(p);
  if (!rows.length) {
    return NextResponse.json(
      { error: "No stills yet — generate scene stills first, then export the dataset." },
      { status: 400 }
    );
  }
  return NextResponse.json({
    ok: true,
    count: rows.length,
    jsonl: toJsonl(rows),
    note: "JSONL of {image, text} pairs — Unsloth/diffusers LoRA training format. Training needs NVIDIA GPU; dataset prep is done here."
  });
}
