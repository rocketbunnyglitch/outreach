"use client";

/**
 * FloorStaffCallsSection (Phase 3.13) -- V2 briefing calls. 0-4 days before each
 * confirmed event, the city lead calls the venue's frontline staff. One outcome
 * click records the attempt; "Confirmed" marks them briefed and drops the row.
 */

import { useToast } from "@/components/ui/toast";
import { captureClientError } from "@/lib/client-error";
import type { EventReadiness } from "@/lib/event-readiness";
import type { WorklistFloorStaffCallRow } from "@/lib/worklist-data";
import { Phone } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { recordFloorStaffCall } from "../_actions";

const OUTCOMES = [
  { key: "confirmed_with_floor_staff", label: "Confirmed" },
  { key: "manager_again_partial", label: "Manager again" },
  { key: "no_answer", label: "No answer" },
  { key: "voicemail", label: "Voicemail" },
  { key: "issue_raised", label: "Issue" },
] as const;

function fmtTime(t: string | null): string {
  if (!t) return "";
  const m = /^(\d{2}):(\d{2})/.exec(t);
  if (!m) return t;
  let h = Number(m[1]);
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m[2]} ${ampm}`;
}

const READINESS_STYLES: Record<EventReadiness["status"], string> = {
  ready:
    "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200",
  on_track:
    "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200",
  at_risk:
    "border-red-300 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200",
  not_started:
    "border-zinc-300 bg-zinc-50 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300",
};

function ReadinessPill({ readiness }: { readiness: EventReadiness }) {
  const pending = readiness.steps.filter((s) => !s.done).map((s) => s.label);
  const title =
    pending.length > 0 ? `Pending: ${pending.join(", ")}` : "All event-day prep complete";
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] ${READINESS_STYLES[readiness.status]}`}
    >
      {readiness.statusLabel} {readiness.doneCount}/{readiness.totalCount}
    </span>
  );
}

/**
 * Talking points the lead reads while dialling the venue's frontline staff
 * (Stage H / 7.14.3a floor-staff briefing intent). Terse, human, grounded in
 * the row's own data -- confirm awareness, the slot role + window, the
 * wristband/entry process, and the night-of contact. No new server data.
 */
function ScriptLines({
  venueName,
  roleLabel,
  slot,
  eventDate,
}: { venueName: string; roleLabel: string; slot: string; eventDate: string }): string[] {
  const window = slot ? `your ${roleLabel} window (${slot})` : `your ${roleLabel} window`;
  return [
    `Hi -- calling from the crawl team about the event at ${venueName} on ${eventDate}.`,
    `Confirm the floor knows the crawl is on and the bar is the ${roleLabel} stop.`,
    `Walk the crowd: groups arrive on wristbands during ${window} -- check the band, no re-entry stamp needed.`,
    "Confirm who's working the door and who to call here night-of if anything comes up.",
    "Ask: any concerns about volume, staffing, or the schedule before the night?",
  ];
}

function Row({ c }: { c: WorklistFloorStaffCallRow }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTx] = useTransition();
  const roleLabel = c.role === "alt_final" ? "final" : c.role;
  const slot =
    c.slotStartTime && c.slotEndTime ? `${fmtTime(c.slotStartTime)}-${fmtTime(c.slotEndTime)}` : "";
  const scriptLines = ScriptLines({
    venueName: c.venueName,
    roleLabel,
    slot,
    eventDate: c.eventDate,
  });

  function record(outcome: (typeof OUTCOMES)[number]["key"]) {
    startTx(async () => {
      try {
        const res = await recordFloorStaffCall({ venueEventId: c.venueEventId, outcome });
        if (!res.ok) {
          toast.show({ kind: "error", message: res.error ?? "Couldn't record." });
          return;
        }
        toast.show({ kind: "success", message: "Logged." });
        router.refresh();
      } catch (err) {
        const cap = captureClientError(err, {
          tag: "worklist.floorcall",
          fallback: "Couldn't record.",
        });
        toast.show({ kind: "error", message: cap.message, code: cap.code });
      }
    });
  }

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-sm">
            {c.venueName}
            {c.cityName ? <span className="text-zinc-500"> &middot; {c.cityName}</span> : null}
          </p>
          <p className="font-mono text-[10px] text-zinc-400">
            {roleLabel}
            {slot ? ` ${slot}` : ""} &middot; event {c.eventDate}
            {c.attempts > 0
              ? ` - ${c.attempts} attempt${c.attempts === 1 ? "" : "s"}${c.lastOutcome ? ` (${c.lastOutcome.replace(/_/g, " ")})` : ""}`
              : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ReadinessPill readiness={c.readiness} />
          {c.phoneE164 ? (
            <a
              href={`tel:${c.phoneE164}`}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-blue-300 bg-blue-50 px-2 py-1 font-mono text-[10px] text-blue-700 uppercase tracking-[0.08em] hover:bg-blue-100 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200"
            >
              <Phone className="h-3 w-3" /> Call
            </a>
          ) : (
            <span className="shrink-0 font-mono text-[10px] text-zinc-400">no phone</span>
          )}
        </div>
      </div>
      <details className="group rounded-lg border border-zinc-200/70 bg-zinc-50/60 px-2.5 py-1.5 dark:border-zinc-800/70 dark:bg-zinc-900/40">
        <summary className="cursor-pointer list-none font-mono text-[9px] text-zinc-500 uppercase tracking-[0.08em] hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
          Call script
        </summary>
        <ul className="mt-1.5 flex flex-col gap-1">
          {scriptLines.map((line) => (
            <li key={line} className="flex gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-300">
              <span className="text-zinc-400 dark:text-zinc-600">-</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </details>
      <div className="flex flex-wrap items-center gap-1">
        {OUTCOMES.map((o) => (
          <button
            key={o.key}
            type="button"
            disabled={pending}
            onClick={() => record(o.key)}
            className="rounded-md border border-zinc-200 px-2 py-0.5 font-mono text-[9px] text-zinc-600 uppercase tracking-[0.08em] hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {o.label}
          </button>
        ))}
      </div>
    </li>
  );
}

export function FloorStaffCallsSection({ calls }: { calls: WorklistFloorStaffCallRow[] }) {
  if (calls.length === 0) return null;
  return (
    <section className="card-surface overflow-hidden">
      <header className="flex items-center gap-2 border-zinc-200/60 border-b px-5 py-3 dark:border-zinc-800/40">
        <Phone className="h-4 w-4 text-blue-500" />
        <h3 className="font-semibold text-sm tracking-tight">Floor-staff briefing calls</h3>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-mono text-[9px] text-zinc-500 uppercase tracking-[0.1em] dark:bg-zinc-800 dark:text-zinc-400">
          {calls.length} in next 4 days
        </span>
      </header>
      <ul className="flex flex-col gap-2 p-3">
        {calls.map((c) => (
          <Row key={c.venueEventId} c={c} />
        ))}
      </ul>
    </section>
  );
}
