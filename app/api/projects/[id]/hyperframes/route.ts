export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { dataDir, getProject } from "@/lib/store";
import { buildHyperframesHtml, buildHyperframesManifest, hyperframesDuration, themeForStyle } from "@/lib/hyperframes";
import type { HyperframesThemeId } from "@/lib/hyperframes";

/**
 * POST /api/projects/[id]/hyperframes — export a deterministic Hyperframes
 * composition (index.html) built from the storyboard. 100% free, no keys.
 * Copies approved stills + narration into the export folder so
 * `npx hyperframes render` works offline from there.
 * Body (optional): { theme?: "horror"|"cinematic"|"neon-anime"|"gold-doc"|"midnight" }
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const p = await getProject(params.id);
  if (!p) return NextResponse.json({ error: "Project not found." }, { status: 404 });
  if (!p.scenes.length) return NextResponse.json({ error: "Plan the storyboard first." }, { status: 400 });
  let theme: HyperframesThemeId = themeForStyle(p.settings.style);
  try {
    const body = await req.json();
    if (body?.theme && ["horror", "cinematic", "neon-anime", "gold-doc", "midnight"].includes(body.theme)) {
      theme = body.theme;
    }
  } catch { /* theme optional */ }

  const exportRel = `media/hyperframes/${p.id}`;
  const exportAbs = path.join(dataDir(), exportRel);
  await fs.mkdir(path.join(exportAbs, "assets"), { recursive: true });

  const stillUrlFor = (stillPath: string): string => {
    return stillPath;
  };

  // Copy stills + narration next to the composition for offline renders.
  // GSAP is vendored (public/vendor) so renders work with the internet OFF.
  try {
    await fs.copyFile(
      path.join(process.cwd(), "public", "vendor", "gsap.min.js"),
      path.join(exportAbs, "assets", "gsap.min.js")
    );
  } catch {
    // Vendor copy failed — composition still references assets/gsap.min.js.
  }
  for (const sc of p.scenes) {
    if (!sc.stillPath) continue;
    try {
      const src = path.join(dataDir(), sc.stillPath);
      const dst = path.join(exportAbs, "assets", path.basename(sc.stillPath));
      await fs.copyFile(src, dst);
    } catch {
      // Missing still — composition still renders with typography only.
    }
  }
  let narrationSrc = "";
  if (p.narrationAudioPath) {
    try {
      const src = path.join(dataDir(), p.narrationAudioPath);
      const dst = path.join(exportAbs, "assets", path.basename(p.narrationAudioPath));
      await fs.copyFile(src, dst);
      narrationSrc = `assets/${path.basename(p.narrationAudioPath)}`;
    } catch {
      narrationSrc = "";
    }
  }

  const html = buildHyperframesHtml(p, p.sceneOrder, {
    stillUrlFor: (sp) => `assets/${path.basename(sp)}`,
    narrationSrc,
    theme
  });
  await fs.writeFile(path.join(exportAbs, "index.html"), html, "utf-8");
  await fs.writeFile(
    path.join(exportAbs, "hyperframes.json"),
    JSON.stringify(buildHyperframesManifest(p, p.sceneOrder, theme), null, 2),
    "utf-8"
  );
  await fs.writeFile(
    path.join(exportAbs, "README.txt"),
    `ZORO AI Ultimate Hyperframes export for "${p.name}" (theme: ${theme}).\n\nOne-click (in app): POST /api/projects/${p.id}/hyperframes/render\nManual on your PC:\n  cd "${exportAbs}"\n  npx --yes hyperframes@latest render -o zoro-hyperframes.mp4\n\nDeterministic: same HTML in, same MP4 out (Chrome + FFmpeg).\n`,
    "utf-8"
  );

  return NextResponse.json({
    ok: true,
    exportPath: `${exportRel}/index.html`.replace(/\\/g, "/"),
    durationSec: hyperframesDuration(p, p.sceneOrder),
    theme,
    renderUrl: `/api/projects/${p.id}/hyperframes/render`,
    note: "FREE Ultimate Hyperframes composition exported (permanent integration). One-click render in app, or locally: npx hyperframes render -o zoro-hyperframes.mp4"
  });
}
