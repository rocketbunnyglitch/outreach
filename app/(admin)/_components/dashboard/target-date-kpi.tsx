"use client";

/**
 * Target Date KPI card. Same visual family as CitiesCompletedKpi but
 * the dotted-arc is a FULL CIRCLE of glowing bars that drain
 * counter-clockwise from green -> yellow -> orange -> red as the
 * campaign's end_date approaches. Operators glance at this card and
 * know how close they are to the wall.
 *
 * Color thresholds (days until end_date):
 *   >  60d  green
 *   <= 60d  green-to-yellow gradient
 *   <= 30d  yellow
 *   <= 14d  yellow-to-orange
 *   <=  7d  orange
 *   <=  3d  red
 *   <=  0d  red (expired — bars fully lit + pulsing tone)
 *
 * The "lit" bars represent days REMAINING (fills the circle when
 * far from the deadline, drains as the date approaches). When the
 * date has passed, all 60 bars are lit + tone is locked to red so
 * the urgency is unmistakable.
 *
 * Admin-only inline edit on the date — pencil opens a date input
 * with Enter/Esc shortcuts (same pattern as CitiesCompletedKpi).
 */

import { Check, Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateCampaignTargetDate } from "../../_actions-cities-goal";

/** Total bars in the ring. 60 bars at 6° each = a clean full circle
 *  that still has enough resolution for "X% remaining" to read. */
const TOTAL_BARS = 60;

export function TargetDateKpi({
  endDate,
  campaignId,
  isAdmin,
}: {
  /** YYYY-MM-DD or null when the campaign hasn't been dated. */
  endDate: string | null;
  campaignId: string | null;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(endDate ?? "");
  const [pending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canEdit = isAdmin && !!campaignId;

  // Resolve "days left" client-side off the start-of-day to avoid
  // a one-day flicker between server render and client hydration.
  // Date input is timezone-naive (YYYY-MM-DD); we treat it as the
  // operator's local date by appending T00:00:00 (no Z) so JS uses
  // local tz on the comparison.
  const target = endDate ? new Date(`${endDate}T00:00:00`) : null;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysLeft = target
    ? Math.ceil((target.getTime() - todayStart.getTime()) / (24 * 60 * 60 * 1000))
    : null;

  // Tone band — drives the bar gradient + accent text color.
  const tone = pickTone(daysLeft);

  function save() {
    if (!campaignId) return;
    if (!draft) {
      setError("Pick a date.");
      return;
    }
    setError(null);
    startTx(async () => {
      const res = await updateCampaignTargetDate({ campaignId, endDate: draft });
      if (!res.ok) {
        setError(res.error ?? "Couldn't save.");
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <section className="card-surface relative overflow-hidden shadow-[0_20px_50px_-20px_rgba(234,179,8,0.18)]">
      {/* Soft radial wash behind the ring — tone-matched to the
          current tone so the card "warms up" as the deadline gets
          closer (green wash early, red wash at the wall). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(ellipse 60% 60% at 50% 50%, ${TONE_WASH[tone]} 0%, rgba(0,0,0,0) 65%)`,
        }}
      />

      <div className="relative aspect-square min-h-[180px] w-full p-3 sm:min-h-[320px] sm:p-5">
        <RingOfBars
          totalBars={TOTAL_BARS}
          litCount={daysLeft === null ? 0 : litBarsFor(daysLeft)}
          tone={tone}
        />

        {/* TARGET DATE label — sized to match the reference image's
            "SUMMARY" treatment: wider letter-spacing, larger size
            than a normal kpi caption, sits above the big number. */}
        <div className="pointer-events-none absolute inset-x-0 top-[36%] flex justify-center">
          <p className="font-mono text-[9px] text-zinc-400 uppercase tracking-[0.28em] sm:text-[12px] sm:tracking-[0.32em] dark:text-zinc-300">
            Target Date
          </p>
        </div>

        {/* Big date — center. Sized to fill the ring's negative
            space the way "20.830" does in the reference: huge,
            bold, white, dominates the card. Uses clamp at the top
            end so the longest month names (SEPTEMBER) still fit
            inside the ring. */}
        <div className="pointer-events-none absolute inset-x-0 top-[44%] flex justify-center px-4">
          {editing ? (
            <span className="pointer-events-auto inline-flex items-center gap-1">
              <input
                // biome-ignore lint/a11y/noAutofocus: explicit edit affordance
                autoFocus
                type="date"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                  if (e.key === "Escape") {
                    setDraft(endDate ?? "");
                    setEditing(false);
                    setError(null);
                  }
                }}
                disabled={pending}
                className="rounded border border-amber-500/40 bg-zinc-900 px-1.5 py-0.5 text-amber-200 text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-amber-400"
                aria-label="Target date"
              />
              <button
                type="button"
                onClick={save}
                disabled={pending}
                className="text-amber-400 hover:text-amber-300"
                aria-label="Save target date"
              >
                <Check className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(endDate ?? "");
                  setEditing(false);
                  setError(null);
                }}
                disabled={pending}
                className="text-zinc-500 hover:text-zinc-300"
                aria-label="Cancel"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ) : (
            <p
              className="whitespace-nowrap font-bold text-3xl text-zinc-900 leading-none tracking-tight sm:text-5xl lg:text-6xl dark:text-white"
              style={{ fontFeatureSettings: '"tnum"' }}
            >
              {target ? formatDate(target) : "—"}
            </p>
          )}
        </div>

        {/* Days left + edit. Tone-colored, bigger and bolder than
            the original — matches the "+23%" treatment in the
            reference where the secondary number is a confident
            colored accent, not a subtle caption. */}
        <div className="pointer-events-none absolute inset-x-0 top-[60%] flex justify-center">
          <div className="pointer-events-auto flex flex-col items-center gap-1">
            <p
              className={`whitespace-nowrap font-mono font-semibold text-xs uppercase tracking-[0.18em] sm:text-base sm:tracking-[0.22em] ${TONE_TEXT[tone]}`}
            >
              {daysLeft === null
                ? "No date set"
                : daysLeft < 0
                  ? `${Math.abs(daysLeft)} days overdue`
                  : daysLeft === 0
                    ? "Today"
                    : `${daysLeft} days left`}
            </p>
            {canEdit && !editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                title="Edit target date (admin)"
                className="text-zinc-500 transition-colors hover:text-amber-400"
                aria-label="Edit target date"
              >
                <Pencil className="h-2.5 w-2.5" />
              </button>
            )}
            {error && (
              <p className="text-rose-400 text-[10px]" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------
// Tone selection — green far out, red at the wall.
// -----------------------------------------------------------------

type Tone = "green" | "lime" | "yellow" | "amber" | "orange" | "red";

function pickTone(daysLeft: number | null): Tone {
  if (daysLeft === null) return "green";
  if (daysLeft <= 3) return "red";
  if (daysLeft <= 7) return "orange";
  if (daysLeft <= 14) return "amber";
  if (daysLeft <= 30) return "yellow";
  if (daysLeft <= 60) return "lime";
  return "green";
}

/** How many bars to light. The ring FILLS UP as the deadline
 *  approaches — far out = nearly empty, at the wall = fully lit.
 *  Reads as a countdown that's "filling up to zero."
 *
 *  Anchored to a 90-day campaign so the math is consistent regardless
 *  of when the operator sets the date. Stretches/compresses at the
 *  edges:
 *    - Always at least 2 bars lit (so the ring's tone is visible
 *      even when the campaign is fresh — otherwise it'd look broken
 *      at "90 days out")
 *    - 0 days or overdue forces the full ring lit + locked-red tone
 *      so the urgency is unmistakable */
function litBarsFor(daysLeft: number): number {
  if (daysLeft <= 0) return TOTAL_BARS;
  const ratio = 1 - Math.min(daysLeft, 90) / 90;
  return Math.max(2, Math.round(TOTAL_BARS * ratio));
}

const TONE_BAR: Record<Tone, string> = {
  green: "#10b981",
  lime: "#84cc16",
  yellow: "#eab308",
  amber: "#f59e0b",
  orange: "#f97316",
  red: "#ef4444",
};

const TONE_WASH: Record<Tone, string> = {
  green: "rgba(16,185,129,0.28)",
  lime: "rgba(132,204,22,0.30)",
  yellow: "rgba(234,179,8,0.34)",
  amber: "rgba(245,158,11,0.36)",
  orange: "rgba(249,115,22,0.40)",
  red: "rgba(239,68,68,0.44)",
};

const TONE_TEXT: Record<Tone, string> = {
  green: "text-emerald-600 dark:text-emerald-400",
  lime: "text-lime-600 dark:text-lime-400",
  yellow: "text-yellow-600 dark:text-yellow-300",
  amber: "text-amber-600 dark:text-amber-300",
  orange: "text-orange-600 dark:text-orange-300",
  red: "text-rose-600 dark:text-rose-400",
};

// -----------------------------------------------------------------
// RingOfBars — radial-tick visualization (matches reference image)
// -----------------------------------------------------------------

function RingOfBars({
  totalBars,
  litCount,
  tone,
}: {
  totalBars: number;
  litCount: number;
  tone: Tone;
}) {
  // ViewBox slightly larger than the bar-reach so the outer glow
  // has room to expand without getting clipped at the SVG edge.
  const width = 440;
  const height = 440;
  const cx = width / 2;
  const cy = height / 2;
  // Long radial fingers — reference image has bars ~25% of the
  // ring radius, with the outer tips landing close to the card
  // edge. Inner void is wide enough to host the full text block
  // (TARGET DATE / big date / DAYS LEFT) without crowding.
  const outerRadius = 210;
  const innerRadius = 156; // 54px tall bars
  const litColor = TONE_BAR[tone];

  // Bars laid out around the circle. Start angle at -90° (top) so
  // the "first" bar is at 12 o'clock; bars go clockwise.
  const bars = Array.from({ length: totalBars }, (_, i) => {
    const angle = (i / totalBars) * 2 * Math.PI - Math.PI / 2;
    const x1 = cx + innerRadius * Math.cos(angle);
    const y1 = cy + innerRadius * Math.sin(angle);
    const x2 = cx + outerRadius * Math.cos(angle);
    const y2 = cy + outerRadius * Math.sin(angle);
    return { x1, y1, x2, y2, angle, order: i };
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Countdown ring: ${litCount} of ${totalBars} bars lit`}
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        {/* Multi-pass bloom to match the reference image's dramatic
            outer halo. Three layers stacked:
              1. wide ambient halo (stdDev 16) — throws colored
                 wash 30-50px past the bars into negative space
              2. mid bloom (stdDev 6) — softens the bar edges and
                 adds the "lit from within" weight
              3. SourceGraphic on top — keeps the bar itself crisp
            Width/height set to 300% with inset -100% so the halo
            isn't clipped at the bar's own bounding box. */}
        <filter id="bar-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="16" result="halo" />
          <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="bloom" />
          <feMerge>
            <feMergeNode in="halo" />
            <feMergeNode in="bloom" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {bars.map((b) => {
        const lit = b.order < litCount;
        const key = `${b.order}`;
        if (lit) {
          return (
            <line
              key={key}
              x1={b.x1}
              y1={b.y1}
              x2={b.x2}
              y2={b.y2}
              stroke={litColor}
              strokeWidth={9}
              strokeLinecap="round"
              filter="url(#bar-glow)"
            />
          );
        }
        return (
          <line
            key={key}
            x1={b.x1}
            y1={b.y1}
            x2={b.x2}
            y2={b.y2}
            stroke="#52525b"
            strokeWidth={5}
            strokeLinecap="round"
            opacity={0.5}
          />
        );
      })}
    </svg>
  );
}

/** "JULY 15TH" formatting. Matches the operator's reference image
 *  — month uppercase, ordinal suffix on the day, no year. The
 *  operator can put the year in the campaign name if they need it
 *  visible. */
function formatDate(d: Date): string {
  const month = d.toLocaleDateString(undefined, { month: "long" }).toUpperCase();
  const day = d.getDate();
  const suffix = ordinal(day);
  return `${month} ${day}${suffix}`;
}

function ordinal(n: number): string {
  const s = ["TH", "ST", "ND", "RD"];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0] ?? "TH";
}
