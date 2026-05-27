"use client";

/**
 * PresenceAvatarStack — overlapping circular badges showing who else is
 * viewing the current page.
 *
 * Sized at three per person; the rest collapse into a "+N" pill at the
 * end. Hover any dot for the full name. The same color palette is used
 * everywhere in the realtime stack so Brandon's dot here matches the
 * border of his focused cell (Phase 14) and the live-cursor label
 * (Phase 15).
 *
 * Empty state: renders nothing (don't draw attention to "you're alone").
 */

import { cn } from "@/lib/cn";
import type { PresenceViewer } from "./use-presence-heartbeat";

interface Props {
  people: PresenceViewer[];
  /** Visible count before the overflow chip. Default 3. */
  max?: number;
  /** Size of each avatar dot in px. Default 24. */
  size?: number;
  /** Prepend a small label like "Viewing now:" before the dots. */
  label?: string;
}

export function PresenceAvatarStack({ people, max = 3, size = 24, label }: Props) {
  if (people.length === 0) return null;

  const visible = people.slice(0, max);
  const overflow = people.length - visible.length;

  return (
    <div className="inline-flex items-center gap-2">
      {label && (
        <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]">
          {label}
        </span>
      )}
      <div className="-space-x-1.5 flex">
        {visible.map((p) => (
          <Avatar key={p.staffId} viewer={p} size={size} />
        ))}
        {overflow > 0 && (
          <div
            className="flex items-center justify-center rounded-full border-2 border-white bg-zinc-200 font-medium text-[10px] text-zinc-700 dark:border-zinc-900 dark:bg-zinc-700 dark:text-zinc-200"
            style={{ width: size, height: size }}
            title={`+${overflow} more viewing`}
          >
            +{overflow}
          </div>
        )}
      </div>
    </div>
  );
}

function Avatar({ viewer, size }: { viewer: PresenceViewer; size: number }) {
  const initials = initialsFor(viewer.displayName);
  const color = colorForStaff(viewer.staffId);
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-full border-2 border-white font-medium text-[10px] text-white shadow-sm dark:border-zinc-900",
        color.bg,
      )}
      style={{ width: size, height: size }}
      title={`${viewer.displayName} · viewing now`}
      aria-label={`${viewer.displayName} viewing now`}
    >
      {initials}
    </div>
  );
}

// =========================================================================
// Helpers
// =========================================================================

function initialsFor(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0] ?? "";
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? "";
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

// Deterministic per-staffer color. Same person → same color forever, so
// "Brandon's dot" reads consistently across presence avatars + cell-focus
// indicators + live cursors.
const PALETTE: Array<{ bg: string; ring: string; text: string }> = [
  { bg: "bg-rose-500", ring: "ring-rose-500", text: "text-rose-500" },
  { bg: "bg-amber-500", ring: "ring-amber-500", text: "text-amber-500" },
  { bg: "bg-emerald-500", ring: "ring-emerald-500", text: "text-emerald-500" },
  { bg: "bg-teal-500", ring: "ring-teal-500", text: "text-teal-500" },
  { bg: "bg-sky-500", ring: "ring-sky-500", text: "text-sky-500" },
  { bg: "bg-violet-500", ring: "ring-violet-500", text: "text-violet-500" },
  { bg: "bg-fuchsia-500", ring: "ring-fuchsia-500", text: "text-fuchsia-500" },
  { bg: "bg-pink-500", ring: "ring-pink-500", text: "text-pink-500" },
  { bg: "bg-orange-500", ring: "ring-orange-500", text: "text-orange-500" },
  { bg: "bg-cyan-500", ring: "ring-cyan-500", text: "text-cyan-500" },
];

export function colorForStaff(staffId: string): {
  bg: string;
  ring: string;
  text: string;
} {
  // Simple FNV-1a-ish hash → palette index. Stable across reloads.
  let h = 2166136261;
  for (let i = 0; i < staffId.length; i++) {
    h ^= staffId.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  const palette = PALETTE[h % PALETTE.length];
  // PALETTE is non-empty (literal const above) so the lookup is always valid,
  // but the TS compiler's noUncheckedIndexedAccess setting requires the guard.
  return palette ?? { bg: "bg-zinc-500", ring: "ring-zinc-500", text: "text-zinc-500" };
}
