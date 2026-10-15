import { v4 as uuidv4 } from "uuid";
import type { ScenePlan } from "./types";

/**
 * OpenMontage-style remix pipeline: "paste a video you love" → storyboard.
 * Builds scenes from YOUR already-cut Shorts (timings preserved), so a source
 * video becomes an editable ZEN R storyboard: recaption, revoice, re-export.
 * Only works on videos you have rights to (import gate already enforces this).
 */

/** Pure builder (tested) — shorts metadata → editable scenes. */
export function buildRemixScenes(
  shorts: Array<{ path: string; startSec: number; lenSec: number }>,
  titlePrefix: string
): ScenePlan[] {
  return shorts.map((sh, i) => ({
    id: uuidv4(),
    index: i,
    durationSec: Math.max(2, Math.min(60, Math.round(sh.lenSec))),
    title: `${titlePrefix} ${i + 1}`,
    visualPrompt: `Remix part ${i + 1}: source segment ${sh.startSec}s–${Math.round((sh.startSec + sh.lenSec) * 10) / 10}s, vertical 9:16. Keep composition, recaption with fresh kinetic titles.`,
    camera: "Source framing (vertical 9:16)",
    lighting: "Source lighting",
    transitionIn: i === 0 ? "Fade in from black" : "Hard cut",
    transitionOut: "Fade to black",
    characterIds: [],
    narrationSegment: "",
    caption: `${titlePrefix} ${i + 1}`,
    sound: "Add free voiceover + safe music (source audio stripped for copyright safety)"
  }));
}

export function remixNarration(scenes: ScenePlan[]): string {
  return scenes.map((s) => s.caption).join(". ").slice(0, 5000);
}
