/**
 * AUTOMATIC1111 Stable Diffusion WebUI adapter (optional, your own GPU PC).
 * WebUI exposes an HTTP API when launched with --api:
 *   POST {A1111_URL}/sdapi/v1/txt2img → { images: [base64png, ...] }
 * Zoro AI only sends prompts there — identity/quality depend on YOUR model.
 * Needs a NVIDIA GPU on the machine running WebUI (CPU works but is very slow).
 */

export function a1111Base(): string | null {
  const v = (process.env.A1111_URL ?? "").trim().replace(/\/$/, "");
  return v ? v : null;
}

export function a1111Steps(): number {
  const n = Number(process.env.A1111_STEPS) || 24;
  return Math.max(5, Math.min(60, n));
}

export interface A1111Txt2Img {
  prompt: string;
  negative_prompt: string;
  width: number;
  height: number;
  seed: number;
  steps: number;
  cfg_scale: number;
}

/** Pure builder (tested) — exact JSON the WebUI /sdapi/v1/txt2img endpoint takes. */
export function txt2imgPayload(o: {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  seed: number;
}): A1111Txt2Img {
  return {
    prompt: o.prompt.slice(0, 1500),
    negative_prompt: (o.negativePrompt ?? "watermark, text, logo, deformed face, blurry, extra limbs").slice(0, 500),
    width: Math.max(256, Math.min(1536, Math.round(o.width))),
    height: Math.max(256, Math.min(1536, Math.round(o.height))),
    seed: Math.floor(o.seed),
    steps: a1111Steps(),
    cfg_scale: 7
  };
}

export async function checkA1111(): Promise<{ ok: boolean; detail?: string }> {
  const base = a1111Base();
  if (!base) return { ok: false };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    // /sdapi/v1/sd-models answers 200 on a healthy WebUI with --api enabled.
    const res = await fetch(`${base}/sdapi/v1/sd-models`, { signal: ctrl.signal });
    if (!res.ok) return { ok: false, detail: `WebUI answered ${res.status} — relaunch with --api flag.` };
    return { ok: true, detail: "A1111 WebUI reachable (your GPU, your model)." };
  } catch {
    return { ok: false, detail: "WebUI not reachable. Launch it with --api and set A1111_URL in .env.local." };
  } finally {
    clearTimeout(t);
  }
}

/** Generate one still via YOUR WebUI. Returns raw PNG bytes. Throws honest errors. */
export async function fetchA1111Still(o: {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  seed: number;
}): Promise<Buffer> {
  const base = a1111Base();
  if (!base) throw new Error("A1111_URL is not set. Launch WebUI with --api and set A1111_URL in .env.local.");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 600000);
  try {
    const res = await fetch(`${base}/sdapi/v1/txt2img`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(txt2imgPayload(o)),
      signal: ctrl.signal
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`WebUI rejected txt2img (${res.status}). ${txt.slice(0, 200)} Check model loaded + --api flag.`);
    }
    const data = await res.json();
    const b64 = Array.isArray(data?.images) ? data.images[0] : null;
    if (typeof b64 !== "string" || b64.length < 1024) {
      throw new Error("WebUI returned no image — treating as failure, not success.");
    }
    return Buffer.from(b64, "base64");
  } finally {
    clearTimeout(t);
  }
}
