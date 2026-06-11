import { describe, expect, it } from "vitest";
import {
  crawlMinutesLabel,
  findCoverageGaps,
  parseAgreedHours,
  timeToCrawlMinutes,
} from "./crawl-hours-core";

describe("parseAgreedHours — real operator-typed formats", () => {
  it("bare evening range: 7:30-10:30 -> 7:30pm-10:30pm", () => {
    expect(parseAgreedHours("7:30-10:30")).toEqual({ startMin: 1170, endMin: 1350 });
  });

  it("explicit pm: 8:30pm-11:30pm", () => {
    expect(parseAgreedHours("8:30pm-11:30pm")).toEqual({ startMin: 1230, endMin: 1410 });
  });

  it("past-midnight end: 11:30-2:00 -> 11:30pm-2am", () => {
    expect(parseAgreedHours("11:30-2:00")).toEqual({ startMin: 1410, endMin: 1560 });
  });

  it("9pm-1am crosses midnight", () => {
    expect(parseAgreedHours("9pm-1am")).toEqual({ startMin: 1260, endMin: 1500 });
  });

  it("12-2 -> midnight to 2am", () => {
    expect(parseAgreedHours("12-2")).toEqual({ startMin: 1440, endMin: 1560 });
  });

  it("'to' as separator", () => {
    expect(parseAgreedHours("8 to 11")).toEqual({ startMin: 1200, endMin: 1380 });
  });

  it("garbage returns null", () => {
    expect(parseAgreedHours("ask for Jim at the bar")).toBeNull();
    expect(parseAgreedHours("")).toBeNull();
    expect(parseAgreedHours(null)).toBeNull();
  });
});

describe("timeToCrawlMinutes", () => {
  it("evening TIME stays same-day", () => {
    expect(timeToCrawlMinutes("21:00:00")).toBe(1260);
  });
  it("after-midnight TIME wraps to next day", () => {
    expect(timeToCrawlMinutes("01:30:00")).toBe(1530);
  });
});

describe("crawlMinutesLabel", () => {
  it("labels evening and past-midnight correctly", () => {
    expect(crawlMinutesLabel(1170)).toBe("7:30 PM");
    expect(crawlMinutesLabel(1440)).toBe("12 AM");
    expect(crawlMinutesLabel(1530)).toBe("1:30 AM");
  });
});

describe("findCoverageGaps", () => {
  it("finds the hole between confirmed slots", () => {
    expect(
      findCoverageGaps([
        { startMin: 1170, endMin: 1290 },
        { startMin: 1350, endMin: 1500 },
      ]),
    ).toEqual([{ startMin: 1290, endMin: 1350 }]);
  });

  it("merged overlaps never fake a gap", () => {
    expect(
      findCoverageGaps([
        { startMin: 1170, endMin: 1320 },
        { startMin: 1200, endMin: 1380 },
        { startMin: 1380, endMin: 1500 },
      ]),
    ).toEqual([]);
  });
});
