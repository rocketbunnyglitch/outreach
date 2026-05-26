/**
 * Phase 6a test: template render engine.
 * Doesn't touch the DB — just exercises the pure function.
 */
import {
  KNOWN_MERGE_FIELDS,
  extractMergeFields,
  renderTemplate,
} from "../lib/template-render";

const TEMPLATE_BODY = `Hi {{venue.name}} team,

{{staff.displayName}} here from {{outreachBrand.displayName}}. We're producing
the {{crawlBrand.displayName}} on {{event.dateFormatted}} in {{city.name}}.

{{venue.name}} at {{venue.address}} would be a great fit. Total reach is
{{venue.unknownField}} (this should be marked unresolved).`;

const CONTEXT = {
  venue: {
    name: "The Phantom Pub",
    address: "200 Queen St W",
    // unknownField intentionally missing
  },
  event: {
    date: "2026-10-31",
    dateFormatted: "Saturday, October 31, 2026",
  },
  campaign: { name: "Halloween 2026 — Toronto" },
  city: { name: "Toronto" },
  crawlBrand: { displayName: "Trick or Drink" },
  outreachBrand: { displayName: "Eventsperse" },
  staff: { displayName: "Bryle" },
};

function main() {
  // Extraction
  const fields = extractMergeFields(TEMPLATE_BODY);
  const expectedFields = [
    "city.name",
    "crawlBrand.displayName",
    "event.dateFormatted",
    "outreachBrand.displayName",
    "staff.displayName",
    "venue.address",
    "venue.name",
    "venue.unknownField",
  ];
  if (JSON.stringify(fields) !== JSON.stringify(expectedFields)) {
    console.error("FAIL: extractMergeFields wrong");
    console.error("  got:     ", fields);
    console.error("  expected:", expectedFields);
    process.exit(1);
  }
  console.log("OK extractMergeFields:", fields.length, "fields");

  // Render
  const result = renderTemplate(TEMPLATE_BODY, CONTEXT);
  if (!result.output.includes("Hi The Phantom Pub team")) {
    console.error("FAIL: venue.name didn't render");
    console.error(result.output); process.exit(1);
  }
  if (!result.output.includes("Saturday, October 31, 2026")) {
    console.error("FAIL: event.dateFormatted didn't render");
    process.exit(1);
  }
  if (!result.output.includes("[??venue.unknownField??]")) {
    console.error("FAIL: unresolved field marker missing");
    process.exit(1);
  }
  if (result.unresolvedFields.length !== 1 || result.unresolvedFields[0] !== "venue.unknownField") {
    console.error("FAIL: unresolvedFields wrong:", result.unresolvedFields);
    process.exit(1);
  }
  console.log("OK render: venue.name + event.dateFormatted + city.name all resolved");
  console.log("OK unresolvedFields:", result.unresolvedFields);

  // Empty context
  const empty = renderTemplate("{{venue.name}} {{x.y.z}}", {});
  if (empty.output !== "[??venue.name??] [??x.y.z??]") {
    console.error("FAIL: empty context render"); console.error(empty.output); process.exit(1);
  }
  console.log("OK empty context: 2 unresolved markers");

  // No merge fields
  const plain = renderTemplate("Hello world", CONTEXT);
  if (plain.output !== "Hello world" || plain.unresolvedFields.length !== 0) {
    console.error("FAIL: plain text shouldn't change"); process.exit(1);
  }
  console.log("OK plain text passthrough");

  // KNOWN_MERGE_FIELDS sanity
  if (KNOWN_MERGE_FIELDS.length < 15) {
    console.error(`FAIL: KNOWN_MERGE_FIELDS only has ${KNOWN_MERGE_FIELDS.length}`); process.exit(1);
  }
  console.log("OK KNOWN_MERGE_FIELDS:", KNOWN_MERGE_FIELDS.length, "documented");

  console.log("\nPASS: template render engine.");
  process.exit(0);
}
main();
