"use client";

/**
 * ComposerHost — mount point for every open composer.
 *
 * Renders via createPortal so the composer stack is anchored to the
 * viewport (not whatever route owns the page).
 *
 * Layout (Gmail-style):
 *   - DOCKED / EXPANDED composers stack right-to-left along the
 *     bottom. Capped at MAX_DOCKED visible — older opens beyond
 *     that get pushed to MINIMIZED.
 *   - MINIMIZED composers render as compact horizontal bars to the
 *     LEFT of the docked stack. They're persistent — the operator
 *     can click any bar to restore that draft to docked.
 *   - FULLSCREEN composers take the whole viewport via fixed inset.
 *     Other composers in the stack continue to render behind but
 *     get z-index'd under so the fullscreen one wins visual focus.
 *
 * Mobile:
 *   On viewports < 640px the floating layout breaks down. The
 *   active composer renders as a full-screen bottom sheet; others
 *   stay minimized as bars along the bottom so the operator can
 *   swap between drafts.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { type ComposerInstance, useComposer } from "./composer-store";
import { ComposerWindow } from "./composer-window";
import { FollowUpPrompt } from "./follow-up-prompt";
import { useDraftHydration } from "./use-draft-hydration";

const MAX_DOCKED_COMPOSERS = 3;
const MOBILE_BREAKPOINT_PX = 640;

export function ComposerHost() {
  const { composers, setMode, followUp, setFollowUp } = useComposer();
  const [isMobile, setIsMobile] = useState(false);

  // Hydrate any not-yet-sent drafts from the server on first mount
  // so a tab refresh doesn't lose in-progress work.
  useDraftHydration();

  // Track viewport width for mobile-vs-desktop layout switch.
  useEffect(() => {
    function check() {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT_PX);
    }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Cap visible docked/expanded composers. When the cap is exceeded
  // we minimize the OLDEST (first-opened) one — same heuristic Gmail
  // uses. Newer composers stay visible since the operator just
  // opened them.
  useEffect(() => {
    const docked = Array.from(composers.values()).filter(
      (c) => c.mode === "docked" || c.mode === "expanded",
    );
    if (docked.length > MAX_DOCKED_COMPOSERS) {
      const toMin = docked[0];
      if (toMin) setMode(toMin.id, "minimized");
    }
  }, [composers, setMode]);

  if (typeof document === "undefined") return null;

  // Post-send follow-up nudge. Rendered independently of the composer stack
  // (the composer that sent it has already closed) so a sent composer never
  // lingers as an editable window. Anchored bottom-right as a small card.
  const followUpEl = followUp
    ? createPortal(
        <div className="pointer-events-none fixed right-3 bottom-3 z-[160] flex justify-end">
          <div className="pointer-events-auto w-80 max-w-[90vw] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
            <FollowUpPrompt
              venueId={followUp.venueId}
              threadId={followUp.threadId}
              subject={followUp.subject}
              to={followUp.to}
              onClose={() => setFollowUp(null)}
            />
          </div>
        </div>,
        document.body,
      )
    : null;

  if (composers.size === 0) return followUpEl;

  // Partition into visible (docked/expanded/fullscreen) and minimized.
  // Inline-mode composers are rendered inside the ThreadPane via
  // InlineReplyHost — skip them here so the same draft doesn't appear
  // twice on screen.
  const all = Array.from(composers.values()).filter((c) => c.mode !== "inline");
  const fullscreen = all.find((c) => c.mode === "fullscreen") ?? null;
  const visibleDocked = all.filter((c) => c.mode === "docked" || c.mode === "expanded");
  const minimized = all.filter((c) => c.mode === "minimized");

  // Mobile: collapse the entire stack into a single fullscreen
  // composer (the most recently-opened/active one) with the rest as
  // minimized bars along the bottom.
  if (isMobile) {
    const activeMobile = fullscreen ?? visibleDocked[visibleDocked.length - 1] ?? null;
    const otherMinimized = all.filter((c) => c.id !== activeMobile?.id);
    return (
      <>
        {createPortal(
          <div
            className="pointer-events-none fixed inset-0 z-[150] flex flex-col"
            aria-live="polite"
          >
            {activeMobile && <ComposerWindow instance={activeMobile} index={0} isMobile={true} />}
            {otherMinimized.length > 0 && (
              <div className="pointer-events-none flex flex-row gap-2 overflow-x-auto px-2 pb-2">
                {otherMinimized.map((c) => (
                  <ComposerWindow key={c.id} instance={c} index={0} isMobile={false} />
                ))}
              </div>
            )}
          </div>,
          document.body,
        )}
        {followUpEl}
      </>
    );
  }

  // Desktop layout:
  //   [minimized bar 3] [minimized bar 2] [minimized bar 1]   [docked 1] [docked 2] [docked 3]
  //                                                                                          ^
  //                                                                              right edge of viewport
  //
  // Fullscreen composers render at z-[200] over everything else.
  return (
    <>
      {createPortal(
        <div
          // Container is a non-interactive overlay layer; individual
          // composer windows each have pointer-events: auto. This way
          // the page beneath the unused space stays clickable.
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[150] flex flex-row-reverse items-end gap-3 px-3 pb-3"
          aria-live="polite"
        >
          {visibleDocked
            .slice()
            .reverse()
            .map((c, i) => (
              <ComposerWindow key={c.id} instance={c} index={i} isMobile={false} />
            ))}
          {minimized.length > 0 && <MinimizedStack minimized={minimized} />}
          {fullscreen && <ComposerWindow instance={fullscreen} index={0} isMobile={false} />}
        </div>,
        document.body,
      )}
      {followUpEl}
    </>
  );
}

/**
 * MinimizedStack — horizontal row of minimized-bar composers to the
 * left of the docked stack. Wraps onto multiple rows if there are
 * many; flex-wrap with row-reverse keeps the most-recent bars on
 * the right edge nearest the docked stack.
 */
function MinimizedStack({ minimized }: { minimized: ComposerInstance[] }) {
  return (
    <div
      className="pointer-events-none flex max-w-[60vw] flex-row-reverse flex-wrap items-end justify-end gap-2"
      role="group"
      aria-label={`${minimized.length} minimized draft${minimized.length === 1 ? "" : "s"}`}
    >
      {minimized
        .slice()
        .reverse()
        .map((c) => (
          <ComposerWindow key={c.id} instance={c} index={0} isMobile={false} />
        ))}
    </div>
  );
}
