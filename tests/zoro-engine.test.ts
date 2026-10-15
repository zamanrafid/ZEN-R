import { describe, expect, it } from "vitest";
import {
  generateZoroStill,
  paletteForStyle,
  zoroDims,
  zoroEngineNote
} from "../lib/zoro-engine";
import { remoteStillKind } from "../lib/jobs";
import { listProviders } from "../lib/providers";
import type { Project } from "../lib/types";

function pngSize(buf: Buffer): { w: number; h: number } {
  expect(buf[0]).toBe(137);
  expect(buf[1]).toBe(0x50); // P
  expect(buf[2]).toBe(0x4e); // N
  expect(buf[3]).toBe(0x47); // G
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

describe("Zoro Engine (own offline model)", () => {
  it("renders valid PNGs at the right dims per aspect", () => {
    expect(zoroDims("9:16")).toEqual({ width: 768, height: 1344 });
    expect(zoroDims("16:9")).toEqual({ width: 1024, height: 576 });
    expect(zoroDims("1:1")).toEqual({ width: 768, height: 768 });
    const buf = generateZoroStill({ prompt: "haunted mansion", style: "dark-mystery", width: 768, height: 1344, seed: 7 });
    expect(buf.length).toBeGreaterThan(5000);
    expect(pngSize(buf)).toEqual({ w: 768, h: 1344 });
  });

  it("is deterministic: same inputs = byte-identical PNG", () => {
    const o = { prompt: "desert road", style: "cinematic-documentary" as const, width: 256, height: 256, seed: 3 };
    expect(generateZoroStill(o).equals(generateZoroStill(o))).toBe(true);
  });

  it("varies with seed and style (not a static image)", () => {
    const a = generateZoroStill({ prompt: "x", width: 128, height: 128, seed: 1 });
    const b = generateZoroStill({ prompt: "x", width: 128, height: 128, seed: 2 });
    const c = generateZoroStill({ prompt: "x", style: "animation", width: 128, height: 128, seed: 1 });
    expect(a.equals(b)).toBe(false);
    expect(a.equals(c)).toBe(false);
  });

  it("maps styles to distinct palettes and labels itself honestly", () => {
    expect(paletteForStyle("dark-mystery")).not.toEqual(paletteForStyle("animation"));
    expect(zoroEngineNote()).toMatch(/offline/i);
    expect(zoroEngineNote()).toMatch(/not AI diffusion/i);
  });

  it("is wired as movie-pipeline still kind for zoro-engine projects", () => {
    const p = { providerId: "zoro-engine" } as Project;
    expect(remoteStillKind(p)).toBe("zoro-still");
    expect(remoteStillKind({ providerId: "slideshow" } as Project)).toBeNull();
  });

  it("provider is always configured, keyless, secret-free", () => {
    const z = listProviders().find((x) => x.id === "zoro-engine")!;
    expect(z.configured).toBe(true);
    expect(z.requiresApiKey).toBe(false);
    expect(JSON.stringify(z)).not.toMatch(/r8_|hf_|sk-/);
  });
});
