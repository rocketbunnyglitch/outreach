/**
 * Pure send-mode gate predicates (P0-1). No db, no server-only -- unit-testable.
 *
 * cronMaySendDraft mirrors the scheduled-send runner's SQL eligibility filter so
 * the boundary "Engine drafts. Humans send." is covered by tests AND enforced a
 * second time in code (defense-in-depth) on top of the DB query. The ONLY drafts
 * the cron may auto-send are: a human-approved scheduled send (operator_scheduled
 * + approved_at), or an explicitly auto-allowed NON-venue transactional message
 * (host/internal/system). Everything else -- the default review_required -- is
 * never auto-sent.
 */

export interface CronSendableDraft {
  sentAt: Date | null;
  scheduledFor: Date | null;
  sendMode: string | null;
  approvedAt: Date | null;
  recipientType: string | null;
}

/** Recipient types eligible for auto_allowed sending. Venue is deliberately excluded. */
const AUTO_ALLOWED_RECIPIENTS: ReadonlySet<string> = new Set(["host", "internal", "system"]);

export function cronMaySendDraft(d: CronSendableDraft, now: Date = new Date()): boolean {
  if (d.sentAt) return false;
  if (!d.scheduledFor || d.scheduledFor.getTime() > now.getTime()) return false;
  if (d.sendMode === "operator_scheduled") return d.approvedAt != null;
  if (d.sendMode === "auto_allowed") return AUTO_ALLOWED_RECIPIENTS.has(d.recipientType ?? "");
  // review_required (the default) and any unknown send_mode -> NEVER auto-send.
  return false;
}

/** A T11 (staff info sheet) draft -- gated on info-sheet readiness before send. */
export function isT11Touch(touchType: string | null): boolean {
  return !!touchType && touchType.startsWith("T11");
}
