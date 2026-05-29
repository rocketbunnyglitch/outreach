import { requireStaff } from "@/lib/auth";
import { loadInternalHostFlaggedCrawls, loadInternalHosts } from "./_actions";
import { InternalHostFlaggedCrawls } from "./_components/flagged-crawls";
import { InternalHostsTable } from "./_components/internal-hosts-table";

export const metadata = { title: "Internal Hosts" };
export const dynamic = "force-dynamic";

export default async function InternalHostsPage() {
  await requireStaff();
  const [hosts, flagged] = await Promise.all([
    loadInternalHosts(),
    loadInternalHostFlaggedCrawls(),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6">
      <header>
        <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">Settings</p>
        <h1 className="mt-0.5 font-semibold text-3xl tracking-tight">Internal hosts</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Team members paid hourly to run crawls. Set an hourly rate + hours worked; the total is
          computed for you. Use this to prep payouts.
        </p>
      </header>

      <InternalHostsTable hosts={hosts} />

      {/* Crawls flagged as having an internal host — surfaces what
          still needs name / hours / rate filled in after the night-of.
          Per operator: "I just need to mark it as internal and put
          that info in after." Without this view they'd have to
          remember which crawls were flagged and navigate to each city
          sheet separately. */}
      <InternalHostFlaggedCrawls rows={flagged} />
    </div>
  );
}
