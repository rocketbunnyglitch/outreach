/**
 * /admin/learning — post-campaign learning report (CRM plan E1).
 *
 * What worked, measured: reply/confirm conversion by template and by
 * sender, slot-role conversion, priority-band conversion, cancellation
 * causes, replacement-push success, and the two lists that seed the
 * next campaign — venues to reuse and venues to avoid. Every number is
 * send-event-grounded (no opens — we never track opens on cold mail).
 */

import { requireAdmin } from "@/lib/auth";
import { loadCampaignLearning } from "@/lib/campaign-learning";
import { getCurrentCampaign } from "@/lib/current-campaign";
import { GraduationCap } from "lucide-react";
import Link from "next/link";

export const metadata = { title: "Learning · Admin" };
export const dynamic = "force-dynamic";

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="font-semibold text-sm tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

const TH = "px-3 py-1.5 text-left font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em]";
const TD = "px-3 py-1.5";

export default async function LearningPage() {
  await requireAdmin();
  const current = await getCurrentCampaign();
  if (!current) {
    return (
      <div className="p-6 text-sm text-zinc-500">
        Pick a campaign first — the learning report is campaign-scoped.
      </div>
    );
  }
  const data = await loadCampaignLearning(current.campaign.id);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 p-6">
      <header className="flex items-center gap-3">
        <GraduationCap className="h-5 w-5 text-zinc-400" />
        <div>
          <h1 className="font-semibold text-xl tracking-tight">
            Learning — {current.campaign.name}
          </h1>
          <p className="text-sm text-zinc-500">
            What measurably worked, so the next campaign starts smarter. Reply = the venue wrote
            back after the send; templates/senders with fewer than 3 sends are hidden.
          </p>
        </div>
      </header>

      <Section title="Templates by reply rate">
        {data.byTemplate.length === 0 ? (
          <p className="text-xs text-zinc-500">No template-attributed sends yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={TH}>Template</th>
                <th className={TH}>Sends</th>
                <th className={TH}>Replied</th>
                <th className={TH}>Reply rate</th>
                <th className={TH}>Confirmed threads</th>
              </tr>
            </thead>
            <tbody>
              {data.byTemplate.map((t) => (
                <tr key={t.code} className="border-zinc-100 border-t dark:border-zinc-900">
                  <td className={TD}>
                    <span className="font-mono text-xs">{t.code}</span>{" "}
                    <span className="text-zinc-500">{t.name}</span>
                  </td>
                  <td className={`${TD} font-mono`}>{t.sends}</td>
                  <td className={`${TD} font-mono`}>{t.replied}</td>
                  <td className={`${TD} font-mono`}>{pct(t.replyRate)}</td>
                  <td className={`${TD} font-mono`}>{t.confirmed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Senders by reply rate">
        {data.bySender.length === 0 ? (
          <p className="text-xs text-zinc-500">No attributed sends yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={TH}>Inbox</th>
                <th className={TH}>Brand</th>
                <th className={TH}>Sends</th>
                <th className={TH}>Replied</th>
                <th className={TH}>Reply rate</th>
              </tr>
            </thead>
            <tbody>
              {data.bySender.map((s) => (
                <tr key={s.email} className="border-zinc-100 border-t dark:border-zinc-900">
                  <td className={`${TD} font-mono text-xs`}>{s.email}</td>
                  <td className={TD}>{s.brand ?? "—"}</td>
                  <td className={`${TD} font-mono`}>{s.sends}</td>
                  <td className={`${TD} font-mono`}>{s.replied}</td>
                  <td className={`${TD} font-mono`}>{pct(s.replyRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Section title="Slot-role conversion">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={TH}>Role</th>
                <th className={TH}>Assigned</th>
                <th className={TH}>Confirmed</th>
                <th className={TH}>Cancelled</th>
              </tr>
            </thead>
            <tbody>
              {data.byRole.map((r) => (
                <tr key={r.role} className="border-zinc-100 border-t dark:border-zinc-900">
                  <td className={TD}>{r.role}</td>
                  <td className={`${TD} font-mono`}>{r.assigned}</td>
                  <td className={`${TD} font-mono`}>{r.confirmed}</td>
                  <td className={`${TD} font-mono`}>{r.cancelled}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Priority-band conversion">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={TH}>Priority</th>
                <th className={TH}>Cold entries</th>
                <th className={TH}>Interested</th>
                <th className={TH}>Confirmed venues</th>
              </tr>
            </thead>
            <tbody>
              {data.byPriority.map((p) => (
                <tr key={p.priority} className="border-zinc-100 border-t dark:border-zinc-900">
                  <td className={`${TD} font-mono`}>P{p.priority}</td>
                  <td className={`${TD} font-mono`}>{p.coldEntries}</td>
                  <td className={`${TD} font-mono`}>{p.interested}</td>
                  <td className={`${TD} font-mono`}>{p.confirmedVenues}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        <Section title="Cancellations by cause">
          {data.cancellationCauses.length === 0 ? (
            <p className="text-xs text-zinc-500">No cancellations.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {data.cancellationCauses.map((c) => (
                <li key={c.cause} className="flex justify-between">
                  <span>{c.cause}</span>
                  <span className="font-mono">{c.n}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Replacement pushes">
          <ul className="flex flex-col gap-1 text-sm">
            <li className="flex justify-between">
              <span>Total fired</span>
              <span className="font-mono">{data.replacements.total}</span>
            </li>
            <li className="flex justify-between">
              <span>Filled (slot recovered)</span>
              <span className="font-mono">{data.replacements.filled}</span>
            </li>
            <li className="flex justify-between">
              <span>Superseded by a re-push</span>
              <span className="font-mono">{data.replacements.superseded}</span>
            </li>
            <li className="flex justify-between">
              <span>Still open</span>
              <span className="font-mono">{data.replacements.open}</span>
            </li>
            <li className="flex justify-between">
              <span>Avg time to fill</span>
              <span className="font-mono">
                {data.replacements.avgFillHours != null
                  ? `${data.replacements.avgFillHours}h`
                  : "—"}
              </span>
            </li>
          </ul>
        </Section>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Section title={`Venues to reuse (${data.venuesToReuse.length})`}>
          <ul className="flex flex-col gap-1 text-sm">
            {data.venuesToReuse.map((v) => (
              <li key={v.venueId} className="flex justify-between gap-2">
                <Link href={`/venues/${v.venueId}`} className="truncate hover:underline">
                  {v.name} <span className="text-zinc-500">· {v.cityName}</span>
                </Link>
                <span className="shrink-0 font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
                  {v.detail}
                </span>
              </li>
            ))}
            {data.venuesToReuse.length === 0 && (
              <li className="text-xs text-zinc-500">No confirmed venues yet.</li>
            )}
          </ul>
        </Section>

        <Section title={`Venues to avoid (${data.venuesToAvoid.length})`}>
          <ul className="flex flex-col gap-1 text-sm">
            {data.venuesToAvoid.map((v) => (
              <li key={v.venueId} className="flex justify-between gap-2">
                <Link href={`/venues/${v.venueId}`} className="truncate hover:underline">
                  {v.name} <span className="text-zinc-500">· {v.cityName}</span>
                </Link>
                <span className="shrink-0 font-mono text-[11px] text-rose-600 dark:text-rose-400">
                  {v.detail}
                </span>
              </li>
            ))}
            {data.venuesToAvoid.length === 0 && (
              <li className="text-xs text-zinc-500">Nobody has pulled out on us. Good.</li>
            )}
          </ul>
        </Section>
      </div>
    </div>
  );
}
