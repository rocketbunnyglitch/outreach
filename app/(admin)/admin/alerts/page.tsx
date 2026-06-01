/**
 * /admin/alerts — per-inbox alert rule management.
 *
 * Admin-only. Lists every connected_account on the team; under each
 * inbox, shows the currently-configured rules + dispatch history,
 * with an inline form to add/edit rules.
 *
 * Spec: bounce_rate, sync_stale, no_replies, cap_breached. All rate-
 * limited to one fire per 24h per rule by the evaluator (see
 * lib/inbox-alerts.ts).
 */

import { connectedAccounts, inboxAlertDispatches, inboxAlertRules, users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { asc, desc, eq } from "drizzle-orm";
import { Bell, ShieldAlert } from "lucide-react";
import { AlertRuleForm } from "./_components/alert-rule-form";
import { DeleteRuleButton } from "./_components/delete-rule-button";

export const dynamic = "force-dynamic";

const RULE_LABELS: Record<string, string> = {
  bounce_rate: "Bounce rate threshold",
  sync_stale: "Sync stale (minutes)",
  no_replies: "Cold sends with no replies",
  cap_breached: "Daily cap bypass count",
};

const RULE_UNITS: Record<string, string> = {
  bounce_rate: "ratio (e.g. 0.05 = 5%)",
  sync_stale: "minutes (e.g. 60)",
  no_replies: "min cold sends to require (e.g. 20)",
  cap_breached: "bypass count (e.g. 0 = any bypass)",
};

export default async function AlertsAdminPage() {
  const { staff } = await requireAdmin();

  // Every inbox owned by anyone on this team.
  const accounts = await db
    .select({
      id: connectedAccounts.id,
      emailAddress: connectedAccounts.emailAddress,
      ownerName: users.displayName,
      ownerEmail: users.primaryEmail,
    })
    .from(connectedAccounts)
    .innerJoin(users, eq(users.id, connectedAccounts.ownerUserId))
    .where(eq(connectedAccounts.teamId, staff.teamId))
    .orderBy(asc(users.displayName), asc(connectedAccounts.emailAddress));

  // Existing rules across these accounts. One query, group client-side.
  const rules = await db
    .select({
      id: inboxAlertRules.id,
      connectedAccountId: inboxAlertRules.connectedAccountId,
      ruleKind: inboxAlertRules.ruleKind,
      threshold: inboxAlertRules.threshold,
      enabled: inboxAlertRules.enabled,
      channels: inboxAlertRules.channels,
      updatedAt: inboxAlertRules.updatedAt,
    })
    .from(inboxAlertRules)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, inboxAlertRules.connectedAccountId))
    .where(eq(connectedAccounts.teamId, staff.teamId))
    .orderBy(asc(inboxAlertRules.connectedAccountId), asc(inboxAlertRules.ruleKind));

  // Recent dispatch history — last 20 fires across the team.
  const recentDispatches = await db
    .select({
      id: inboxAlertDispatches.id,
      ruleId: inboxAlertDispatches.ruleId,
      firedAt: inboxAlertDispatches.firedAt,
      observedValue: inboxAlertDispatches.observedValue,
      channel: inboxAlertDispatches.channel,
      status: inboxAlertDispatches.status,
      notes: inboxAlertDispatches.notes,
      ruleKind: inboxAlertRules.ruleKind,
      accountEmail: connectedAccounts.emailAddress,
    })
    .from(inboxAlertDispatches)
    .innerJoin(inboxAlertRules, eq(inboxAlertRules.id, inboxAlertDispatches.ruleId))
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, inboxAlertRules.connectedAccountId))
    .where(eq(connectedAccounts.teamId, staff.teamId))
    .orderBy(desc(inboxAlertDispatches.firedAt))
    .limit(20);

  const rulesByAccount = new Map<string, typeof rules>();
  for (const r of rules) {
    const arr = rulesByAccount.get(r.connectedAccountId) ?? [];
    arr.push(r);
    rulesByAccount.set(r.connectedAccountId, arr);
  }

  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">
          Deliverability operations
        </p>
        <h1 className="mt-1 flex items-center gap-2 font-semibold text-4xl tracking-tight">
          <Bell className="h-7 w-7 text-zinc-400" />
          Inbox alerts
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
          Per-inbox alert rules. The cron runs every 30 minutes and rate-limits each rule to at most
          one fire per 24h. Channels: <code>email</code> needs <code>ALERT_SENDER_FROM</code>;{" "}
          <code>slack</code> needs <code>ALERT_SLACK_WEBHOOK_URL</code>.
        </p>
      </header>

      {accounts.length === 0 ? (
        <p className="card-surface-quiet px-4 py-3 text-sm text-zinc-600 dark:text-zinc-400">
          No inboxes connected on this team yet.
        </p>
      ) : (
        <section className="flex flex-col gap-6">
          {accounts.map((acc) => {
            const accountRules = rulesByAccount.get(acc.id) ?? [];
            return (
              <div key={acc.id} className="card-surface p-4">
                <div className="mb-3 flex items-baseline justify-between gap-3">
                  <div>
                    <h3 className="font-medium font-mono text-sm">{acc.emailAddress}</h3>
                    <p className="text-xs text-zinc-500">
                      {acc.ownerName} · {acc.ownerEmail}
                    </p>
                  </div>
                </div>
                {accountRules.length === 0 ? (
                  <p className="mb-3 text-xs text-zinc-500">No rules configured.</p>
                ) : (
                  <ul className="mb-3 flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800/40">
                    {accountRules.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                        <div className="flex flex-col gap-0.5">
                          <span className="font-medium text-xs">
                            {RULE_LABELS[r.ruleKind] ?? r.ruleKind}
                          </span>
                          <span className="font-mono text-[10px] text-zinc-500">
                            threshold: {r.threshold} · channels: {(r.channels ?? []).join(", ")} ·{" "}
                            {r.enabled ? "enabled" : "disabled"}
                          </span>
                        </div>
                        <DeleteRuleButton ruleId={r.id} />
                      </li>
                    ))}
                  </ul>
                )}
                <details className="rounded-md border border-zinc-200 border-dashed px-3 py-2 dark:border-zinc-800/60">
                  <summary className="cursor-pointer font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
                    Add / edit rule
                  </summary>
                  <AlertRuleForm
                    connectedAccountId={acc.id}
                    ruleLabels={RULE_LABELS}
                    ruleUnits={RULE_UNITS}
                  />
                </details>
              </div>
            );
          })}
        </section>
      )}

      {recentDispatches.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 font-medium text-xl">
            <ShieldAlert className="h-5 w-5 text-zinc-400" />
            Recent fires
          </h2>
          <div className="card-surface overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-zinc-200 border-b text-left font-mono text-[10px] text-zinc-500 uppercase tracking-widest dark:border-zinc-800/60">
                  <th className="px-4 py-2">When</th>
                  <th className="px-4 py-2">Inbox</th>
                  <th className="px-4 py-2">Rule</th>
                  <th className="px-4 py-2">Observed</th>
                  <th className="px-4 py-2">Channel</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {recentDispatches.map((d, i) => (
                  <tr key={d.id} className={i % 2 === 1 ? "dark:bg-white/[0.015]" : ""}>
                    <td className="px-4 py-2 font-mono text-[10px] text-zinc-500">
                      {d.firedAt.toLocaleString("en-US")}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{d.accountEmail}</td>
                    <td className="px-4 py-2 text-xs">{RULE_LABELS[d.ruleKind] ?? d.ruleKind}</td>
                    <td className="px-4 py-2 font-mono text-xs tabular-nums">{d.observedValue}</td>
                    <td className="px-4 py-2 text-xs">{d.channel}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`font-mono text-[10px] uppercase tracking-widest ${
                          d.status === "sent"
                            ? "text-emerald-600"
                            : d.status === "failed"
                              ? "text-rose-600"
                              : "text-zinc-500"
                        }`}
                      >
                        {d.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-zinc-500">{d.notes ?? "—"}</td>
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
