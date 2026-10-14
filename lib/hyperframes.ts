import type { AspectRatio, Project } from "./types";

/**
 * Hyperframes export (FREE, local, deterministic).
 * Turns a ZORO AI project into a Hyperframes HTML composition:
 * scenes become timed title-card sections with kinetic captions,
 * approved stills become embedded assets, narration becomes <audio>.
 * Render on your PC with: npx hyperframes render -o out.mp4
 */

export function dimsForHyperframes(aspect: AspectRatio): { w: number; h: number } {
  if (aspect === "9:16") return { w: 1080, h: 1920 };
  if (aspect === "1:1") return { w: 1080, h: 1080 };
  return { w: 1920, h: 1080 };
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#8217;");
}

/** Total composition duration = sum of scene durations + 1s intro padding. */
export function hyperframesDuration(project: Project, orderedSceneIds: string[]): number {
  const total = orderedSceneIds.reduce((acc, sid) => {
    const sc = project.scenes.find((s) => s.id === sid);
    return acc + (sc?.durationSec ?? 0);
  }, 0);
  return Math.max(4, Math.round(total) + 1);
}

/**
 * Build a deterministic Hyperframes index.html for the project.
 * stillUrlFor(slcPath) maps a ZORO still rel-path to a URL reachable
 * from the composition (e.g. a copied asset path or /api/media/... URL).
 */
export function buildHyperframesHtml(
  project: Project,
  orderedSceneIds: string[],
  opts?: { stillUrlFor?: (stillPath: string) => string; narrationSrc?: string }
): string {
  const { w, h } = dimsForHyperframes(project.settings.aspectRatio);
  const total = hyperframesDuration(project, orderedSceneIds);
  const stillUrlFor = opts?.stillUrlFor ?? ((p: string) => p);
  const narrationSrc = opts?.narrationSrc ?? project.narrationAudioPath ?? "";

  let t = 0.5;
  const scenesHtml: string[] = [];
  const captionsHtml: string[] = [];
  orderedSceneIds.forEach((sid, i) => {
    const sc = project.scenes.find((s) => s.id === sid);
    if (!sc) return;
    const dur = Math.max(2, Math.round(sc.durationSec));
    const start = Math.round(t * 100) / 100;
    const title = escapeHtml(sc.title || `Scene ${i + 1}`);
    const caption = escapeHtml((sc.caption || sc.narrationSegment || title).slice(0, 200));
    const visual = escapeHtml((sc.visualPrompt || "").slice(0, 280));
    const stillImg = sc.stillPath
      ? `<img id="hf-still-${i}" src="${escapeHtml(stillUrlFor(sc.stillPath))}" alt="${title}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0.55;" />`
      : "";
    scenesHtml.push(
      `      <div id="hf-scene-${i}" class="clip scene" data-start="${start}" data-duration="${dur}" data-track-index="0">\n` +
        `        ${stillImg}\n` +
        `        <div class="hf-shade"></div>\n` +
        `        <div class="hf-kicker">${title} &#183; ${dur}s</div>\n` +
        `        <div id="hf-title-${i}" class="hf-title">${caption}</div>\n` +
        `        <div class="hf-visual">${visual}</div>\n` +
        `      </div>`
    );
    captionsHtml.push(
      `      <div id="hf-cap-${i}" class="clip" data-start="${start}" data-duration="${dur}" data-track-index="2"><div class="caption-bar"><div class="caption">${caption}</div></div></div>`
    );
    t += dur;
  });

  const audioHtml = narrationSrc
    ? `      <audio id="hf-narration" data-start="0.5" data-duration="${Math.round((t - 0.5) * 100) / 100}" data-track-index="5" src="${escapeHtml(narrationSrc)}"></audio>\n`
    : "";

  const animJs = orderedSceneIds
    .map((_, i) => {
      const s = scenesHtml.length > i ? `hf-scene-${i}` : null;
      if (!s) return "";
      return (
        `      tl.fromTo("#hf-title-${i}", { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" }, ${sceneStart(i)});\n` +
        `      tl.to("#${s}", { opacity: 0, duration: 0.4 }, ${sceneEnd(i)});`
      );
    })
    .join("\n");

  function sceneStart(i: number): number {
    let acc = 0.5;
    for (let k = 0; k < i; k++) {
      const sid = orderedSceneIds[k];
      const sc = project.scenes.find((s) => s.id === sid);
      acc += Math.max(2, Math.round(sc?.durationSec ?? 5));
    }
    return Math.round((acc + 0.2) * 100) / 100;
  }
  function sceneEnd(i: number): number {
    const sid = orderedSceneIds[i];
    const sc = project.scenes.find((s) => s.id === sid);
    const start = sceneStart(i);
    return Math.round((start + Math.max(2, Math.round(sc?.durationSec ?? 5)) - 0.4) * 100) / 100;
  }

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${w}, height=${h}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      html, body { margin:0; width:${w}px; height:${h}px; overflow:hidden; background:#050505; font-family:Inter,system-ui,sans-serif; }
      #root { position:relative; width:100%; height:100%; background:#050505; overflow:hidden; }
      .clip { position:absolute; top:0; left:0; width:100%; height:100%; }
      .scene { display:flex; align-items:center; justify-content:center; flex-direction:column; text-align:center; padding:80px; }
      .hf-shade { position:absolute; inset:0; background:linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0.85)); }
      .hf-kicker { position:relative; z-index:2; color:#888; font-size:28px; letter-spacing:0.4em; text-transform:uppercase; margin-bottom:24px; }
      .hf-title { position:relative; z-index:2; color:#fff; font-size:${w > h ? 84 : 64}px; font-weight:800; line-height:1.15; max-width:85%; text-shadow:0 4px 30px rgba(0,0,0,0.8); }
      .hf-visual { position:relative; z-index:2; color:#666; font-size:22px; margin-top:28px; max-width:75%; line-height:1.5; }
      .caption-bar { position:absolute; bottom:60px; left:0; right:0; display:flex; justify-content:center; z-index:20; pointer-events:none; }
      .caption { background:rgba(0,0,0,0.85); color:#fff; font-size:40px; font-weight:600; padding:14px 36px; border-radius:12px; max-width:85%; text-align:center; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="${w}" data-height="${h}">
${audioHtml}${scenesHtml.join("\n")}
${captionsHtml.join("\n")}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
${animJs}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
}
