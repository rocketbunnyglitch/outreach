import { describe, expect, it } from "vitest";
import { decodeHtmlEntities } from "./html-entities";

describe("decodeHtmlEntities", () => {
  it("decodes the Gmail snippet entities seen in prod", () => {
    expect(decodeHtmlEntities("That&#39;s great")).toBe("That's great");
    expect(decodeHtmlEntities("&lt;kevin@contacteventsperse.com&gt;")).toBe(
      "<kevin@contacteventsperse.com>",
    );
    expect(decodeHtmlEntities("Tom &amp; Jerry&nbsp;Bar")).toBe("Tom & Jerry Bar");
    expect(decodeHtmlEntities("&quot;quoted&quot; &apos;text&apos;")).toBe("\"quoted\" 'text'");
  });

  it("decodes hex references", () => {
    expect(decodeHtmlEntities("caf&#xe9;")).toBe("café");
  });

  it("does not double-decode", () => {
    expect(decodeHtmlEntities("&amp;#39;")).toBe("&#39;");
  });

  it("leaves unknown entities and plain text alone", () => {
    expect(decodeHtmlEntities("&unknown; stays")).toBe("&unknown; stays");
    expect(decodeHtmlEntities("no entities here")).toBe("no entities here");
  });
});
