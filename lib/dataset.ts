import type { Project } from "./types";

/**
 * Training-dataset export for Unsloth / diffusers LoRA fine-tuning.
 * Honest note: real training needs an NVIDIA GPU (Unsloth Desktop / cloud).
 * This PC (i3, no GPU) can only PREPARE the dataset: your approved stills +
 * the exact prompts that made them → JSONL you train later, anywhere.
 * Format: one {"image","text"} per line (image = /api/media/... path).
 */

export interface DatasetRow {
  image: string;
  text: string;
}

/** Pure builder (tested) — only scenes that actually have a still. */
export function buildDatasetManifest(p: Project): DatasetRow[] {
  return p.sceneOrder
    .map((sid) => p.scenes.find((s) => s.id === sid))
    .filter((s): s is NonNullable<typeof s> => Boolean(s && s.stillPath))
    .map((s) => ({
      image: `/api/media/${s.stillPath}`,
      text: (s.visualPrompt || s.caption || s.title).slice(0, 1000)
    }));
}

/** Pure (tested) — JSONL string for training scripts. */
export function toJsonl(rows: DatasetRow[]): string {
  return rows.map((r) => JSON.stringify(r)).join("\n");
}
