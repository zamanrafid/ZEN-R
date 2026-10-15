export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { searchWikimedia } from "@/lib/stock";

/**
 * GET /api/stock?q=mosque&limit=8 — copyright-safe stock search.
 * Source: Wikimedia Commons (freely licensed CC/public-domain, no key).
 * Returns direct URLs + attribution (description e rakho).
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") ?? "").trim();
  const limit = Math.max(1, Math.min(20, Number(u.searchParams.get("limit")) || 8));
  if (q.length < 2) {
    return NextResponse.json(
      { error: "?q= dao (e.g. /api/stock?q=haunted%20house).", safeSources: ["Wikimedia Commons (CC)"] },
      { status: 400 }
    );
  }
  try {
    const items = await searchWikimedia(q, limit);
    return NextResponse.json({
      ok: true,
      query: q,
      count: items.length,
      items,
      note: "Sob CC/public-domain — tobu description e attribution rakho, tahole strike risk nei."
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Stock search failed." }, { status: 502 });
  }
}
