import { describe, expect, it } from "vitest";
import { CHUNK_GAP_SEC, HOSTED_TO_EDGE, edgeVoiceFor, resolveVoiceEngines } from "../lib/voice";
import { kokoroSpeed, kokoroVoiceFor } from "../lib/kokoro";
import { elevenlabsModel, elevenlabsPayload, elevenlabsTtsUrl } from "../lib/elevenlabs";
import { buildSrt, buildXfadeChain, fadeFilters, gradeFilter } from "../lib/ffmpeg";

describe("voice engine resolution (best voice wins)", () => {
  it("natural voice prefers edge, then kokoro, hosted, robot last", () => {
    expect(resolveVoiceEngines("aria", { edge: true, kokoro: true, hosted: true, offline: true, eleven: false }))
      .toEqual(["edge", "kokoro", "hosted", "offline"]);
    expect(resolveVoiceEngines("nabanita", { edge: true, kokoro: false, hosted: false, offline: false, eleven: false }))
      .toEqual(["edge"]);
    // Old bug: aria without edge fell to robot, skipping hosted.
    expect(resolveVoiceEngines("aria", { edge: false, kokoro: false, hosted: true, offline: true, eleven: false }))
      .toEqual(["hosted", "offline"]);
    // Kokoro bridges the gap: no edge, no hosted → local neural before robot.
    expect(resolveVoiceEngines("aria", { edge: false, kokoro: true, hosted: false, offline: true, eleven: false }))
      .toEqual(["kokoro", "offline"]);
  });

  it("hosted-only voices try hosted first, then closest edge, then kokoro", () => {
    expect(resolveVoiceEngines("nova", { edge: true, kokoro: true, hosted: true, offline: true, eleven: false }))
      .toEqual(["hosted", "edge", "kokoro", "offline"]);
    expect(HOSTED_TO_EDGE.nova).toBe("aria");
    expect(edgeVoiceFor("nova")).toBe("aria");
    expect(edgeVoiceFor("aria")).toBe("aria");
  });

  it("robot is offline-only; empty chain when nothing works", () => {
    expect(resolveVoiceEngines("robot", { edge: true, kokoro: true, hosted: true, offline: true, eleven: false }))
      .toEqual(["offline"]);
    expect(resolveVoiceEngines("aria", { edge: false, kokoro: false, hosted: false, offline: false, eleven: false }))
      .toEqual([]);
    expect(CHUNK_GAP_SEC).toBeGreaterThan(0);
  });
});

describe("elevenlabs opt-in paid engine", () => {
  it("is used only for the explicit eleven voice, with free fallbacks", () => {
    expect(resolveVoiceEngines("eleven", { edge: true, kokoro: true, hosted: true, offline: true, eleven: true })[0])
      .toBe("eleven");
    expect(resolveVoiceEngines("eleven", { edge: true, kokoro: true, hosted: true, offline: true, eleven: false })[0])
      .toBe("edge");
    // Other voices never touch the paid key.
    expect(resolveVoiceEngines("aria", { edge: true, kokoro: true, hosted: true, offline: true, eleven: true }))
      .toEqual(["edge", "kokoro", "hosted", "offline"]);
  });

  it("builds the official v1 TTS request shape", () => {
    expect(elevenlabsTtsUrl("abc123")).toBe("https://api.elevenlabs.io/v1/text-to-speech/abc123");
    expect(elevenlabsTtsUrl()).toContain("/v1/text-to-speech/");
    const p = elevenlabsPayload("Hello world") as { text: string; model_id: string; voice_settings: { stability: number } };
    expect(p.text).toBe("Hello world");
    expect(p.model_id).toBe(elevenlabsModel());
    expect(p.voice_settings.stability).toBeGreaterThan(0);
  });
});

describe("kokoro voice mapping (FluxNote + Voice Studio family)", () => {
  it("maps every ZEN R voice to a Kokoro id (robot excluded)", () => {
    expect(kokoroVoiceFor("aria")).toBe("af_heart");
    expect(kokoroVoiceFor("guy")).toBe("am_adam");
    expect(kokoroVoiceFor("emma")).toBe("bf_emma");
    expect(kokoroVoiceFor("nova")).toBe("af_nova");
    expect(kokoroVoiceFor("robot")).toBeNull();
    expect(kokoroSpeed("slow")).toBe(0.85);
    expect(kokoroSpeed("normal")).toBe(1.0);
    expect(kokoroSpeed("fast")).toBe(1.15);
  });
});

describe("cinematic assembly builders", () => {
  it("xfade chain offsets + totals are exact", () => {
    const two = buildXfadeChain([5, 5], 0.5);
    expect(two.total).toBe(9.5);
    expect(two.filter).toBe("[v0][v1]xfade=transition=fade:duration=0.5:offset=4.50[vcat]");
    const three = buildXfadeChain([4, 6, 5], 0.5);
    expect(three.total).toBe(14);
    expect(three.filter).toContain("[v0][v1]xfade=transition=fade:duration=0.5:offset=3.50[x1]");
    expect(three.filter).toContain("[x1][v2]xfade=transition=fade:duration=0.5:offset=9.00[vcat]");
    const one = buildXfadeChain([5], 0.5);
    expect(one.total).toBe(5);
  });

  it("fades + grade filters are well-formed", () => {
    expect(fadeFilters(10)).toBe("fade=t=in:st=0:d=0.5,fade=t=out:st=9.50:d=0.5");
    expect(gradeFilter("balanced")).toContain("vignette");
    expect(gradeFilter("balanced")).toContain("noise=alls=7:allf=t");
    expect(gradeFilter("best")).toContain("unsharp");
  });

  it("SRT shifts for transitions without overlaps", () => {
    const project = {
      scenes: [
        { id: "a", durationSec: 5, caption: "One", narrationSegment: "" },
        { id: "b", durationSec: 5, caption: "Two", narrationSegment: "" }
      ]
    } as never;
    const srt = buildSrt(project, ["a", "b"], 0.5);
    expect(srt).toContain("00:00:00,000 --> 00:00:04,500");
    expect(srt).toContain("00:00:04,500 --> 00:00:09,500");
    // No-transition path unchanged.
    expect(buildSrt(project, ["a", "b"])).toContain("00:00:05,000 --> 00:00:10,000");
  });
});
