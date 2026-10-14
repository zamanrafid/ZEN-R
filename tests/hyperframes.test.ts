import { describe, expect, it } from "vitest";
import { buildHyperframesHtml, dimsForHyperframes, escapeHtml, hyperframesDuration } from "../lib/hyperframes";
import type { Project } from "../lib/types";

function fakeProject(): Project {
  const now = new Date().toISOString();
  return {
    id: "p1",
    name: "Horror test",
    prompt: "ghost story",
    settings: { durationSec: 10, aspectRatio: "16:9", style: "dark-mystery", quality: "balanced" },
    providerId: "hyperframes",
    characters: [],
    scenes: [
      {
        id: "s1", index: 0, durationSec: 5, title: "Scene 1",
        visualPrompt: "dark room", camera: "push-in", lighting: "low-key",
        transitionIn: "fade", transitionOut: "cut", characterIds: [],
        narrationSegment: "At 2:17 AM.", caption: "At 2:17 AM <b>scary</b>", sound: "ambient"
      },
      {
        id: "s2", index: 1, durationSec: 5, title: "Scene 2",
        visualPrompt: "door", camera: "static", lighting: "red",
        transitionIn: "cut", transitionOut: "fade", characterIds: [],
        narrationSegment: "Don't open.", caption: "Don't open.", sound: "knock"
      }
    ],
    sceneOrder: ["s1", "s2"],
    jobs: [],
    narrationVolume: 1,
    musicVolume: 0.5,
    burnCaptions: false,
    output: { status: "idle", updatedAt: now },
    shorts: [],
    createdAt: now,
    updatedAt: now
  };
}

describe("hyperframes export", () => {
  it("dims match aspect", () => {
    expect(dimsForHyperframes("16:9")).toEqual({ w: 1920, h: 1080 });
    expect(dimsForHyperframes("9:16")).toEqual({ w: 1080, h: 1920 });
    expect(dimsForHyperframes("1:1")).toEqual({ w: 1080, h: 1080 });
  });

  it("escapes HTML in captions", () => {
    expect(escapeHtml(`a<b>&"'`)).toBe("a&lt;b&gt;&amp;&quot;&#8217;");
  });

  it("builds a deterministic composition with timed clips + audio", () => {
    const p = fakeProject();
    const html = buildHyperframesHtml(p, p.sceneOrder, { narrationSrc: "assets/voice.wav" });
    // Composition contract
    expect(html).toContain('data-composition-id="main"');
    expect(html).toContain('data-width="1920"');
    expect(html).toContain('id="hf-narration"');
    expect(html).toContain('src="assets/voice.wav"');
    // Both scenes timed
    expect(html).toContain('id="hf-scene-0"');
    expect(html).toContain('id="hf-scene-1"');
    expect(html).toContain('data-start="0.5"');
    // Caption HTML escaped, not raw
    expect(html).toContain("At 2:17 AM &lt;b&gt;scary&lt;/b&gt;");
    expect(html).not.toContain("At 2:17 AM <b>scary</b>");
    // Paused seekable timeline registered
    expect(html).toContain('window.__timelines["main"]');
    expect(html).toContain("paused: true");
  });

  it("duration sums scenes + intro", () => {
    expect(hyperframesDuration(fakeProject(), ["s1", "s2"])).toBe(11);
  });
});
