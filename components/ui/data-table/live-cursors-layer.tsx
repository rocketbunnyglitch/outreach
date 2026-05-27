"use client";

/**
 * LiveCursorsLayer — renders peer cursors as colored arrow + label tags
 * absolutely positioned at each peer's pageX/pageY.
 *
 * Sits outside any scrollable container, fixed to the document. The
 * pointer-events-none means cursors never interrupt the local user's
 * clicks. Z-index is high but below modal overlays.
 *
 * Each cursor uses the deterministic per-staff color from colorForStaff
 * so Brandon's cursor matches his avatar dot, his per-cell focus border,
 * and his row dot. The "design language" of who-is-who is unified.
 *
 * Transition between positions:
 *   We CSS-transition transform over 100ms, matching the 10Hz send rate
 *   from useLiveCursors. The result is a smooth glide instead of jerky
 *   jumps at 10 fps.
 */

import { cn } from "@/lib/cn";
import { colorForStaff } from "./presence-avatar-stack";
import type { CursorState } from "./use-live-cursors";

interface Props {
  cursors: CursorState[];
}

export function LiveCursorsLayer({ cursors }: Props) {
  if (cursors.length === 0) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      {cursors.map((c) => (
        <PeerCursor key={c.staffId} cursor={c} />
      ))}
    </div>
  );
}

function PeerCursor({ cursor }: { cursor: CursorState }) {
  const color = colorForStaff(cursor.staffId);
  // Initials for the label
  const initials = cursor.displayName
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div
      className="absolute top-0 left-0 transition-transform duration-100 ease-linear"
      style={{
        transform: `translate3d(${cursor.x}px, ${cursor.y}px, 0)`,
      }}
    >
      {/* Arrow SVG — same shape Figma/Linear use, tinted to the peer color */}
      <svg
        width="16"
        height="20"
        viewBox="0 0 16 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        role="presentation"
        className={cn("drop-shadow-sm", color.text)}
      >
        <title>peer cursor</title>
        <path
          d="M1.5 1.5L1.5 16.5L5.5 12.5L8 18L11 17L8.5 11.5L14 11.5L1.5 1.5Z"
          fill="currentColor"
          stroke="white"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
      {/* Label */}
      <span
        className={cn(
          "absolute top-4 left-3 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-[10px] text-white shadow-sm",
          color.bg,
        )}
      >
        <span className="font-mono">{initials}</span>
        <span className="text-white/90">{cursor.displayName.split(" ")[0]}</span>
      </span>
    </div>
  );
}
