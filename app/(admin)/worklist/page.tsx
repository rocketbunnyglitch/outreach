/**
 * /worklist - the operator's daily worklist (Phase 2.1 scaffold).
 *
 * The single dummy-proofing surface: everything an operator needs to do today,
 * grouped into four queues (drafts, replies, follow-ups, calls). This phase
 * scaffolds the page + four section placeholders showing empty states; each
 * section is wired to real data in Phase 2.2-2.6.
 *
 * Intended as the primary landing for the outreach + lead roles; that default
 * post-login redirect is deliberately deferred until the sections carry real
 * data (Phase 2.2+), so operators are not dropped onto an empty page.
 */

import { requireStaff } from "@/lib/auth";
import { CallsSection } from "./_components/calls-section";
import { DraftsSection } from "./_components/drafts-section";
import { FollowUpsSection } from "./_components/follow-ups-section";
import { RepliesSection } from "./_components/replies-section";

export const metadata = { title: "Daily worklist" };
export const dynamic = "force-dynamic";

export default async function WorklistPage() {
  const { staff } = await requireStaff();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Current Crawl</p>
        <h1 className="mt-1 font-semibold text-4xl tracking-tight">Daily worklist</h1>
        <p className="mt-2 max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
          Everything you need to do today.
        </p>
      </header>

      <div className="flex flex-col gap-4">
        <DraftsSection staffId={staff.id} />
        <RepliesSection />
        <FollowUpsSection />
        <CallsSection />
      </div>
    </div>
  );
}
