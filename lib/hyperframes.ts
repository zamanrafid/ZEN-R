import type { AspectRatio, Project, VisualStyle } from "./types";

/**
 * ZORO AI Ultimate Cinematic Engine — Hyperframes, permanently integrated.
 * Turns a ZORO AI project into a deterministic Hyperframes HTML composition:
 * scenes become timed cinematic sections with kinetic captions,
 * approved stills become embedded assets, narration becomes <audio>.
 *
 * Render options (all FREE, local, no key):
 *   1-click in-app:  POST /api/projects/[id]/hyperframes/render (Chrome + FFmpeg)
 *   manual on PC:    npx hyperframes render -o zoro-hyperframes.mp4 (inside export folder)
 */

export type HyperframesThemeId = "horror" | "cinematic" | "neon-anime" | "gold-doc" | "midnight";

export interface HyperframesTheme {
  id: HyperframesThemeId;
  label: string;
  accent: string;
  bg: string;
  kickerColor: string;
  titleFont: string;
  grainOpacity: number;
}

export const HYPERFRAMES_THEMES: Record<HyperframesThemeId, HyperframesTheme> = {
  horror: {
    id: "horror",
    label: "Horror / Mystery — blood-red kinetic type, heavy grain",
    accent: "#ff2a2a",
    bg: "#050505",
    kickerColor: "#a33",
    titleFont: "Georgia, 'Times New Roman', serif",
    grainOpacity: 0.14
  },
  cinematic: {
    id: "cinematic",
    label: "Cinematic — teal/gold blockbuster, letterbox",
    accent: "#e8b34b",
    bg: "#070b12",
    kickerColor: "#7dd3fc",
    titleFont: "Inter,system-ui,sans-serif",
    grainOpacity: 0.07
  },
  "neon-anime": {
    id: "neon-anime",
    label: "Neon Anime — magenta/cyan glow titles",
    accent: "#ff4df0",
    bg: "#0a0614",
    kickerColor: "#22d3ee",
    titleFont: "'Segoe UI',Inter,system-ui,sans-serif",
    grainOpacity: 0.05
  },
  "gold-doc": {
    id: "gold-doc",
    label: "Gold Documentary — warm serif, calm fades",
    accent: "#d4a437",
    bg: "#0d0b08",
    kickerColor: "#c9b896",
    titleFont: "Georgia, serif",
    grainOpacity: 0.06
  },
  midnight: {
    id: "midnight",
    label: "Midnight — clean universal default",
    accent: "#8b5cf6",
    bg: "#050505",
    kickerColor: "#888",
    titleFont: "Inter,system-ui,sans-serif",
    grainOpacity: 0.08
  }
};

/** Map ZORO visual style → ultimate theme. Explicit opts.theme always wins. */
export function themeForStyle(style?: VisualStyle): HyperframesThemeId {
  if (style === "dark-mystery" || style === "historical") return "horror";
  if (style === "cinematic-documentary") return "cinematic";
  if (style === "animation" || style === "fantasy") return "neon-anime";
  if (style === "realistic") return "gold-doc";
  return "midnight";
}

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
  opts?: { stillUrlFor?: (stillPath: string) => string; narrationSrc?: string; theme?: HyperframesThemeId }
): string {
  const { w, h } = dimsForHyperframes(project.settings.aspectRatio);
  const total = hyperframesDuration(project, orderedSceneIds);
  const stillUrlFor = opts?.stillUrlFor ?? ((p: string) => p);
  const narrationSrc = opts?.narrationSrc ?? project.narrationAudioPath ?? "";
  const theme = HYPERFRAMES_THEMES[opts?.theme ?? themeForStyle(project.settings.style)];
  const vertical = h > w;
  const projectTitle = escapeHtml(project.title || project.name || "ZORO AI");

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
      ? `<img id="hf-still-${i}" class="hf-still" src="${escapeHtml(stillUrlFor(sc.stillPath))}" alt="${title}" />`
      : `<div id="hf-still-${i}" class="hf-still hf-gradient"></div>`;
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
        `      tl.fromTo("#hf-title-${i}", { opacity: 0, y: 60, letterSpacing: "0.02em" }, { opacity: 1, y: 0, duration: 0.7, ease: "power3.out" }, ${sceneStart(i)});\n` +
        `      tl.fromTo("#hf-still-${i}", { scale: 1.0 }, { scale: 1.12, duration: ${sceneDur(i)}, ease: "none" }, ${sceneStart(i)});\n` +
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
  function sceneDur(i: number): number {
    const sid = orderedSceneIds[i];
    const sc = project.scenes.find((s) => s.id === sid);
    return Math.max(2, Math.round(sc?.durationSec ?? 5));
  }
  function sceneEnd(i: number): number {
    const start = sceneStart(i);
    return Math.round((start + sceneDur(i) - 0.4) * 100) / 100;
  }

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${w}, height=${h}" />
    <meta name="zoro-theme" content="${theme.id}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      html, body { margin:0; width:${w}px; height:${h}px; overflow:hidden; background:${theme.bg}; font-family:${theme.titleFont}; }
      #root { position:relative; width:100%; height:100%; background:${theme.bg}; overflow:hidden; }
      .clip { position:absolute; top:0; left:0; width:100%; height:100%; }
      .scene { display:flex; align-items:center; justify-content:center; flex-direction:column; text-align:center; padding:80px; }
      .hf-still { position:absolute; inset:-4%; width:108%; height:108%; object-fit:cover; opacity:0.6; transform-origin:center; }
      .hf-gradient { background:radial-gradient(circle at 50% 30%, ${theme.accent}55, ${theme.bg} 70%); }
      .hf-shade { position:absolute; inset:0; background:linear-gradient(180deg, rgba(0,0,0,0.5), rgba(0,0,0,0.88)); }
      .hf-vignette { position:absolute; inset:0; z-index:5; pointer-events:none; background:radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%); }
      .hf-grain { position:absolute; inset:0; z-index:6; pointer-events:none; opacity:${theme.grainOpacity}; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E"); }
      .hf-bar { position:absolute; left:0; right:0; height:${vertical ? 120 : 90}px; background:#000; z-index:15; }
      .hf-bar.top { top:0; } .hf-bar.bottom { bottom:0; }
      .hf-kicker { position:relative; z-index:2; color:${theme.kickerColor}; font-size:28px; letter-spacing:0.4em; text-transform:uppercase; margin-bottom:24px; }
      .hf-title { position:relative; z-index:2; color:#fff; font-size:${w > h ? 84 : 64}px; font-weight:800; line-height:1.15; max-width:85%; text-shadow:0 4px 30px rgba(0,0,0,0.8), 0 0 42px ${theme.accent}44; }
      .hf-accent { color:${theme.accent}; }
      .hf-visual { position:relative; z-index:2; color:#999; font-size:22px; margin-top:28px; max-width:75%; line-height:1.5; }
      .hf-intro { display:flex; align-items:center; justify-content:center; flex-direction:column; z-index:10; }
      .hf-intro-title { color:#fff; font-size:${w > h ? 96 : 72}px; font-weight:900; letter-spacing:0.06em; }
      .hf-intro-sub { color:${theme.accent}; font-size:30px; letter-spacing:0.5em; margin-top:18px; text-transform:uppercase; }
      .caption-bar { position:absolute; bottom:${vertical ? 180 : 150}px; left:0; right:0; display:flex; justify-content:center; z-index:20; pointer-events:none; }
      .caption { background:rgba(0,0,0,0.85); color:#fff; font-size:40px; font-weight:600; padding:14px 36px; border-radius:12px; max-width:85%; text-align:center; border:1px solid ${theme.accent}33; }
      .hf-progress { position:absolute; bottom:0; left:0; height:8px; width:100%; background:rgba(255,255,255,0.08); z-index:30; }
      .hf-progress-fill { height:100%; width:0%; background:${theme.accent}; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="${w}" data-height="${h}">
${audioHtml}      <div id="hf-intro" class="clip hf-intro" data-start="0" data-duration="0.5" data-track-index="1"><div id="hf-intro-title" class="hf-intro-title">${projectTitle}</div><div class="hf-intro-sub">Zoro AI &#183; ${theme.id}</div></div>
${scenesHtml.join("\n")}
${captionsHtml.join("\n")}
      <div class="hf-vignette"></div>
      <div class="hf-grain"></div>
      <div class="hf-bar top"></div>
      <div class="hf-bar bottom"></div>
      <div class="hf-progress"><div id="hf-progress-fill" class="hf-progress-fill"></div></div>
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.fromTo("#hf-intro-title", { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1, duration: 0.45, ease: "power2.out" }, 0);
      tl.to("#hf-intro", { opacity: 0, duration: 0.15 }, 0.35);
${animJs}
      tl.fromTo("#hf-progress-fill", { width: "0%" }, { width: "100%", duration: ${total}, ease: "none" }, 0);
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
}

/** Sidecar config written next to index.html so renders are reproducible. */
export function buildHyperframesManifest(project: Project, orderedSceneIds: string[], themeId: HyperframesThemeId) {
  return {
    engine: "zoro-ai-ultimate",
    hyperframes: ">=0.8.160",
    theme: themeId,
    projectId: project.id,
    projectName: project.name,
    aspect: project.settings.aspectRatio,
    durationSec: hyperframesDuration(project, orderedSceneIds),
    scenes: orderedSceneIds.length,
    render: "npx hyperframes render -o zoro-hyperframes.mp4",
    deterministic: true
  };
}
