import { requireStaff } from "@/lib/auth";
import { loadCityOptions, loadSubmissionSites } from "./_actions";
import { EventSubmissionBoard } from "./_components/event-submission-board";

export const metadata = { title: "Event Submission" };
export const dynamic = "force-dynamic";

export default async function EventSubmissionPage() {
  await requireStaff();
  const [groups, cityOptions] = await Promise.all([loadSubmissionSites(), loadCityOptions()]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6">
      <header>
        <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">Operate</p>
        <h1 className="mt-0.5 font-semibold text-3xl tracking-tight">Event submission</h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          The sites to post each city's crawls to — Eventbrite, local listings, university boards.
          Add sites per city and check them off as you submit this cycle.
        </p>
      </header>

      <EventSubmissionBoard groups={groups} cityOptions={cityOptions} />
    </div>
  );
}
