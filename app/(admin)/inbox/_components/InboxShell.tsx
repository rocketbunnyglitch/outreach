import { cn } from "@/lib/cn";

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
        // Full-height of the admin shell minus header padding.
        "min-h-[calc(100vh-8rem)]",
        // Subtle outer card so the three panes read as one composed surface.
        "card-surface overflow-hidden p-0",
      )}
    >
      {topRight && (
        <div className="absolute top-3 right-4 z-20 lg:top-4 lg:right-5">{topRight}</div>
      )}
      {/* Left pane — folder list. Hidden on mobile; the scope bar
          inside `middle` covers the essential folder pivots. */}
      <aside
        className={cn(
          "hidden shrink-0 border-zinc-200/80 lg:block lg:w-[220px] lg:border-r",
          "dark:border-zinc-800/60",
          "p-3",
        )}
      >
        {left}
      </aside>
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
