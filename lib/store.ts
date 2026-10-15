import { promises as fs } from "fs";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "fs";
import os from "os";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import type { GenerationJob, Project } from "./types";

let cachedDir: string | null = null;

/** Writable data dir. Falls back to the OS temp dir on read-only hosts (e.g. serverless). */
export function dataDir(): string {
  if (cachedDir) return cachedDir;
  const configured = process.env.ZENR_DATA_DIR ?? process.env.ZORO_DATA_DIR;
  const primary = configured
    ? (path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured))
    : path.join(process.cwd(), "data");
  cachedDir = writableDir(primary) ?? writableDir(path.join(os.tmpdir(), "zoro-ai-data")) ?? primary;
  if (cachedDir !== primary) {
    console.warn(`[zen-r] storage ${primary} is not writable — using ephemeral ${cachedDir}. Files will NOT persist across restarts/deploys.`);
  }
  return cachedDir;
}

function writableDir(dir: string): string | null {
  try {
    mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, ".write-test");
    writeFileSync(probe, "ok");
    unlinkSync(probe);
    return dir;
  } catch {
    return null;
  }
}

export function projectsDir(): string {
  return path.join(dataDir(), "projects");
}
export function mediaDir(): string {
  return path.join(dataDir(), "media");
}
export function jobsDir(): string {
  return path.join(dataDir(), "jobs");
}

export async function ensureDirs(): Promise<void> {
  for (const d of [dataDir(), projectsDir(), mediaDir(), jobsDir()]) {
    await fs.mkdir(d, { recursive: true });
  }
}

function projectPath(id: string): string {
  return path.join(projectsDir(), `${id}.json`);
}

export async function listProjects(): Promise<Project[]> {
  await ensureDirs();
  const files = await fs.readdir(projectsDir()).catch(() => [] as string[]);
  const out: Project[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(projectsDir(), f), "utf-8");
      out.push(JSON.parse(raw) as Project);
    } catch {
      // skip corrupt files but don't crash the dashboard
    }
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getProject(id: string): Promise<Project | null> {
  await ensureDirs();
  try {
    const raw = await fs.readFile(projectPath(id), "utf-8");
    return JSON.parse(raw) as Project;
  } catch {
    return null;
  }
}

export async function saveProject(p: Project): Promise<void> {
  return withProjectLock(p.id, async () => {
    await ensureDirs();
    p.updatedAt = new Date().toISOString();
    await atomicWriteFile(projectPath(p.id), JSON.stringify(p, null, 2));
  });
}

/**
 * Concurrency-safe storage (the fix for "Job or project no longer exists"
 * under parallel polling): temp-file + rename makes writes atomic (no torn
 * reads), and a per-project promise chain serializes read-modify-write cycles
 * (no lost jobs/scenes). NEVER hold the lock across network/FFmpeg work —
 * only around the micro read+mutate+write section.
 */
const projectLocks = new Map<string, Promise<void>>();

export async function withProjectLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = projectLocks.get(projectId) ?? Promise.resolve();
  let release!: () => void;
  const cur = new Promise<void>((r) => (release = r));
  projectLocks.set(projectId, prev.then(() => cur));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (projectLocks.get(projectId) === cur) projectLocks.delete(projectId);
  }
}

async function atomicWriteFile(absPath: string, data: string): Promise<void> {
  const tmp = `${absPath}.${process.pid}.tmp`;
  await fs.writeFile(tmp, data, "utf-8");
  await fs.rename(tmp, absPath);
}

const TERMINAL = new Set(["succeeded", "failed", "cancelled"]);

/**
 * Surgical job persist: fresh-read the project under lock, replace ONLY this
 * job object, save atomically. Terminal states set by others (e.g. replan
 * cancel) are never revived. Returns null when project/job is gone.
 */
export async function persistJob(
  projectId: string,
  job: GenerationJob,
  extra?: { stillPath?: string; sceneId?: string; log?: string }
): Promise<{ project: Project; job: GenerationJob } | null> {
  return withProjectLock(projectId, async () => {
    await ensureDirs();
    const fresh = await getProject(projectId);
    if (!fresh) return null;
    const fj = fresh.jobs.find((j) => j.id === job.id);
    if (!fj) return null;
    const cancelledElsewhere = TERMINAL.has(fj.status) && !TERMINAL.has(job.status);
    if (!cancelledElsewhere) {
      Object.assign(fj, job, { updatedAt: new Date().toISOString() });
      if (extra?.log) fj.logs.push(extra.log);
      if (extra?.stillPath && extra.sceneId) {
        const sc = fresh.scenes.find((s) => s.id === extra.sceneId);
        if (sc && !sc.stillPath) sc.stillPath = extra.stillPath;
      }
    }
    await atomicWriteFile(projectPath(fresh.id), JSON.stringify({ ...fresh, updatedAt: new Date().toISOString() }, null, 2));
    return { project: fresh, job: fj };
  });
}

/** Locked job append — concurrent generate calls can never lose a job. */
export async function pushJob(projectId: string, job: GenerationJob): Promise<Project> {
  return withProjectLock(projectId, async () => {
    await ensureDirs();
    const fresh = await getProject(projectId);
    if (!fresh) throw new Error("Project not found.");
    if (!fresh.jobs.some((j) => j.id === job.id)) fresh.jobs.push(job);
    await atomicWriteFile(projectPath(fresh.id), JSON.stringify({ ...fresh, updatedAt: new Date().toISOString() }, null, 2));
    return fresh;
  });
}

export function newId(prefix = ""): string {
  return `${prefix}${uuidv4()}`;
}

export async function deleteProjectFiles(p: Project): Promise<void> {
  // Remove media + clips belonging to this project. Never touch other projects.
  const targets = new Set<string>();
  for (const c of p.characters ?? []) {
    if (c.referenceImagePath) targets.add(c.referenceImagePath);
  }
  for (const j of p.jobs ?? []) {
    if (j.clipPath) targets.add(j.clipPath);
    if (j.posterPath) targets.add(j.posterPath);
  }
  for (const s of p.scenes ?? []) {
    if (s.stillPath) targets.add(s.stillPath);
  }
  if (p.output?.path) targets.add(p.output.path);
  if (p.output?.srtPath) targets.add(p.output.srtPath);
  if (p.narrationAudioPath) targets.add(p.narrationAudioPath);
  for (const t of targets) {
    try {
      const abs = path.join(dataDir(), t);
      await fs.unlink(abs);
    } catch {
      // already gone — fine
    }
  }
  // Sweep per-project directories (stills, clips, audio) and temp export renders.
  const sweepDirs = [
    path.join(dataDir(), "media", "stills", p.id),
    path.join(dataDir(), "media", "clips", p.id),
    path.join(dataDir(), "media", p.id)
  ];
  for (const d of sweepDirs) {
    try {
      await fs.rm(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  try {
    const exports = await fs.readdir(path.join(dataDir(), "media", "exports")).catch(() => [] as string[]);
    for (const f of exports) {
      if (f.includes(p.id)) {
        try { await fs.unlink(path.join(dataDir(), "media", "exports", f)); } catch { /* ignore */ }
      }
    }
  } catch {
    // ignore
  }
  try {
    await fs.unlink(projectPath(p.id));
  } catch {
    // ignore
  }
  // Remove job index entries
  for (const j of p.jobs ?? []) {
    try {
      await fs.unlink(path.join(jobsDir(), `${j.id}.json`));
    } catch {
      // ignore
    }
  }
}

/** Persist a base64 data-URL upload into data/media and return the project-relative path. */
export async function saveUpload(
  projectId: string,
  kind: string,
  filename: string,
  dataUrl: string,
  allowedMime: RegExp,
  maxBytes: number
): Promise<string> {
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("Upload must be a base64 data URL.");
  const [, mime, b64] = m;
  if (!allowedMime.test(mime)) throw new Error(`Unsupported file type: ${mime}`);
  const buf = Buffer.from(b64, "base64");
  if (buf.length > maxBytes) {
    throw new Error(`File too large (${Math.round(buf.length / 1024)} KB). Limit is ${Math.round(maxBytes / 1024)} KB.`);
  }
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "upload.bin";
  const rel = path.join("media", projectId, kind, `${Date.now()}_${safe}`).replace(/\\/g, "/");
  const abs = path.join(dataDir(), rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buf);
  return rel;
}
