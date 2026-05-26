/**
 * Email template render engine.
 *
 * Templates use Mustache-style merge fields: `{{venue.name}}`, `{{event.date}}`,
 * etc. We keep this simple — no conditionals, no loops, no helpers. Just
 * dotted-path substitution. Anything more complex goes into the application
 * code that builds the context object.
 *
 * Unknown fields render as `[??field.path??]` (with the path inline) so the
 * operator sees broken merges in the live preview instead of silent gaps.
 *
 * Available context:
 *   - venue.{ name, address, city, phone, email, website }
 *   - event.{ date, dateFormatted, slotNumber, status }
 *   - campaign.{ name, slug, year }
 *   - city.{ name, region }
 *   - crawlBrand.{ displayName, tagline, holidayType, primaryColorHex, accentColorHex }
 *   - outreachBrand.{ displayName }
 *   - staff.{ displayName, primaryEmail }
 */

const MERGE_FIELD_RE = /\{\{([a-zA-Z0-9_.]+)\}\}/g;

export interface RenderContext {
  venue?: {
    name?: string;
    address?: string | null;
    city?: string;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
  };
  event?: {
    date?: string;
    dateFormatted?: string;
    slotNumber?: number;
    status?: string;
  };
  campaign?: {
    name?: string;
    slug?: string;
    year?: number;
  };
  city?: {
    name?: string;
    region?: string | null;
  };
  crawlBrand?: {
    displayName?: string;
    tagline?: string | null;
    holidayType?: string;
    primaryColorHex?: string | null;
    accentColorHex?: string | null;
  };
  outreachBrand?: {
    displayName?: string;
  };
  staff?: {
    displayName?: string;
    primaryEmail?: string;
  };
}

export interface RenderResult {
  output: string;
  unresolvedFields: string[];
}

export function renderTemplate(template: string, context: RenderContext): RenderResult {
  const unresolved: string[] = [];
  const output = template.replace(MERGE_FIELD_RE, (_match, path: string) => {
    const value = resolvePath(context as Record<string, unknown>, path);
    if (value === undefined || value === null || value === "") {
      unresolved.push(path);
      return `[??${path}??]`;
    }
    return String(value);
  });
  return { output, unresolvedFields: Array.from(new Set(unresolved)) };
}

/**
 * Extract every `{{field.path}}` reference from a template, deduplicated.
 * Used by the editor UI to show "fields this template uses".
 */
export function extractMergeFields(template: string): string[] {
  const matches = new Set<string>();
  for (const m of template.matchAll(MERGE_FIELD_RE)) {
    if (m[1]) matches.add(m[1]);
  }
  return Array.from(matches).sort();
}

function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * Documented list of every merge field the engine knows about. Used by the
 * editor's "available fields" sidebar so the operator doesn't have to guess.
 */
export const KNOWN_MERGE_FIELDS: { path: string; description: string }[] = [
  { path: "venue.name", description: "Venue display name" },
  { path: "venue.address", description: "Street address" },
  { path: "venue.city", description: "City name" },
  { path: "venue.phone", description: "Phone in E.164 format" },
  { path: "venue.email", description: "Primary venue email" },
  { path: "venue.website", description: "Venue website URL" },
  { path: "event.date", description: "Event date in YYYY-MM-DD" },
  { path: "event.dateFormatted", description: 'e.g. "Saturday, October 31, 2026"' },
  { path: "event.slotNumber", description: "1, 2, 3 if multiple events same date" },
  { path: "event.status", description: "planned / confirmed / completed" },
  { path: "campaign.name", description: 'e.g. "Halloween 2026 — Toronto"' },
  { path: "campaign.slug", description: "URL-friendly campaign slug" },
  { path: "campaign.year", description: "Year extracted from campaign date" },
  { path: "city.name", description: "City the campaign is running in" },
  { path: "city.region", description: "State/province" },
  { path: "crawlBrand.displayName", description: 'e.g. "Trick or Drink"' },
  { path: "crawlBrand.tagline", description: "Brand tagline" },
  { path: "crawlBrand.holidayType", description: "halloween / nye / st_patricks" },
  { path: "outreachBrand.displayName", description: 'e.g. "Eventsperse"' },
  { path: "staff.displayName", description: "Sender's name (your name)" },
  { path: "staff.primaryEmail", description: "Sender's email" },
];
