/**
 * Health / viability scoring -- PURE core (no db, no "server-only"), so it is
 * unit-tested directly and importable from client components. The DB wrapper
 * (lib/health-score.ts) fetches the inputs and calls these graders.
 *
 * This is the operating-system backbone the command center, worklist sorting,
 * viability triage and Google Sheets backup all read from. It composes -- it
 * does NOT duplicate -- the existing pure engines:
 *   - computeEffectivePriority (lib/effective-priority.ts)  sales pivot
 *   - readinessFromRow         (lib/event-readiness-core.ts) V2 / event-day prep
 *   - scoreEngagement          (lib/engagement-score.ts)     venue warmth
 *
 * Levels:
 *   - CrawlHealth   : one `events` row (a crawl night). Ticket sales + slot
 *                     fill (wristband/middle/final) + readiness -> score + a
 *                     viability verdict (operational triage, NOT a forecast).
 *   - CityHealth    : a city_campaign -- rolls up its crawls + warm-lead rot.
 *   - VenueHealth   : a venue -- engagement + staleness + stage gaps.
 *   - CampaignHealth: a campaign -- rolls up its cities.
 *
 * Everything is deterministic: the caller passes already-resolved inputs (incl.
 * `daysToEvent`, computed from a single reference instant) so the same inputs
 * always grade the same way. Slot vocabulary matches the schema: a slot is a
 * venue_event; role in {wristband, middle, final, alt_final}; status=confirmed
 * => FILLED. crawl_format='day_party' has NO final slot.
 */

export type HealthColor = "green" | "yellow" | "red";

/**
 * Operational triage verdict for a crawl. This is NOT legal/financial
 * forecasting -- it answers "what should the operator do about this crawl
 * today", nothing more.
 */
export type ViabilityVerdict =
  | "too_early_to_judge"
  | "likely_to_run"
  | "needs_attention"
  | "sales_strong_lineup_weak"
  | "lineup_strong_sales_weak"
  | "cancellation_review"
  | "likely_cancellation"
  | "completed"
  | "cancelled";

export interface HealthScore {
  /** 0-100, higher = healthier. */
  score: number;
  color: HealthColor;
  /** Short operator-friendly label for the chip. */
  statusLabel: string;
  /** Soft concerns (drag the score; do not block). */
  reasons: string[];
  /** Hard problems that must be cleared (drive red). */
  blockers: string[];
  /** The single highest-leverage thing to do next, or null when healthy. */
  nextAction: string | null;
}

export interface CrawlHealth extends HealthScore {
  viability: ViabilityVerdict;
}

// ---- Thresholds (exported so consumers + docs stay in sync) ----------------

/** score >= this => green. */
export const HEALTH_GREEN_MIN = 80;
/** score >= this (and < green) => yellow; below => red. */
export const HEALTH_YELLOW_MIN = 50;

/** "High sales" -- enough demand that an incomplete lineup is urgent. Aligned
 *  with effective-priority's BOOST_UP1 band. */
export const HIGH_SALES_TICKETS = 20;
/** At/above this inside the event week, a crawl "leans run" -- never an
 *  auto-cancellation candidate. (Reference: 11+ tickets Wed/Thu leans run.) */
export const MIN_RUN_TICKETS = 11;
/** Within this many days of the event = "event week" (slot gaps turn critical). */
export const EVENT_WEEK_DAYS = 7;
/** The back-half of the event week. Inside this window, sales below the run
 *  floor escalate to a cancellation review. (Reference: 0 sales Tuesday of
 *  event week -> review; Tue before a Sat event is ~4-5 days out.) */
export const CANCELLATION_REVIEW_DAYS = 5;
/** Earlier than this, there is not enough signal to call viability. */
export const TOO_EARLY_DAYS = 21;

// Score deltas.
const BLOCKER_PENALTY = 25;
const REASON_PENALTY = 8;

const COLOR_STATUS_LABEL: Record<HealthColor, string> = {
  green: "On track",
  yellow: "Needs attention",
  red: "At risk",
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function scoreToColor(score: number): HealthColor {
  if (score >= HEALTH_GREEN_MIN) return "green";
  if (score >= HEALTH_YELLOW_MIN) return "yellow";
  return "red";
}

/**
 * Build a HealthScore from accumulated reasons/blockers + a chosen nextAction.
 *
 * Color is categorical and follows the documented contract: ANY blocker drives
 * red, ANY soft reason drives yellow, otherwise green. The numeric `score` is
 * then kept inside the band its color implies, so the sortable number and the
 * chip color never disagree.
 */
function gradeFromSignals(
  reasons: string[],
  blockers: string[],
  nextAction: string | null,
  colorOverride?: HealthColor,
): HealthScore {
  let score = clamp(
    100 - BLOCKER_PENALTY * blockers.length - REASON_PENALTY * reasons.length,
    0,
    100,
  );

  let color: HealthColor;
  if (colorOverride) color = colorOverride;
  else if (blockers.length > 0) color = "red";
  else if (reasons.length > 0) color = "yellow";
  else color = "green";

  if (color === "red") score = Math.min(score, HEALTH_YELLOW_MIN - 1);
  else if (color === "yellow")
    score = clamp(Math.max(score, HEALTH_YELLOW_MIN), HEALTH_YELLOW_MIN, HEALTH_GREEN_MIN - 1);
  else score = Math.max(score, HEALTH_GREEN_MIN);

  return { score, color, statusLabel: COLOR_STATUS_LABEL[color], reasons, blockers, nextAction };
}

/** " -- event today" / " -- event in 4d" / " -- event passed" / "". */
function eventWhen(daysToEvent: number | null | undefined): string {
  if (daysToEvent == null) return "";
  if (daysToEvent < 0) return " -- event passed";
  if (daysToEvent === 0) return " -- event today";
  return ` -- event in ${daysToEvent}d`;
}

// ============================================================================
// Crawl health
// ============================================================================

export interface CrawlHealthInput {
  /** events.status. */
  eventStatus: "planned" | "confirmed" | "completed" | "cancelled";
  /** events.crawl_format -- 'day_party' has NO final slot. */
  crawlFormat: "standard" | "day_party";
  /** events.ticket_sales_count. */
  ticketsSold: number;
  /** Days until the event (negative = past, null = unknown date). */
  daysToEvent: number | null;

  /** Confirmed venue_events per role vs. how many that crawl requires. */
  wristbandRequired: number;
  wristbandFilled: number;
  middleRequired: number;
  middleFilled: number;
  finalRequired: number;
  finalFilled: number;

  /** A confirmed venue inside the V2/event-day window is missing a hard
   *  readiness step (e.g. floor-staff briefing). From readinessFromRow.blocker
   *  rolled up across this crawl's venues. */
  readinessBlocker?: boolean;
  readinessBlockerReason?: string | null;
}

function missingFinalApplies(input: CrawlHealthInput): boolean {
  // Day parties wrap before the final hour -- no final slot to miss.
  if (input.crawlFormat === "day_party") return false;
  return input.finalRequired > 0 && input.finalFilled < input.finalRequired;
}

function computeViability(input: CrawlHealthInput): ViabilityVerdict {
  if (input.eventStatus === "cancelled") return "cancelled";
  if (input.eventStatus === "completed") return "completed";

  const d = input.daysToEvent;
  const { ticketsSold } = input;

  const missingWristband =
    input.wristbandRequired > 0 && input.wristbandFilled < input.wristbandRequired;
  const missingFinal = missingFinalApplies(input);
  const missingMiddle = input.middleFilled < input.middleRequired;
  const missingAny = missingWristband || missingFinal || missingMiddle;
  const lineupWeak = missingWristband || missingFinal; // the slots that sink a crawl

  const eventWeek = d != null && d >= 0 && d <= EVENT_WEEK_DAYS;
  const nearCancelWindow = d != null && d >= 0 && d <= CANCELLATION_REVIEW_DAYS;
  const salesStrong = ticketsSold >= HIGH_SALES_TICKETS;
  const salesRunnable = ticketsSold >= MIN_RUN_TICKETS;

  // Imminent + not selling -> cancellation track. Guarded by the run floor so
  // a crawl with real momentum is never marked for cancellation.
  if (nearCancelWindow && !salesRunnable) {
    return ticketsSold === 0 ? "cancellation_review" : "likely_cancellation";
  }

  // Strong demand with a hole in the lineup -- the urgent "fill it now" state.
  if (salesStrong && lineupWeak) return "sales_strong_lineup_weak";

  // Inside the event week with runnable sales -> leans run.
  if (eventWeek && salesRunnable) {
    return lineupWeak ? "sales_strong_lineup_weak" : "likely_to_run";
  }

  // Lineup is set but sales are soft this close in.
  if (eventWeek && !salesRunnable && !missingAny) return "lineup_strong_sales_weak";

  // Too early to judge -- but a missing slot is still worth flagging softly.
  if (d == null || d > TOO_EARLY_DAYS) {
    return missingAny ? "needs_attention" : "too_early_to_judge";
  }

  return missingAny || !salesRunnable ? "needs_attention" : "likely_to_run";
}

/** Grade a single crawl (an `events` row). */
export function crawlHealthFromInputs(input: CrawlHealthInput): CrawlHealth {
  const when = eventWhen(input.daysToEvent);
  const viability = computeViability(input);

  if (viability === "cancelled") {
    return {
      ...gradeFromSignals(
        [],
        ["Crawl cancelled"],
        "Open a replacement slot or close out the crawl",
        "red",
      ),
      statusLabel: "Cancelled",
      viability,
    };
  }
  if (viability === "completed") {
    const done = gradeFromSignals([], [], null, "green");
    return { ...done, statusLabel: "Completed", viability };
  }

  const d = input.daysToEvent;
  const eventWeek = d != null && d >= 0 && d <= EVENT_WEEK_DAYS;
  const salesStrong = input.ticketsSold >= HIGH_SALES_TICKETS;

  const reasons: string[] = [];
  const blockers: string[] = [];

  // ---- Slot gaps -----------------------------------------------------------
  const missingWristband =
    input.wristbandRequired > 0 && input.wristbandFilled < input.wristbandRequired;
  if (missingWristband) {
    const msg = `Wristband venue not confirmed${when}`;
    if (eventWeek) blockers.push(msg);
    else reasons.push(msg);
  }

  if (missingFinalApplies(input)) {
    const msg = `Final venue not confirmed${when}`;
    if (salesStrong || eventWeek) blockers.push(msg);
    else reasons.push(msg);
  }

  const missingMiddleCount = Math.max(0, input.middleRequired - input.middleFilled);
  if (missingMiddleCount > 0) {
    const msg = `${missingMiddleCount} middle slot${missingMiddleCount > 1 ? "s" : ""} unfilled`;
    if (eventWeek && missingMiddleCount >= 2) blockers.push(msg);
    else reasons.push(msg);
  }

  // ---- Readiness / V2 ------------------------------------------------------
  if (input.readinessBlocker) {
    blockers.push(input.readinessBlockerReason ?? `Floor-staff briefing pending${when}`);
  }

  // ---- Sales / viability narrative ----------------------------------------
  switch (viability) {
    case "cancellation_review":
      blockers.push(`No tickets sold${when} -- review for cancellation`);
      break;
    case "likely_cancellation":
      blockers.push(`Only ${input.ticketsSold} sold${when} -- at risk of cancellation`);
      break;
    case "lineup_strong_sales_weak":
      reasons.push(`Lineup set but only ${input.ticketsSold} sold${when}`);
      break;
    case "sales_strong_lineup_weak":
      reasons.push(`${input.ticketsSold} sold but lineup still has a gap`);
      break;
    case "needs_attention":
      if (input.ticketsSold === 0 && reasons.length === 0 && blockers.length === 0) {
        reasons.push("No tickets sold yet");
      }
      break;
    default:
      break;
  }

  const nextAction = deriveCrawlNextAction({
    missingWristband,
    missingFinal: missingFinalApplies(input),
    missingMiddleCount,
    viability,
    readinessBlocker: !!input.readinessBlocker,
  });

  return { ...gradeFromSignals(reasons, blockers, nextAction), viability };
}

function deriveCrawlNextAction(args: {
  missingWristband: boolean;
  missingFinal: boolean;
  missingMiddleCount: number;
  viability: ViabilityVerdict;
  readinessBlocker: boolean;
}): string | null {
  if (args.viability === "cancellation_review" || args.viability === "likely_cancellation") {
    return "Run cancellation review";
  }
  if (args.missingWristband) return "Confirm a wristband venue";
  if (args.missingFinal) return "Prioritize final venue calls today";
  if (args.readinessBlocker) return "Complete the floor-staff briefing call";
  if (args.missingMiddleCount > 0) return "Fill the remaining middle slot(s)";
  if (args.viability === "lineup_strong_sales_weak") return "Push ticket sales for this crawl";
  return null;
}

// ============================================================================
// City health -- rolls up the city's crawls + warm-lead rot.
// ============================================================================

export interface CityHealthInput {
  /** Already-graded crawls belonging to this city_campaign. */
  crawls: CrawlHealth[];
  /** Sum of ticket_sales_count across the city's crawls. */
  totalTicketsSold: number;
  /** Warm leads that have gone stale (from the stale tagger). */
  staleWarmLeads?: number;
}

export function cityHealthFromInputs(input: CityHealthInput): HealthScore {
  const reasons: string[] = [];
  const blockers: string[] = [];

  const red = input.crawls.filter((c) => c.color === "red");
  const yellow = input.crawls.filter((c) => c.color === "yellow");
  const stale = Math.max(0, input.staleWarmLeads ?? 0);

  // Surface the most urgent crawl blockers at the city level (cap the noise).
  for (const c of red) {
    if (c.blockers[0]) blockers.push(c.blockers[0]);
  }

  if (red.length > 0) reasons.push(`${red.length} crawl${red.length > 1 ? "s" : ""} at risk`);
  if (yellow.length > 0) {
    reasons.push(`${yellow.length} crawl${yellow.length > 1 ? "s" : ""} need attention`);
  }
  if (stale > 0) reasons.push(`${stale} warm lead${stale > 1 ? "s" : ""} going stale`);
  reasons.push(`${input.totalTicketsSold} tickets sold`);

  // Score: red crawls are the dominant drag, yellows + stale softer.
  const score = clamp(100 - 22 * red.length - 8 * yellow.length - 5 * Math.min(stale, 4), 0, 100);
  const color = scoreToColor(score);

  // Next action = the action of the worst crawl (red first, then highest score
  // drag), else a city-level nudge.
  const worst = pickWorstCrawl(input.crawls);
  let nextAction: string | null = worst?.nextAction ?? null;
  if (!nextAction && stale > 0) nextAction = "Follow up on stale warm leads";

  return { score, color, statusLabel: COLOR_STATUS_LABEL[color], reasons, blockers, nextAction };
}

function pickWorstCrawl(crawls: CrawlHealth[]): CrawlHealth | null {
  let worst: CrawlHealth | null = null;
  for (const c of crawls) {
    if (!c.nextAction) continue;
    if (worst === null || c.score < worst.score) worst = c;
  }
  return worst;
}

// ============================================================================
// Venue health -- engagement + staleness + stage gaps.
// ============================================================================

export interface VenueHealthInput {
  /** Engagement band/score (from scoreEngagement), if computed. */
  engagementScore?: number | null;
  engagementBand?: string | null;
  /** Relationship flag, e.g. 'good' | 'bad' | 'do_not_contact'. */
  relationshipFlag?: string | null;
  /** Venue/thread is sitting too long (from the stale tagger). */
  isStale?: boolean;
  stalenessReason?: string | null;
  /** venue_event status -- 'confirmed' raises the bar on missing fields. */
  confirmationStage?: string | null;
  /** No usable email AND no usable phone on record. */
  missingContact?: boolean;
  /** Confirmed venue still missing its floor-staff (V2) briefing. */
  v2Pending?: boolean;
}

const DEAD_FLAGS = new Set([
  "do_not_contact",
  "dnc",
  "bad",
  "bad_email",
  "opt_out",
  "unsubscribed",
]);

export function venueHealthFromInputs(input: VenueHealthInput): HealthScore {
  const flag = (input.relationshipFlag ?? "").trim().toLowerCase();
  if (DEAD_FLAGS.has(flag)) {
    return {
      score: 0,
      color: "red",
      statusLabel: "Do not contact",
      reasons: [`Relationship flagged "${flag}"`],
      blockers: [],
      nextAction: null,
    };
  }

  const reasons: string[] = [];
  const blockers: string[] = [];
  const confirmed = (input.confirmationStage ?? "").trim().toLowerCase() === "confirmed";

  if (confirmed && input.missingContact) {
    blockers.push("Confirmed venue missing night-of contact");
  } else if (input.missingContact) {
    reasons.push("No contact email or phone on record");
  }
  if (confirmed && input.v2Pending) blockers.push("Floor-staff (V2) call still pending");
  if (input.isStale) reasons.push(input.stalenessReason ?? "Sitting too long without a touch");

  const band = (input.engagementBand ?? "").trim().toLowerCase();
  if (band === "dead") reasons.push("No engagement");

  let nextAction: string | null = null;
  if (blockers.length > 0) {
    nextAction = input.missingContact
      ? "Add a night-of contact"
      : "Complete the floor-staff briefing call";
  } else if (input.isStale) {
    nextAction = "Follow up -- this venue is going stale";
  }

  // A confirmed venue with no blockers is healthy regardless of cold warmth;
  // otherwise let engagement lift an un-confirmed venue's score.
  let baseColorOverride: HealthColor | undefined;
  if (confirmed && blockers.length === 0 && reasons.length === 0) baseColorOverride = "green";

  return {
    ...gradeFromSignals(reasons, blockers, nextAction, baseColorOverride),
  };
}

// ============================================================================
// Campaign health -- rolls up the campaign's cities.
// ============================================================================

export interface CampaignHealthInput {
  cities: HealthScore[];
}

export function campaignHealthFromInputs(input: CampaignHealthInput): HealthScore {
  const reasons: string[] = [];
  const blockers: string[] = [];
  const red = input.cities.filter((c) => c.color === "red");
  const yellow = input.cities.filter((c) => c.color === "yellow");

  for (const c of red.slice(0, 5)) {
    if (c.blockers[0]) blockers.push(c.blockers[0]);
  }
  if (red.length > 0) reasons.push(`${red.length} city/cities at risk`);
  if (yellow.length > 0) reasons.push(`${yellow.length} city/cities need attention`);
  if (red.length === 0 && yellow.length === 0) reasons.push("All cities on track");

  const score = clamp(100 - 15 * red.length - 6 * yellow.length, 0, 100);
  const color = scoreToColor(score);
  const worst = input.cities
    .filter((c) => c.nextAction)
    .reduce<HealthScore | null>((w, c) => (!w || c.score < w.score ? c : w), null);

  return {
    score,
    color,
    statusLabel: COLOR_STATUS_LABEL[color],
    reasons,
    blockers,
    nextAction: worst?.nextAction ?? null,
  };
}
