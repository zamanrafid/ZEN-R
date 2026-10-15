import { deflateSync } from "zlib";
import { hashString } from "./planner";
import type { AspectRatio, VisualStyle } from "./types";

/**
 * ZORO ENGINE — tomar nijer alada model, karor upor depend na.
 * 100% offline, zero key, zero account, zero per-use fee:
 *   stills  = Zoro Engine procedural cinematic art (ei file, pure TypeScript)
 *   motion  = FFmpeg Ken Burns (tor PC)
 *   voice   = eSpeak NG offline (tor PC)
 *   render  = Hyperframes local (Chrome + FFmpeg, vendored GSAP — no CDN)
 *
 * Honest label: deterministic procedural art, NOT AI diffusion. Same prompt +
 * same seed = byte-identical PNG, every time. Internet bondho koreo chole.
 */

export interface ZoroStillOpts {
  prompt: string;
  style?: VisualStyle;
  width: number;
  height: number;
  seed: number;
}

interface RGB { r: number; g: number; b: number }

interface Palette {
  skyTop: RGB;
  horizon: RGB;
  ground: RGB;
  ridgeFar: RGB;
  ridgeNear: RGB;
  disc: RGB;
  discGlow: number;
  stars: boolean;
  mist: number;
}

const PALETTES: Record<string, Palette> = {
  horror: {
    skyTop: { r: 8, g: 4, b: 10 }, horizon: { r: 90, g: 16, b: 18 },
    ground: { r: 5, g: 3, b: 4 }, ridgeFar: { r: 22, g: 8, b: 12 },
    ridgeNear: { r: 10, g: 4, b: 6 }, disc: { r: 220, g: 200, b: 190 },
    discGlow: 90, stars: true, mist: 0.25
  },
  dark: {
    skyTop: { r: 4, g: 6, b: 16 }, horizon: { r: 40, g: 30, b: 70 },
    ground: { r: 3, g: 4, b: 8 }, ridgeFar: { r: 16, g: 14, b: 30 },
    ridgeNear: { r: 7, g: 6, b: 14 }, disc: { r: 200, g: 210, b: 230 },
    discGlow: 70, stars: true, mist: 0.2
  },
  cinematic: {
    skyTop: { r: 8, g: 30, b: 48 }, horizon: { r: 230, g: 130, b: 60 },
    ground: { r: 12, g: 14, b: 20 }, ridgeFar: { r: 40, g: 50, b: 66 },
    ridgeNear: { r: 16, g: 20, b: 28 }, disc: { r: 255, g: 200, b: 130 },
    discGlow: 110, stars: false, mist: 0.3
  },
  neon: {
    skyTop: { r: 14, g: 4, b: 34 }, horizon: { r: 200, g: 40, b: 160 },
    ground: { r: 8, g: 4, b: 20 }, ridgeFar: { r: 60, g: 20, b: 100 },
    ridgeNear: { r: 24, g: 8, b: 44 }, disc: { r: 120, g: 240, b: 255 },
    discGlow: 120, stars: true, mist: 0.28
  },
  gold: {
    skyTop: { r: 30, g: 48, b: 90 }, horizon: { r: 240, g: 190, b: 120 },
    ground: { r: 30, g: 26, b: 20 }, ridgeFar: { r: 70, g: 66, b: 60 },
    ridgeNear: { r: 30, g: 28, b: 24 }, disc: { r: 255, g: 235, b: 200 },
    discGlow: 100, stars: false, mist: 0.32
  }
};

export function paletteForStyle(style?: VisualStyle): Palette {
  if (style === "dark-mystery" || style === "historical") return PALETTES.horror;
  if (style === "cinematic-documentary") return PALETTES.cinematic;
  if (style === "animation" || style === "fantasy") return PALETTES.neon;
  if (style === "realistic") return PALETTES.gold;
  if (style === "custom") return PALETTES.dark;
  return PALETTES.dark;
}

/** Still dims for the Zoro Engine (light enough for i3, sharp enough for 720p). */
export function zoroDims(aspect: AspectRatio): { width: number; height: number } {
  if (aspect === "9:16") return { width: 768, height: 1344 };
  if (aspect === "1:1") return { width: 768, height: 768 };
  return { width: 1024, height: 576 };
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mix(c1: RGB, c2: RGB, t: number): RGB {
  return { r: lerp(c1.r, c2.r, t), g: lerp(c1.g, c2.g, t), b: lerp(c1.b, c2.b, t) };
}

/** Render one deterministic cinematic frame. Same inputs = byte-identical PNG. */
export function renderZoroFrame(o: ZoroStillOpts): Buffer {
  const w = Math.max(64, Math.min(1536, Math.round(o.width)));
  const h = Math.max(64, Math.min(1536, Math.round(o.height)));
  const pal = paletteForStyle(o.style);
  const seed = (hashString(o.prompt) + Math.floor(o.seed) * 7919) >>> 0;
  const rnd = mulberry(seed);

  // Seeded composition: disc position, ridge shapes, star field.
  const discX = w * (0.25 + rnd() * 0.5);
  const discY = h * (0.18 + rnd() * 0.25);
  const discR = Math.min(w, h) * (0.05 + rnd() * 0.04);
  const horizonY = h * (0.52 + rnd() * 0.1);
  const ridgeAmp1 = h * (0.04 + rnd() * 0.05);
  const ridgeAmp2 = h * (0.05 + rnd() * 0.07);
  const f1 = 2 + Math.floor(rnd() * 3);
  const f2 = 1 + Math.floor(rnd() * 3);
  const p1 = rnd() * Math.PI * 2;
  const p2 = rnd() * Math.PI * 2;
  const stars: Array<{ x: number; y: number; r: number }> = [];
  if (pal.stars) {
    const n = Math.floor((w * h) / 9000);
    for (let i = 0; i < n; i++) {
      stars.push({ x: rnd() * w, y: rnd() * horizonY * 0.9, r: 0.4 + rnd() * 1.1 });
    }
  }
  const grainAmp = 9 + rnd() * 5;

  const px = Buffer.alloc(w * h * 3);
  let k = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sky gradient.
      const t = Math.min(1, y / horizonY);
      let c = mix(pal.skyTop, pal.horizon, Math.pow(t, 1.4));

      // Disc glow + disc.
      const dx = x - discX;
      const dy = y - discY;
      const dd = Math.sqrt(dx * dx + dy * dy);
      if (dd < discR * 4) {
        const g = Math.max(0, 1 - dd / (discR * 4));
        c = {
          r: c.r + (pal.disc.r - c.r) * g * 0.35 * (pal.discGlow / 100),
          g: c.g + (pal.disc.g - c.g) * g * 0.35 * (pal.discGlow / 100),
          b: c.b + (pal.disc.b - c.b) * g * 0.35 * (pal.discGlow / 100)
        };
      }
      if (dd < discR) {
        const edge = Math.max(0, (dd - discR * 0.85) / (discR * 0.15));
        c = mix(pal.disc, c, edge * 0.25);
      }

      // Ridges (two silhouette layers below horizon).
      const r1y = horizonY + ridgeAmp1 * Math.sin((x / w) * Math.PI * 2 * f1 + p1) * 0.5 + ridgeAmp1 * 0.5;
      const r2y = horizonY + h * 0.06 + ridgeAmp2 * Math.sin((x / w) * Math.PI * 2 * f2 + p2) * 0.5 + ridgeAmp2 * 0.5;
      if (y > r1y) c = mix(c, pal.ridgeFar, Math.min(1, (y - r1y) / (h * 0.08) + 0.55));
      if (y > r2y) c = mix(c, pal.ridgeNear, Math.min(1, (y - r2y) / (h * 0.08) + 0.6));
      if (y > horizonY + h * 0.16) c = mix(c, pal.ground, Math.min(1, (y - horizonY - h * 0.16) / (h * 0.2)));

      // Mist band at horizon.
      const mistD = Math.abs(y - horizonY) / (h * 0.12);
      if (mistD < 1) {
        const m = (1 - mistD) * pal.mist;
        c = { r: lerp(c.r, pal.horizon.r, m), g: lerp(c.g, pal.horizon.g, m), b: lerp(c.b, pal.horizon.b, m) };
      }

      px[k++] = Math.max(0, Math.min(255, Math.round(c.r)));
      px[k++] = Math.max(0, Math.min(255, Math.round(c.g)));
      px[k++] = Math.max(0, Math.min(255, Math.round(c.b)));
    }
  }

  // Stars (drawn over sky only).
  for (const s of stars) {
    const xi = Math.floor(s.x);
    const yi = Math.floor(s.y);
    if (xi < 0 || xi >= w || yi < 0 || yi >= h) continue;
    const idx = (yi * w + xi) * 3;
    const b = Math.min(255, 150 + Math.floor(s.r * 60));
    px[idx] = Math.min(255, px[idx] + b * 0.5);
    px[idx + 1] = Math.min(255, px[idx + 1] + b * 0.5);
    px[idx + 2] = Math.min(255, px[idx + 2] + b * 0.6);
  }

  // Film grain (seeded) + vignette.
  const cx = w / 2;
  const cy = h / 2;
  const maxD = Math.sqrt(cx * cx + cy * cy);
  const rnd2 = mulberry(seed ^ 0x9e3779b9);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 3;
      const g = (rnd2() - 0.5) * 2 * grainAmp;
      const dx = x - cx;
      const dy = y - cy;
      const v = 1 - 0.42 * Math.pow(Math.sqrt(dx * dx + dy * dy) / maxD, 1.8);
      px[idx] = Math.max(0, Math.min(255, Math.round(px[idx] * v + g)));
      px[idx + 1] = Math.max(0, Math.min(255, Math.round(px[idx + 1] * v + g)));
      px[idx + 2] = Math.max(0, Math.min(255, Math.round(px[idx + 2] * v + g)));
    }
  }

  return encodePng(w, h, px);
}

/* ---------------- Minimal PNG encoder (truecolor, filter 0, zlib) ---------------- */

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let m = 0; m < 8; m++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePng(w: number, h: number, rgb: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    rgb.copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Public entry: deterministic still bytes for a scene. */
export function generateZoroStill(o: ZoroStillOpts): Buffer {
  const buf = renderZoroFrame(o);
  if (buf.length < 1024) throw new Error("Zoro Engine produced an empty frame — retry.");
  return buf;
}

export function zoroEngineNote(): string {
  return "Zoro Engine procedural art (100% offline, zero dependence) — deterministic, not AI diffusion.";
}
