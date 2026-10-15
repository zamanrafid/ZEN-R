/**
 * Hugging Face Inference Providers — text-to-image (diffusers-powered server-side).
 * The hosted endpoints run diffusers pipelines (SDXL, SD 1.5, FLUX schnell...)
 * so you get diffusion stills WITHOUT a local GPU. Usage may bill to your HF
 * account — check the model page + your plan. Requires HF_TOKEN.
 */

export const HF_IMAGE_MODELS = [
  { id: "stabilityai/stable-diffusion-xl-base-1.0", label: "SDXL Base (balanced quality)" },
  { id: "stabilityai/stable-diffusion-2-1", label: "SD 2.1 (fast)" },
  { id: "black-forest-labs/FLUX.1-schnell", label: "FLUX.1-schnell (sharp, few steps)" }
] as const;

export function hfImageModel(): string {
  return (process.env.HF_IMAGE_MODEL ?? "stabilityai/stable-diffusion-xl-base-1.0").trim();
}

/** Pure builder (tested) — router URL for the configured diffusers model. */
export function hfImageUrl(model?: string): string {
  return `https://router.huggingface.co/hf-inference/models/${model ?? hfImageModel()}`;
}

export function hfImageHeaders(): Record<string, string> {
  const t = process.env.HF_TOKEN;
  return t ? { Authorization: `Bearer ${t}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

export function hfImageConfigured(): boolean {
  return Boolean(process.env.HF_TOKEN);
}

/** Generate one still via HF Inference (diffusers pipeline, hosted). Returns raw bytes. */
export async function fetchHfStill(o: {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  seed: number;
}): Promise<Buffer> {
  if (!hfImageConfigured()) {
    throw new Error("HF_TOKEN is not set. Create one at https://huggingface.co/settings/tokens and set HF_TOKEN + HF_IMAGE_MODEL in .env.local.");
  }
  const fullPrompt = o.negativePrompt
    ? `${o.prompt.slice(0, 1200)} (avoid: ${o.negativePrompt.slice(0, 200)})`
    : o.prompt.slice(0, 1400);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 300000);
  try {
    const res = await fetch(hfImageUrl(), {
      method: "POST",
      headers: hfImageHeaders(),
      body: JSON.stringify({
        inputs: fullPrompt,
        parameters: {
          width: Math.max(256, Math.min(1536, Math.round(o.width))),
          height: Math.max(256, Math.min(1536, Math.round(o.height))),
          seed: Math.floor(o.seed)
        }
      }),
      signal: ctrl.signal
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("Hugging Face refused the key (401/403). Check HF_TOKEN and model access.");
    }
    if (res.status === 402) {
      throw new Error("Hugging Face needs payment/credits for this model (402). Check billing — nothing was rendered.");
    }
    if (res.status === 429) {
      throw new Error("Hugging Face rate-limited (429). Wait and retry — project is saved.");
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Hugging Face image failed (${res.status}). ${txt.slice(0, 200)}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2048) throw new Error("Hugging Face returned an empty image — treating as failure.");
    return buf;
  } finally {
    clearTimeout(t);
  }
}
