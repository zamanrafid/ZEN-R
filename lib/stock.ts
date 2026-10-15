import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { dataDir } from "./store";
import { ffmpegBin } from "./tools";

/**
 * Copyright-safe free sources (no key, no account):
 * 1. Wikimedia Commons — freely licensed images/videos (CC/public-domain), attribution included.
 * 2. ZORO Safe Music Bed — FFmpeg diye locally generated ambient tone (100% tomar, zero strike risk).
 * 3. Reference packs — curated visual/style prompt starters (horror, cinematic, anime...).
 */

// ---- Stock URL allow-list (arbitrary hotlink block = malware/license safety) ----
const STOCK_HOSTS = ["upload.wikimedia.org", "commons.wikimedia.org"];

export function isSafeStockUrl(u: string): boolean {
  try {
    const url = new URL(u.trim());
    if (url.protocol !== "https:") return false;
    if (u.length > 1000) return false;
    return STOCK_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export interface StockItem {
  title: string;
  url: string;
  thumb?: string;
  license: string;
  attribution: string;
}

interface CommonsResult {
  query?: { pages?: Record<string, { title?: string; imageinfo?: Array<{ url?: string; thumburl?: string; extmetadata?: { LicenseShortName?: { value?: string }; Artist?: { value?: string } } }> }> };
}

/** Search Wikimedia Commons (free, no key). Returns direct file URLs + attribution. */
export async function searchWikimedia(query: string, limit = 8): Promise<StockItem[]> {
  const q = query.trim().slice(0, 120);
  if (q.length < 2) throw new Error("Search text dao (min 2 chars).");
  const api =
    `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search` +
    `&gsrsearch=${encodeURIComponent(`filetype:bitmap ${q}`)}&gsrlimit=${Math.max(1, Math.min(20, limit))}` +
    `&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=640&formatversion=2`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(api, { signal: ctrl.signal, headers: { "User-Agent": "zoro-ai/1.0 (copyright-safe stock)" } });
    if (!res.ok) throw new Error(`Wikimedia busy (${res.status}) — retry koro.`);
    const data = (await res.json()) as CommonsResult;
    const pages = data?.query?.pages ? Object.values(data.query.pages) : [];
    return pages
      .map((pg) => {
        const info = pg.imageinfo?.[0];
        const url = info?.url ?? "";
        if (!url || !isSafeStockUrl(url)) return null;
        const lic = info?.extmetadata?.LicenseShortName?.value?.replace(/<[^>]*>/g, "") ?? "CC";
        const artist = info?.extmetadata?.Artist?.value?.replace(/<[^>]*>/g, "").slice(0, 80) ?? "";
        return {
          title: (pg.title ?? "Wikimedia file").replace(/^File:/, ""),
          url,
          thumb: info?.thumburl,
          license: lic,
          attribution: `Attribution: "${(pg.title ?? "").replace(/^File:/, "")}" ${artist ? `by ${artist} ` : ""}[${lic}] Source: https://commons.wikimedia.org — description e rakho.`
        } as StockItem;
      })
      .filter((x): x is StockItem => x !== null)
      .slice(0, limit);
  } finally {
    clearTimeout(t);
  }
}

/** Download an allow-listed stock file into project media. Throws on non-image/video. */
export async function downloadStockToMedia(projectId: string, fileUrl: string): Promise<string> {
  if (!isSafeStockUrl(fileUrl)) {
    throw new Error("Only upload.wikimedia.org / commons.wikimedia.org links allowed (copyright-safe allow-list).");
  }
  const res = await fetch(fileUrl, { headers: { "User-Agent": "zoro-ai/1.0" } });
  if (!res.ok) throw new Error(`Stock download failed (${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 2048) throw new Error("Stock file empty — retry.");
  if (buf.length > 80 * 1024 * 1024) throw new Error("Stock file too big (80MB cap).");
  const ext = (fileUrl.toLowerCase().match(/\.(jpg|jpeg|png|webp|mp4|webm)(\?|$)/)?.[1] ?? "jpg").replace("jpeg", "jpg");
  const rel = `media/stock/${projectId}/${Date.now()}.${ext}`.replace(/\\/g, "/");
  const abs = path.join(dataDir(), rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buf);
  return rel;
}

// ---- 100% copyright-free music bed (generated on YOUR pc, no sample, no claim) ----
export type SafeMood = "ambient" | "tension" | "hopeful";

const MOOD_FREQ: Record<SafeMood, number[]> = {
  ambient: [110, 165, 220],
  tension: [55, 58.27, 110.5],
  hopeful: [131, 196, 262]
};

/** Generate a soft ambient bed (sine pads + slow fade). Tomar nijer toiri — strike impossible. */
export async function generateSafeMusicBed(outRel: string, durSec: number, mood: SafeMood = "ambient"): Promise<string> {
  const dur = Math.max(3, Math.min(120, Math.round(durSec)));
  const freqs = MOOD_FREQ[mood] ?? MOOD_FREQ.ambient;
  const outAbs = path.join(dataDir(), outRel);
  await fs.mkdir(path.dirname(outAbs), { recursive: true });
  const mix = freqs.map((f, i) => `[${i}:a]volume=${(0.5 / freqs.length).toFixed(3)}[a${i}]`).join(";");
  const amix = freqs.map((_, i) => `[a${i}]`).join("");
  await new Promise<void>((resolve, reject) => {
    const args = [
      "-y",
      ...freqs.flatMap((f) => ["-f", "lavfi", "-i", `sine=frequency=${f}:duration=${dur}`]),
      "-filter_complex",
      `${mix};${amix}amix=inputs=${freqs.length}:normalize=0,afade=t=in:st=0:d=2,afade=t=out:st=${Math.max(0, dur - 3)}:d=3,volume=0.35`,
      "-c:a", "aac", "-b:a", "96k",
      outAbs
    ];
    const child = spawn(ffmpegBin(), args, { stdio: ["ignore", "pipe", "pipe"] });
    child.on("error", (e) => reject(new Error(`Could not launch FFmpeg: ${e.message}`)));
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`Safe music render failed (exit ${code}).`))));
  });
  return outRel;
}

// ---- Curated reference packs (prompt starters — tomar nijer AI stills er jonno) ----
export interface ReferencePack {
  id: string;
  label: string;
  prompts: string[];
  negative: string;
}

export const REFERENCE_PACKS: ReferencePack[] = [
  {
    id: "toon-panels",
    label: "Toon Panels / Comic Drama (bold ink, consistent cast)",
    prompts: [
      "comic book panel, bold ink outlines, cel shading, hero close-up with speed lines",
      "toon drama wide panel, vibrant flat colors, expressive faces, dynamic angle",
      "manga-style emotional beat panel, screentone shading, dramatic lighting"
    ],
    negative: "photorealistic, watermark, text, logo, deformed face, extra limbs, blurry"
  },
  {
    id: "horror",
    label: "Horror / Mystery (strike-free, AI-generated look)",
    prompts: [
      "abandoned mansion hallway at 2am, flickering candle light, fog, cinematic horror still",
      "close-up scared face lit by flashlight, dark background, film grain, 85mm portrait",
      "old wooden door with scratches, red rim light, dust particles, Lynchian dread"
    ],
    negative: "cartoon, watermark, text, logo, deformed face, blurry"
  },
  {
    id: "cinematic",
    label: "Cinematic Documentary",
    prompts: [
      "golden hour desert road, drone wide shot, teal-orange grade, anamorphic",
      "fisherman boat at dawn, mist over river, documentary realism, 35mm",
      "old Dhaka street, monsoon reflection, neon + rain, cinematic depth"
    ],
    negative: "watermark, text, oversaturated, plastic skin"
  },
  {
    id: "anime",
    label: "Anime / Fantasy",
    prompts: [
      "starlit village festival, anime key visual, vibrant night sky, Makoto Shinkai style",
      "lone swordsman on cliff, storm clouds, epic fantasy matte painting",
      "cute spirit forest, glowing mushrooms, Ghibli-inspired wonder"
    ],
    negative: "photorealistic gore, watermark, text, extra limbs"
  },
  {
    id: "islamic-doc",
    label: "Respectful Documentary (no faces where sensitive)",
    prompts: [
      "empty mosque interior, geometric light patterns, peaceful symmetry, no people",
      "ancient manuscript pages, warm lamp light, macro detail, reverent mood",
      "desert caravan silhouette at sunset, wide landscape, no faces"
    ],
    negative: "disrespectful imagery, watermark, text, distorted"
  }
];

export function getReferencePack(id: string): ReferencePack | null {
  return REFERENCE_PACKS.find((p) => p.id === id) ?? null;
}
