import { describe, expect, it } from "vitest";
import { txt2imgPayload, a1111Base } from "../lib/a1111";
import { localaiBase, localaiImageModel, localaiImagePayload } from "../lib/localai";
import { hfImageHeaders, hfImageModel, hfImageUrl, HF_IMAGE_MODELS } from "../lib/hfimage";
import { khojSearchUrl, parseKhojResults } from "../lib/khoj";
import { buildDatasetManifest, toJsonl } from "../lib/dataset";
import { buildRemixScenes, remixNarration } from "../lib/remix";
import type { Project } from "../lib/types";

describe("A1111 adapter", () => {
  it("builds a valid txt2img payload with clamped dims", () => {
    const p = txt2imgPayload({ prompt: "ghost", width: 9999, height: 10, seed: 42 });
    expect(p.width).toBeLessThanOrEqual(1536);
    expect(p.height).toBeGreaterThanOrEqual(256);
    expect(p.seed).toBe(42);
    expect(p.negative_prompt.length).toBeGreaterThan(0);
  });

  it("base is null without env (honest unconfigured state)", () => {
    const had = process.env.A1111_URL;
    delete process.env.A1111_URL;
    expect(a1111Base()).toBeNull();
    if (had !== undefined) process.env.A1111_URL = had;
  });
});

describe("LocalAI adapter", () => {
  it("defaults to localhost base and builds images payload", () => {
    expect(localaiBase()).toContain("http");
    const p = localaiImagePayload({ prompt: "desert", width: 768, height: 1344 });
    expect(p.size).toBe("768x1344");
    expect(p.n).toBe(1);
    expect(p.model).toBe(localaiImageModel());
  });
});

describe("HF diffusers adapter", () => {
  it("router URL points at the configured model", () => {
    expect(hfImageUrl("foo/bar")).toBe("https://router.huggingface.co/hf-inference/models/foo/bar");
    expect(hfImageUrl()).toContain(hfImageModel());
    expect(HF_IMAGE_MODELS.length).toBeGreaterThanOrEqual(3);
  });

  it("sends bearer auth only when a token exists", () => {
    const had = process.env.HF_TOKEN;
    delete process.env.HF_TOKEN;
    expect(hfImageHeaders().Authorization).toBeUndefined();
    process.env.HF_TOKEN = "hf_test123";
    expect(hfImageHeaders().Authorization).toBe("Bearer hf_test123");
    if (had === undefined) delete process.env.HF_TOKEN;
    else process.env.HF_TOKEN = had;
  });
});

describe("Khoj adapter", () => {
  it("returns null URL when unconfigured, parses fixture shapes safely", () => {
    const had = process.env.KHOJ_URL;
    delete process.env.KHOJ_URL;
    expect(khojSearchUrl("x")).toBeNull();
    if (had !== undefined) process.env.KHOJ_URL = had;
    const hits = parseKhojResults({
      results: [
        { entry: { compiled: "Mughal built Lalbagh", file: "notes/history.org" } },
        { weird: true },
        null
      ]
    });
    expect(hits).toHaveLength(3);
    expect(hits[0].text).toContain("Lalbagh");
    expect(parseKhojResults({})).toEqual([]);
    expect(parseKhojResults(null)).toEqual([]);
  });
});

function fakeProjectWithStills(): Project {
  const now = new Date().toISOString();
  return {
    id: "p9",
    name: "Remix test",
    prompt: "ghost story in old Dhaka",
    settings: { durationSec: 20, aspectRatio: "9:16", style: "dark-mystery", quality: "balanced" },
    providerId: "slideshow",
    characters: [],
    scenes: [
      {
        id: "s1", index: 0, durationSec: 5, title: "Gate",
        visualPrompt: "old gate at night", camera: "static", lighting: "moon",
        transitionIn: "fade", transitionOut: "cut", characterIds: [],
        narrationSegment: "The gate creaks.", caption: "The gate creaks.", sound: "wind",
        stillPath: "media/stills/p9/s1_7.jpg"
      },
      {
        id: "s2", index: 1, durationSec: 5, title: "No still",
        visualPrompt: "empty street", camera: "static", lighting: "lamp",
        transitionIn: "cut", transitionOut: "fade", characterIds: [],
        narrationSegment: "", caption: "", sound: ""
      }
    ],
    sceneOrder: ["s1", "s2"],
    jobs: [],
    narrationVolume: 1,
    musicVolume: 0.5,
    burnCaptions: false,
    output: { status: "idle", updatedAt: now },
    shorts: [{ path: "media/shorts/p9/short_0.mp4", startSec: 12, lenSec: 30 }],
    createdAt: now,
    updatedAt: now
  };
}

describe("Unsloth dataset export", () => {
  it("exports only scenes with stills as JSONL", () => {
    const rows = buildDatasetManifest(fakeProjectWithStills());
    expect(rows).toHaveLength(1);
    expect(rows[0].image).toContain("media/stills/p9/s1_7.jpg");
    const jl = toJsonl(rows);
    expect(JSON.parse(`[${jl}]`)).toHaveLength(1);
  });
});

describe("OpenMontage-style remix", () => {
  it("builds editable scenes from shorts with timings", () => {
    const scenes = buildRemixScenes(
      [
        { path: "a.mp4", startSec: 0, lenSec: 30 },
        { path: "b.mp4", startSec: 30, lenSec: 200 }
      ],
      "Remix"
    );
    expect(scenes).toHaveLength(2);
    expect(scenes[0].durationSec).toBe(30);
    expect(scenes[1].durationSec).toBe(60);
    expect(scenes[0].visualPrompt).toContain("0s");
    expect(remixNarration(scenes)).toContain("Remix 1");
  });
});
