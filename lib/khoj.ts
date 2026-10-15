/**
 * Khoj adapter (optional "second brain" research for your scripts).
 * Khoj searches YOUR docs + the web: GET {KHOJ_URL}/api/v1/search?q=..&n=..
 * Use /api/research?q=... to research a topic before storyboarding.
 * Self-hosted, open-source — your notes never leave your machine unless YOU use cloud.
 */

export function khojBase(): string | null {
  const v = (process.env.KHOJ_URL ?? "").trim().replace(/\/$/, "");
  return v ? v : null;
}

function khojHeaders(): Record<string, string> {
  const t = process.env.KHOJ_TOKEN;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/** Pure builder (tested). */
export function khojSearchUrl(query: string, n = 5): string | null {
  const base = khojBase();
  if (!base) return null;
  return `${base}/api/v1/search?q=${encodeURIComponent(query.slice(0, 300))}&n=${Math.max(1, Math.min(10, n))}`;
}

export interface KhojHit {
  title: string;
  text: string;
  source: string;
}

/** Pure parser (tested with fixtures) — never throws on odd shapes. */
export function parseKhojResults(data: unknown): KhojHit[] {
  const raw = (data as { results?: unknown })?.results;
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 10).map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const entry = (o.entry ?? {}) as Record<string, unknown>;
    return {
      title: String(entry.compiled?.toString().slice(0, 120) ?? entry.heading ?? o.heading ?? "Khoj result"),
      text: String(entry.compiled ?? entry.raw ?? o.text ?? "").slice(0, 800),
      source: String(entry.file ?? entry.uri ?? o.source ?? "")
    };
  });
}

export async function khojSearch(query: string, n = 5): Promise<KhojHit[]> {
  const url = khojSearchUrl(query, n);
  if (!url) throw new Error("KHOJ_URL is not set. Run Khoj (self-hosted or cloud) and set KHOJ_URL in .env.local.");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(url, { headers: khojHeaders(), signal: ctrl.signal });
    if (!res.ok) throw new Error(`Khoj search failed (${res.status}). Check KHOJ_URL.`);
    return parseKhojResults(await res.json());
  } finally {
    clearTimeout(t);
  }
}
