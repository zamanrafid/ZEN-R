import { spawn } from "child_process";
import path from "path";
import { promises as fs } from "fs";
import { dataDir } from "./store";

/** Export folder for one project: data/media/hyperframes/<projectId>/ */
export function hyperframesExportDir(projectId: string): string {
  return path.join(dataDir(), "media", "hyperframes", projectId);
}

export function hyperframesMp4Rel(projectId: string): string {
  return `media/hyperframes/${projectId}/zoro-hyperframes.mp4`.replace(/\\/g, "/");
}

async function fileExists(abs: string): Promise<boolean> {
  try {
    const st = await fs.stat(abs);
    return st.isFile() && st.size > 1024;
  } catch {
    return false;
  }
}

export interface HyperframesRenderResult {
  ok: boolean;
  mp4Rel?: string;
  log: string;
}

/**
 * Run the Hyperframes CLI INSIDE the export dir (must contain index.html).
 * FREE + local: headless Chrome seeks frames, FFmpeg encodes. Same HTML = same MP4.
 */
export function renderHyperframesExport(projectId: string, timeoutMs = 10 * 60 * 1000): Promise<HyperframesRenderResult> {
  const cwd = hyperframesExportDir(projectId);
  return new Promise((resolve) => {
    const log: string[] = [];
    const child = spawn("npx", ["--yes", "hyperframes@latest", "render", "-o", "zoro-hyperframes.mp4"], {
      cwd,
      shell: true,
      windowsHide: true
    });
    const timer = setTimeout(() => {
      log.push("Render timed out after 10 min — try fewer/shorter scenes.");
      try { child.kill(); } catch { /* ignore */ }
      resolve({ ok: false, log: log.join("\n").slice(-4000) });
    }, timeoutMs);
    child.stdout?.on("data", (d) => log.push(String(d).slice(0, 2000)));
    child.stderr?.on("data", (d) => log.push(String(d).slice(0, 2000)));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, log: `Could not start Hyperframes CLI: ${e.message}` });
    });
    child.on("close", async (code) => {
      clearTimeout(timer);
      const abs = path.join(cwd, "zoro-hyperframes.mp4");
      const exists = await fileExists(abs);
      if (code === 0 && exists) {
        resolve({ ok: true, mp4Rel: hyperframesMp4Rel(projectId), log: log.join("\n").slice(-4000) });
      } else {
        log.push(`Hyperframes exited with code ${code}.`);
        if (!exists) log.push("No MP4 was produced — Chrome/FFmpeg error above is the real cause.");
        resolve({ ok: false, log: log.join("\n").slice(-4000) });
      }
    });
  });
}

export async function hyperframesRenderStatus(projectId: string): Promise<{ exported: boolean; rendered: boolean; mp4Rel?: string; durationSec?: number }> {
  const dir = hyperframesExportDir(projectId);
  let exported = false;
  try {
    const st = await fs.stat(path.join(dir, "index.html"));
    exported = st.isFile();
  } catch { exported = false; }
  const abs = path.join(dir, "zoro-hyperframes.mp4");
  const rendered = await fileExists(abs);
  return { exported, rendered, mp4Rel: rendered ? hyperframesMp4Rel(projectId) : undefined };
}
