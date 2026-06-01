/**
 * /features — detailed feature tour. Work content filters value
 * feature pages because they contain rich, descriptive prose that
 * proves the site has substance.
 *
 * Each feature section pulls from real shipped functionality (the
 * tracker, the inbox, campaigns/cities/venues, cold-outreach, the
 * analytics surfaces). Nothing aspirational — every feature mentioned
 * here exists in the app.
 */

import {
  Activity,
  Archive,
  BarChart3,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Filter,
  Globe,
  Inbox,
  Keyboard,
  Mail,
  Map as MapIcon,
  Sparkles,
  Tag,
  Target,
  Users,
} from "lucide-react";
import Link from "next/link";
import { PublicShell } from "../_public/public-shell";

export const metadata = {
  title: "Features",
  description:
    "Inbox, tracker, campaigns, analytics, templates, and keyboard-driven workflows — every feature PERSE ships for multi-city event promoters.",
  robots: { index: true, follow: true },
};

export default function FeaturesPage() {
  return (
    <PublicShell>
      <main className="mx-auto max-w-4xl px-6 py-16 md:py-24">
        <header className="border-zinc-200 border-b pb-12 dark:border-zinc-800">
          <p className="font-mono text-[11px] text-zinc-500 uppercase tracking-[0.2em]">Features</p>
          <h1 className="mt-3 font-semibold text-4xl tracking-tight md:text-5xl">
            Everything you need to run multi-city event outreach.
          </h1>
          <p className="mt-4 max-w-2xl text-[17px] text-zinc-600 leading-relaxed dark:text-zinc-400">
            PERSE replaces the spreadsheet-plus-email-plus-sticky-note stack most event promoters
            use. One interface for every conversation, every venue, every campaign — across as many
            cities and brands as your team operates.
          </p>
        </header>

        <FeatureBlock
          icon={<Inbox className="h-5 w-5" />}
          eyebrow="Unified inbox"
          title="Gmail, but built for outreach"
          body={
            <>
              <p>
                Connect any number of Gmail inboxes. PERSE pulls every conversation into a single
                threaded view, grouped by venue, sortable by reply state, status, owner, and last
                activity. When a venue replies, the thread surfaces at the top of the queue with
                conversational context the operator can act on immediately.
              </p>
              <p>
                Beyond just listing threads, the inbox tracks the operational state of each
                conversation: needs reply, awaiting confirmation, awaiting contract, completed. One
                keyboard shortcut moves a thread through the funnel.
              </p>
            </>
          }
          bullets={[
            "Multiple Gmail accounts per team",
            "Conversational view threaded by venue, not by date",
            "Status flags that flow into campaign + tracker views",
            "Built-in labels mapped to Gmail labels in both directions",
          ]}
        />

        <FeatureBlock
          icon={<MapIcon className="h-5 w-5" />}
          eyebrow="Tracker"
          title="Every campaign at a glance, every city in detail"
          body={
            <>
              <p>
                The tracker is the operational dashboard. Every city you're running shows up as a
                row with its confirmed-venues count, target-venues count, sales progress, and the
                state of each individual crawl. Click a row to expand the per-city sheet — a
                worksheet with one column per crawl, one row per venue slot.
              </p>
              <p>
                Drag a cold contact into an empty slot and PERSE flags it as warm, syncs the venue
                record, schedules the outreach. Confirm a slot and the dashboard tile updates in
                real time. No refreshing, no manual data entry.
              </p>
            </>
          }
          bullets={[
            "City roll-up showing target vs confirmed at a glance",
            "Per-city worksheet for granular slot-by-slot work",
            "Crawl-format awareness (Day Party, weekend crawl, themed)",
            "Drag-from-cold to instantly assign a warm prospect",
          ]}
        />

        <FeatureBlock
          icon={<Target className="h-5 w-5" />}
          eyebrow="Campaigns"
          title="One product, many brands"
          body={
            <>
              <p>
                PERSE was built for the operator who runs multiple outreach brands at once. Switch
                between campaigns from the top nav and every view — inbox, tracker, templates,
                analytics — scopes instantly to the selected campaign. Cross-campaign contamination
                is impossible because campaign IDs flow through every query.
              </p>
              <p>
                Each campaign can have its own outreach brand and crawl brand (the operator-facing
                vs the customer-facing names), its own goals, its own target cities. Archive a
                completed campaign to clear it from the active view without losing the history.
              </p>
            </>
          }
          bullets={[
            "Unlimited campaigns per team",
            "Separate outreach + crawl brand per campaign",
            "Per-campaign sales + venue + city goals",
            "Archive campaigns when complete without losing data",
          ]}
        />

        <FeatureBlock
          icon={<Mail className="h-5 w-5" />}
          eyebrow="Templates + cold outreach"
          title="Send 50 personalized emails in 5 minutes"
          body={
            <>
              <p>
                The template library lets operators store and reuse outreach messages with variable
                substitution (venue name, city, contact first name, crawl date). The cold-outreach
                queue is the high-throughput list view where you work through new prospects: select
                20 venues with the same template, click send, done. PERSE handles personalization
                per row.
              </p>
              <p>
                Sent messages land in the operator's actual Gmail Sent folder, addressed from their
                own email — venues see a real person sending a real email, not an automation.
              </p>
            </>
          }
          bullets={[
            "Variable substitution per recipient",
            "Bulk send from the cold queue with one click per template",
            "Sent through the operator's own Gmail — full deliverability",
            "Per-template reply-rate + warm-rate + decline-rate analytics",
          ]}
        />

        <FeatureBlock
          icon={<BarChart3 className="h-5 w-5" />}
          eyebrow="Analytics"
          title="Stop guessing what works"
          body={
            <>
              <p>
                Three analytics views ship with every team: <em>Template</em> performance shows each
                outreach template's reply, warm, and decline rates side-by-side over the last 30
                days. <em>Funnel</em> shows the count and conversion at each stage from first touch
                to confirmed venue. <em>Send-time</em> shows a 24-bar histogram of reply rate by
                hour-of-day, so operators learn when their messages land best.
              </p>
              <p>
                All three are scoped to the active campaign. Small-sample rows are flagged so you
                don't draw conclusions from 4 sends.
              </p>
            </>
          }
          bullets={[
            "Template-by-template comparison table",
            "Per-stage funnel: touch → reply → warm → confirm",
            "Hour-of-day reply-rate histogram",
            "Small-sample warnings on every chart",
          ]}
        />

        <FeatureBlock
          icon={<Keyboard className="h-5 w-5" />}
          eyebrow="Keyboard-first"
          title="Built for operators who live in their inbox"
          body={
            <>
              <p>
                Press{" "}
                <kbd className="rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 font-mono text-[11px] dark:border-zinc-700 dark:bg-zinc-800">
                  ?
                </kbd>{" "}
                anywhere to see every shortcut. The cold-outreach queue is J/K to move row cursor,
                Space to select, E to change status, A to archive (with undo). The command palette (
                <kbd className="rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 font-mono text-[11px] dark:border-zinc-700 dark:bg-zinc-800">
                  ⌘K
                </kbd>
                ) jumps to any campaign, city, view, or shortcut from a single search box.
              </p>
              <p>
                Every destructive action has a real undo — a toast window where you have 5 seconds
                to reverse a click. Archive a venue by mistake? Press the undo button or hit{" "}
                <kbd className="rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 font-mono text-[11px] dark:border-zinc-700 dark:bg-zinc-800">
                  ⌘Z
                </kbd>
                . Status flips, deletions, demotions — all reversible.
              </p>
            </>
          }
          bullets={[
            "Press ? for the full shortcut cheatsheet",
            "Cmd+K command palette for instant navigation",
            "Real undo on every destructive action",
            "Optimistic UI — every click feels instant",
          ]}
        />

        <FeatureBlock
          icon={<Users className="h-5 w-5" />}
          eyebrow="Team collaboration"
          title="See who's online, what they're touching"
          body={
            <>
              <p>
                When a teammate is viewing the same campaign, you see their presence avatar in the
                corner. When they're editing a cell in the tracker, their cursor highlights that
                cell so you don't collide. Assignments flow through every view — a thread assigned
                to one operator stays out of everyone else's queue.
              </p>
              <p>
                Roles control who can do what: admins manage users, labels, and team-wide settings.
                Staff operators run their assigned cities and campaigns. The audit log records every
                state change with timestamp and actor.
              </p>
            </>
          }
          bullets={[
            "Live presence — see who's online and where",
            "Cursor avatars on shared cells to prevent collision",
            "Role-based access (admin vs staff)",
            "Audit log of every state change",
          ]}
        />

        <section className="mt-16 border-zinc-200 border-t pt-12 dark:border-zinc-800">
          <h2 className="font-semibold text-2xl tracking-tight">More to explore</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <SmallCard
              icon={<Globe className="h-4 w-4" />}
              title="Cities + venues catalog"
              body="Persistent catalog of every venue you've ever touched, searchable across campaigns."
            />
            <SmallCard
              icon={<ClipboardList className="h-4 w-4" />}
              title="Tasks + reminders"
              body="Assign follow-ups to yourself or teammates with due dates and reminder pings."
            />
            <SmallCard
              icon={<Calendar className="h-4 w-4" />}
              title="Event submission"
              body="Push confirmed crawl events to Eventbrite without leaving PERSE."
            />
            <SmallCard
              icon={<Tag className="h-4 w-4" />}
              title="Two-way Gmail labels"
              body="Labels you apply in PERSE show up in Gmail, and vice-versa — no double-bookkeeping."
            />
            <SmallCard
              icon={<Sparkles className="h-4 w-4" />}
              title="AI assistance"
              body="Triage incoming replies, suggest response drafts, tag venue types automatically."
            />
            <SmallCard
              icon={<Archive className="h-4 w-4" />}
              title="Archive + recover"
              body="Soft-delete with restore on every entity. Hard delete is admin-only and intentional."
            />
            <SmallCard
              icon={<Filter className="h-4 w-4" />}
              title="Saved filter views"
              body="Every list view supports persistent column filters so you keep your shortcuts."
            />
            <SmallCard
              icon={<Activity className="h-4 w-4" />}
              title="Email health monitoring"
              body="Per-inbox send and reply telemetry so you catch deliverability issues fast."
            />
          </div>
        </section>

        <section className="mt-16 rounded-2xl border border-zinc-200 bg-zinc-50 p-8 md:p-10 dark:border-zinc-800 dark:bg-zinc-900/50">
          <h2 className="font-semibold text-2xl tracking-tight">Ready to see it?</h2>
          <p className="mt-2 max-w-2xl text-[15px] text-zinc-600 dark:text-zinc-400">
            PERSE is invite-only — if your team is already onboarded, sign in. If not, drop us a
            line.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-5 py-2.5 font-medium text-sm text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Sign in
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-5 py-2.5 font-medium text-sm hover:border-zinc-500 dark:border-zinc-700 dark:hover:border-zinc-500"
            >
              Contact us
            </Link>
          </div>
        </section>
      </main>
    </PublicShell>
  );
}

function FeatureBlock({
  icon,
  eyebrow,
  title,
  body,
  bullets,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  body: React.ReactNode;
  bullets: string[];
}) {
  return (
    <section className="mt-16 grid gap-8 md:grid-cols-[1fr_2fr]">
      <div>
        <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {icon}
        </div>
        <p className="font-mono text-[11px] text-zinc-500 uppercase tracking-[0.15em]">{eyebrow}</p>
        <h2 className="mt-1 font-semibold text-2xl tracking-tight">{title}</h2>
      </div>
      <div className="space-y-4 text-[15px] text-zinc-600 leading-relaxed dark:text-zinc-400">
        {body}
        <ul className="mt-5 space-y-2 border-zinc-200 border-t pt-5 dark:border-zinc-800">
          {bullets.map((b) => (
            <li key={b} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function SmallCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="mb-2 inline-flex h-6 w-6 items-center justify-center rounded-md bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
        {icon}
      </div>
      <h3 className="font-semibold text-[14px] tracking-tight">{title}</h3>
      <p className="mt-1 text-[13px] text-zinc-600 leading-relaxed dark:text-zinc-400">{body}</p>
    </div>
  );
}
