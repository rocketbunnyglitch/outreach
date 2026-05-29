/**
 * GET /api/presence/all — everyone present anywhere in the app, deduped to one
 * entry per staffer (their most recent route), with a human-readable label for
 * where they are. Powers the dashboard "who's online" strip.
 */

import { cities, cityCampaigns, venues } from "@/db/schema";
import { getCurrentStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { listAllPresence } from "@/lib/presence";
import { eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function staticLabel(route: string): string {
  if (route === "/") return "Dashboard";
  if (route.startsWith("/tracker")) return "Tracker";
  if (route.startsWith("/tasks")) return "Tasks";
  if (route.startsWith("/inbox")) return "Inbox";
  if (route.startsWith("/wristbands")) return "Wristbands";
  if (route.startsWith("/crawl-matrix")) return "Crawl Matrix";
  if (route.startsWith("/crawl-support")) return "Crawl Support";
  if (route.startsWith("/all-crawls")) return "All Crawls";
  if (route.startsWith("/calendar")) return "Calendar";
  if (route.startsWith("/support-hours")) return "Support Hours";
  if (route.startsWith("/admin")) return "Admin";
  // Fall back to a Title-cased first segment.
  const seg = route.split("/").filter(Boolean)[0] ?? "App";
  return seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, " ");
}

export async function GET() {
  const ctx = await getCurrentStaff();
  if (!ctx) return new NextResponse("Unauthorized", { status: 401 });

  const present = await listAllPresence();

  // Resolve city-campaign + venue ids in routes to friendly names.
  const ccIds: string[] = [];
  const venueIds: string[] = [];
  for (const p of present) {
    const id = p.route.match(ID_RE)?.[0];
    if (!id) continue;
    if (p.route.startsWith("/city-campaigns/")) ccIds.push(id);
    else if (p.route.startsWith("/venues/")) venueIds.push(id);
  }

  const cityByCc = new Map<string, string>();
  const venueById = new Map<string, string>();
  try {
    if (ccIds.length > 0) {
      const rows = await db
        .select({ id: cityCampaigns.id, name: cities.name })
        .from(cityCampaigns)
        .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
        .where(inArray(cityCampaigns.id, ccIds));
      for (const r of rows) cityByCc.set(r.id, r.name);
    }
    if (venueIds.length > 0) {
      const rows = await db
        .select({ id: venues.id, name: venues.name })
        .from(venues)
        .where(inArray(venues.id, venueIds));
      for (const r of rows) venueById.set(r.id, r.name);
    }
  } catch {
    // name enrichment is best-effort
  }

  const enriched = present.map((p) => {
    const id = p.route.match(ID_RE)?.[0];
    let label = staticLabel(p.route);
    if (id && p.route.startsWith("/city-campaigns/")) {
      label = cityByCc.has(id) ? `${cityByCc.get(id)} sheet` : "City sheet";
    } else if (id && p.route.startsWith("/venues/")) {
      label = venueById.has(id) ? `Venue: ${venueById.get(id)}` : "Venue";
    }
    return {
      staffId: p.staffId,
      displayName: p.displayName,
      route: p.route,
      label,
      at: p.at,
      lastActiveAt: p.lastActiveAt ?? p.at,
    };
  });

  return NextResponse.json({ present: enriched });
}
