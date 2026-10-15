/**
 * ElevenLabs studio-quality voice (OPTIONAL, PAID key — never called without one).
 * Same endpoints as the official elevenlabs-js SDK (MIT):
 *   POST /v1/text-to-speech/{voice_id}  (xi-api-key) → audio/mpeg
 *   GET  /v1/user                       (xi-api-key) → quota check
 * Free tier ≈10k credits/month on ElevenLabs' side; ZEN R spends NOTHING
 * unless you pick the "eleven" voice AND set ELEVENLABS_API_KEY.
 */

export function elevenlabsKey(): string | null {
  const k = (process.env.ELEVENLABS_API_KEY ?? "").trim();
  return k ? k : null;
}

/** Voice id — override with any voice from YOUR ElevenLabs library. */
export function elevenlabsVoiceId(): string {
  // Rachel — ElevenLabs' own documented default demo voice (their SDK examples).
  return (process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM").trim();
}

/** eleven_multilingual_v2 = recommended for most use cases (29 languages). */
export function elevenlabsModel(): string {
  return (process.env.ELEVENLABS_MODEL ?? "eleven_multilingual_v2").trim();
}

/** Pure builder (tested). */
export function elevenlabsTtsUrl(voiceId?: string): string {
  return `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId ?? elevenlabsVoiceId())}`;
}

/** Pure builder (tested) — stability/similarity balanced for narration. */
export function elevenlabsPayload(text: string): Record<string, unknown> {
  return {
    text: text.slice(0, 2500),
    model_id: elevenlabsModel(),
    voice_settings: { stability: 0.5, similarity_boost: 0.75 }
  };
}

export interface ElevenlabsQuota {
  ok: boolean;
  remaining?: number;
  limit?: number;
  detail: string;
}

/** Validate the key AND read remaining credits — honest quota reporting. */
export async function checkElevenlabs(): Promise<ElevenlabsQuota> {
  const key = elevenlabsKey();
  if (!key) return { ok: false, detail: "ELEVENLABS_API_KEY is not set." };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/user", {
      headers: { "xi-api-key": key },
      signal: ctrl.signal
    });
    if (res.status === 401) return { ok: false, detail: "ElevenLabs key refused (401). Check ELEVENLABS_API_KEY." };
    if (!res.ok) return { ok: false, detail: `ElevenLabs user check failed (${res.status}).` };
    const data = await res.json();
    const limit = Number(data?.subscription?.character_limit ?? NaN);
    const used = Number(data?.subscription?.character_count ?? NaN);
    if (Number.isFinite(limit) && Number.isFinite(used)) {
      const remaining = Math.max(0, limit - used);
      return {
        ok: remaining > 0,
        remaining,
        limit,
        detail: remaining > 0 ? `ElevenLabs key OK — ${remaining}/${limit} credits left.` : "ElevenLabs quota exhausted — top up or pick a free voice."
      };
    }
    return { ok: true, detail: "ElevenLabs key OK." };
  } catch {
    return { ok: false, detail: "ElevenLabs unreachable. Check internet and retry." };
  } finally {
    clearTimeout(t);
  }
}

/** One chunk → MP3 bytes. Throws honest billing/auth errors (never silent). */
export async function fetchElevenlabsMp3(text: string): Promise<Buffer> {
  const key = elevenlabsKey();
  if (!key) throw new Error("ELEVENLABS_API_KEY is not set. Pick a free voice, or add your ElevenLabs key in .env.local.");
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) throw new Error("Empty narration text.");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 120000);
  try {
    const res = await fetch(elevenlabsTtsUrl(), {
      method: "POST",
      headers: { "xi-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify(elevenlabsPayload(clean)),
      signal: ctrl.signal
    });
    if (res.status === 401) throw new Error("ElevenLabs refused the key (401). Check ELEVENLABS_API_KEY — nothing was charged.");
    if (res.status === 402) throw new Error("ElevenLabs quota empty (402/payment required). Top up, or switch to a free voice — project is saved.");
    if (res.status === 422) throw new Error("ElevenLabs rejected the voice (422). Check ELEVENLABS_VOICE_ID exists in YOUR library.");
    if (res.status === 429) throw new Error("ElevenLabs rate-limited (429). Wait and retry — project is saved.");
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`ElevenLabs TTS failed (${res.status}). ${txt.slice(0, 200)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1024) throw new Error("ElevenLabs returned an empty file — treating as failure.");
    return buf;
  } finally {
    clearTimeout(t);
  }
}
