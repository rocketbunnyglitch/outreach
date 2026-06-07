"use server";

/**
 * Venue domain-alias server actions -- add + remove rows in
 * venue_domain_aliases from the venue detail page.
 *
 * The domain is normalized (shared normalizeDomain, so stored aliases
 * match what the matcher will compare an inbound sender host against)
 * and validated against an obvious-junk guard. createdBy is
 * server-derived from the session, never trusted from the form. Writes
 * go through withAuditContext so the audit_log trigger records who.
 */

import { venueDomainAliases, venues } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db, withAuditContext } from "@/lib/db";
import type { ActionResult } from "@/lib/form-utils";
import { logger } from "@/lib/logger";
import { normalizeDomain } from "@/lib/venue-domain-match";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// At least two labels (one dot), domain-legal chars only, no spaces.
// Deliberately loose -- operators paste real-world domains; this just
// rejects obvious junk and anything SQL-ish.
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export async function addDomainAlias(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ domain: string; retroactivelyAttached: number }>> {
  const { staff } = await requireStaff();
  const venueId = String(formData.get("venueId") ?? "");
  const domain = normalizeDomain(String(formData.get("domain") ?? ""));
  const notesRaw = String(formData.get("notes") ?? "").trim();
  const notes = notesRaw.length > 0 ? notesRaw.slice(0, 500) : null;

  if (!UUID_RE.test(venueId)) return { ok: false, error: "Invalid venue id." };
  if (!domain) return { ok: false, error: "Enter a domain." };
  if (!DOMAIN_RE.test(domain)) {
    return { ok: false, error: "That doesn't look like a domain (e.g. taohospitalitygroup.com)." };
  }

  try {
    const [venue] = await db
      .select({ id: venues.id })
      .from(venues)
      .where(eq(venues.id, venueId))
      .limit(1);
    if (!venue) return { ok: false, error: "Venue not found." };

    const inserted = await withAuditContext(staff.id, async (tx) =>
      tx
        .insert(venueDomainAliases)
        .values({ venueId, domain, notes, createdBy: staff.id })
        .onConflictDoNothing({
          target: [venueDomainAliases.venueId, venueDomainAliases.domain],
        })
        .returning({ id: venueDomainAliases.id }),
    );

    if (inserted.length === 0) {
      return { ok: false, error: "That domain is already aliased to this venue." };
    }

    // Retroactive sweep: when an operator adds a new alias, claim every
    // historical unmatched thread whose latest inbound came from that
    // domain. Without this, only NEW inbound (post-add) gets routed --
    // operators would still have to manually attach the historical
    // ones, which is exactly the friction the alias was supposed to
    // remove.
    //
    // Scope by the operator's team via staff_outreach_emails -- venues
    // are a shared namespace but threads live on team-owned inboxes,
    // so we never retroactively sweep threads on a different team's
    // inbox even when they happen to be from the same domain.
    //
    // Best-effort: if the sweep fails (DB hiccup, etc.) we still
    // succeed the add since the alias DOES route future mail. Log
    // and continue.
    let retroactivelyAttached = 0;
    try {
      const retroResult = await db.execute<{ id: string }>(sql`
        UPDATE email_threads et
        SET venue_id = ${venueId}, updated_by = ${staff.id}
        FROM connected_accounts soe, email_messages em
        WHERE et.staff_outreach_email_id = soe.id
          AND soe.team_id = ${staff.teamId}
          AND et.venue_id IS NULL
          AND em.thread_id = et.id
          AND em.direction = 'inbound'
          AND em.from_email_normalized IS NOT NULL
          AND LOWER(SPLIT_PART(em.from_email_normalized, '@', 2)) = ${domain}
        RETURNING et.id
      `);
      const retroRows: Array<{ id: string }> = Array.isArray(retroResult)
        ? (retroResult as unknown as Array<{ id: string }>)
        : ((retroResult as unknown as { rows?: Array<{ id: string }> }).rows ?? []);
      // de-dup ids in case the same thread had multiple inbound rows
      // from the domain (rare; would only happen if the same thread
      // had two messages from different addresses at the same host).
      retroactivelyAttached = new Set(retroRows.map((r) => r.id)).size;
    } catch (sweepErr) {
      logger.warn(
        { sweepErr, venueId, domain },
        "addDomainAlias: retroactive sweep failed (alias itself was added OK)",
      );
    }

    revalidatePath(`/venues/${venueId}`);
    if (retroactivelyAttached > 0) {
      // Refresh the inbox views too -- threads moved into the venue.
      revalidatePath("/inbox");
    }
    return { ok: true, data: { domain, retroactivelyAttached } };
  } catch (err) {
    logger.error({ err, venueId, domain }, "addDomainAlias failed");
    return { ok: false, error: "Unexpected database error. See server logs." };
  }
}

export async function removeDomainAlias(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  const { staff } = await requireStaff();
  const aliasId = String(formData.get("aliasId") ?? "");
  const venueId = String(formData.get("venueId") ?? "");

  if (!UUID_RE.test(aliasId) || !UUID_RE.test(venueId)) {
    return { ok: false, error: "Invalid id." };
  }

  try {
    const deleted = await withAuditContext(staff.id, async (tx) =>
      tx
        .delete(venueDomainAliases)
        .where(and(eq(venueDomainAliases.id, aliasId), eq(venueDomainAliases.venueId, venueId)))
        .returning({ id: venueDomainAliases.id }),
    );
    if (deleted.length === 0) {
      return { ok: false, error: "Alias not found or already removed." };
    }
    revalidatePath(`/venues/${venueId}`);
    return { ok: true, data: { id: aliasId } };
  } catch (err) {
    logger.error({ err, aliasId, venueId }, "removeDomainAlias failed");
    return { ok: false, error: "Unexpected database error. See server logs." };
  }
}
