/**
 * ZEN R voice engine resolution — best voice available, honestly reported.
 * Priority per voice (all free):
 *  - natural voices (aria/jenny/guy/davis/emma/nabanita/pradeep):
 *    edge neural → local Kokoro neural → hosted AI → offline robot
 *  - hosted voices (alloy/echo/fable/onyx/nova/shimmer):
 *    hosted AI → closest edge neural → local Kokoro → offline robot
 *  - eleven: paid ElevenLabs key → edge → Kokoro → hosted → robot (opt-in only)
 *  - robot: offline only.
 * Old bug: aria without edge-tts fell straight to the robot, skipping hosted.
 */

export type VoiceEngine = "edge" | "kokoro" | "hosted" | "offline" | "eleven";

const EDGE_OK = new Set(["aria", "jenny", "guy", "davis", "emma", "nabanita", "pradeep"]);

/** Closest natural edge voice for a hosted-only voice id. */
export const HOSTED_TO_EDGE: Record<string, string> = {
  alloy: "aria",
  echo: "guy",
  fable: "emma",
  onyx: "davis",
  nova: "aria",
  shimmer: "jenny"
};

export interface VoiceAvailability {
  edge: boolean;
  kokoro: boolean;
  hosted: boolean;
  offline: boolean;
  eleven: boolean;
}

/** Pure resolver (tested) — ordered engine chain for one voice id. */
export function resolveVoiceEngines(voice: string, avail: VoiceAvailability): VoiceEngine[] {
  const chain: VoiceEngine[] = [];
  if (voice === "eleven") {
    // Explicit opt-in only: paid key first, then every free fallback.
    if (avail.eleven) chain.push("eleven");
    if (avail.edge) chain.push("edge");
    if (avail.kokoro) chain.push("kokoro");
    if (avail.hosted) chain.push("hosted");
    if (avail.offline) chain.push("offline");
    return chain;
  }
  if (EDGE_OK.has(voice)) {
    if (avail.edge) chain.push("edge");
    if (avail.kokoro) chain.push("kokoro");
    if (avail.hosted) chain.push("hosted");
    if (avail.offline) chain.push("offline");
  } else if (voice === "robot") {
    if (avail.offline) chain.push("offline");
  } else {
    if (avail.hosted) chain.push("hosted");
    if (avail.edge) chain.push("edge");
    if (avail.kokoro) chain.push("kokoro");
    if (avail.offline) chain.push("offline");
  }
  return chain;
}

/** Edge voice id to synthesize with (maps hosted-only ids to closest natural). */
export function edgeVoiceFor(voice: string): string {
  if (EDGE_OK.has(voice)) return voice;
  return HOSTED_TO_EDGE[voice] ?? "aria";
}

/** Pause between chunks so narration breathes instead of rushing. */
export const CHUNK_GAP_SEC = 0.35;
