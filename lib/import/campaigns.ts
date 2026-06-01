/**
 * Campaign registry — central list of all xlsx-based campaign
 * imports the operator has set up.
 *
 * Each entry is a CampaignImportConfig consumed by
 * runCampaignImport(config, opts). The registry order is
 * RECENCY-ORDERED (newest first) so the admin panel can render
 * sections in priority order — the most recent campaign wins on
 * non-operator-edited venue fields per the operator's recency
 * rule.
 *
 * To add a new campaign:
 *   1. Parse the xlsx into JSON: `python3 scripts/parse-campaign-xlsx.py
 *        <input.xlsx> data/<slug>.json`
 *   2. Read the distinct date_label values from the JSON
 *   3. Add an entry below mapping each label to (date, dayPart,
 *      slotNumber). Skip labels you want to drop entirely.
 *   4. (Optional) Add data/<slug>_resolver_overrides.json after a
 *      verify pass has been run.
 *
 * History mode: legacy campaigns (mode: "history") write venues +
 * venue_events for confirmed slots but skip cold_outreach. The
 * operator doesn't need a cold-outreach queue for past campaigns —
 * just the historical record.
 */

import {
  type CampaignImportConfig,
  HALLOWEEN_2025_CONFIG,
} from "@/lib/import/generic-campaign-import";

// =============================================================================
// 2026 (active)
// =============================================================================

/**
 * St Paddy's 2026 — 2 nights × up to 3 crawls per night.
 *
 * Labels in the source xlsx:
 *   FRIDAY CRAWL 1               → Fri 3/13 slot 1
 *   FRIDAY CRAWL 2               → Fri 3/13 slot 2
 *   FRIDAY CRAWL 2 - NORTHERN PART (and CANCEL variant) → SKIPPED
 *     (Chicago-only experiment that didn't sell; operator drops it)
 *   SATURDAY CRAWL 1             → Sat 3/14 slot 1
 *   SATURDAY CRAWL 2             → Sat 3/14 slot 2
 *   SATURDAY CRAWL 2 - NORTHERN PART → SKIPPED
 *   SATURDAY CRAWL 3             → Sat 3/14 slot 3
 */
export const SPD_2026_CONFIG: CampaignImportConfig = {
  slug: "spd-2026",
  name: "St Paddy's 2026",
  holidayType: "stpaddys",
  startDate: "2026-03-13",
  endDate: "2026-03-14",
  jsonPath: "data/spd_2026.json",
  overridesPath: "data/spd_2026_resolver_overrides.json",
  jsonPathEnvVar: "SPD_2026_JSON_PATH",
  mode: "active",
  clustersByLabel: {
    "friday crawl 1": { date: "2026-03-13", dayPart: "friday_night", slotNumber: 1 },
    "friday crawl 2": { date: "2026-03-13", dayPart: "friday_night", slotNumber: 2 },
    "saturday crawl 1": { date: "2026-03-14", dayPart: "saturday_night", slotNumber: 1 },
    "saturday crawl 2": { date: "2026-03-14", dayPart: "saturday_night", slotNumber: 2 },
    "saturday crawl 3": { date: "2026-03-14", dayPart: "saturday_night", slotNumber: 3 },
  },
};

/**
 * New Year's Eve 2026 — 1 night × up to 3 crawls.
 *
 * Labels:
 *   CLUSTER 1 → Dec 31 2025 slot 1
 *   CLUSTER 2 → Dec 31 2025 slot 2
 *   CLUSTER 3 → Dec 31 2025 slot 3
 *
 * Note: "NYE 2026" labels the event that rings in 2026 — held on
 * Dec 31, 2025. The startDate reflects the actual event date.
 */
export const NYE_2026_CONFIG: CampaignImportConfig = {
  slug: "nye-2026",
  name: "New Year's Eve 2026",
  holidayType: "newyears",
  startDate: "2025-12-31",
  endDate: "2026-01-01",
  jsonPath: "data/nye_2026.json",
  overridesPath: "data/nye_2026_resolver_overrides.json",
  jsonPathEnvVar: "NYE_2026_JSON_PATH",
  mode: "active",
  clustersByLabel: {
    "cluster 1": { date: "2025-12-31", dayPart: "other", slotNumber: 1 },
    "cluster 2": { date: "2025-12-31", dayPart: "other", slotNumber: 2 },
    "cluster 3": { date: "2025-12-31", dayPart: "other", slotNumber: 3 },
  },
};

// =============================================================================
// 2025 (Halloween 2025 is active — handled by HALLOWEEN_2025_CONFIG above)
// =============================================================================
// (HALLOWEEN_2025_CONFIG imported from generic-campaign-import.ts)

/**
 * St Paddy's 2025 — historical record only.
 *
 * Labels in the source xlsx:
 *   Day 1                → Fri 3/14 slot 1 (parser fallback — no
 *                         explicit date header on this section)
 *   SATURDAY MARCH 15TH  → Sat 3/15 slot 1
 *
 * mode: "history" — no cold_outreach writes. Just venues +
 * venue_events for the confirmed slots so the city-venues table
 * can show "previously used in SPD 2025" badges.
 */
export const SPD_2025_CONFIG: CampaignImportConfig = {
  slug: "spd-2025",
  name: "St Paddy's 2025",
  holidayType: "stpaddys",
  startDate: "2025-03-14",
  endDate: "2025-03-15",
  jsonPath: "data/spd_2025.json",
  overridesPath: "data/spd_2025_resolver_overrides.json",
  jsonPathEnvVar: "SPD_2025_JSON_PATH",
  mode: "history",
  clustersByLabel: {
    "day 1": { date: "2025-03-14", dayPart: "friday_night", slotNumber: 1 },
    "saturday march 15th": { date: "2025-03-15", dayPart: "saturday_night", slotNumber: 1 },
  },
};

// =============================================================================
// Pre-2025 (history mode)
// =============================================================================

/**
 * New Year's Eve 2025 — historical record only.
 *
 * Labels:
 *   Day 1 → Dec 31 2024 slot 1 (parser fallback)
 */
export const NYE_2025_CONFIG: CampaignImportConfig = {
  slug: "nye-2025",
  name: "New Year's Eve 2025",
  holidayType: "newyears",
  startDate: "2024-12-31",
  endDate: "2025-01-01",
  jsonPath: "data/nye_2025.json",
  overridesPath: "data/nye_2025_resolver_overrides.json",
  jsonPathEnvVar: "NYE_2025_JSON_PATH",
  mode: "history",
  clustersByLabel: {
    "day 1": { date: "2024-12-31", dayPart: "other", slotNumber: 1 },
  },
};

/**
 * Halloween 2024 — historical record only.
 *
 * Labels:
 *   Day 1 → Oct 31 2024 slot 1 (parser fallback — Halloween 2024
 *           sheets had a single-block layout per city)
 */
export const HALLOWEEN_2024_CONFIG: CampaignImportConfig = {
  slug: "halloween-2024",
  name: "Halloween 2024",
  holidayType: "halloween",
  startDate: "2024-10-31",
  endDate: "2024-11-02",
  jsonPath: "data/halloween_2024.json",
  overridesPath: "data/halloween_2024_resolver_overrides.json",
  jsonPathEnvVar: "HALLOWEEN_2024_JSON_PATH",
  mode: "history",
  clustersByLabel: {
    "day 1": { date: "2024-10-31", dayPart: "thursday_night", slotNumber: 1 },
  },
};

// =============================================================================
// Registry — recency-ordered (newest first)
// =============================================================================

export const CAMPAIGN_REGISTRY: CampaignImportConfig[] = [
  SPD_2026_CONFIG,
  NYE_2026_CONFIG,
  HALLOWEEN_2025_CONFIG,
  SPD_2025_CONFIG,
  NYE_2025_CONFIG,
  HALLOWEEN_2024_CONFIG,
];

/** Look up a campaign config by slug. Returns null when not found. */
export function getCampaignConfig(slug: string): CampaignImportConfig | null {
  return CAMPAIGN_REGISTRY.find((c) => c.slug === slug) ?? null;
}
