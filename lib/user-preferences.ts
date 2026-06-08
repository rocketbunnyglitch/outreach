import "server-only";

/**
 * User preferences — read + upsert helpers for the user_preferences
 * table. See migration 0060 / db/schema/user-preferences.ts.
 *
 * The InboxDensityToggle component reads via getUserPreferences on
 * mount (server-side, via a server action) and writes via
 * upsertUserPreferences when the operator changes a setting. The
 * local localStorage cache stays as a no-flicker hint between
 * navigations, but the table is the source of truth.
 *
 * Returns null when the user has no preferences row yet — caller
 * should fall back to defaults.
 */

import { userPreferences } from "@/db/schema";
import { db } from "@/lib/db";
import { eq, sql } from "drizzle-orm";

export type InboxDensity = "compact" | "default" | "comfortable";
export type ReadingPanePosition = "right" | "bottom" | "none";
export type InboxView = "outlook" | "gmail";
export type ThemePref = "light" | "dark";
export type InboxScope = "team" | "campaign" | "mine";

export interface UserPrefs {
  inboxDensity: InboxDensity | null;
  inboxReadingPane: ReadingPanePosition | null;
  /** 'outlook' (3-pane) | 'gmail' (list + full-screen). null = outlook. */
  inboxView: InboxView | null;
  /** 'light' | 'dark'. null = follow localStorage / OS. */
  themePref: ThemePref | null;
  /** 'team' | 'campaign' | 'mine'. null = no saved scope -> default 'mine'. */
  inboxScope: InboxScope | null;
  /** Per-campaign account-visibility scope. Key is campaign id or
   *  "_default" for the no-campaign / all-campaigns view. Value is
   *  the list of connected_account ids the operator explicitly
   *  selected. Empty arrays + missing keys both mean "default to
   *  every account I can see." */
  inboxAccountFilters: Record<string, string[]>;
  /** Daily digest opt-in. true = receive daily digest emails;
   *  false = opted out; null = use default (currently opted-in).
   *  The cron at /api/cron/daily-digest reads this and skips
   *  rows whose value is explicitly false. */
  dailyDigestEnabled: boolean | null;
}

export async function getUserPreferences(userId: string): Promise<UserPrefs | null> {
  const [row] = await db
    .select({
      inboxDensity: userPreferences.inboxDensity,
      inboxReadingPane: userPreferences.inboxReadingPane,
      inboxView: userPreferences.inboxView,
      themePref: userPreferences.themePref,
      inboxScope: userPreferences.inboxScope,
      inboxAccountFilters: userPreferences.inboxAccountFilters,
      dailyDigestEnabled: userPreferences.dailyDigestEnabled,
    })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  if (!row) return null;
  return {
    inboxDensity: (row.inboxDensity as InboxDensity | null) ?? null,
    inboxReadingPane: (row.inboxReadingPane as ReadingPanePosition | null) ?? null,
    inboxView: (row.inboxView as InboxView | null) ?? null,
    themePref: (row.themePref as ThemePref | null) ?? null,
    inboxScope: (row.inboxScope as InboxScope | null) ?? null,
    inboxAccountFilters: (row.inboxAccountFilters as Record<string, string[]> | null) ?? {},
    dailyDigestEnabled: row.dailyDigestEnabled ?? null,
  };
}

/**
 * Upsert a single preference key. We don't take the whole UserPrefs
 * object because callers usually change one toggle at a time —
 * touching both at once would risk overwriting a setting the user
 * just changed on a different device between reads.
 *
 * Use ON CONFLICT DO UPDATE so first-time callers don't need a
 * separate INSERT path.
 */
export async function setUserPreference(userId: string, patch: Partial<UserPrefs>): Promise<void> {
  // Validate enum values defensively -- the action is callable from
  // the client.
  const density = isInboxDensity(patch.inboxDensity ?? null) ? patch.inboxDensity : undefined;
  const pane = isReadingPanePosition(patch.inboxReadingPane ?? null)
    ? patch.inboxReadingPane
    : undefined;
  const view = isInboxView(patch.inboxView ?? null) ? patch.inboxView : undefined;
  const theme = isThemePref(patch.themePref ?? null) ? patch.themePref : undefined;
  const scope = isInboxScope(patch.inboxScope ?? null) ? patch.inboxScope : undefined;
  // dailyDigestEnabled: only accept actual booleans or explicit
  // null. Undefined (key not present in patch) means "don't touch."
  // We can't use `patch.dailyDigestEnabled === undefined` cleanly
  // since `in` checks the key presence, so use `in` directly.
  const digestProvided = "dailyDigestEnabled" in patch;
  const digest = digestProvided
    ? typeof patch.dailyDigestEnabled === "boolean" || patch.dailyDigestEnabled === null
      ? patch.dailyDigestEnabled
      : undefined
    : undefined;

  if (
    density === undefined &&
    pane === undefined &&
    view === undefined &&
    theme === undefined &&
    scope === undefined &&
    digest === undefined &&
    !digestProvided
  ) {
    return;
  }

  await db
    .insert(userPreferences)
    .values({
      userId,
      inboxDensity: density ?? null,
      inboxReadingPane: pane ?? null,
      inboxView: view ?? null,
      themePref: theme ?? null,
      inboxScope: scope ?? null,
      // dailyDigestEnabled column default is TRUE; an explicit
      // false here records the opt-out. NULL here means "not set
      // by this insert", which on a fresh row falls back to the
      // column default of TRUE -- correct semantics.
      ...(digestProvided ? { dailyDigestEnabled: digest ?? null } : {}),
    })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: {
        ...(density !== undefined ? { inboxDensity: density ?? null } : {}),
        ...(pane !== undefined ? { inboxReadingPane: pane ?? null } : {}),
        ...(view !== undefined ? { inboxView: view ?? null } : {}),
        ...(theme !== undefined ? { themePref: theme ?? null } : {}),
        ...(scope !== undefined ? { inboxScope: scope ?? null } : {}),
        ...(digestProvided ? { dailyDigestEnabled: digest ?? null } : {}),
        updatedAt: sql`NOW()`,
      },
    });
}

function isInboxDensity(v: unknown): v is InboxDensity | null {
  return v === null || v === "compact" || v === "default" || v === "comfortable";
}

function isReadingPanePosition(v: unknown): v is ReadingPanePosition | null {
  return v === null || v === "right" || v === "bottom" || v === "none";
}

function isInboxView(v: unknown): v is InboxView | null {
  return v === null || v === "outlook" || v === "gmail";
}

function isThemePref(v: unknown): v is ThemePref | null {
  return v === null || v === "light" || v === "dark";
}

function isInboxScope(v: unknown): v is InboxScope | null {
  return v === null || v === "team" || v === "campaign" || v === "mine";
}

/**
 * Persist the account-visibility selection for one campaign (or the
 * "_default" / all-campaigns view). Single-key upsert preserves the
 * other campaigns' filters — we don't overwrite the whole JSONB
 * object since the operator may have set filters on multiple
 * campaigns from different devices.
 *
 * Empty list means "clear the filter for this campaign" — the entry
 * is deleted from the JSONB rather than stored as an empty array,
 * so the next read defaults back to "every account."
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function setInboxAccountFilterForCampaign(
  userId: string,
  /** campaign id, or "_default" for the no-campaign view. */
  campaignKey: string,
  accountIds: string[],
): Promise<void> {
  // Defensive validation — the action is callable from the client.
  // Drop garbage entries; if every id is invalid we treat as "clear".
  const valid = accountIds.filter((id) => UUID_RE.test(id));
  const key = campaignKey === "_default" || UUID_RE.test(campaignKey) ? campaignKey : null;
  if (!key) return;

  // Update the JSONB in place via jsonb_set when adding, or '#-' when
  // clearing. Done with a single SQL fragment so we don't read-
  // modify-write across two queries (race-safe).
  if (valid.length === 0) {
    await db
      .insert(userPreferences)
      .values({
        userId,
        inboxAccountFilters: {},
      })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: {
          inboxAccountFilters: sql`COALESCE(${userPreferences.inboxAccountFilters}, '{}'::jsonb) #- ${sql.raw(
            `'{${escapeJsonbPathKey(key)}}'`,
          )}`,
          updatedAt: sql`NOW()`,
        },
      });
    return;
  }

  await db
    .insert(userPreferences)
    .values({
      userId,
      inboxAccountFilters: { [key]: valid },
    })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: {
        inboxAccountFilters: sql`jsonb_set(
          COALESCE(${userPreferences.inboxAccountFilters}, '{}'::jsonb),
          ${sql.raw(`'{${escapeJsonbPathKey(key)}}'`)},
          ${JSON.stringify(valid)}::jsonb,
          true
        )`,
        updatedAt: sql`NOW()`,
      },
    });
}

/**
 * jsonb path keys need single quotes escaped + braces / commas
 * stripped to be safe inside the {key} array literal. Campaign keys
 * are UUID or "_default" so this is defensive only; the alphabet
 * is already safe.
 */
function escapeJsonbPathKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, "");
}
