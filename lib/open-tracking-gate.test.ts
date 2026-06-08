import { shouldTrackOpens } from "@/lib/open-tracking-gate";
import { describe, expect, it } from "vitest";

describe("shouldTrackOpens -- warm-only open-tracking hard-gate", () => {
  it("tracks a warm thread (venue has replied)", () => {
    expect(shouldTrackOpens({ threadDirection: "mixed" })).toBe(true);
    expect(shouldTrackOpens({ threadDirection: "inbound" })).toBe(true);
  });

  it("NEVER tracks a cold / outbound-only thread", () => {
    expect(shouldTrackOpens({ threadDirection: "outbound" })).toBe(false);
  });

  it("NEVER tracks when the thread direction is unknown", () => {
    expect(shouldTrackOpens({ threadDirection: null })).toBe(false);
    expect(shouldTrackOpens({ threadDirection: undefined })).toBe(false);
    expect(shouldTrackOpens({ threadDirection: "" })).toBe(false);
  });

  it("only tracks venue recipients (never host/internal/system)", () => {
    expect(shouldTrackOpens({ threadDirection: "mixed", recipientType: "venue" })).toBe(true);
    expect(shouldTrackOpens({ threadDirection: "mixed", recipientType: "host" })).toBe(false);
    expect(shouldTrackOpens({ threadDirection: "mixed", recipientType: "internal" })).toBe(false);
    expect(shouldTrackOpens({ threadDirection: "mixed", recipientType: "system" })).toBe(false);
  });

  it("recipientType does not rescue a cold thread", () => {
    expect(shouldTrackOpens({ threadDirection: "outbound", recipientType: "venue" })).toBe(false);
  });
});
