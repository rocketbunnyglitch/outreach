"use client";

import { Check, Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateCampaignCitiesGoal } from "../../_actions-cities-goal";

/**
 * "Cities completed of X" KPI card. Glass-style dark surface with a
 * dotted-gradient semicircle of green dots, count + goal-in-label centered
 * in the negative space — Apple Activity / status-display style.
 *
 * Sized as a single-column card meant to sit alongside other KPI tiles in
 * a 3-col grid on the dashboard. Square-ish aspect so the arc reads.
 *
 * Lit dots scale with completed/goal; all dots glow when at goal. Admin-only
 * inline edit on the goal — pencil opens an input with Enter/Esc shortcuts.
 */
export function CitiesCompletedKpi({
  completed,
  goal,
  campaignId,
  isAdmin,
}: {
  completed: number;
  goal: number;
  /** Active campaign id; null when the dashboard is "all campaigns" — we
   *  still show the visual but hide the edit. */
  campaignId: string | null;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(goal));
  const [pending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canEdit = isAdmin && !!campaignId;
  const safeGoal = Math.max(goal, 1);
  const ratio = Math.min(Math.max(completed / safeGoal, 0), 1);

  function save() {
    if (!campaignId) return;
    const n = Number(draft);
    if (!Number.isFinite(n) || n < 1 || n > 500) {
      setError("Enter a whole number between 1 and 500.");
      return;
    }
    setError(null);
    startTx(async () => {
      const res = await updateCampaignCitiesGoal({ campaignId, goal: Math.round(n) });
      if (!res.ok) {
        setError(res.error ?? "Couldn't save.");
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <section
      // Glass look: dark semi-transparent gradient, thin pale border, soft
      // emerald outer glow + an inset top highlight to catch the eye. The
      // backdrop-blur is a no-op on opaque surfaces but kicks in if any
      // content sits behind.
      className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-zinc-900/85 via-zinc-950/95 to-zinc-900/70 backdrop-blur-xl"
      style={{
        boxShadow:
          "inset 0 1px 0 0 rgba(255,255,255,0.06), 0 20px 50px -20px rgba(16,185,129,0.18)",
      }}
    >
      {/* Soft radial wash behind the dots — the "lit from within" feel */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 65% 55% at 50% 78%, rgba(16,185,129,0.18) 0%, rgba(16,185,129,0) 60%)",
        }}
      />

      {/* Square-ish wrapper so the arc reads cleanly regardless of grid */}
      <div className="relative aspect-square min-h-[300px] w-full p-5">
        <DottedArc ratio={ratio} />

        {/* Centered overlay text — sits in the hollow of the semicircle */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-end pb-[18%]">
          <div className="pointer-events-auto flex flex-col items-center">
            <p className="flex items-center gap-1.5 font-mono text-[10px] text-zinc-300 uppercase tracking-[0.18em]">
              <span>Cities completed of</span>
              {editing ? (
                <span className="inline-flex items-center gap-1">
                  <input
                    // biome-ignore lint/a11y/noAutofocus: explicit edit affordance
                    autoFocus
                    type="number"
                    min={1}
                    max={500}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") save();
                      if (e.key === "Escape") {
                        setDraft(String(goal));
                        setEditing(false);
                        setError(null);
                      }
                    }}
                    disabled={pending}
                    className="w-12 rounded border border-emerald-500/40 bg-zinc-900 px-1 py-0.5 text-center text-emerald-200 text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-400"
                    aria-label="Cities goal"
                  />
                  <button
                    type="button"
                    onClick={save}
                    disabled={pending}
                    className="text-emerald-400 hover:text-emerald-300"
                    aria-label="Save goal"
                  >
                    <Check className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(String(goal));
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
                <span className="inline-flex items-center gap-1.5">
                  <span className="tabular-nums">{goal}</span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setEditing(true)}
                      title="Edit goal (admin)"
                      className="text-zinc-500 transition-colors hover:text-emerald-400"
                      aria-label="Edit cities goal"
                    >
                      <Pencil className="h-2.5 w-2.5" />
                    </button>
                  )}
                </span>
              )}
            </p>
            <p
              className="mt-2 font-semibold text-5xl text-white tabular-nums sm:text-6xl"
              style={{ fontFeatureSettings: '"tnum"' }}
            >
              {completed.toLocaleString()}
            </p>
            {error && (
              <p className="mt-2 text-rose-400 text-xs" role="alert">
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
// DottedArc — concentric semicircle rings of dots
// -----------------------------------------------------------------

const TOTAL_DOTS = 24; // per ring
const RINGS = 3;
const RING_GAP = 16; // px between ring radii

function DottedArc({ ratio }: { ratio: number }) {
  // ViewBox sized so the half-circle sits along the bottom of the SVG and
  // the arc's negative space (below the apex) is what fills the card body.
  // Pinned with preserveAspectRatio so the arc scales with the card width.
  const width = 360;
  const height = 220;
  const cx = width / 2;
  const cy = height - 8;
  // Outer radius (innermost +2*GAP) sized to leave a margin inside the card.
  const innerRadius = cx - 40 - (RINGS - 1) * RING_GAP;
  const ringRadii = Array.from({ length: RINGS }, (_, i) => innerRadius + i * RING_GAP);

  const totalAcrossRings = TOTAL_DOTS * RINGS;
  const litCount = Math.round(totalAcrossRings * ratio);

  type Dot = { x: number; y: number; angle: number; ring: number; order: number };
  const dots: Dot[] = [];
  let order = 0;
  for (let i = 0; i < TOTAL_DOTS; i++) {
    // 180° arc: π (leftmost) → 0 (rightmost)
    const angle = Math.PI - (i / (TOTAL_DOTS - 1)) * Math.PI;
    for (let ring = 0; ring < RINGS; ring++) {
      const radius = ringRadii[ring] ?? innerRadius;
      dots.push({
        x: cx + radius * Math.cos(angle),
        y: cy - radius * Math.sin(angle),
        angle,
        ring,
        order: order++,
      });
    }
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Progress arc: ${Math.round(ratio * 100)} percent`}
      className="absolute inset-x-0 top-[8%] h-auto w-full"
      preserveAspectRatio="xMidYMin meet"
    >
      <defs>
        <radialGradient id="dot-lit" cx="50%" cy="0%" r="100%">
          <stop offset="0%" stopColor="#6ee7b7" stopOpacity="1" />
          <stop offset="55%" stopColor="#34d399" stopOpacity="1" />
          <stop offset="100%" stopColor="#059669" stopOpacity="0.65" />
        </radialGradient>
        <filter id="dot-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {dots.map((d) => {
        const lit = d.order < litCount;
        const r = d.ring === 2 ? 5.5 : d.ring === 1 ? 5 : 4.5;
        const key = `${d.ring}-${d.angle.toFixed(4)}`;
        if (lit) {
          return (
            <g key={key} filter="url(#dot-glow)">
              <circle cx={d.x} cy={d.y} r={r + 2} fill="#10b981" opacity={0.25} />
              <circle cx={d.x} cy={d.y} r={r} fill="url(#dot-lit)" />
            </g>
          );
        }
        return <circle key={key} cx={d.x} cy={d.y} r={r} fill="#10b981" opacity={0.08} />;
      })}
    </svg>
  );
}
