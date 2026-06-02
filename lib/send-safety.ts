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
import {
  events,
  campaigns,
  cities,
  cityCampaigns,
  emailSuppression,
  emailThreads,
  staffOutreachEmails,
  users,
  venueDomainAliases,
  venueEvents,
  venues,
} from "@/db/schema";
import { db } from "@/lib/db";
import { and, asc, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";

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

/**
 * The recipient is linked to a venue that recently declined an
 * event. NOT a hard block (venues sometimes come back around), but
 * the operator should know before re-pitching.
 *
 * Detected via venue_events.status = 'declined' AND updated_at
 * within the last RECENT_DECLINE_WINDOW_DAYS days.
 */
export interface RecentDeclineWarning {
  kind: "recent_decline";
  venueId: string;
  venueName: string;
  /** ISO date of the decline. */
  declinedAt: Date;
  /** Days since the decline (rounded down). Cheaper for the UI to
   *  consume than re-deriving from declinedAt. */
  daysAgo: number;
  /** Optional name of the event that was declined, for context.
   *  Most "Halloween 2025 Toronto" declines tell you more than a
   *  bare timestamp. */
  eventLabel: string | null;
}

/**
 * Another staff member is actively contacting this venue for one
 * or more events. Sending under the current operator's name would
 * confuse the venue and step on a teammate's pitch.
 *
 * "Actively contacting" = there's at least one venue_event row
 * where ourContactStaffId points to a different staff member AND
 * the venue_event isn't in a terminal state
 * (declined/cancelled).
 *
 * NOT a hard block — sometimes coverage IS the right move
 * (teammate is OOO, venue is hot and time-sensitive, the
 * operator is the brand owner stepping in). The warning gives
 * the operator a chance to message the teammate first.
 */
export interface CrossStaffOwnershipWarning {
  kind: "cross_staff_owner";
  venueId: string;
  venueName: string;
  /** The other staff member's display name. */
  ownerStaffName: string | null;
  /** The other staff member's user id, for the UI to link to
   *  their profile or open a DM. */
  ownerStaffId: string;
  /** Optional event label so operator knows WHICH event this is
   *  about. May be null if the join couldn't resolve a clean
   *  label. */
  eventLabel: string | null;
}

/**
 * The recipient's domain matches a venue_domain_aliases entry but
 * the operator didn't attach the venue at compose time. Likely a
 * miss -- e.g. they're emailing mike@taohospitalitygroup.com which
 * the team has aliased to Lavelle, but no venueId was set in the
 * compose form.
 *
 * NOT a block. Just surfaces the linkage so the operator can:
 *   a) Cancel + attach Lavelle in the composer, or
 *   b) Send anyway (correct when the email is to the parent group
 *      about a different venue, or when the alias is wrong)
 *
 * If multiple venues share an alias (rare; operators sometimes
 * map a parent domain to several venues), we surface up to 3
 * candidates so the operator can pick.
 */
export interface DomainAliasSuggestionWarning {
  kind: "domain_alias_suggestion";
  /** The host portion of the recipient that matched (e.g.
   *  "taohospitalitygroup.com"). Surfaces in the dialog so the
   *  operator understands which signal fired. */
  domain: string;
  /** Up to 3 candidate venues aliased to that domain. Ordered by
   *  alias creation time (oldest first -- the original
   *  alias-setter's choice ranks above later overrides). */
  candidates: Array<{ venueId: string; venueName: string }>;
}

export type SafetyWarning =
  | DuplicateWarning
  | RecentDeclineWarning
  | CrossStaffOwnershipWarning
  | DomainAliasSuggestionWarning;

export type SafetyResult =
  | { ok: true; warnings: SafetyWarning[] }
  | { ok: false; block: SuppressionBlock | DncBlock; warnings: SafetyWarning[] };

/**
 * Multi-recipient send-safety result. Same shape as SafetyResult but
 * the block also records WHICH recipient triggered it, so the caller
 * can tell the operator that e.g. a Cc address (not the primary To)
 * is the problem.
 */
export type MultiSafetyResult =
  | { ok: true; warnings: SafetyWarning[] }
  | {
      ok: false;
      block: SuppressionBlock | DncBlock;
      blockedRecipient: string;
      warnings: SafetyWarning[];
    };

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
  /** Current operator's staff id. When set, the cross-staff
   *  ownership warning excludes them (they own the venue
   *  themselves → no warning). When undefined the cross-staff
   *  check is skipped — without knowing who's sending we can't
   *  meaningfully say it's "someone else's venue." Most callers
   *  should pass this. */
  staffId?: string;
}): Promise<SafetyResult> {
  const to = normaliseEmail(opts.to);
  if (!to) {
    // Caller's responsibility to validate format; this just guards
    // against a totally empty input.
    return { ok: true, warnings: [] };
  }

  // --- HARD BLOCKS: suppression + venue do-not-contact ------------------
  const block = await findHardBlock({
    teamId: opts.teamId,
    recipient: to,
    venueId: opts.venueId ?? null,
  });
  if (block) {
    return { ok: false, block, warnings: [] };
  }

  // --- WARNINGS -----------------------------------------------------
  const warnings: SafetyWarning[] = [];

  // Duplicate-outreach: another open thread to the same address on
  // this team. Most common warning kind by far.
  const duplicateRows = await findDuplicateOutreach({
    teamId: opts.teamId,
    recipient: to,
    excludeThreadId: opts.excludeThreadId,
  });
  warnings.push(...duplicateRows);

  // Recent-decline: this venue declined an event in the last
  // RECENT_DECLINE_WINDOW_DAYS. NOT a hard block (venues sometimes
  // come back around — leadership changes, the rejected event's
  // theme didn't fit but a new one might) but operators should
  // know before re-pitching so the message acknowledges the
  // prior interaction.
  const declines = await findRecentDeclines({
    teamId: opts.teamId,
    recipient: to,
    venueId: opts.venueId ?? null,
  });
  warnings.push(...declines);

  // Cross-staff ownership: another operator is actively contacting
  // this venue. Sending under the current operator's name would
  // confuse the venue and step on a teammate's pitch. Skipped when
  // we don't have an opts.staffId to compare against (caller
  // didn't supply, or the operator IS the current owner).
  if (opts.staffId) {
    const ownership = await findCrossStaffOwnership({
      recipient: to,
      venueId: opts.venueId ?? null,
      currentStaffId: opts.staffId,
    });
    warnings.push(...ownership);
  }

  // Domain-alias suggestion: when the operator didn't attach a
  // venueId, check whether the recipient's domain matches a
  // venue_domain_aliases entry. If yes, surface the candidate
  // venue(s) so the operator can attach before sending. Skipped
  // when venueId IS set -- the operator already made their choice.
  if (!opts.venueId) {
    const candidates = await findDomainAliasCandidates({
      teamId: opts.teamId,
      recipient: to,
    });
    if (candidates) warnings.push(candidates);
  }

  return { ok: true, warnings };
}

/**
 * SQL predicate matching a venue by EITHER its primary email OR any
 * of its alternate_emails (case-insensitive). The recipient must be
 * pre-normalised (lowercased). Used by every venue-resolution path so
 * DNC / decline / ownership can't be evaded by emailing a venue's
 * alternate address instead of its primary.
 */
function venueEmailMatches(recipient: string) {
  return sql`(
    lower(${venues.email}) = ${recipient}
    OR EXISTS (
      SELECT 1 FROM unnest(${venues.alternateEmails}) AS ae
      WHERE lower(ae) = ${recipient}
    )
  )`;
}

/**
 * The two HARD blocks (suppression + venue DNC) for a SINGLE
 * normalised recipient. Returns the block or null. Extracted so both
 * the single-recipient runSendSafety and the multi-recipient
 * runSendSafetyForRecipients enforce identical block logic.
 */
async function findHardBlock(opts: {
  teamId: string;
  recipient: string;
  venueId: string | null;
}): Promise<SuppressionBlock | DncBlock | null> {
  // Suppression list (lower() on the stored column so a row inserted
  // before normalisation was enforced still matches).
  const suppression = await db
    .select({
      email: emailSuppression.email,
      reason: emailSuppression.reason,
      notes: emailSuppression.notes,
    })
    .from(emailSuppression)
    .where(
      and(
        eq(emailSuppression.teamId, opts.teamId),
        sql`lower(${emailSuppression.email}) = ${opts.recipient}`,
      ),
    )
    .limit(1);
  if (suppression[0]) {
    return {
      kind: "suppression",
      email: opts.recipient,
      reason: suppression[0].reason as SuppressionBlock["reason"],
      notes: suppression[0].notes,
    };
  }

  // Venue do-not-contact (by explicit venueId or email/alternate match).
  return await findDncForRecipient({
    teamId: opts.teamId,
    recipient: opts.recipient,
    venueId: opts.venueId,
  });
}

/**
 * Multi-recipient send safety. Runs the HARD blocks against EVERY
 * normalised recipient across To + Cc + Bcc (deduped); a single
 * blocked recipient fails the whole send (the requirement: one
 * suppressed/DNC address anywhere blocks the send). Warnings are
 * gathered too: duplicate-outreach is checked for every recipient and
 * deduped by thread; the venue-centric warnings (recent decline,
 * cross-staff ownership, domain-alias suggestion) resolve off the
 * primary To recipient + explicit venueId, since fanning them across
 * Cc/Bcc would be noise.
 *
 * This is the gate every interactive + scheduled send should use --
 * the old single-recipient path only ever checked the first To.
 */
export async function runSendSafetyForRecipients(opts: {
  teamId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  excludeThreadId?: string;
  venueId?: string | null;
  staffId?: string;
}): Promise<MultiSafetyResult> {
  const norm = (xs?: string[]) => (xs ?? []).map(normaliseEmail).filter(Boolean);
  const toN = norm(opts.to);
  const ccN = norm(opts.cc);
  const bccN = norm(opts.bcc);

  // Dedupe across all roles, preserving To -> Cc -> Bcc order.
  const seen = new Set<string>();
  const all: string[] = [];
  for (const r of [...toN, ...ccN, ...bccN]) {
    if (!seen.has(r)) {
      seen.add(r);
      all.push(r);
    }
  }
  if (all.length === 0) return { ok: true, warnings: [] };

  // HARD BLOCKS across every recipient. First block fails the send.
  for (const recipient of all) {
    const block = await findHardBlock({
      teamId: opts.teamId,
      recipient,
      venueId: opts.venueId ?? null,
    });
    if (block) {
      return { ok: false, block, blockedRecipient: recipient, warnings: [] };
    }
  }

  // WARNINGS.
  const warnings: SafetyWarning[] = [];

  // Duplicate-outreach for every recipient, deduped by thread id, cap 3.
  const dupByThread = new Map<string, DuplicateWarning>();
  for (const recipient of all) {
    const dups = await findDuplicateOutreach({
      teamId: opts.teamId,
      recipient,
      excludeThreadId: opts.excludeThreadId,
    });
    for (const d of dups) {
      if (!dupByThread.has(d.threadId)) dupByThread.set(d.threadId, d);
    }
  }
  warnings.push(...Array.from(dupByThread.values()).slice(0, 3));

  // Venue-centric warnings off the primary recipient + venueId.
  // all[] is guaranteed non-empty here (early return above), but the
  // `?? ""` keeps the type a plain string for the helper signatures.
  const primary: string = toN[0] ?? all[0] ?? "";
  warnings.push(
    ...(await findRecentDeclines({
      teamId: opts.teamId,
      recipient: primary,
      venueId: opts.venueId ?? null,
    })),
  );
  if (opts.staffId) {
    warnings.push(
      ...(await findCrossStaffOwnership({
        recipient: primary,
        venueId: opts.venueId ?? null,
        currentStaffId: opts.staffId,
      })),
    );
  }
  if (!opts.venueId) {
    const candidates = await findDomainAliasCandidates({ teamId: opts.teamId, recipient: primary });
    if (candidates) warnings.push(candidates);
  }

  return { ok: true, warnings };
}

/**
 * Look for a venue with do_not_contact=true whose primary OR alternate
 * email matches the recipient. When venueId is passed, we check that
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
    .where(and(eq(venues.doNotContact, true), venueEmailMatches(opts.recipient)))
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
        // The recipient matches at least one to/cc normalized
        // address on a message of the thread OR matches the
        // from_email_normalized (we previously sent to them or
        // they're a sender). Uses migration 0083's normalized
        // columns so a sender with a display name in the From
        // header — the common case — actually matches against
        // opts.recipient (already lowercased upstream).
        sql`EXISTS (
          SELECT 1 FROM email_messages em
          WHERE em.thread_id = ${emailThreads.id}
            AND (
              ${opts.recipient} = ANY (em.to_emails_normalized)
              OR ${opts.recipient} = ANY (em.cc_emails_normalized)
              OR em.from_email_normalized = ${opts.recipient}
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
        // Use drizzle inArray, NOT sql`= ANY(${ownerIds})`. Interpolating a
        // JS array into `= ANY(${...})` makes the pg driver serialize it as
        // a bare scalar, so a single-owner list (the common case) threw
        // 22P02 "malformed array literal" and 500'd EVERY send that hit a
        // duplicate-thread owner. See lib/tracker-status.ts for the same
        // documented footgun.
        .where(inArray(users.id, ownerIds))
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

/**
 * Recent-decline detector.
 *
 * Looks for venue_events whose status='declined' and whose row was
 * updated within the look-back window. A "decline" here means the
 * venue explicitly turned down a specific event; we don't treat
 * status='cancelled' as a decline (cancellations are usually
 * operator-driven, not venue-driven, and re-pitching is normal).
 *
 * Match by either:
 *   a) opts.venueId — caller knows the venue context already.
 *   b) opts.recipient matches venues.email — the engine resolves
 *      the venue from the recipient address (lowercased equality
 *      since venues.email is stored clean).
 *
 * Returns up to 1 warning. Multiple declines on the same venue
 * collapse — the most recent one is the most informative.
 *
 * Window: 90 days. Set tight enough that operators don't get
 * pelted with stale declines, loose enough that a "we declined
 * last quarter" still surfaces during the next campaign push.
 *
 * NOT a hard block: a venue declining one event doesn't preclude
 * being approached for a different one (different theme, different
 * leadership, simply a better timing). The warning gives the
 * operator pause without taking the decision away.
 */
const RECENT_DECLINE_WINDOW_DAYS = 90;

async function findRecentDeclines(opts: {
  teamId: string;
  recipient: string;
  venueId: string | null;
}): Promise<RecentDeclineWarning[]> {
  const cutoff = new Date(Date.now() - RECENT_DECLINE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Resolve the venueId to query against. Prefer the caller's
  // explicit value; fall back to email-match against venues.email.
  let resolvedVenueId: string | null = opts.venueId;
  if (!resolvedVenueId) {
    const [v] = await db
      .select({ id: venues.id })
      .from(venues)
      .where(venueEmailMatches(opts.recipient))
      .limit(1);
    resolvedVenueId = v?.id ?? null;
  }
  if (!resolvedVenueId) return [];

  // Pull the most-recent declined venue_event for this venue.
  // Joined out to events → cities for an operator-meaningful label
  // ("Toronto, 2025-10-31") and to campaigns for the campaign name
  // ("Halloween 2025"). The chain:
  //   venue_events → events → city_campaigns → cities + campaigns
  //
  // No team-scope predicate. Three reasons:
  //   1) venues are global (not team-scoped) — there's no
  //      schema-level relation that says "this venue is on Team X"
  //      to honor anyway.
  //   2) campaigns, outreach_brands, and city_campaigns also lack
  //      a direct team_id column; team membership is inferred via
  //      connected_accounts / staff_members / campaign assignments,
  //      none of which can be cleanly threaded through this query.
  //   3) Cross-team decline awareness is a FEATURE, not a leak:
  //      if Team A got told no by Lavelle last month, Team B
  //      pitching the same venue should know. The decline itself
  //      isn't sensitive — it's a fact about the venue's stance.
  //
  // opts.teamId is kept on the function signature for future-proofing
  // (a later schema migration may add team_id columns we can use
  // here without changing every caller). It's currently unused.
  const [decline] = await db
    .select({
      venueId: venues.id,
      venueName: venues.name,
      declinedAt: venueEvents.updatedAt,
      eventDate: events.eventDate,
      campaignName: campaigns.name,
      cityName: cities.name,
    })
    .from(venueEvents)
    .innerJoin(venues, eq(venues.id, venueEvents.venueId))
    .innerJoin(events, eq(events.id, venueEvents.eventId))
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .where(
      and(
        eq(venueEvents.venueId, resolvedVenueId),
        eq(venueEvents.status, "declined"),
        gte(venueEvents.updatedAt, cutoff),
      ),
    )
    .orderBy(desc(venueEvents.updatedAt))
    .limit(1);

  if (!decline) return [];

  // Compose the event label: "Campaign — City" is the most
  // operator-meaningful shape we can build from what's joined
  // here. Falls back to the event date if either piece is null.
  const labelParts: string[] = [];
  if (decline.campaignName) labelParts.push(decline.campaignName);
  if (decline.cityName) labelParts.push(decline.cityName);
  const eventLabel =
    labelParts.length > 0
      ? labelParts.join(" — ")
      : decline.eventDate
        ? String(decline.eventDate)
        : null;

  const daysAgo = Math.max(
    0,
    Math.floor((Date.now() - new Date(decline.declinedAt).getTime()) / (24 * 60 * 60 * 1000)),
  );

  return [
    {
      kind: "recent_decline",
      venueId: decline.venueId,
      venueName: decline.venueName,
      declinedAt: new Date(decline.declinedAt),
      daysAgo,
      eventLabel,
    },
  ];
}

/**
 * Cross-staff venue ownership detector.
 *
 * Finds the most relevant other staff member actively contacting
 * the resolved venue. "Actively" excludes venue_events in terminal
 * states (declined, cancelled). When the current operator is
 * already among the owners, no warning is emitted.
 *
 * Pick the MOST RECENT venue_event row by updated_at so the warning
 * names the staffer currently engaged, not someone who touched
 * the venue six months ago and moved on.
 *
 * Returns at most one warning. Multiple cross-staff owners
 * collapse to the most active one — surfacing every teammate
 * who's ever owned this venue would be noise.
 */
async function findCrossStaffOwnership(opts: {
  recipient: string;
  venueId: string | null;
  currentStaffId: string;
}): Promise<CrossStaffOwnershipWarning[]> {
  // Resolve venueId same way as the other warnings.
  let resolvedVenueId: string | null = opts.venueId;
  if (!resolvedVenueId) {
    const [v] = await db
      .select({ id: venues.id })
      .from(venues)
      .where(venueEmailMatches(opts.recipient))
      .limit(1);
    resolvedVenueId = v?.id ?? null;
  }
  if (!resolvedVenueId) return [];

  // Find the most recent active venue_event with a different owner.
  // "Active" = NOT in declined or cancelled.
  const [row] = await db
    .select({
      venueId: venues.id,
      venueName: venues.name,
      ownerStaffId: venueEvents.ourContactStaffId,
      ownerStaffName: users.displayName,
      campaignName: campaigns.name,
      cityName: cities.name,
    })
    .from(venueEvents)
    .innerJoin(venues, eq(venues.id, venueEvents.venueId))
    .innerJoin(users, eq(users.id, venueEvents.ourContactStaffId))
    .innerJoin(events, eq(events.id, venueEvents.eventId))
    .innerJoin(cityCampaigns, eq(cityCampaigns.id, events.cityCampaignId))
    .innerJoin(campaigns, eq(campaigns.id, cityCampaigns.campaignId))
    .innerJoin(cities, eq(cities.id, cityCampaigns.cityId))
    .where(
      and(
        eq(venueEvents.venueId, resolvedVenueId),
        ne(venueEvents.ourContactStaffId, opts.currentStaffId),
        // Terminal statuses are excluded — once declined or
        // cancelled, the prior owner has stepped away from this
        // venue/event combo and there's nothing to step on.
        ne(venueEvents.status, "declined"),
        ne(venueEvents.status, "cancelled"),
      ),
    )
    .orderBy(desc(venueEvents.updatedAt))
    .limit(1);

  if (!row || !row.ownerStaffId) return [];

  const labelParts: string[] = [];
  if (row.campaignName) labelParts.push(row.campaignName);
  if (row.cityName) labelParts.push(row.cityName);
  const eventLabel = labelParts.length > 0 ? labelParts.join(" — ") : null;

  return [
    {
      kind: "cross_staff_owner",
      venueId: row.venueId,
      venueName: row.venueName,
      ownerStaffId: row.ownerStaffId,
      ownerStaffName: row.ownerStaffName,
      eventLabel,
    },
  ];
}

/**
 * Look up venue_domain_aliases for the recipient's host and return
 * a single suggestion warning (with up to 3 candidates) when any
 * matches exist. Returns null when:
 *   - The recipient has no parseable host
 *   - No alias matches
 *
 * Team-scoped via venues table: aliases reference venues, which
 * are a shared namespace, but the safety check itself runs in the
 * operator's team context. We don't filter aliases by team since
 * venues are shared. If a future schema makes venues team-scoped,
 * add the filter here.
 *
 * Candidates ordered by alias created_at ASC so the original
 * alias-setter's mapping appears first. The dialog renders them
 * as a small list with attach-from-here links.
 */
async function findDomainAliasCandidates(opts: {
  teamId: string;
  recipient: string;
}): Promise<DomainAliasSuggestionWarning | null> {
  // Extract the host portion. opts.recipient is already
  // normalised + lowercased; just split on '@'.
  const atIdx = opts.recipient.lastIndexOf("@");
  if (atIdx < 0) return null;
  const domain = opts.recipient.slice(atIdx + 1).trim();
  if (!domain) return null;

  const rows = await db
    .select({
      venueId: venueDomainAliases.venueId,
      venueName: venues.name,
      createdAt: venueDomainAliases.createdAt,
    })
    .from(venueDomainAliases)
    .innerJoin(venues, eq(venues.id, venueDomainAliases.venueId))
    .where(and(eq(venueDomainAliases.domain, domain), isNull(venues.archivedAt)))
    .orderBy(asc(venueDomainAliases.createdAt))
    .limit(3);

  if (rows.length === 0) return null;

  return {
    kind: "domain_alias_suggestion",
    domain,
    candidates: rows.map((r) => ({ venueId: r.venueId, venueName: r.venueName })),
  };
}
