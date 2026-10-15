export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { REFERENCE_PACKS, getReferencePack } from "@/lib/stock";

/** GET /api/stock/packs[?id=horror] — curated strike-free prompt starters. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const id = u.searchParams.get("id");
  if (id) {
    const pack = getReferencePack(id);
    if (!pack) return NextResponse.json({ error: "Unknown pack." }, { status: 404 });
    return NextResponse.json({ ok: true, pack });
  }
  return NextResponse.json({
    ok: true,
    packs: REFERENCE_PACKS.map((p) => ({ id: p.id, label: p.label, prompts: p.prompts.length })),
    note: "Egulo tomar nijer AI stills er jonno prompt starters — kono third-party copy nei, strike risk zero."
  });
}
