import { requireAdmin } from "@/lib/auth";
import { cn } from "@/lib/cn";
import { type MisclassificationRow, loadMisclassifications } from "@/lib/misclassification-data";
import { ArrowRight, Bot, ListChecks, UserCheck } from "lucide-react";
import Link from "next/link";

export const metadata = { title: "Misclassifications - Admin" };
export const dynamic = "force-dynamic";

/**
 * /misclassifications -- Phase 6.5 misclassification review surface.
 *
 * Read-only. Lists threads where the AI's suggested classification (latest
 * classifier_runs row) differs from the operator-confirmed classification
 * (email_threads.classification). Lets a lead see where the model was wrong:
 * what it guessed, how confident it was, which model + reference-doc sections
 * drove the guess, and the venue/city context. Every row links to the thread.
 *
 * Admin-only. No mutations -- this is an audit lens, not a correction tool.
 */
export default async function MisclassificationsPage() {
  const { staff } = await requireAdmin();
  const rows = await loadMisclassifications({ teamId: staff.teamId, limit: 200 });

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Back to Admin
        </Link>
        <h1 className="mt-2 flex items-center gap-2 font-semibold text-4xl tracking-tight">
          <ListChecks className="h-8 w-8 text-zinc-400" />
          Misclassifications
        </h1>
        <p className="max-w-2xl text-sm text-zinc-500">
          Threads where the AI's suggested classification differs from the one the operator
          confirmed. Use it to spot where the classifier is consistently wrong. Read-only.
        </p>
      </header>

      <section className="rounded-2xl border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-950">
        {rows.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-zinc-500">
            No misclassifications yet. Either the AI and operators agree, or no threads have been
            both AI-classified and operator-confirmed.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-zinc-200 border-b text-xs text-zinc-500 dark:border-zinc-800">
                <th className="px-3 py-2 text-left font-medium">Thread</th>
                <th className="px-3 py-2 text-left font-medium">
                  <span className="inline-flex items-center gap-1">
                    <Bot className="h-3 w-3" />
                    AI said
                  </span>
                </th>
                <th className="px-3 py-2 text-left font-medium">
                  <span className="inline-flex items-center gap-1">
                    <UserCheck className="h-3 w-3" />
                    Operator said
                  </span>
                </th>
                <th className="px-3 py-2 text-right font-medium">Confidence</th>
                <th className="px-3 py-2 text-left font-medium">Model</th>
                <th className="px-3 py-2 text-left font-medium">Sections</th>
                <th className="px-3 py-2 text-left font-medium">Venue / City</th>
                <th className="px-3 py-2 text-left font-medium">Last run</th>
                <th className="px-3 py-2 font-medium" aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.threadId} row={r} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Row({ row: r }: { row: MisclassificationRow }) {
  const confidencePct = Math.round(r.confidence * 100);
  const highConfidenceMiss = r.confidence >= 0.9;

  return (
    <tr className="border-zinc-100 border-b last:border-b-0 hover:bg-zinc-50/60 dark:border-zinc-900 dark:hover:bg-zinc-900/40">
      <td className="max-w-[20rem] px-3 py-2">
        <span className="block truncate font-medium text-zinc-800 dark:text-zinc-200">
          {r.subject ?? "(no subject)"}
        </span>
      </td>
      <td className="px-3 py-2">
        <ClassPill value={r.suggestedClassification} tone="ai" />
      </td>
      <td className="px-3 py-2">
        <ClassPill value={r.confirmedClassification} tone="operator" />
      </td>
      <td className="px-3 py-2 text-right">
        <span
          className={cn(
            "font-mono text-xs",
            highConfidenceMiss
              ? "text-rose-700 dark:text-rose-300"
              : "text-zinc-600 dark:text-zinc-400",
          )}
          title={highConfidenceMiss ? "High-confidence miss" : undefined}
        >
          {confidencePct}%
        </span>
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-zinc-500">{r.model}</td>
      <td className="px-3 py-2">
        {r.retrievedSectionCodes.length === 0 ? (
          <span className="text-zinc-400">-</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {r.retrievedSectionCodes.map((code) => (
              <span
                key={code}
                className="rounded border border-zinc-200 bg-zinc-50 px-1 py-0.5 font-mono text-[10px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
              >
                {code}
              </span>
            ))}
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-col">
          <span className="text-zinc-700 dark:text-zinc-300">{r.venueName ?? "-"}</span>
          {r.cityName && <span className="font-mono text-[10px] text-zinc-500">{r.cityName}</span>}
        </div>
      </td>
      <td className="px-3 py-2 font-mono text-[11px] text-zinc-500">
        {r.runAt.toLocaleString("en-US", {
          timeZone: "America/Toronto",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}
      </td>
      <td className="px-3 py-2 text-right">
        <Link
          href={`/inbox/${r.threadId}`}
          className="inline-flex items-center gap-0.5 rounded-md border border-zinc-200 px-1.5 py-1 text-xs text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
        >
          Open
          <ArrowRight className="h-3 w-3" />
        </Link>
      </td>
    </tr>
  );
}

function ClassPill({ value, tone }: { value: string; tone: "ai" | "operator" }) {
  const toneClass =
    tone === "ai"
      ? "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-200"
      : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest",
        toneClass,
      )}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}
