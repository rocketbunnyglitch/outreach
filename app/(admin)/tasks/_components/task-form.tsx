"use client";

import { FieldShell } from "@/app/(admin)/_components/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/form-utils";
import { CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

/**
 * Return `yyyy-MM-ddTHH:mm` for a Date in LOCAL time. Matches the
 * format the <input type="datetime-local"> control accepts.
 */
function localDateTimeString(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

/**
 * yyyy-MM-ddTHH:mm string for noon, `daysFromNow` days in the future.
 * Noon (rather than midnight) so the task doesn't read as "overdue"
 * the moment the target date arrives.
 */
function dueOffsetString(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(12, 0, 0, 0);
  return localDateTimeString(d);
}

interface StaffOption {
  id: string;
  displayName: string;
}

interface TaskFormProps {
  mode: "create" | "edit";
  staffList: StaffOption[];
  /**
   * Signed-in operator's staff ID. Used to mark "(you)" in the
   * assignee dropdown and sort the operator first so they can find
   * themselves at a glance (session 11: "assign to anyone, even me").
   * Optional so callers without auth context can still render.
   */
  currentUserId?: string;
  /** Initial values for edit mode. */
  initial?: {
    id?: string;
    title: string;
    description: string;
    status?: "pending" | "in_progress" | "completed" | "cancelled";
    targetType?: "venue_event" | "venue" | "city_campaign" | "wristband" | "misc";
    targetId?: string | null;
    assignedStaffId?: string | null;
    dueAt?: string | null; // datetime-local string
    slaThresholdMinutes?: number | null;
    version?: number;
  };
  action: (prev: unknown, formData: FormData) => Promise<ActionResult<{ id: string }>>;
}

export function TaskForm({ mode, staffList, currentUserId, initial, action }: TaskFormProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<
    ActionResult<{ id: string }> | null,
    FormData
  >(action, null);

  const fieldErrors = state && !state.ok && state.fieldErrors ? state.fieldErrors : {};

  // After a successful save, refresh the route so the server component
  // upstream (task detail page or task list) re-runs its query and the
  // user sees the new values reflected. Without this, the spinner just
  // disappears with no visible change — making it look like the save
  // didn't take. Also briefly show a "saved" badge so the user has
  // explicit confirmation before the refresh.
  const [savedFlash, setSavedFlash] = useState(false);
  useEffect(() => {
    if (state?.ok) {
      setSavedFlash(true);
      router.refresh();
      const t = window.setTimeout(() => setSavedFlash(false), 2000);
      return () => window.clearTimeout(t);
    }
  }, [state, router]);

  // Sort staff so the signed-in operator appears first (with "(you)"
  // suffix) and everyone else follows alphabetically. Mirrors the
  // pattern used in AddTaskRow so both surfaces feel consistent.
  const sortedStaff = [...staffList]
    .map((s) => ({ ...s, isSelf: s.id === currentUserId }))
    .sort((a, b) => {
      if (a.isSelf && !b.isSelf) return -1;
      if (b.isSelf && !a.isSelf) return 1;
      return a.displayName.localeCompare(b.displayName);
    });

  // Controlled state for the due-at input so the quick-pill row below
  // can update it programmatically. We seed from the initial prop on
  // edit so the value reads correctly on first paint.
  const [dueAt, setDueAt] = useState<string>(initial?.dueAt ?? "");

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-6">
      {state && !state.ok && state.error && <Alert tone="error">{state.error}</Alert>}

      {mode === "edit" && initial?.id && (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version ?? 1} />
        </>
      )}

      <FieldShell name="title" label="Title" required error={fieldErrors.title?.[0]}>
        <Input
          id="title"
          name="title"
          defaultValue={initial?.title ?? ""}
          maxLength={280}
          required
          placeholder="e.g. Book wristbands for Oct 28"
        />
      </FieldShell>

      <FieldShell name="description" label="Description" error={fieldErrors.description?.[0]}>
        <Textarea
          id="description"
          name="description"
          rows={4}
          defaultValue={initial?.description ?? ""}
          maxLength={4000}
          placeholder="Optional details about what needs doing."
        />
      </FieldShell>

      {mode === "create" && (
        <FieldShell
          name="targetType"
          label="Target"
          error={fieldErrors.targetType?.[0]}
          hint="What this task is about. Pick 'misc' for general tasks not tied to a specific record."
        >
          <Select name="targetType" defaultValue={initial?.targetType ?? "misc"}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="misc">General / miscellaneous</SelectItem>
              <SelectItem value="venue_event">Venue event</SelectItem>
              <SelectItem value="venue">Venue</SelectItem>
              <SelectItem value="city_campaign">City campaign</SelectItem>
              <SelectItem value="wristband">Wristband shipment</SelectItem>
            </SelectContent>
          </Select>
        </FieldShell>
      )}

      {mode === "edit" && (
        <FieldShell name="status" label="Status" required error={fieldErrors.status?.[0]}>
          <Select name="status" defaultValue={initial?.status ?? "pending"}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="in_progress">In progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </FieldShell>
      )}

      <FieldShell
        name="assignedStaffId"
        label="Assignee"
        error={fieldErrors.assignedStaffId?.[0]}
        hint="Leave blank to keep the task unassigned."
      >
        <Select name="assignedStaffId" defaultValue={initial?.assignedStaffId ?? "_none"}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_none">Unassigned</SelectItem>
            {sortedStaff.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.displayName}
                {s.isSelf && " (you)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldShell>

      <FieldShell
        name="dueAt"
        label="Due"
        error={fieldErrors.dueAt?.[0]}
        hint="Optional. Tasks with a due date in the past show as overdue."
      >
        <div className="flex flex-col gap-2">
          <Input
            id="dueAt"
            name="dueAt"
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
          />
          {/* Quick due-date pills — operator session 11 ask. One click
              fills the input above with the appropriate ISO datetime
              for noon local time on that day. */}
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[9px] text-zinc-400 uppercase tracking-[0.14em]">
              Quick
            </span>
            <DuePill label="Tomorrow" offsetDays={1} current={dueAt} onSet={setDueAt} />
            <DuePill label="3 days" offsetDays={3} current={dueAt} onSet={setDueAt} />
            <DuePill label="1 week" offsetDays={7} current={dueAt} onSet={setDueAt} />
            <DuePill label="2 weeks" offsetDays={14} current={dueAt} onSet={setDueAt} />
            {dueAt && (
              <button
                type="button"
                onClick={() => setDueAt("")}
                className="ml-auto rounded-md px-2 py-0.5 font-mono text-[9px] text-zinc-400 uppercase tracking-widest hover:text-zinc-700 dark:hover:text-zinc-300"
              >
                clear
              </button>
            )}
          </div>
        </div>
      </FieldShell>

      <FieldShell
        name="slaThresholdMinutes"
        label="SLA threshold (minutes)"
        error={fieldErrors.slaThresholdMinutes?.[0]}
        hint="Minutes past due before this task triggers an alert. Blank for soft due dates."
      >
        <Input
          id="slaThresholdMinutes"
          name="slaThresholdMinutes"
          type="number"
          min={0}
          max={60 * 24 * 30}
          step={15}
          defaultValue={
            initial?.slaThresholdMinutes != null ? String(initial.slaThresholdMinutes) : ""
          }
          placeholder="e.g. 60 (one hour grace period)"
        />
      </FieldShell>

      <div className="flex items-center gap-3 border-zinc-200 border-t pt-6 dark:border-zinc-800">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {mode === "create" ? "Create task" : "Save changes"}
        </Button>
        {/* Brief "saved" confirmation — appears for 2s after a successful
            update so the operator has explicit visual feedback. Without
            it the spinner just disappeared and it looked like nothing
            happened (the form values stayed the same because they're
            what the operator just entered). */}
        {savedFlash && !pending && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-emerald-600 uppercase tracking-[0.12em] dark:text-emerald-400">
            <CheckCircle2 className="h-3 w-3" />
            Saved
          </span>
        )}
        <Link
          href="/tasks"
          className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}

/**
 * Quick due-date pill. Highlights when current === the value this pill
 * would set, so the operator can see which preset they picked.
 *
 * Shared shape with AddTaskRow's DuePill but lives here to avoid an
 * extra component file; both forms use distinct datetime formats (the
 * inline list uses date-only, this form uses datetime-local).
 */
function DuePill({
  label,
  offsetDays,
  current,
  onSet,
}: {
  label: string;
  offsetDays: number;
  current: string;
  onSet: (value: string) => void;
}) {
  // Recompute on every render so 11:59 PM → 12:00 AM flips the pill
  // to the next-day equivalent. Cheap (1 Date allocation per pill).
  const targetValue = dueOffsetString(offsetDays);
  const matches = current === targetValue;
  return (
    <button
      type="button"
      onClick={() => onSet(targetValue)}
      className={
        matches
          ? "rounded-md border border-blue-400 bg-blue-100 px-2 py-0.5 font-medium text-[10px] text-blue-900 transition-colors dark:border-blue-700 dark:bg-blue-950/60 dark:text-blue-100"
          : "rounded-md border border-zinc-200 px-2 py-0.5 text-[10px] text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
      }
      aria-pressed={matches}
    >
      {label}
    </button>
  );
}
