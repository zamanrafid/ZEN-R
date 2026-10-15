import { describe, expect, it } from "vitest";
import {
  buildAttribution,
  copyrightRiskOfTitle,
  exportDisclaimer,
  isValidLicense,
  rightsConfirmError
} from "../lib/copyright";
import { getReferencePack, isSafeStockUrl, REFERENCE_PACKS } from "../lib/stock";

describe("copyright-strike protection", () => {
  it("accepts only known licenses", () => {
    expect(isValidLicense("own-work")).toBe(true);
    expect(isValidLicense("cc-by")).toBe(true);
    expect(isValidLicense("stolen")).toBe(false);
    expect(isValidLicense(undefined)).toBe(false);
  });

  it("flags label/movie titles as risky, own vlog as safe", () => {
    expect(copyrightRiskOfTitle("Artist - Official Music Video VEVO").risky).toBe(true);
    expect(copyrightRiskOfTitle("My own vlog day 5 in Dhaka").risky).toBe(false);
    expect(copyrightRiskOfTitle("").risky).toBe(false);
  });

  it("builds attribution with license + source", () => {
    const a = buildAttribution({ title: "Old Mosque", sourceUrl: "https://commons.wikimedia.org/x", license: "cc-by" });
    expect(a).toContain("Old Mosque");
    expect(a).toContain("cc-by");
    expect(a).toContain("commons.wikimedia.org");
  });

  it("rights error tells user what to send", () => {
    expect(rightsConfirmError()).toContain("confirmRights");
  });

  it("disclaimer warns when third-party source exists", () => {
    expect(exportDisclaimer(true)).toMatch(/double-check/i);
    expect(exportDisclaimer(false)).toMatch(/minimal/i);
  });
});

describe("copyright-safe stock allow-list", () => {
  it("allows only wikimedia hosts over https", () => {
    expect(isSafeStockUrl("https://upload.wikimedia.org/wikipedia/x.jpg")).toBe(true);
    expect(isSafeStockUrl("https://evil.com/x.jpg")).toBe(false);
    expect(isSafeStockUrl("http://upload.wikimedia.org/x.jpg")).toBe(false);
    expect(isSafeStockUrl("not a url")).toBe(false);
  });

  it("ships reference packs with prompts", () => {
    expect(REFERENCE_PACKS.length).toBeGreaterThanOrEqual(4);
    expect(getReferencePack("horror")?.prompts.length).toBeGreaterThan(0);
    expect(getReferencePack("nope")).toBeNull();
  });
});
