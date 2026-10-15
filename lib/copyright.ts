/**
 * Copyright-strike protection for ZEN R.
 * Rule: YouTube / uploads / stock ke sirf tokhon use koro jokhon rights tomar —
 * nijer video, licensed, public domain, or freely-licensed (CC) with attribution.
 * AI kokhono copyright detect korte pare na — tai explicit confirmation + license
 * tracking + risky-audio strip + attribution export বাধ্যতামূলক।
 */

export type SourceLicense =
  | "own-work"
  | "licensed"
  | "public-domain"
  | "cc-by"
  | "cc-by-sa"
  | "cc0";

export const SOURCE_LICENSES: Array<{ id: SourceLicense; label: string }> = [
  { id: "own-work", label: "Nijer video / nijer shoot (safest)" },
  { id: "licensed", label: "License kena / permission ache" },
  { id: "public-domain", label: "Public domain" },
  { id: "cc-by", label: "CC-BY (attribution dite hobe)" },
  { id: "cc-by-sa", label: "CC-BY-SA (attribution + share-alike)" },
  { id: "cc0", label: "CC0 (free, no attribution needed)" }
];

export function isValidLicense(v: unknown): v is SourceLicense {
  return (
    v === "own-work" ||
    v === "licensed" ||
    v === "public-domain" ||
    v === "cc-by" ||
    v === "cc-by-sa" ||
    v === "cc0"
  );
}

/** Risky title signals — Content ID / label claim khawar chance besi. Block na, warn kore. */
const RISKY_TITLE = /(official music video|official video|vevo|full episode|full movie|trailer|netflix|disney|sony music|warner|universal music|t-series)/i;

export function copyrightRiskOfTitle(title: string): { risky: boolean; reason?: string } {
  if (!title) return { risky: false };
  if (RISKY_TITLE.test(title)) {
    return {
      risky: true,
      reason:
        "Title ta music-label / movie / episode er moto lagche — egulo te Content ID strike khawar risk sobcheye besi. Only nijer / licensed copy use koro, ar audio replace koro."
    };
  }
  return { risky: false };
}

/** YouTube audio reuse = sobcheye boro strike reason (music). Safe fix: mute + free voice/music. */
export function audioRiskNote(hasSourceAudio: boolean): string {
  if (!hasSourceAudio) return "";
  return "Source audio te onner music/song thakle YouTube/FB te Content ID claim asbe. Safe upay: Shorts katar somoy muteSource:true dao, tarpor ZEN R free voiceover + safe music bed bosao (100% copyright-free).";
}

export function rightsConfirmError(): string {
  return "Copyright protection: confirm koro video ta tomar nijer / license / public-domain / CC. Body te confirmRights:true + license পাঠাও (e.g. own-work). Onner video bina permission e use korle strike khabe — ZEN R seta block kore.";
}

/** Attribution text — CC-BY / CC-BY-SA te description e ditei hobe. */
export function buildAttribution(opts: {
  title?: string;
  sourceUrl?: string;
  license?: SourceLicense;
  author?: string;
}): string {
  const parts: string[] = [];
  if (opts.title) parts.push(`"${opts.title}"`);
  if (opts.author) parts.push(`by ${opts.author}`);
  if (opts.license) parts.push(`[${opts.license}]`);
  if (opts.sourceUrl) parts.push(`Source: ${opts.sourceUrl}`);
  if (!parts.length) return "";
  return `Attribution: ${parts.join(" ")} — license terms mene description e rakho.`;
}

/** Export-time disclaimer (MP4/SRT sathe README te jabe). */
export function exportDisclaimer(hasThirdPartySource: boolean): string {
  const base =
    "ZEN R nijer theke kono copyrighted content ane na. Tumi ja import/generate korecho tar rights tomar dayitto.";
  if (!hasThirdPartySource) return `${base} AI stills + voice + motion sob free/generated — strike risk minimal.`;
  return `${base} Third-party source ache — YouTube/FB te upload er age rights + attribution double-check koro. Music thakle mute + free voiceover use koro.`;
}
