import { beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

process.env.ZENR_DATA_DIR = path.join(os.tmpdir(), `zenr-race-${Date.now()}`);

import { getProject, persistJob, pushJob, saveProject } from "../lib/store";
import type { GenerationJob, Project } from "../lib/types";

function fakeProject(id: string): Project {
  const now = new Date().toISOString();
  return {
    id,
    name: "race",
    prompt: "A detective in old Dhaka uncovers a mystery.",
    settings: { durationSec: 20, aspectRatio: "9:16", style: "fantasy", motionIntensity: "low", quality: "fast" },
    providerId: "slideshow",
    characters: [],
    scenes: [],
    sceneOrder: [],
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

function fakeJob(id: string): GenerationJob {
  const now = new Date().toISOString();
  return { id, sceneId: "s1", providerId: "slideshow", status: "queued", progress: 0, logs: [], createdAt: now, updatedAt: now };
}

describe("storage race safety (parallel polls)", () => {
  beforeEach(async () => {
    await fs.mkdir(process.env.ZENR_DATA_DIR!, { recursive: true });
  });

  it("concurrent pushJob calls lose no jobs", async () => {
    const p = fakeProject(`race-push-${Date.now()}`);
    await saveProject(p);
    await Promise.all(Array.from({ length: 10 }, (_, i) => pushJob(p.id, fakeJob(`j${i}`))));
    const fresh = await getProject(p.id);
    expect(fresh?.jobs.map((j) => j.id).sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => `j${i}`).sort()
    );
  });

  it("concurrent persistJob calls lose no progress", async () => {
    const p = fakeProject(`race-persist-${Date.now()}`);
    await saveProject(p);
    for (let i = 0; i < 5; i++) await pushJob(p.id, fakeJob(`k${i}`));
    await Promise.all(
      [0, 1, 2, 3, 4].map((i) =>
        persistJob(p.id, { ...fakeJob(`k${i}`), status: "processing", progress: (i + 1) * 10 })
      )
    );
    const fresh = await getProject(p.id);
    expect(fresh?.jobs).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(fresh?.jobs.find((j) => j.id === `k${i}`)?.progress).toBe((i + 1) * 10);
    }
  });

  it("never revives a job cancelled elsewhere (replan wins)", async () => {
    const p = fakeProject(`race-cancel-${Date.now()}`);
    await saveProject(p);
    await pushJob(p.id, fakeJob("c1"));
    // Someone cancels it (e.g. replan) with a newer timestamp.
    await persistJob(p.id, { ...fakeJob("c1"), status: "cancelled" as const });
    // A stale poller tries to mark it processing — must NOT revive.
    const r = await persistJob(p.id, { ...fakeJob("c1"), status: "processing" as const, progress: 50 });
    expect(r?.job.status).toBe("cancelled");
    const fresh = await getProject(p.id);
    expect(fresh?.jobs.find((j) => j.id === "c1")?.status).toBe("cancelled");
  });

  it("returns null for missing project/job (honest 404 path)", async () => {
    expect(await persistJob("nope-missing", fakeJob("x"))).toBeNull();
  });
});
