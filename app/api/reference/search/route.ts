/**
 * GET /api/reference/search?q=<query>&slug=<doc-slug>
 *
 * Full-text search across the loaded reference doc. Uses the Phase 0.4
 * retrieval helper (curated + Postgres FTS) with the "general" task so the
 * query alone drives results. Returns the matching section codes; the viewer
 * highlights them in the TOC and jumps to the first hit.
 */

import { getCurrentStaff } from "@/lib/auth";
import { retrieveRelevantSections } from "@/lib/reference-retrieval";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const staff = await getCurrentStaff();
  if (!staff) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const slug = url.searchParams.get("slug") ?? undefined;
  if (!q) return Response.json({ codes: [] });

  const sections = await retrieveRelevantSections({
    task: "general",
    query: q,
    docSlug: slug,
    topK: 10,
  });

  return Response.json({ codes: sections.map((s) => s.sectionCode) });
}
