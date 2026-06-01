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
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// At least two labels (one dot), domain-legal chars only, no spaces.
// Deliberately loose -- operators paste real-world domains; this just
// rejects obvious junk and anything SQL-ish.
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export async function addDomainAlias(
  _prev: unknown,
  formData: FormData,
): Promise<ActionResult<{ domain: string }>> {
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

    revalidatePath(`/venues/${venueId}`);
    return { ok: true, data: { domain } };
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
