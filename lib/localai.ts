/**
 * LocalAI adapter (optional, fully local, no key, no account).
 * LocalAI speaks OpenAI-compatible APIs on {LOCALAI_URL} (default http://localhost:8080/v1):
 *   GET  /models                 → status check
 *   POST /images/generations     → stills (b64_json or url)
 *   (chat planning already works via OPENAI_BASE_URL pointing at LocalAI)
 * Any GGUF/SD model YOU load there decides quality — ZEN R only sends prompts.
 */

export function localaiBase(): string {
  return (process.env.LOCALAI_URL ?? "http://localhost:8080/v1").trim().replace(/\/$/, "");
}

export function localaiImageModel(): string {
  return (process.env.LOCALAI_IMAGE_MODEL ?? "stablediffusion").trim() || "stablediffusion";
}

export function localaiConfigured(): boolean {
  return Boolean(process.env.LOCALAI_URL);
}

export interface LocalaiImagePayload {
  model: string;
  prompt: string;
  size: string;
  n: number;
  response_format: "b64_json";
}

/** Pure builder (tested) — OpenAI-style images payload LocalAI understands. */
export function localaiImagePayload(o: { prompt: string; width: number; height: number }): LocalaiImagePayload {
  return {
    model: localaiImageModel(),
    prompt: o.prompt.slice(0, 1500),
    size: `${Math.round(o.width)}x${Math.round(o.height)}`,
    n: 1,
    response_format: "b64_json"
  };
}

export async function checkLocalai(): Promise<{ ok: boolean; detail?: string }> {
  if (!localaiConfigured()) return { ok: false };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(`${localaiBase()}/models`, { signal: ctrl.signal });
    if (!res.ok) return { ok: false, detail: `LocalAI answered ${res.status}.` };
    return { ok: true, detail: "LocalAI reachable (your hardware, your models)." };
  } catch {
    return { ok: false, detail: "LocalAI not reachable. Start it and set LOCALAI_URL in .env.local." };
  } finally {
    clearTimeout(t);
  }
}

/** Generate one still via YOUR LocalAI. Returns raw image bytes. */
export async function fetchLocalaiStill(o: { prompt: string; width: number; height: number }): Promise<Buffer> {
  if (!localaiConfigured()) throw new Error("LOCALAI_URL is not set. Start LocalAI and set LOCALAI_URL in .env.local.");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 600000);
  try {
    const res = await fetch(`${localaiBase()}/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(localaiImagePayload(o)),
      signal: ctrl.signal
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`LocalAI rejected the image request (${res.status}). ${txt.slice(0, 200)} Load an image model in LocalAI first.`);
    }
    const data = await res.json();
    const item = Array.isArray(data?.data) ? data.data[0] : null;
    if (item?.b64_json && typeof item.b64_json === "string") {
      const buf = Buffer.from(item.b64_json, "base64");
      if (buf.length < 2048) throw new Error("LocalAI returned an empty image.");
      return buf;
    }
    if (item?.url && typeof item.url === "string") {
      const dl = await fetch(item.url);
      if (!dl.ok) throw new Error(`Could not download LocalAI image (${dl.status}).`);
      const buf = Buffer.from(await dl.arrayBuffer());
      if (buf.length < 2048) throw new Error("LocalAI returned an empty image.");
      return buf;
    }
    throw new Error("LocalAI returned no image — treating as failure, not success.");
  } finally {
    clearTimeout(t);
  }
}
