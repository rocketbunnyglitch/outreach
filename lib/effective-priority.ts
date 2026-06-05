/**
 * Effective priority -- the sales-driven scheduling pivot. [ReferenceDoc 1.6]
 *
 * Pure logic (no DB/network/server-only) so it unit-tests under vitest and can
 * be computed on the server and passed to client badges as plain data.
 *
 * Static priority (cityCampaigns.priority, 1 = highest .. 10 = lowest per
 * DECISIONS.md#007) is the right scheduler EARLY, when there is no sales data
 * and you have to bet on last year's prior. Once tickets start moving (inside
 * the 21-day pre-event window) the engine blends in actual sales velocity:
 * evidence beats prior. A low-priority city that is converting gets worked
 * ahead of a high-priority city that is hoping.
 *
 * "Bump up a tier" = MORE important = LOWER number. The thresholds below are
 * calibrated to the LOCKED reference-doc example (Toronto Prio 1 / 0 sold / 14d
 * out -> effective 3; Detroit Prio 4 / 35 sold / 14d out -> effective 2) -- the
 * concrete numbers there are the contract. See the [ENGINE] subsection under
 * 1.6 in the reference doc for the exact bands kept in sync with this file.
 */

export const PRIORITY_MIN = 1;
export const PRIORITY_MAX = 10;

/** Sales pivot activates this many days before the event (configurable later). */
export const PIVOT_WINDOW_DAYS = 21;

// Sales boost: tickets sold inside the window bumps the city UP (lower number).
export const BOOST_UP2_TICKETS = 30; // > 30 sold -> up 2 tiers
export const BOOST_UP1_TICKETS = 20; // > 20 sold -> up 1 tier

// Sales drag: zero sales inside the window bumps the city DOWN (higher number).
export const DRAG_DOWN2_DAYS = 14; // 0 sold and <= 14 days out -> down 2 tiers
// (15..21 days out with 0 sold -> down 1 tier)

export interface EffectivePriorityArgs {
  /** Static city priority, 1 (highest) .. 10 (lowest). */
  staticPriority: number;
  /** Current sold count for this city x campaign (0 when no integration/sales). */
  ticketsSold: number;
  /** Days until the earliest event in this city (negative = past). */
  daysToEvent: number;
}

export interface EffectivePriorityResult {
  /** Blended priority, clamped to 1..10. */
  effective: number;
  /** Human-readable why, for tooltips. */
  reason: string;
  /** True when a sales-based adjustment is in effect (inside window + a tier shift). */
  pivotActive: boolean;
}

function clampPriority(n: number): number {
  return Math.max(PRIORITY_MIN, Math.min(PRIORITY_MAX, Math.round(n)));
}

/**
 * Blend static priority with ticket sales. [ReferenceDoc 1.6]
 *
 * Outside the 21-day window, or with sales that don't cross a band, the
 * effective priority equals the static priority (pivotActive=false).
 */
export function computeEffectivePriority(args: EffectivePriorityArgs): EffectivePriorityResult {
  const staticPriority = clampPriority(args.staticPriority);
  const { ticketsSold, daysToEvent } = args;

  // Earlier than 3 weeks out: not enough sales data to override the prior.
  if (daysToEvent > PIVOT_WINDOW_DAYS) {
    return {
      effective: staticPriority,
      reason: "Static priority -- too early for sales data.",
      pivotActive: false,
    };
  }

  // Inside the window. Boost up (lower number) or drag down (higher number).
  let delta = 0;
  if (ticketsSold > BOOST_UP2_TICKETS) delta = -2;
  else if (ticketsSold > BOOST_UP1_TICKETS) delta = -1;
  else if (ticketsSold === 0) delta = daysToEvent <= DRAG_DOWN2_DAYS ? 2 : 1;

  const effective = clampPriority(staticPriority + delta);

  if (delta === 0 || effective === staticPriority) {
    return {
      effective,
      reason:
        ticketsSold > 0
          ? `Static priority -- ${ticketsSold} sold, no tier change.`
          : "Static priority -- inside window, no sales yet.",
      // A boost/drag that only got clamped away still means the pivot fired.
      pivotActive: delta !== 0,
    };
  }

  const dir = delta < 0 ? "up" : "down";
  const cause = delta < 0 ? `${ticketsSold} tickets sold` : "0 tickets sold";
  return {
    effective,
    reason: `Bumped ${dir} from ${staticPriority} -> ${effective} because ${cause} by day -${daysToEvent}.`,
    pivotActive: true,
  };
}
