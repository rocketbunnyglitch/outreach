import { describe, expect, it } from "vitest";
import { csvCell, filenameSlug, toCsv } from "./csv-export";

describe("csvCell", () => {
  it("passes plain values through", () => {
    expect(csvCell("Coyote Ugly")).toBe("Coyote Ugly");
    expect(csvCell(42)).toBe("42");
  });

  it("renders null/undefined as empty", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes values containing comma, quote or newline", () => {
    expect(csvCell("Bar, Grill")).toBe('"Bar, Grill"');
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("neutralizes spreadsheet-formula injection", () => {
    // No special chars: just the leading-quote guard.
    expect(csvCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(csvCell("+1-416-555-0199")).toBe("'+1-416-555-0199");
    expect(csvCell("-50")).toBe("'-50");
    expect(csvCell("@handle")).toBe("'@handle");
    // Guard AND CSV-quoting stack when the value also contains a quote.
    expect(csvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
  });
});

describe("toCsv", () => {
  it("builds header + CRLF-joined rows", () => {
    const csv = toCsv(
      ["Venue", "City"],
      [
        ["A", "Toronto"],
        ["B", "Calgary"],
      ],
    );
    expect(csv).toBe("Venue,City\r\nA,Toronto\r\nB,Calgary");
  });

  it("returns just the header when there are no rows", () => {
    expect(toCsv(["Venue", "City"], [])).toBe("Venue,City");
  });
});

describe("filenameSlug", () => {
  it("slugifies labels and trims separators", () => {
    expect(filenameSlug("New York")).toBe("new-york");
    expect(filenameSlug("  St. John's  ")).toBe("st-john-s");
    expect(filenameSlug(null)).toBe("");
  });
});
