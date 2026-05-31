"use client";

import { useToast } from "@/components/ui/toast";
import { UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { type PendingExternalCrawl, assignExternalHostToCrawl } from "../_actions";

/**
 * Crawls marked external but not yet assigned a host. Each row gets a picker to
 * assign someone from the external-host roster; on assign it drops off the list.
 */
export function PendingExternalHostsSection({
  crawls,
  hosts,
}: {
  crawls: PendingExternalCrawl[];
  hosts: Array<{ id: string; fullName: string }>;
}) {
  const router = useRouter();
  const [pending, startTx] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  if (crawls.length === 0) return null;

  function assign(crawlHostId: string, externalHostId: string) {
    if (!externalHostId) return;
    const host = hosts.find((h) => h.id === externalHostId);
    const crawl = crawls.find((c) => c.crawlHostId === crawlHostId);
    setBusyId(crawlHostId);
    setError(null);
    startTx(async () => {
      const res = await assignExternalHostToCrawl({ crawlHostId, externalHostId });
      setBusyId(null);
      if (!res.ok) {
        setError(res.error ?? "Couldn't assign.");
        toast.show({
          kind: "error",
          message: res.error ?? "Couldn't assign host.",
          code: res.code,
        });
        return;
      }
      toast.show({
        kind: "success",
        message:
          host && crawl ? `Assigned ${host.fullName} to ${crawl.cityName}.` : "Host assigned.",
      });
      router.refresh();
    });
  }

  function fmtDate(iso: string): string {
    const d = new Date(`${iso}T00:00:00`);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  return (
    <section className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-5">
      <header className="mb-3 flex items-center gap-2">
        <UserPlus className="h-4 w-4 text-violet-600 dark:text-violet-400" />
        <h2 className="font-semibold text-lg tracking-tight">Crawls needing an external host</h2>
        <span className="rounded-full bg-violet-500/15 px-2 py-0.5 font-mono text-[10px] text-violet-700 tabular-nums dark:text-violet-300">
          {crawls.length}
        </span>
      </header>
      {hosts.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Add an external host below first, then come back to assign one.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-violet-500/15">
          {crawls.map((c) => (
            <li
              key={c.crawlHostId}
              className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="font-medium text-sm">
                  {c.cityName}
                  <span className="ml-2 font-normal text-xs text-zinc-500">{c.campaignName}</span>
                </p>
                <p className="font-mono text-[11px] text-zinc-500 tabular-nums">
                  {fmtDate(c.eventDate)}
                  {c.dayPart ? ` · ${c.dayPart}` : ""}
                  {c.crawlNumber ? ` · crawl ${c.crawlNumber}` : ""}
                </p>
              </div>
              <select
                defaultValue=""
                disabled={pending && busyId === c.crawlHostId}
                onChange={(e) => assign(c.crawlHostId, e.target.value)}
                className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="">Assign host…</option>
                {hosts.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.fullName}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-rose-600 text-xs">{error}</p>}
    </section>
  );
}
