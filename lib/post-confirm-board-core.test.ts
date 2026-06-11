import {
  type PostConfirmFlags,
  type PostConfirmLane,
  assignPostConfirmLane,
  groupByPostConfirmLane,
} from "@/lib/post-confirm-board-core";
import { describe, expect, it } from "vitest";

function flags(over: Partial<PostConfirmFlags> = {}): PostConfirmFlags {
  return {
    needsGraphic: false,
    needsSheet: false,
    t13Due: false,
    t14Due: false,
    v2Due: false,
    isReady: false,
    ...over,
  };
}

describe("assignPostConfirmLane", () => {
  it("graphic outranks everything else", () => {
    expect(
      assignPostConfirmLane(flags({ needsGraphic: true, needsSheet: true, v2Due: true })),
    ).toBe("graphic");
  });

  it("walks the sequence graphic -> sheet -> t13 -> t14 -> v2", () => {
    expect(assignPostConfirmLane(flags({ needsSheet: true, t13Due: true }))).toBe("sheet");
    expect(assignPostConfirmLane(flags({ t13Due: true, t14Due: true }))).toBe("t13");
    expect(assignPostConfirmLane(flags({ t14Due: true, v2Due: true }))).toBe("t14");
    expect(assignPostConfirmLane(flags({ v2Due: true }))).toBe("v2");
  });

  it("fully-ready with nothing outstanding -> ready", () => {
    expect(assignPostConfirmLane(flags({ isReady: true }))).toBe("ready");
  });

  it("prep done, nothing due, not ready -> on_track", () => {
    expect(assignPostConfirmLane(flags())).toBe("on_track");
  });

  it("a readiness-ready venue still needing its graphic lands in graphic, not ready", () => {
    expect(assignPostConfirmLane(flags({ needsGraphic: true, isReady: true }))).toBe("graphic");
  });
});

describe("groupByPostConfirmLane", () => {
  it("returns every lane in order, including empty ones", () => {
    const out = groupByPostConfirmLane<{ id: string; lane: PostConfirmLane }>([
      { id: "a", lane: "v2" },
      { id: "b", lane: "graphic" },
    ]);
    expect(out.map((l) => l.key)).toEqual([
      "graphic",
      "sheet",
      "t13",
      "t14",
      "v2",
      "on_track",
      "ready",
    ]);
    expect(out.find((l) => l.key === "graphic")?.items.map((i) => i.id)).toEqual(["b"]);
    expect(out.find((l) => l.key === "v2")?.items.map((i) => i.id)).toEqual(["a"]);
    expect(out.find((l) => l.key === "sheet")?.items).toEqual([]);
  });
});
