/**
 * /settings/inboxes — Gmail inbox connection management.
 *
 * New (post-decommission) model:
 *   - "My inboxes" — every connected_accounts row owned by the
 *     current user, each with Reconnect + Disconnect.
 *   - "Team inboxes" — every connection on the team OTHER than the
 *     current user's, read-only, so operators can see who has
 *     connected what.
 *   - "Connect Gmail" CTA up top.
 *
 * Brand scoping, send throttling, and warm-up status were removed
 * along with the send-queue decommission. This page is purely
 * about which Gmail accounts feed the inbox-read pipeline.
 */

import { connectedAccounts, users } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { isGmailOAuthConfigured } from "@/lib/gmail";
import { classifyHealth, loadInboxAnalytics } from "@/lib/inbox-analytics";
import { loadInboxDailyStats } from "@/lib/inbox-daily-stats";
import { loadSendUsage } from "@/lib/send-cap";
import { and, asc, eq, ne } from "drizzle-orm";
import { AlertCircle, CheckCircle2, Info, Mail, RefreshCw, Tag, Unplug } from "lucide-react";
import { disconnectInbox, resyncInbox, syncGmailLabelsNowAction } from "./_actions";
import { CapEditor } from "./_components/cap-editor";
import { InboxAnalyticsStrip } from "./_components/inbox-analytics-strip";
import { SignatureEditor } from "./_components/signature-editor";

export const metadata = { title: "Email Connection" };
export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  not_configured:
    "Gmail OAuth isn't configured on the server. Set GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET in .env.",
  missing_params: "OAuth callback was missing code or state.",
  bad_state: "OAuth state was malformed.",
  csrf: "CSRF validation failed. Try again from the Connect button.",
  staff_mismatch: "The connecting user didn't match. Try again while signed in as yourself.",
  token_exchange: "Google rejected the authorization code. Try connecting again.",
  no_refresh_token:
    "Google didn't return a refresh token. Go to your Google account → Security → 3rd party access, remove 'Outreach Engine', and try again.",
  userinfo: "Couldn't read your Gmail address from Google after connecting.",
  persist: "Connection succeeded with Google but the DB write failed. Check server logs.",
  access_denied: "You denied the consent screen.",
};

interface Props {
  searchParams: Promise<{ connected?: string; error?: string }>;
}

export default async function InboxesPage({ searchParams }: Props) {
  const params = await searchParams;
  const { staff } = await requireStaff();
  const oauthReady = isGmailOAuthConfigured();

  const myInboxesRaw = await db
    .select({
      id: connectedAccounts.id,
      emailAddress: connectedAccounts.emailAddress,
      status: connectedAccounts.status,
      lastSyncedAt: connectedAccounts.lastSyncedAt,
      dailyColdSendCap: connectedAccounts.dailyColdSendCap,
      signatureHtml: connectedAccounts.signatureHtml,
    })
    .from(connectedAccounts)
    .where(eq(connectedAccounts.ownerUserId, staff.id))
    .orderBy(asc(connectedAccounts.emailAddress));

  // Load today's usage for each of my inboxes so the row can render
  // "18 / 30 today". Sequential — list is small (typically 1-3).
  const myInboxes = await Promise.all(
    myInboxesRaw.map(async (ib) => {
      const usage = await loadSendUsage(ib.id);
      return { ...ib, usedToday: usage.used };
    }),
  );

  const teamInboxes = await db
    .select({
      id: connectedAccounts.id,
      emailAddress: connectedAccounts.emailAddress,
      status: connectedAccounts.status,
      lastSyncedAt: connectedAccounts.lastSyncedAt,
      ownerName: users.displayName,
      ownerEmail: users.primaryEmail,
      dailyColdSendCap: connectedAccounts.dailyColdSendCap,
    })
    .from(connectedAccounts)
    .innerJoin(users, eq(users.id, connectedAccounts.ownerUserId))
    .where(
      and(eq(connectedAccounts.teamId, staff.teamId), ne(connectedAccounts.ownerUserId, staff.id)),
    )
    .orderBy(asc(users.displayName), asc(connectedAccounts.emailAddress));

  // Per-inbox 30-day analytics. One batched query keyed by every
  // inbox id the page renders (mine + team). Failures here degrade
  // gracefully — each row falls back to zero-analytics + the
  // health pill shows what we can derive from status + sync time.
  const allInboxIds = [...myInboxes.map((i) => i.id), ...teamInboxes.map((i) => i.id)];
  let analyticsByInbox = new Map<
    string,
    Awaited<ReturnType<typeof loadInboxAnalytics>> extends Map<string, infer V> ? V : never
  >();
  try {
    analyticsByInbox = await loadInboxAnalytics(allInboxIds);
  } catch (err) {
    // Log but render — analytics is supplementary, the page still works
    // without it. The inboxes list is the operationally important part.
    console.warn("loadInboxAnalytics failed; rendering without analytics", err);
  }

  // 14-day time series for inline sparklines. Separate try/catch so
  // a missing inbox_daily_stats table (e.g. before the cron has run)
  // doesn't break the page — the strip just falls back to no
  // sparkline rendering.
  let dailyStatsByInbox = new Map<
    string,
    Awaited<ReturnType<typeof loadInboxDailyStats>> extends Map<string, infer V> ? V : never
  >();
  try {
    dailyStatsByInbox = await loadInboxDailyStats(allInboxIds, { days: 14 });
  } catch (err) {
    console.warn("loadInboxDailyStats failed; rendering without sparklines", err);
  }

  return (
    <div className="flex animate-[fade-in_300ms_ease-out] flex-col gap-8">
      <header>
        <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">
          Email Connection
        </p>
        <h1 className="mt-1 font-semibold text-4xl tracking-tight">Email inboxes</h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
          Connect each Gmail account you use. The inbox reads from every connected account on your
          team so anyone can pick up a thread; replies go from the specific Gmail the message was
          sent to. Tokens are encrypted with AES-256-GCM before being stored.
        </p>
      </header>

      {params.connected && (
        <div className="card-surface-quiet flex items-center gap-2 border-l-2 border-l-emerald-500 px-4 py-3 text-sm">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          <span>
            Connected <span className="font-medium">{decodeURIComponent(params.connected)}</span>.
          </span>
        </div>
      )}
      {params.error && (
        <div className="card-surface-quiet flex items-center gap-2 border-l-2 border-l-rose-500 px-4 py-3 text-sm">
          <AlertCircle className="h-4 w-4 text-rose-500" />
          <span>{ERROR_MESSAGES[params.error] ?? `Error: ${params.error}`}</span>
        </div>
      )}

      {!oauthReady && (
        <section className="card-surface p-5">
          <header className="mb-3 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-rose-500" />
            <h2 className="font-semibold text-lg tracking-tight">Gmail OAuth not configured</h2>
          </header>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            The server doesn't have{" "}
            <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">
              GOOGLE_OAUTH_CLIENT_ID
            </code>{" "}
            and{" "}
            <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">
              GOOGLE_OAUTH_CLIENT_SECRET
            </code>{" "}
            set. The connect button is inert until they're configured.
          </p>
        </section>
      )}

      <section className="card-surface flex items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-zinc-500" />
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            Connect a Gmail account (you can connect more than one — a separate row is added per
            address).
          </span>
        </div>
        {oauthReady ? (
          <a
            href="/api/auth/google/start"
            className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            Connect Gmail
          </a>
        ) : (
          <button
            type="button"
            disabled
            className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900"
          >
            Connect Gmail
          </button>
        )}
      </section>

      <section>
        <h2 className="mb-3 font-semibold text-2xl tracking-tight">My inboxes</h2>
        {myInboxes.length === 0 ? (
          <p className="card-surface-quiet flex items-center gap-2 px-4 py-3 text-sm text-zinc-600 dark:text-zinc-400">
            <Info className="h-4 w-4 text-zinc-500" />
            You haven't connected any Gmail accounts yet. Use the Connect Gmail button above.
          </p>
        ) : (
          <ul className="card-surface flex flex-col divide-y divide-zinc-200/80 dark:divide-zinc-800/40">
            {myInboxes.map((inbox) => {
              const analytics = analyticsByInbox.get(inbox.id) ?? {
                coldSends: 0,
                replies: 0,
                bounces: 0,
                staleThreads: 0,
                replyRate: 0,
                bounceRate: 0,
              };
              const health = classifyHealth({
                status: inbox.status,
                lastSyncedAt: inbox.lastSyncedAt,
                analytics,
              });
              return (
                <li key={inbox.id} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <CheckCircle2
                        className={`h-3.5 w-3.5 shrink-0 ${
                          inbox.status === "connected" ? "text-emerald-500" : "text-zinc-400"
                        }`}
                      />
                      <span className="truncate font-mono text-sm">{inbox.emailAddress}</span>
                      {inbox.lastSyncedAt && (
                        <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
                          · synced {inbox.lastSyncedAt.toLocaleString()}
                        </span>
                      )}
                      <span className="font-mono text-[10px] text-zinc-500">·</span>
                      <CapEditor
                        inboxId={inbox.id}
                        initialCap={inbox.dailyColdSendCap}
                        usedToday={inbox.usedToday}
                      />
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {inbox.status === "connected" && (
                        <form
                          action={async (fd: FormData) => {
                            "use server";
                            await resyncInbox(null, fd);
                          }}
                        >
                          <input type="hidden" name="id" value={inbox.id} />
                          <button
                            type="submit"
                            title="Pull new Gmail messages now (bypasses the 5-min cron cadence)"
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                          >
                            <RefreshCw className="h-3 w-3" />
                            Resync
                          </button>
                        </form>
                      )}
                      {inbox.status === "connected" && (
                        <form
                          action={async (fd: FormData) => {
                            "use server";
                            await syncGmailLabelsNowAction(null, fd);
                          }}
                        >
                          <input type="hidden" name="id" value={inbox.id} />
                          <button
                            type="submit"
                            title="Refresh the Gmail labels mirror — useful after creating a new label in Gmail's web UI"
                            className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                          >
                            <Tag className="h-3 w-3" />
                            Sync labels
                          </button>
                        </form>
                      )}
                      {oauthReady && (
                        <a
                          href="/api/auth/google/start"
                          className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
                        >
                          Reconnect
                        </a>
                      )}
                      <form
                        action={async (fd: FormData) => {
                          "use server";
                          await disconnectInbox(null, fd);
                        }}
                      >
                        <input type="hidden" name="id" value={inbox.id} />
                        <button
                          type="submit"
                          className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-rose-700 text-xs hover:bg-rose-100 dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-400 dark:hover:bg-rose-950/50"
                        >
                          <Unplug className="h-3 w-3" />
                          Disconnect
                        </button>
                      </form>
                    </div>
                  </div>
                  {/* Per-inbox 30-day deliverability rollup. Health pill
                      derives from status + sync freshness + bounce rate. */}
                  <InboxAnalyticsStrip
                    analytics={analytics}
                    health={health}
                    dailyStats={dailyStatsByInbox.get(inbox.id) ?? []}
                  />
                  <div className="mt-2">
                    <SignatureEditor
                      connectedAccountId={inbox.id}
                      initialSignatureHtml={inbox.signatureHtml}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {teamInboxes.length > 0 && (
        <section>
          <h2 className="mb-3 font-semibold text-2xl tracking-tight">Team inboxes</h2>
          <div className="card-surface overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-zinc-200 border-b text-left font-mono text-[10px] text-zinc-500 uppercase tracking-widest dark:border-zinc-800/60">
                  <th className="px-4 py-2.5">Owner</th>
                  <th className="px-4 py-2.5">Email</th>
                  <th className="px-4 py-2.5">Daily cap</th>
                  <th className="px-4 py-2.5">Health · 30d</th>
                </tr>
              </thead>
              <tbody>
                {teamInboxes.map((c, i) => {
                  const analytics = analyticsByInbox.get(c.id) ?? {
                    coldSends: 0,
                    replies: 0,
                    bounces: 0,
                    staleThreads: 0,
                    replyRate: 0,
                    bounceRate: 0,
                  };
                  const health = classifyHealth({
                    status: c.status,
                    lastSyncedAt: c.lastSyncedAt,
                    analytics,
                  });
                  return (
                    <tr key={c.id} className={i % 2 === 1 ? "dark:bg-white/[0.015]" : ""}>
                      <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">
                        {c.ownerName}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs">{c.emailAddress}</td>
                      <td className="px-4 py-2.5">
                        {staff.role === "admin" ? (
                          <CapEditor inboxId={c.id} initialCap={c.dailyColdSendCap} />
                        ) : (
                          <span className="font-mono text-[11px] text-zinc-500 tabular-nums">
                            {c.dailyColdSendCap}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <InboxAnalyticsStrip
                          analytics={analytics}
                          health={health}
                          dailyStats={dailyStatsByInbox.get(c.id) ?? []}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
