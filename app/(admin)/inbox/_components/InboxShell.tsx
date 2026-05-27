import { cn } from "@/lib/cn";

/**
 * Three-pane Inbox shell.
 *
 *   • Left  (220px):  folder list + filter chips
 *   • Middle (380px): thread list
 *   • Right (flex):   thread detail + CRM rail (or empty state)
 *
 * On narrow screens (<lg breakpoint) the right pane stacks below. We don't
 * try to be clever about hiding the middle pane on mobile — small screens
 * get the same three columns, just narrower. Inbox-as-destination means
 * users are on desktop most of the time.
 *
 * The middle pane scrolls independently of the right; both inherit
 * height from the (admin) layout's main element.
 */
export function InboxShell({
  left,
  middle,
  right,
}: {
  left: React.ReactNode;
  middle: React.ReactNode;
  right: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex animate-[fade-in_300ms_ease-out] flex-col lg:flex-row",
        // Full-height of the admin shell minus header padding. The admin
        // layout uses overflow management; we just need to consume height.
        "min-h-[calc(100vh-8rem)]",
        // Subtle outer card so the three panes read as one composed surface.
        "card-surface overflow-hidden p-0",
      )}
    >
      <aside
        className={cn(
          "shrink-0 border-zinc-200/80 border-b lg:w-[220px] lg:border-r lg:border-b-0",
          "dark:border-zinc-800/60",
          "p-3",
        )}
      >
        {left}
      </aside>
      <section
        className={cn(
          "shrink-0 border-zinc-200/80 border-b lg:w-[380px] lg:border-r lg:border-b-0",
          "dark:border-zinc-800/60",
          "overflow-y-auto",
        )}
      >
        {middle}
      </section>
      <section className="flex-1 overflow-y-auto">{right}</section>
    </div>
  );
}
