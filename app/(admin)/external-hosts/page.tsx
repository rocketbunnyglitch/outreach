import { requireStaff } from "@/lib/auth";
import { loadCrawlsNeedingExternalHost, loadExternalHosts } from "./_actions";
import { ExternalHostsTable } from "./_components/external-hosts-table";
import { PendingExternalHostsSection } from "./_components/pending-external-hosts";

export const metadata = { title: "External Hosts" };
export const dynamic = "force-dynamic";

export default async function ExternalHostsPage() {
  await requireStaff();
  const [hosts, pendingCrawls] = await Promise.all([
    loadExternalHosts(),
    loadCrawlsNeedingExternalHost(),
  ]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
      <header>
        <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">Settings</p>
        <h1 className="mt-0.5 font-semibold text-3xl tracking-tight">External hosts</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Contractors paid to run crawls. Keep their contact info, mailing address, rate, and how to
          pay them — including a payment contact when that differs from the host.
        </p>
      </header>

      <PendingExternalHostsSection
        crawls={pendingCrawls}
        hosts={hosts.map((h) => ({ id: h.id, fullName: h.fullName }))}
      />

      <ExternalHostsTable hosts={hosts} />
    </div>
  );
}
