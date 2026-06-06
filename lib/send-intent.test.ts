import { codeFamily, deriveSendIntent } from "@/lib/send-intent";
import { describe, expect, it } from "vitest";

describe("codeFamily", () => {
  it("collapses variant codes to their family token", () => {
    expect(codeFamily("T1")).toBe("T1");
    expect(codeFamily("T9-near")).toBe("T9");
    expect(codeFamily("T9-far")).toBe("T9");
    expect(codeFamily("T7A")).toBe("T7");
    expect(codeFamily("T7B")).toBe("T7");
    expect(codeFamily("T11-wristband")).toBe("T11");
    expect(codeFamily("T11-other")).toBe("T11");
    expect(codeFamily("T13W")).toBe("T13");
    expect(codeFamily("H0a")).toBe("H");
    expect(codeFamily("H0b")).toBe("H");
    expect(codeFamily("V1")).toBe("V");
    expect(codeFamily("  t16 ")).toBe("T16");
  });
});

describe("deriveSendIntent -- intent classification [P0]", () => {
  it("T1 cold opener -> cold_cadence", () => {
    expect(deriveSendIntent({ templateCode: "T1" }).sendIntent).toBe("cold_cadence");
  });
  it("T3 warm-copy opener -> cold_cadence (first touch initiates the sequence)", () => {
    expect(deriveSendIntent({ templateCode: "T3" }).sendIntent).toBe("cold_cadence");
  });
  it("T4/T8 cold detail/ask -> cold_cadence", () => {
    expect(deriveSendIntent({ templateCode: "T4" }).sendIntent).toBe("cold_cadence");
    expect(deriveSendIntent({ templateCode: "T8" }).sendIntent).toBe("cold_cadence");
  });
  it("T9 / T9-near / T11 / T13 / T13W / T14 / T15 -> lifecycle", () => {
    for (const code of [
      "T9",
      "T9-near",
      "T9-far",
      "T10",
      "T11",
      "T11-wristband",
      "T13",
      "T13W",
      "T14",
      "T15",
    ]) {
      expect(deriveSendIntent({ templateCode: code }).sendIntent).toBe("lifecycle");
    }
  });
  it("V1 internal-host venue confirm -> lifecycle (operational venue mail)", () => {
    expect(deriveSendIntent({ templateCode: "V1" }).sendIntent).toBe("lifecycle");
  });
  it("T16 -> cancellation", () => {
    expect(deriveSendIntent({ templateCode: "T16" }).sendIntent).toBe("cancellation");
  });
  it("T17 -> post_event", () => {
    expect(deriveSendIntent({ templateCode: "T17" }).sendIntent).toBe("post_event");
  });
  it("H0a / H0b -> host", () => {
    expect(deriveSendIntent({ templateCode: "H0a" }).sendIntent).toBe("host");
    expect(deriveSendIntent({ touchType: "H0b", recipientType: "host" }).sendIntent).toBe("host");
  });
  it("touchType wins when both touchType and templateCode are present", () => {
    // Engine-picked template was T1 but the draft was explicitly marked T16.
    expect(deriveSendIntent({ templateCode: "T1", touchType: "T16" }).sendIntent).toBe(
      "cancellation",
    );
  });
  it("explicit lifecycle wins even on a reply", () => {
    expect(
      deriveSendIntent({ touchType: "T14", isReply: true, cadenceCategory: "warm" }).sendIntent,
    ).toBe("lifecycle");
  });

  it("reply on an engaged (warm) thread, no template -> warm_cadence", () => {
    expect(deriveSendIntent({ isReply: true, cadenceCategory: "warm" }).sendIntent).toBe(
      "warm_cadence",
    );
  });
  it("reply on a cold (no-inbound) thread, no template -> cold_cadence follow-up", () => {
    expect(deriveSendIntent({ isReply: true, cadenceCategory: "cold" }).sendIntent).toBe(
      "cold_cadence",
    );
  });

  it("new venue thread, no template/touch -> unknown (NOT cold)", () => {
    const r = deriveSendIntent({ isReply: false });
    expect(r.sendIntent).toBe("unknown");
    expect(r.seedsColdCadence).toBe(false);
    expect(r.recordsCadenceTouch).toBe(false);
  });

  it("recipientType internal/system override to internal/system", () => {
    expect(deriveSendIntent({ recipientType: "internal" }).sendIntent).toBe("internal");
    expect(deriveSendIntent({ recipientType: "system" }).sendIntent).toBe("system");
  });
});

describe("deriveSendIntent -- cap/cadence behavior gates [P0]", () => {
  it("cold cadence: seeds cold, counts cap, applies floor, records touch", () => {
    const r = deriveSendIntent({ templateCode: "T1" });
    expect(r).toMatchObject({
      seedsColdCadence: true,
      countsAgainstColdCap: true,
      appliesCadenceFloor: true,
      recordsCadenceTouch: true,
      operationalForCap: false,
    });
  });

  it("warm cadence: no cold cap, no cold seed, records (warm) touch, applies floor", () => {
    const r = deriveSendIntent({ isReply: true, cadenceCategory: "warm" });
    expect(r).toMatchObject({
      seedsColdCadence: false,
      countsAgainstColdCap: false,
      appliesCadenceFloor: true,
      recordsCadenceTouch: true,
      operationalForCap: false,
    });
  });

  it.each(["T9", "T10", "T11", "T13", "T13W", "T14", "T15"])(
    "lifecycle %s: no cold cap, no floor, no touch, no seed, operational-for-cap",
    (code) => {
      const r = deriveSendIntent({ templateCode: code });
      expect(r).toMatchObject({
        sendIntent: "lifecycle",
        seedsColdCadence: false,
        countsAgainstColdCap: false,
        appliesCadenceFloor: false,
        recordsCadenceTouch: false,
        operationalForCap: true,
      });
    },
  );

  it("cancellation T16: never cold, operational-for-cap", () => {
    const r = deriveSendIntent({ templateCode: "T16" });
    expect(r).toMatchObject({
      countsAgainstColdCap: false,
      recordsCadenceTouch: false,
      seedsColdCadence: false,
      operationalForCap: true,
    });
  });

  it("post-event T17: never cold cadence, operational-for-cap (Halloween)", () => {
    const r = deriveSendIntent({ templateCode: "T17" });
    expect(r).toMatchObject({
      countsAgainstColdCap: false,
      recordsCadenceTouch: false,
      appliesCadenceFloor: false,
      operationalForCap: true,
    });
  });

  it("host: operational-for-cap, never venue cadence", () => {
    const r = deriveSendIntent({ templateCode: "H0a" });
    expect(r).toMatchObject({
      recipientType: "host",
      countsAgainstColdCap: false,
      recordsCadenceTouch: false,
      operationalForCap: true,
    });
  });

  it("unknown: counts against cold cap (deliverability) but seeds/records NO cadence", () => {
    const r = deriveSendIntent({ isReply: false });
    expect(r).toMatchObject({
      sendIntent: "unknown",
      countsAgainstColdCap: true,
      seedsColdCadence: false,
      recordsCadenceTouch: false,
      appliesCadenceFloor: false,
      operationalForCap: false,
    });
  });
});
