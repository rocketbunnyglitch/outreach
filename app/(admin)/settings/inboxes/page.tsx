import { outreachBrands, staffMembers, staffOutreachEmails } from "@/db/schema";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { isGmailOAuthConfigured } from "@/lib/gmail";
import { canSendNow } from "@/lib/send-throttle";
import { asc, eq, isNull } from "drizzle-orm";
import { AlertCircle, CheckCircle2, Info, Mail, Unplug } from "lucide-react";
import Link from "next/link";
import { disconnectInbox } from "./_actions";
import { InboxBrandSelect } from "./_components/inbox-brand-select";

export const metadata = { title: "Email Connection" };
export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  not_configured:
    "Gmail OAuth isn't configured on the server. Set GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET in .env.",
  missing_params: "OAuth callback was missing code or state.",
  bad_state: "OAuth state was malformed.",
  csrf: "CSRF validation failed. Try again from the Connect button.",
  staff_mismatch: "The connecting staffer didn't match. Try again while signed in as yourself.",
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

  // Outreach brands × current staff connections
  const brands = await db
    .select({
      id: outreachBrands.id,
      displayName: outreachBrands.displayName,
    })
    .from(outreachBrands)
    .where(isNull(outreachBrands.archivedAt))
    .orderBy(asc(outreachBrands.displayName));

  const myInboxes = await db
    .select({
      id: staffOutreachEmails.id,
      outreachBrandId: staffOutreachEmails.outreachBrandId,
      emailAddress: staffOutreachEmails.emailAddress,
      status: staffOutreachEmails.status,
      lastSyncedAt: staffOutreachEmails.lastSyncedAt,
      dailySendLimit: staffOutreachEmails.dailySendLimit,
      hourlySendLimit: staffOutreachEmails.hourlySendLimit,
      warmupPhase: staffOutreachEmails.warmupPhase,
      warmupStartedAt: staffOutreachEmails.warmupStartedAt,
      businessHoursOnly: staffOutreachEmails.businessHoursOnly,
      autoPausedAt: staffOutreachEmails.autoPausedAt,
      autoPausedReason: staffOutreachEmails.autoPausedReason,
    })
    .from(staffOutreachEmails)
    .where(eq(staffOutreachEmails.staffMemberId, staff.id));

  const inboxesByBrand = new Map<string, typeof myInboxes>();
  for (const i of myInboxes) {
    const list = inboxesByBrand.get(i.outreachBrandId) ?? [];
    list.push(i);
    inboxesByBrand.set(i.outreachBrandId, list);
  }

  // For each connected inbox, query the rolling 24h send count + cap
  const throttleStatusByInbox = new Map<string, Awaited<ReturnType<typeof canSendNow>>>();
  await Promise.all(
    myInboxes
      .filter((i) => i.status === "connected")
      .map(async (i) => {
        try {
          const status = await canSendNow({ staffOutreachEmailId: i.id });
          throttleStatusByInbox.set(i.id, status);
        } catch {
          /* ignore */
        }
      }),
  );

  // Other staff members for the per-brand summary at the bottom
  const allConnections = await db
    .select({
      brandId: staffOutreachEmails.outreachBrandId,
      brandName: outreachBrands.displayName,
      emailAddress: staffOutreachEmails.emailAddress,
      status: staffOutreachEmails.status,
      staffName: staffMembers.displayName,
    })
    .from(staffOutreachEmails)
    .innerJoin(outreachBrands, eq(outreachBrands.id, staffOutreachEmails.outreachBrandId))
    .innerJoin(staffMembers, eq(staffMembers.id, staffOutreachEmails.staffMemberId))
    .orderBy(asc(outreachBrands.displayName), asc(staffMembers.displayName));

  return (
    <div className="flex animate-[fade-in_300ms_ease-out] flex-col gap-8">
      <header>
        <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">
          Email Connection
        </p>
        <h1 className="mt-1 font-semibold text-4xl tracking-tight">Email inboxes</h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
          Connect your Gmail account to each outreach brand. Cold emails are sent from YOUR Gmail
          (not a shared inbox), so replies thread naturally and venues see a real human address.
          Tokens are encrypted with AES-256-GCM before being stored.
        </p>
      </header>

      {/* Flash messages */}
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

      {/* Configuration warning */}
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
            set. Until those land in{" "}
            <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">
              /var/www/outreach/.env
            </code>
            , the connect buttons below are visible but inert.
          </p>
          <p className="mt-2 text-xs text-zinc-500">
            Walkthrough: console.cloud.google.com → New project → Enable Gmail API → OAuth consent
            (External, Testing) → Add scopes (gmail.send, gmail.readonly, gmail.modify,
            userinfo.email, openid) → Add test users (your staff Gmail addresses) → Create OAuth
            Client (Web app) → Redirect URI shown below.
          </p>
        </section>
      )}

      {/* Authorized redirect URI — shown always, not just when OAuth isn't
          configured. The "redirect_uri_mismatch" error happens when the URL
          we send to Google doesn't match what's registered in the Cloud
          Console. Surfacing it here lets the operator copy-paste it
          verbatim into Google's OAuth client config. */}
      <section className="card-surface border-l-2 border-l-rose-500 p-5">
        <header className="mb-3 flex items-center gap-2">
          <Info className="h-4 w-4 text-zinc-500" />
          <h2 className="font-semibold text-base tracking-tight">
            Google Cloud Console — required URLs
          </h2>
        </header>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          If you see{" "}
          <code className="rounded bg-rose-50 px-1 py-0.5 text-[11px] text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
            Error 400: redirect_uri_mismatch
          </code>{" "}
          when clicking Connect / Add an email, the URL below isn&apos;t listed verbatim under your
          OAuth client&apos;s &quot;Authorized redirect URIs&quot;. Google compares
          character-for-character — a trailing slash, http vs https, or different case all count as
          mismatches. <strong className="font-semibold">Both fields below must be set</strong> on
          the OAuth client whose ID + secret are in the server&apos;s .env.
        </p>

        <div className="mt-3 flex flex-col gap-3">
          <div>
            <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
              Authorized JavaScript origins
            </p>
            <code className="mt-1 block break-all rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-[11px] dark:border-zinc-800 dark:bg-zinc-900">
              {env.APP_URL}
            </code>
          </div>
          <div>
            <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.12em]">
              Authorized redirect URIs
            </p>
            <code className="mt-1 block break-all rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 font-mono text-[11px] dark:border-zinc-800 dark:bg-zinc-900">
              {env.APP_URL}/api/auth/google/callback
            </code>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 rounded-md bg-zinc-50/60 p-3 dark:bg-zinc-900/40">
          <p className="font-medium text-[11px] text-zinc-700 dark:text-zinc-300">
            Setup steps in Google Cloud Console
          </p>
          <ol className="ml-4 list-decimal space-y-1 text-[11px] text-zinc-600 dark:text-zinc-400">
            <li>
              Open{" "}
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-700 underline-offset-2 hover:underline dark:text-blue-300"
              >
                console.cloud.google.com → APIs &amp; Services → Credentials
              </a>
            </li>
            <li>
              Pick the OAuth 2.0 Client ID whose value matches your server&apos;s{" "}
              <code className="rounded bg-zinc-200 px-1 py-0.5 text-[10px] dark:bg-zinc-700">
                GOOGLE_OAUTH_CLIENT_ID
              </code>
              . If you have several clients, make sure you&apos;re editing the right one.
            </li>
            <li>
              Paste the JavaScript origin (above) into &quot;Authorized JavaScript origins&quot;.
            </li>
            <li>Paste the redirect URI (above) into &quot;Authorized redirect URIs&quot;.</li>
            <li>
              Click <em>Save</em>. Changes can take a minute or two to propagate.
            </li>
          </ol>
        </div>

        <p className="mt-3 text-[11px] text-zinc-500">
          The URLs are derived from the server&apos;s{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 text-[10px] dark:bg-zinc-800">
            APP_URL
          </code>{" "}
          env var (currently{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 text-[10px] dark:bg-zinc-800">
            {env.APP_URL}
          </code>
          ). If that&apos;s wrong, the URLs above are wrong too; fix{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 text-[10px] dark:bg-zinc-800">
            APP_URL
          </code>{" "}
          in <code>.env</code> and restart, then re-register both fields in the Cloud Console.
        </p>
        <p className="mt-2 text-[11px] text-zinc-500">
          To verify what the server is actually sending, open{" "}
          <a
            href="/api/auth/google/debug"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 underline-offset-2 hover:underline dark:text-blue-300"
          >
            /api/auth/google/debug
          </a>{" "}
          — the JSON response shows the exact URL we hand to Google.
        </p>
      </section>

      {/* My inboxes — per brand */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-semibold text-2xl tracking-tight">Your inboxes</h2>
          {oauthReady && brands.length > 0 ? (
            <a
              href={`/api/auth/google/start?outreachBrandId=${brands[0]?.id ?? ""}`}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-xs text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
              title="Connect a Gmail, then pick its brand from the dropdown on the connected email"
            >
              <Mail className="h-3 w-3" /> Add an email
            </a>
          ) : null}
        </div>
        <p className="text-xs text-zinc-500">
          Connect as many Gmail accounts as you like, then use the brand dropdown on each to choose
          which brand it&apos;s grouped under. An email can be moved between brands anytime.
        </p>
        {brands.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No outreach brands yet. Create one in{" "}
            <Link href="/brands" className="underline">
              Brands
            </Link>
            .
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {brands.map((brand) => {
              const brandInboxes = inboxesByBrand.get(brand.id) ?? [];
              const connectedInboxes = brandInboxes.filter((i) => i.status === "connected");
              return (
                <li key={brand.id} className="card-surface flex flex-col gap-3 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <p className="font-medium">{brand.displayName}</p>
                    {oauthReady ? (
                      <a
                        href={`/api/auth/google/start?outreachBrandId=${brand.id}`}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 font-medium text-xs text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
                      >
                        <Mail className="h-3 w-3" />
                        {connectedInboxes.length > 0 ? "Connect another" : "Connect Gmail"}
                      </a>
                    ) : (
                      <span
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-zinc-200 px-3 py-1.5 font-medium text-xs text-zinc-500 dark:bg-zinc-800"
                        title="GOOGLE_OAUTH_CLIENT_ID not set on server"
                      >
                        <Mail className="h-3 w-3" />
                        Connect Gmail (waiting on config)
                      </span>
                    )}
                  </div>

                  {connectedInboxes.length === 0 ? (
                    <p className="text-xs text-zinc-500">No inbox connected</p>
                  ) : (
                    <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
                      {connectedInboxes.map((inbox) => (
                        <li
                          key={inbox.id}
                          className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-1.5 text-xs">
                              <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
                              <span className="truncate text-zinc-600 dark:text-zinc-400">
                                {inbox.emailAddress}
                              </span>
                              {inbox.lastSyncedAt && (
                                <span className="font-mono text-[10px] text-zinc-500 tabular-nums">
                                  · synced {inbox.lastSyncedAt.toLocaleString()}
                                </span>
                              )}
                            </p>
                            <ThrottleBadge
                              status={throttleStatusByInbox.get(inbox.id)}
                              warmupPhase={inbox.warmupPhase}
                              autoPausedAt={inbox.autoPausedAt}
                              autoPausedReason={inbox.autoPausedReason}
                              dailySendLimit={inbox.dailySendLimit}
                            />
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <InboxBrandSelect
                              emailId={inbox.id}
                              currentBrandId={brand.id}
                              brands={brands}
                            />
                            {oauthReady && (
                              <a
                                href={`/api/auth/google/start?outreachBrandId=${brand.id}`}
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
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Team summary */}
      {allConnections.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-semibold text-2xl tracking-tight">Team connections</h2>
          <div className="card-surface overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-zinc-200 border-b text-left font-mono text-[10px] text-zinc-500 uppercase tracking-widest dark:border-zinc-800/60">
                  <th className="px-4 py-2.5">Brand</th>
                  <th className="px-4 py-2.5">Staff</th>
                  <th className="px-4 py-2.5">Email</th>
                  <th className="px-4 py-2.5">Status</th>
                </tr>
              </thead>
              <tbody>
                {allConnections.map((c, i) => (
                  <tr
                    key={`${c.brandId}-${c.emailAddress}`}
                    className={i % 2 === 1 ? "dark:bg-white/[0.015]" : ""}
                  >
                    <td className="px-4 py-2.5">{c.brandName}</td>
                    <td className="px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{c.staffName}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{c.emailAddress}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={`font-mono text-[10px] uppercase tracking-widest ${
                          c.status === "connected"
                            ? "text-emerald-500"
                            : c.status === "disconnected"
                              ? "text-zinc-500"
                              : "text-rose-500"
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * Per-inbox deliverability status indicator. Shows:
 *   - Warm-up day badge (when warmupPhase is true)
 *   - "23/30 sent today" counter
 *   - Auto-paused warning (red) when set
 *   - Outside-business-hours / cap-reached hints when relevant
 *
 * Pulls from the throttle status fetched on the server.
 */
function ThrottleBadge({
  status,
  warmupPhase,
  autoPausedAt,
  autoPausedReason,
  dailySendLimit: _dailySendLimit,
}: {
  status: Awaited<ReturnType<typeof canSendNow>> | undefined;
  warmupPhase: boolean;
  autoPausedAt: Date | null;
  autoPausedReason: string | null;
  dailySendLimit: number;
}) {
  if (autoPausedAt) {
    return (
      <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 font-mono text-[10px] text-rose-700 uppercase tracking-widest dark:border-rose-900/40 dark:bg-rose-950/30 dark:text-rose-400">
        <AlertCircle className="h-3 w-3" />
        Auto-paused: {autoPausedReason ?? "unknown"}
      </p>
    );
  }
  if (!status) return null;
  if (status.ok) {
    const remaining = status.effectiveDailyCap - status.sent24h;
    return (
      <p className="mt-1.5 inline-flex flex-wrap items-center gap-2 font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
        {warmupPhase && status.warmupDay !== null && (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-amber-600 ring-1 ring-amber-500/20 ring-inset dark:text-amber-400">
            Warm-up day {status.warmupDay}/14
          </span>
        )}
        <span className="tabular-nums">
          {status.sent24h}/{status.effectiveDailyCap} sent · {remaining} left today
        </span>
        {status.sent1h > 0 && (
          <span className="text-zinc-400 tabular-nums">({status.sent1h} this hour)</span>
        )}
      </p>
    );
  }
  // Denied state
  const toneByCode: Record<typeof status.code, string> = {
    inbox_not_connected: "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20",
    auto_paused: "bg-rose-500/10 text-rose-700 ring-rose-500/20",
    outside_business_hours: "bg-blue-500/10 text-blue-700 ring-blue-500/20",
    weekend: "bg-blue-500/10 text-blue-700 ring-blue-500/20",
    daily_cap_reached: "bg-amber-500/10 text-amber-700 ring-amber-500/20",
    hourly_cap_reached: "bg-amber-500/10 text-amber-700 ring-amber-500/20",
    spacing_floor: "bg-zinc-500/10 text-zinc-600 ring-zinc-500/20",
    inbox_not_found: "bg-rose-500/10 text-rose-700 ring-rose-500/20",
  };
  return (
    <p
      className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ring-1 ring-inset ${toneByCode[status.code]}`}
      title={status.reason}
    >
      <AlertCircle className="h-3 w-3" />
      {status.code.replace(/_/g, " ")}
    </p>
  );
}
