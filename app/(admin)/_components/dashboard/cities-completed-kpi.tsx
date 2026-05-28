"use client";

import { Check, Pencil, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateCampaignCitiesGoal } from "../../_actions-cities-goal";

/**
 * "Cities completed of X" KPI card. Dotted-gradient semicircle inspired by
 * the Apple Activity / status displays — a wide arc of green dots glowing
 * from a brighter apex, with the completed count and the goal-in-label
 * rendered in the negative space inside the arc.
 *
 * The number of LIT dots scales with progress (completed/goal), with all
 * dots fully lit at the goal. Unlit dots still render as faint outlines so
 * the arc shape is always visible.
 *
 * Admin-only inline edit on the goal — pencil icon in the label. Non-admin
 * staff see a static label.
 */
export function CitiesCompletedKpi({
  completed,
  goal,
  campaignId,
  isAdmin,
}: {
  completed: number;
  goal: number;
  /** Active campaign id for the edit action; null when the dashboard is in
   *  "all campaigns" mode (we still show the visual but hide the edit). */
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
    <section className="relative overflow-hidden rounded-2xl bg-zinc-950 px-6 py-8 shadow-sm shadow-zinc-900/20 dark:shadow-none">
      {/* Subtle ambient gradient behind the dots for the "lit-from-within" feel */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 50% 80%, rgba(16,185,129,0.18) 0%, rgba(16,185,129,0) 60%)",
        }}
      />
      <div className="relative flex flex-col items-center">
        <DottedArc ratio={ratio} />
        <div className="-mt-44 sm:-mt-52 flex flex-col items-center">
          <p className="flex items-center gap-2 font-mono text-[10px] text-zinc-300 uppercase tracking-[0.18em]">
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
            className="mt-3 font-semibold text-7xl text-white tabular-nums sm:text-8xl"
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
    </section>
  );
}

// -----------------------------------------------------------------
// DottedArc — the semicircle of dots
// -----------------------------------------------------------------

const TOTAL_DOTS = 30; // per ring
const RINGS = 3;
const RING_GAP = 14; // px between ring radii

/** SVG semicircle made of concentric rings of dots. ratio in [0,1] —
 *  dots are sequentially "lit" from one end of the arc to the other,
 *  proportional to progress. Lit dots glow green; unlit dots are faint
 *  outlines so the arc shape is always visible. */
function DottedArc({ ratio }: { ratio: number }) {
  const width = 520;
  const height = 280;
  const cx = width / 2;
  const cy = height - 20; // baseline of the arc near bottom
  const baseRadius = 200;
  const ringRadii = Array.from({ length: RINGS }, (_, i) => baseRadius + i * RING_GAP);

  // Each ring has its own dot positions, all spanning the same arc (180°).
  // We light dots in left-to-right order across the whole arc — i.e. the
  // first lit dot is the leftmost on the outer ring, the next is the
  // leftmost on the middle ring, etc., creating a "sweep" effect.
  const totalAcrossRings = TOTAL_DOTS * RINGS;
  const litCount = Math.round(totalAcrossRings * ratio);

  // Build a global ordering of dots (ring-by-ring at each angular step),
  // so progress sweeps the arc evenly.
  type Dot = { x: number; y: number; angle: number; ring: number };
  const dots: Dot[] = [];
  for (let i = 0; i < TOTAL_DOTS; i++) {
    // 180° arc from π (left, angle=180°) to 0 (right, angle=0°)
    const angle = Math.PI - (i / (TOTAL_DOTS - 1)) * Math.PI;
    for (let ring = 0; ring < RINGS; ring++) {
      const radius = ringRadii[ring] ?? baseRadius;
      dots.push({
        x: cx + radius * Math.cos(angle),
        y: cy - radius * Math.sin(angle),
        angle,
        ring,
      });
    }
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Progress arc: ${Math.round(ratio * 100)} percent`}
      className="h-auto w-full max-w-[520px]"
    >
      <defs>
        {/* Radial gradient for the "lit" dots — brighter near the top apex */}
        <radialGradient id="dot-lit" cx="50%" cy="100%" r="80%">
          <stop offset="0%" stopColor="#34d399" stopOpacity="1" />
          <stop offset="60%" stopColor="#10b981" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#059669" stopOpacity="0.55" />
        </radialGradient>
        {/* Glow filter for the lit dots */}
        <filter id="dot-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {dots.map((d, idx) => {
        const lit = idx < litCount;
        // Slight per-ring size variation for depth
        const r = d.ring === 1 ? 5.5 : 5;
        const key = `${d.ring}-${d.angle.toFixed(4)}`;
        if (lit) {
          // Soft outer halo + bright core
          return (
            <g key={key} filter="url(#dot-glow)">
              <circle cx={d.x} cy={d.y} r={r + 1.8} fill="#10b981" opacity={0.22} />
              <circle cx={d.x} cy={d.y} r={r} fill="url(#dot-lit)" />
            </g>
          );
        }
        return <circle key={key} cx={d.x} cy={d.y} r={r} fill="#10b981" opacity={0.08} />;
      })}
    </svg>
  );
}
