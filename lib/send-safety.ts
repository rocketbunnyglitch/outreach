/**
 * Send-safety — checks that run BEFORE any outbound mail leaves
 * the engine. Three categories:
 *
 *   1. Suppression list (email_suppression table)
 *   2. Per-venue DNC flag (venues.do_not_contact)
 *   3. Duplicate-outreach risk (another active thread to the same
 *      address on the same team, possibly from a different staffer)
 *
 * Suppression + DNC are HARD blocks (no admin bypass — these are
 * compliance / deliverability concerns; an admin who wants to
 * un-suppress should do it via /admin/suppression first).
 *
 * Duplicate-outreach is a WARNING — the caller decides whether to
 * proceed. composeAndSend / sendThreadReply surface the warning to
 * the UI and let the operator confirm or cancel.
 *
 * Why three checks in one funnel:
 *   The send path needs a single gate. Spreading the checks across
 *   the action sites means each one re-implements address
 *   normalisation, team scoping, etc. Centralising it lets the
 *   compose modal and reply composer call the SAME function and
 *   surface the SAME error/warning shape.
 */

import "server-only";
import { emailSuppression, emailThreads, staffOutreachEmails, users, venues } from "@/db/schema";
import { db } from "@/lib/db";
import { and, desc, eq, ne, or, sql } from "drizzle-orm";

/** Normalise an email address for comparison: lowercase + trim. */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export interface SuppressionBlock {
  kind: "suppression";
  email: string;
  reason: "manual" | "bounced" | "complained" | "unsubscribe";
  notes: string | null;
}

export interface DncBlock {
  kind: "dnc";
  venueId: string;
  venueName: string;
  /** Free-text reason from venues.do_not_contact_reason. */
  reason: string | null;
}

export interface DuplicateWarning {
  kind: "duplicate";
  /** Existing thread id for the same recipient on this team. */
  threadId: string;
  /** Subject of the existing thread, for context. */
  subject: string | null;
  /** When the most recent message in that thread happened. */
  lastMessageAt: Date;
  /** Display name of the staffer who last touched the thread, if any. */
  lastSenderName: string | null;
  /** The connected_account on whose inbox the thread lives. */
  inboxEmail: string | null;
  /** The user who owns that inbox (so the operator can see whose
   *  outreach they're about to duplicate). */
  ownerDisplayName: string | null;
}

export type SafetyResult =
  | { ok: true; warnings: DuplicateWarning[] }
  | { ok: false; block: SuppressionBlock | DncBlock; warnings: DuplicateWarning[] };

/**
 * Run pre-send safety checks. The blocking checks short-circuit; the
 * duplicate check always runs so the caller can surface a warning
 * even on an OK result.
 *
 * The caller is expected to have already authenticated and scoped to
 * a team; teamId comes from requireStaff().
 */
export async function runSendSafety(opts: {
  teamId: string;
  to: string;
  /** When set, the duplicate check excludes this thread (a reply on
   *  an existing thread should not warn about itself). */
  excludeThreadId?: string;
  /** When set, used to look up DNC on a known venue without an
   *  email-domain join. */
  venueId?: string | null;
}): Promise<SafetyResult> {
  const to = normaliseEmail(opts.to);
  if (!to) {
    // Caller's responsibility to validate format; this just guards
    // against a totally empty input.
    return { ok: true, warnings: [] };
  }

  // --- HARD BLOCK 1: suppression list -----------------------------------
  const suppression = await db
    .select({
      email: emailSuppression.email,
      reason: emailSuppression.reason,
      notes: emailSuppression.notes,
    })
    .from(emailSuppression)
    .where(and(eq(emailSuppression.teamId, opts.teamId), eq(emailSuppression.email, to)))
    .limit(1);
  if (suppression[0]) {
    return {
      ok: false,
      block: {
        kind: "suppression",
        email: to,
        reason: suppression[0].reason as SuppressionBlock["reason"],
        notes: suppression[0].notes,
      },
      warnings: [],
    };
  }

  // --- HARD BLOCK 2: venue do-not-contact -------------------------------
  // Two ways to discover DNC:
  //   a) Caller passed venueId explicitly — direct lookup.
  //   b) The recipient email matches a venue's email column or
  //      one of its alternate emails (denormalised on the venue row
  //      as a simple text column).
  // We prefer (a) when set, falling back to (b).
  const dnc = await findDncForRecipient({
    teamId: opts.teamId,
    recipient: to,
    venueId: opts.venueId ?? null,
  });
  if (dnc) {
    return { ok: false, block: dnc, warnings: [] };
  }

  // --- WARNING: duplicate outreach --------------------------------------
  const warnings = await findDuplicateOutreach({
    teamId: opts.teamId,
    recipient: to,
    excludeThreadId: opts.excludeThreadId,
  });

  return { ok: true, warnings };
}

/**
 * Look for a venue with do_not_contact=true whose primary email
 * matches the recipient. When venueId is passed, we check that
 * specific venue directly (faster + handles cases where the email
 * doesn't match any venue but the caller knows the context).
 */
async function findDncForRecipient(opts: {
  teamId: string;
  recipient: string;
  venueId: string | null;
}): Promise<DncBlock | null> {
  if (opts.venueId) {
    const row = await db
      .select({
        id: venues.id,
        name: venues.name,
        dnc: venues.doNotContact,
        reason: venues.doNotContactReason,
      })
      .from(venues)
      .where(eq(venues.id, opts.venueId))
      .limit(1);
    if (row[0]?.dnc) {
      return {
        kind: "dnc",
        venueId: row[0].id,
        venueName: row[0].name,
        reason: row[0].reason,
      };
    }
  }

  // Fallback: any venue with this primary email + DNC set.
  // venues.email is the canonical contact email; we lowercase
  // both sides for comparison.
  const byEmail = await db
    .select({
      id: venues.id,
      name: venues.name,
      reason: venues.doNotContactReason,
    })
    .from(venues)
    .where(and(eq(venues.doNotContact, true), sql`lower(${venues.email}) = ${opts.recipient}`))
    .limit(1);
  if (byEmail[0]) {
    return {
      kind: "dnc",
      venueId: byEmail[0].id,
      venueName: byEmail[0].name,
      reason: byEmail[0].reason,
    };
  }
  return null;
}

/**
 * Look for OPEN threads to the same recipient on the same team. An
 * "open" thread is one in needs_reply / waiting_on_them / follow_up_due.
 * Closed threads are excluded because the operator has already
 * decided that conversation is done.
 *
 * Returns up to 3 warnings, sorted by most-recent activity.
 */
async function findDuplicateOutreach(opts: {
  teamId: string;
  recipient: string;
  excludeThreadId?: string;
}): Promise<DuplicateWarning[]> {
  // We look at the latest message per thread and check whether the
  // recipient was in its to/from lines. Simpler approximation: scan
  // email_messages by recipient/sender email match, then collapse
  // to distinct threads.
  //
  // The cost is one indexed scan + a join back to threads. Acceptable
  // because this only fires at send time, not per-row.
  const rows = await db
    .select({
      threadId: emailThreads.id,
      subject: emailThreads.subject,
      lastMessageAt: emailThreads.lastMessageAt,
      lastSenderName: emailThreads.lastSenderName,
      state: emailThreads.state,
      inboxEmail: staffOutreachEmails.emailAddress,
      ownerUserId: staffOutreachEmails.ownerUserId,
    })
    .from(emailThreads)
    .innerJoin(staffOutreachEmails, eq(staffOutreachEmails.id, emailThreads.staffOutreachEmailId))
    .where(
      and(
        eq(staffOutreachEmails.teamId, opts.teamId),
        // OPEN states only — closed conversations don't count as
        // active duplicate outreach.
        or(
          eq(emailThreads.state, "needs_reply"),
          eq(emailThreads.state, "waiting_on_them"),
          eq(emailThreads.state, "follow_up_due"),
        ),
        opts.excludeThreadId ? ne(emailThreads.id, opts.excludeThreadId) : undefined,
        // The recipient matches at least one to_address on the
        // thread's most recent message OR matches the from_address
        // (which means we sent to them previously OR they're a sender).
        sql`EXISTS (
          SELECT 1 FROM email_messages em
          WHERE em.thread_id = ${emailThreads.id}
            AND (
              ${opts.recipient} = ANY (SELECT lower(unnest(em.to_addresses)))
              OR lower(em.from_address) = ${opts.recipient}
            )
        )`,
      ),
    )
    .orderBy(desc(emailThreads.lastMessageAt))
    .limit(3);

  // Drop the rare row where excludeThreadId equality didn't filter
  // (shouldn't happen with the .where above, but defensive).
  const filtered = opts.excludeThreadId
    ? rows.filter((r) => r.threadId !== opts.excludeThreadId)
    : rows;

  if (filtered.length === 0) return [];

  // Resolve owner display names in one query.
  const ownerIds = Array.from(
    new Set(filtered.map((r) => r.ownerUserId).filter(Boolean) as string[]),
  );
  const owners = ownerIds.length
    ? await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(sql`${users.id} = ANY(${ownerIds})`)
    : [];
  const ownerMap = new Map(owners.map((o) => [o.id, o.displayName]));

  return filtered.map((r) => ({
    kind: "duplicate" as const,
    threadId: r.threadId,
    subject: r.subject,
    lastMessageAt: r.lastMessageAt,
    lastSenderName: r.lastSenderName,
    inboxEmail: r.inboxEmail,
    ownerDisplayName: r.ownerUserId ? (ownerMap.get(r.ownerUserId) ?? null) : null,
  }));
}

/** Convenience helper for action layers: build a human-readable
 *  error message from a block. */
export function describeBlock(block: SuppressionBlock | DncBlock): string {
  if (block.kind === "suppression") {
    const reasonLabel: Record<SuppressionBlock["reason"], string> = {
      manual: "the suppression list",
      bounced: "the suppression list (hard bounce)",
      complained: "the suppression list (spam complaint)",
      unsubscribe: "the suppression list (unsubscribed)",
    };
    return `Can't send to ${block.email}: it's on ${reasonLabel[block.reason]}.${
      block.notes ? ` Note: ${block.notes}` : ""
    }`;
  }
  return `${block.venueName} is marked Do Not Contact${
    block.reason ? `: ${block.reason}` : ""
  }. Remove the DNC flag on the venue if you want to send.`;
}
