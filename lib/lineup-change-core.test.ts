import { describe, expect, it } from "vitest";
import { sanitizeLineupPayload } from "./lineup-change-core";

describe("sanitizeLineupPayload", () => {
  it("keeps public-safe lineup facts", () => {
    expect(
      sanitizeLineupPayload({
        venueName: "The Foundry",
        role: "wristband",
        slotPosition: 1,
        slotStartTime: "21:00",
        slotEndTime: "22:00",
        previousStatus: "contacted",
        newStatus: "confirmed",
        detail: "wristband -> The Foundry",
      }),
    ).toEqual({
      venueName: "The Foundry",
      role: "wristband",
      slotPosition: 1,
      slotStartTime: "21:00",
      slotEndTime: "22:00",
      previousStatus: "contacted",
      newStatus: "confirmed",
      detail: "wristband -> The Foundry",
    });
  });

  it("drops private fields (never-do #6)", () => {
    const out = sanitizeLineupPayload({
      venueName: "The Foundry",
      notes: "owner is difficult, lowball them",
      email: "owner@foundry.com",
      phoneE164: "+14165551234",
      nightOfContactName: "Jim",
      cancellationReason: "venue ghosted us",
      currentSalesCents: 123400,
      doNotContactReason: "legal threat",
    });
    expect(out).toEqual({ venueName: "The Foundry" });
  });

  it("drops nested objects even under allowed keys", () => {
    expect(sanitizeLineupPayload({ detail: { secret: "x" } })).toEqual({});
  });

  it("handles null/undefined payloads", () => {
    expect(sanitizeLineupPayload(null)).toEqual({});
    expect(sanitizeLineupPayload(undefined)).toEqual({});
  });
});
