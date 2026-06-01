import "server-only";

/**
 * Venue domain-alias matching -- the reusable lookup behind the
 * venue_domain_aliases table.
 *
 * STATUS: the lookup is NOT yet wired into the inbound-matching path.
 * Every existing venue-matching site (lib/gmail-poll-worker.ts Tier 2,
 * lib/venue-communication.ts domain match, lib/inbox _attach-venue,
 * compose recipient resolution) is frozen in this work cycle, so this
 * ships as a ready-to-wire helper. The followup is a one-liner: after
 * the existing venue.email / alternate_emails / website-host checks,
 * also call findVenuesByDomainAlias(fromEmailNormalized) and union the
 * result. See the commit message for the exact site.
 */

import { venueDomainAliases } from "@/db/schema";
import { db } from "@/lib/db";
import { eq } from "drizzle-orm";

/**
 * Normalize a raw domain (or pasted email / URL) to a bare lowercase
 * host. Strips surrounding whitespace, a leading "@", a "mailto:"
 * prefix, the local-part of a full address ("mgr@tao.com" -> "tao.com"),
 * and any trailing path/port. Does NOT validate -- callers decide what
 * counts as a usable domain. Shared between add-time normalization (so
 * stored aliases are canonical) and match-time normalization (so an
 * inbound sender host is compared on the same footing).
 */
export function normalizeDomain(raw: string): string {
  let d = raw.trim().toLowerCase();
  if (d.startsWith("mailto:")) d = d.slice("mailto:".length);
  // If a full address was pasted, keep only the host part.
  const at = d.lastIndexOf("@");
  if (at >= 0) d = d.slice(at + 1);
  // Drop any path / port if a URL-ish value slipped through.
  d = d.replace(/[/:].*$/, "");
  return d.trim();
}

/**
 * Given an inbound from_email_normalized (e.g.
 * "mgr@taohospitalitygroup.com"), return the ids of every venue whose
 * domain alias matches its host. Returns [] when nothing matches.
 *
 * Multiple venues can share a parent domain (rare) -- all matches are
 * returned so the caller can surface both rather than guessing.
 */
export async function findVenuesByDomainAlias(fromEmailNormalized: string): Promise<string[]> {
  const host = normalizeDomain(fromEmailNormalized);
  if (!host) return [];
  const rows = await db
    .select({ venueId: venueDomainAliases.venueId })
    .from(venueDomainAliases)
    .where(eq(venueDomainAliases.domain, host));
  return rows.map((r) => r.venueId);
}
