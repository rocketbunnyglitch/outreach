import { requireStaff } from "@/lib/auth";
import { getUserPreferences } from "@/lib/user-preferences";
import Link from "next/link";
import { DailyDigestToggle } from "./_components/DailyDigestToggle";

export const dynamic = "force-dynamic";
export const metadata = { title: "Preferences" };

/**
 * /me/preferences -- operator-scoped notification + UI prefs.
 *
 * The user_preferences table already exists (migration 0060) with
 * dailyDigestEnabled, inboxDensity, and inboxReadingPane columns.
 * The two inbox-display preferences have their own UI surfaces
 * inside the inbox (density toggle + reading-pane picker). The
 * digest opt-in has had NO UI -- operators wanting to opt out
 * could only do so via direct DB manipulation, which is
 * obviously not OK.
 *
 * This page adds the digest toggle and is a home for any future
 * preferences that don't have a more specific surface.
 *
 * Auth: requireStaff(). Reads + writes scope to the caller's own
 * row only.
 */
export default async function PreferencesPage() {
  const { staff } = await requireStaff();
  const prefs = await getUserPreferences(staff.id);

  // NULL = use default. The cron's logic is "explicit false skips;
  // NULL = opted in"; expose that as the initial checked state.
  const digestEnabled = prefs?.dailyDigestEnabled ?? true;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-10">
      <header className="mb-8">
        <Link
          href="/me"
          className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.14em] hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          {"<- me"}
        </Link>
        <h1 className="mt-2 font-semibold text-3xl tracking-tight">Preferences</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Personal settings. Inbox display options (density, reading pane) are set from the inbox
          toolbar.
        </p>
      </header>

      <section className="card-surface divide-y divide-zinc-200/60 dark:divide-zinc-800/40">
        <PreferenceRow
          title="Daily digest"
          description="Email you each morning with yesterday's sends, replies, and stale-thread summary."
        >
          <DailyDigestToggle initialEnabled={digestEnabled} />
        </PreferenceRow>
      </section>
    </main>
  );
}

function PreferenceRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm text-zinc-900 dark:text-zinc-100">{title}</p>
        <p className="mt-0.5 text-xs text-zinc-500">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
