import { describe, expect, it } from "vitest";
import { type CronSendableDraft, cronMaySendDraft, isT11Touch } from "./send-mode-gate";

const PAST = new Date("2026-06-01T00:00:00Z");
const NOW = new Date("2026-06-06T00:00:00Z");
const FUTURE = new Date("2026-06-10T00:00:00Z");

function draft(over: Partial<CronSendableDraft>): CronSendableDraft {
  return {
    sentAt: null,
    scheduledFor: PAST,
    sendMode: "operator_scheduled",
    approvedAt: PAST,
    recipientType: "venue",
    ...over,
  };
}

describe("cronMaySendDraft (P0-1 send boundary)", () => {
  it("NEVER sends a review_required draft, even if scheduled in the past", () => {
    expect(cronMaySendDraft(draft({ sendMode: "review_required" }), NOW)).toBe(false);
  });

  it("sends an operator_scheduled draft that is approved + due", () => {
    expect(cronMaySendDraft(draft({ sendMode: "operator_scheduled", approvedAt: PAST }), NOW)).toBe(
      true,
    );
  });

  it("does NOT send operator_scheduled without approved_at", () => {
    expect(cronMaySendDraft(draft({ sendMode: "operator_scheduled", approvedAt: null }), NOW)).toBe(
      false,
    );
  });

  it("does NOT send before the scheduled time", () => {
    expect(cronMaySendDraft(draft({ scheduledFor: FUTURE }), NOW)).toBe(false);
  });

  it("does NOT send when scheduledFor is null", () => {
    expect(cronMaySendDraft(draft({ scheduledFor: null }), NOW)).toBe(false);
  });

  it("does NOT send an already-sent draft", () => {
    expect(cronMaySendDraft(draft({ sentAt: PAST }), NOW)).toBe(false);
  });

  it("sends auto_allowed to host/internal/system", () => {
    for (const rt of ["host", "internal", "system"]) {
      expect(cronMaySendDraft(draft({ sendMode: "auto_allowed", recipientType: rt }), NOW)).toBe(
        true,
      );
    }
  });

  it("does NOT auto-send auto_allowed to a venue recipient", () => {
    expect(cronMaySendDraft(draft({ sendMode: "auto_allowed", recipientType: "venue" }), NOW)).toBe(
      false,
    );
  });

  it("does NOT send an unknown send_mode", () => {
    expect(cronMaySendDraft(draft({ sendMode: "something_else" }), NOW)).toBe(false);
    expect(cronMaySendDraft(draft({ sendMode: null }), NOW)).toBe(false);
  });
});

describe("isT11Touch", () => {
  it("matches T11 family only", () => {
    expect(isT11Touch("T11")).toBe(true);
    expect(isT11Touch("T11-wristband")).toBe(true);
    expect(isT11Touch("T11-other")).toBe(true);
    expect(isT11Touch("T9")).toBe(false);
    expect(isT11Touch("T13")).toBe(false);
    expect(isT11Touch(null)).toBe(false);
    expect(isT11Touch("")).toBe(false);
  });
});
