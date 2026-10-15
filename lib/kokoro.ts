import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

/**
 * Kokoro local neural voice engine (same Kokoro-82M family as
 * FluxNote free-text-to-speech + local-ai-voice-studio: Apache-2.0 weights,
 * CPU-only, no key, no account. Internet needed ONCE for the model download,
 * then never — exactly like local-ai-voice-studio's story).
 *
 * Runs through the installed hyperframes CLI (already a ZEN R dependency):
 *   npx hyperframes tts --text-file <txt> -o <wav> -v <voice> -s <speed>
 * Kokoro voices are English-only (both source repos are English-only too) —
 * Bangla voices still prefer edge-tts; Kokoro is their offline fallback.
 */

/** ZEN R voice id → Kokoro voice id (hyperframes tts --list). */
export const KOKORO_VOICES: Record<string, string> = {
  aria: "af_heart",
  jenny: "af_bella",
  guy: "am_adam",
  davis: "am_michael",
  emma: "bf_emma",
  nabanita: "bf_isabella",
  pradeep: "bm_george",
  nova: "af_nova",
  alloy: "af_heart",
  echo: "af_sky",
  fable: "af_bella",
  onyx: "am_michael",
  shimmer: "af_sky"
};

export function kokoroVoiceFor(voice: string): string | null {
  if (voice === "robot") return null;
  return KOKORO_VOICES[voice] ?? "af_heart";
}

export function kokoroSpeed(rate: "slow" | "normal" | "fast"): number {
  if (rate === "slow") return 0.85;
  if (rate === "fast") return 1.15;
  return 1.0;
}

let cached: boolean | null | undefined;

/** True when `hyperframes tts` answers (CLI present; model downloads on first use). */
export async function checkKokoro(): Promise<{ ok: boolean; detail?: string }> {
  if (cached !== undefined) return cached ? { ok: true, detail: "Kokoro local neural voice ready (CPU, no key)" } : { ok: false };
  const ok = await new Promise<boolean>((resolve) => {
    const child = spawn("npx", ["--yes", "hyperframes", "tts", "--list"], { shell: true, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
    setTimeout(() => resolve(false), 60000);
  });
  cached = ok;
  return ok
    ? { ok: true, detail: "Kokoro local neural voice ready (CPU, no key)" }
    : { ok: false, detail: "Kokoro CLI unavailable." };
}

/**
 * Synthesize one chunk to WAV via local Kokoro. First run downloads the model
 * once (~300MB, needs internet); afterwards fully offline. Throws honestly.
 */
export async function kokoroTtsWav(
  text: string,
  voice: string,
  wavAbsPath: string,
  rate: "slow" | "normal" | "fast" = "normal"
): Promise<void> {
  const kv = kokoroVoiceFor(voice);
  if (!kv) throw new Error("Robot voice has no Kokoro equivalent.");
  const clean = text.replace(/\s+/g, " ").trim().slice(0, 1500);
  if (!clean) throw new Error("Empty narration text.");
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "zenr-kokoro-"));
  const txtPath = path.join(tmpDir, "chunk.txt");
  try {
    await fs.writeFile(txtPath, clean, "utf-8");
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        "npx",
        ["--yes", "hyperframes", "tts", "--text-file", txtPath, "-o", wavAbsPath, "-v", kv, "-s", String(kokoroSpeed(rate))],
        { shell: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
      );
      let err = "";
      child.stderr?.on("data", (d) => (err += String(d).slice(-600)));
      child.on("error", (e) => reject(new Error(`Could not launch Kokoro TTS: ${e.message}`)));
      const killer = setTimeout(() => {
        try { child.kill(); } catch { /* ignore */ }
        reject(new Error("Kokoro synthesis timed out (10 min). First run downloads the model — check internet and retry."));
      }, 600000);
      child.on("close", (code) => {
        clearTimeout(killer);
        if (code === 0) resolve();
        else reject(new Error(`Kokoro synthesis failed (exit ${code}). ${err || "First run needs internet for the one-time model download."}`));
      });
    });
    const st = await fs.stat(wavAbsPath).catch(() => null);
    if (!st || st.size < 1024) throw new Error("Kokoro produced an empty file — treating as failure.");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
