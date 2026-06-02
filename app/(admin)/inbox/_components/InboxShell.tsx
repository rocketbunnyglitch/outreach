import { cn } from "@/lib/cn";
import { InboxRail } from "./InboxRail";

/**
 * Three-pane Inbox shell.
 *
 *   Desktop (lg+):
 *     Left   (220px)   folder list + filter chips
 *     Middle (380px)   thread list
 *     Right  (flex)    thread detail + CRM rail
 *
 *   Mobile (<lg) — Phase F redesign:
 *     With a thread selected   show the RIGHT pane full-width.
 *                               The middle pane is hidden so the
 *                               operator gets a focused read +
 *                               reply surface, like a native mail
 *                               app.
 *     With no thread           show the MIDDLE pane (thread list)
 *     selected                  at full width. The left pane is
 *                               hidden — the InboxScopeBar inside
 *                               `middle` surfaces the essential
 *                               folder pivots inline.
 *
 *   The right pane is responsible for surfacing its own "back to
 *   list" affordance on mobile (the ThreadPane header renders one).
 *
 * The middle pane scrolls independently of the right; both inherit
 * height from the (admin) layout's main element.
 */
export function InboxShell({
  left,
  middle,
  right,
  topRight,
  hasThreadSelected = false,
}: {
  left: React.ReactNode;
  middle: React.ReactNode;
  right: React.ReactNode;
  /** Optional top-right slot — renders absolutely-positioned over the
   *  shell so it floats above the right pane. Used by the Gmail-style
   *  AccountSwitcher dropdown. */
  topRight?: React.ReactNode;
  /** Drives mobile pane swap (Phase F). True when the operator is
   *  inside a thread; false on the list view. Desktop (lg+)
   *  ignores this entirely — all three panes always show. */
  hasThreadSelected?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative flex animate-[fade-in_300ms_ease-out] flex-col lg:flex-row",
        // Near-full-screen height: mobile leaves room for the header;
        // desktop fills almost the whole viewport so it reads like Gmail's
        // app surface rather than a small centered card.
        "min-h-[calc(100vh-8rem)] lg:min-h-[calc(100vh-6rem)]",
        // Subtle outer card so the three panes read as one composed surface.
        "card-surface overflow-hidden p-0",
        // MOBILE FULL-WIDTH (Gmail mobile parity): break out of the
        // (admin) <main> padding (px-6 / sm:px-10) with negative margins
        // and strip the rounded card chrome + side borders below lg so the
        // inbox list AND the email/thread view are edge-to-edge.
        "-mx-6 -mt-6 max-lg:rounded-none max-lg:border-x-0 sm:-mx-10 sm:-mt-10",
        // DESKTOP NEAR-FULL-WIDTH: claw back most of the <main> padding
        // (px-10 py-14) so the framed inbox fills ~95% of the viewport
        // with just a small gutter, instead of a narrow centered card.
        "lg:-mx-6 lg:-my-6",
      )}
    >
      {topRight && (
        <div className="absolute top-3 right-4 z-20 lg:top-4 lg:right-5">{topRight}</div>
      )}
      {/* Left pane — folder list. Static aside on desktop; on mobile it
          becomes an off-canvas drawer (opened by InboxRailTrigger in the
          list header) so the settings gear, folders, and Compose are
          reachable on a phone. */}
      <InboxRail>{left}</InboxRail>
      {/* Middle pane — thread list. Mobile: full width when no
          thread is selected; hidden when a thread is open. */}
      <section
        className={cn(
          "shrink-0 overflow-y-auto border-zinc-200/80 lg:w-[380px] lg:border-r",
          "dark:border-zinc-800/60",
          hasThreadSelected ? "hidden lg:block" : "flex-1 lg:flex-none",
        )}
      >
        {middle}
      </section>
      {/* Right pane — thread detail. Mobile: full width when a
          thread is selected; hidden when on the list view. */}
      <section
        className={cn(
          "overflow-y-auto",
          hasThreadSelected ? "flex-1" : "hidden lg:block lg:flex-1",
        )}
      >
        {right}
      </section>
    </div>
  );
}
