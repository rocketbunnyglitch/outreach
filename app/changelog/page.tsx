/**
 * /changelog — recent shipped updates.
 *
 * The "Updates" page in public nav. Content filters love changelogs
 * because they prove the site is actively maintained — fresh content
 * with dates is a strong signal of legitimacy.
 *
 * Entries are sourced from real shipped commits during the current
 * development cycle. When adding new entries, prepend to the list so
 * newest stays at top.
 */

import { PublicShell } from "../_public/public-shell";

export const metadata = {
  title: "Updates",
  description:
    "Recent updates to PERSE — new features, bug fixes, performance improvements, and UX enhancements.",
  robots: { index: true, follow: true },
};

interface Update {
  date: string;
  title: string;
  tags: string[];
  body: React.ReactNode;
}

const UPDATES: Update[] = [
  {
    date: "June 2026",
    title: "Public site overhaul",
    tags: ["Marketing", "Public"],
    body: (
      <>
        <p>
          New public-facing pages covering About, Features, Security, FAQ, Contact, and Updates.
          Each page is rendered server-side with shared nav and footer chrome so the site reads as a
          coherent product rather than a hidden internal tool.
        </p>
        <p>
          Privacy Policy and Terms of Service pages also got a refresh to fully disclose every Gmail
          OAuth scope we request and align with the Google API Limited Use policy.
        </p>
      </>
    ),
  },
  {
    date: "June 2026",
    title: "Campaign switcher reliability fix",
    tags: ["Fix", "Mobile"],
    body: (
      <p>
        Resolved a touch-device dropdown issue where tapping a campaign would close the menu without
        registering the selection, and could briefly leave other links on the page inert. Replaced
        the underlying outside-click handler and removed a hidden form-state race that was blocking
        subsequent interactions.
      </p>
    ),
  },
  {
    date: "June 2026",
    title: "Gmail account chooser on connect",
    tags: ["Fix", "OAuth"],
    body: (
      <p>
        Connecting a secondary Gmail inbox now always shows Google's account chooser, instead of
        silently selecting whichever account the operator was already signed into. Operators running
        multiple Gmail addresses for outreach can finally pick the right one without opening an
        incognito window first.
      </p>
    ),
  },
  {
    date: "June 2026",
    title: "Dashboard KPI rework",
    tags: ["Feature", "Analytics"],
    body: (
      <>
        <p>
          The dashboard now leads with two operationally meaningful tiles: <em>Venues confirmed</em>{" "}
          and <em>Crawls complete</em> — each with a recency sub-line showing how many landed in the
          last 24 hours and last 3 days. Replaces a confusing tile that mixed confirmed + planned
          counts into one number.
        </p>
        <p>
          The counters are scoped to the currently-selected campaign, not to the entire database (a
          previous build was accidentally summing across every campaign in history).
        </p>
      </>
    ),
  },
  {
    date: "June 2026",
    title: "Optimistic UI on cold outreach",
    tags: ["Feature", "UX"],
    body: (
      <p>
        Status changes and assignment edits in the cold-outreach queue now apply instantly with zero
        network wait. If the server rejects an update, the row reverts with a toast explaining why.
        Operators working through queues of 50+ prospects feel the speed immediately.
      </p>
    ),
  },
  {
    date: "June 2026",
    title: "Keyboard shortcuts on cold outreach",
    tags: ["Feature", "UX"],
    body: (
      <p>
        J / K to move the row cursor, Space to toggle selection, E to change status, A to archive
        with undo. Press{" "}
        <kbd className="rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 font-mono text-[11px] dark:border-zinc-700 dark:bg-zinc-800">
          ?
        </kbd>{" "}
        anywhere to see the full shortcut cheatsheet.
      </p>
    ),
  },
  {
    date: "May 2026",
    title: "Command palette + universal undo",
    tags: ["Feature", "UX"],
    body: (
      <p>
        Press{" "}
        <kbd className="rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 font-mono text-[11px] dark:border-zinc-700 dark:bg-zinc-800">
          ⌘K
        </kbd>{" "}
        anywhere to open a command palette covering every campaign, every view, and every keyboard
        shortcut. Every destructive action (archive, demote, status change) now triggers a real undo
        toast — five seconds to reverse a click before it sticks.
      </p>
    ),
  },
  {
    date: "May 2026",
    title: "Archived entities admin views",
    tags: ["Feature", "Admin"],
    body: (
      <p>
        Three new admin pages — Archived Venues, Archived Cities, Archived Campaigns — let admins
        see what was soft-deleted, restore items, or hard-delete intentionally. The right-click
        distinction between archive and hard delete eliminates ambiguity about "where did this go?".
      </p>
    ),
  },
  {
    date: "May 2026",
    title: "Day Party crawl format",
    tags: ["Feature", "Campaigns"],
    body: (
      <p>
        Added a Day Party crawl format that drops the Final-venue slot from the structure (a
        day-party crawl is wristband + two middle venues — no late-night closer). The slot table and
        tracker both render the new shape automatically; the ☀ icon flags day-party crawls in any
        list view.
      </p>
    ),
  },
  {
    date: "May 2026",
    title: "Cold-to-warm flag preservation",
    tags: ["Fix", "Tracker"],
    body: (
      <p>
        Promoting a cold prospect into a warm crawl slot now keeps the row visible in BOTH the cold
        queue and the warm tracker (with an is-warm flag) instead of yanking it from cold. Operators
        no longer lose visibility on contacts mid-pipeline.
      </p>
    ),
  },
  {
    date: "May 2026",
    title: "Phase 2 campaign imports",
    tags: ["Feature", "Operations"],
    body: (
      <p>
        Wired five additional campaigns through the import pipeline with label-based event
        resolution. New campaigns are now config-driven — adding the next one is a config block, not
        a code change.
      </p>
    ),
  },
];

export default function ChangelogPage() {
  return (
    <PublicShell>
      <main className="mx-auto max-w-3xl px-6 py-16 md:py-24">
        <header className="border-zinc-200 border-b pb-12 dark:border-zinc-800">
          <p className="font-mono text-[11px] text-zinc-500 uppercase tracking-[0.2em]">Updates</p>
          <h1 className="mt-3 font-semibold text-4xl tracking-tight md:text-5xl">
            What's new in PERSE.
          </h1>
          <p className="mt-4 max-w-2xl text-[17px] text-zinc-600 leading-relaxed dark:text-zinc-400">
            Recent updates to the product — new features, fixes, and improvements. Newest at the
            top.
          </p>
        </header>

        <div className="mt-12 space-y-12">
          {UPDATES.map((u) => (
            <article
              key={`${u.date}-${u.title}`}
              className="border-zinc-200 border-b pb-12 last:border-0 dark:border-zinc-800"
            >
              <div className="flex flex-wrap items-center gap-3">
                <time className="font-mono text-[11px] text-zinc-500 uppercase tracking-[0.12em]">
                  {u.date}
                </time>
                {u.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full border border-zinc-200 px-2 py-0.5 font-mono text-[10px] text-zinc-600 uppercase tracking-[0.08em] dark:border-zinc-800 dark:text-zinc-400"
                  >
                    {t}
                  </span>
                ))}
              </div>
              <h2 className="mt-3 font-semibold text-2xl tracking-tight">{u.title}</h2>
              <div className="mt-3 space-y-3 text-[15px] text-zinc-600 leading-relaxed dark:text-zinc-400">
                {u.body}
              </div>
            </article>
          ))}
        </div>
      </main>
    </PublicShell>
  );
}
