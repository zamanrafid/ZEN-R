export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { khojSearch } from "@/lib/khoj";

/**
 * GET /api/research?q=topic&n=5 — research via YOUR Khoj second brain
 * (your docs + web). Use before storyboarding factual topics.
 * Requires KHOJ_URL in .env.local (self-hosted Khoj or cloud).
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const q = (u.searchParams.get("q") ?? "").trim();
  const n = Math.max(1, Math.min(10, Number(u.searchParams.get("n")) || 5));
  if (q.length < 2) {
    return NextResponse.json({ error: "?q= dao (e.g. /api/research?q=mughal%20history)." }, { status: 400 });
  }
  try {
    const hits = await khojSearch(q, n);
    return NextResponse.json({
      ok: true,
      query: q,
      count: hits.length,
      hits,
      note: "Khoj theke research — script likhar age facts verify koro."
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Research failed." }, { status: 502 });
  }
}
