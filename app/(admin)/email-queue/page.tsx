/**
 * /email-queue - the cold-send queue.
 *
 * Staff queue cold emails (composer "Queue" button) which auto-stagger 5-8
 * min apart per inbox, then walk away and work on something else. This page
 * is the at-a-glance view of that queue:
 *   - Queued  : waiting, with its planned send time
 *   - Sending : due now, the scheduled-sends cron is dispatching it
 *   - Sent    : fired in the last 24h
 * with Cancel (remove a queued email) + Edit (re-open in the composer).
 *
 * Owner-scoped -- everyone sees only their own queue.
 */

import { requireStaff } from "@/lib/auth";
import { loadEmailQueue } from "@/lib/email-queue-data";
import { EmailQueueList } from "./_components/email-queue-list";

export const metadata = { title: "Email queue" };
export const dynamic = "force-dynamic";

export default async function EmailQueuePage() {
  const { staff } = await requireStaff();
  const data = await loadEmailQueue(staff.id);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <header className="mb-5">
        <h1 className="font-semibold text-lg tracking-tight">Email queue</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Cold emails you queued send automatically, spaced a few minutes apart so they land
          naturally. Queue a batch and get on with other work.
        </p>
      </header>
      <EmailQueueList
        queued={data.queued}
        sending={data.sending}
        sent={data.sent}
        viewerTimezone={staff.timezone ?? "America/Toronto"}
      />
    </div>
  );
}
