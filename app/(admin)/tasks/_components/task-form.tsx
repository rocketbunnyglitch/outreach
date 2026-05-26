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
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";

interface StaffOption {
  id: string;
  displayName: string;
}

interface TaskFormProps {
  mode: "create" | "edit";
  staffList: StaffOption[];
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

export function TaskForm({ mode, staffList, initial, action }: TaskFormProps) {
  const [state, formAction, pending] = useActionState<
    ActionResult<{ id: string }> | null,
    FormData
  >(action, null);

  const fieldErrors = state && !state.ok && state.fieldErrors ? state.fieldErrors : {};

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
            {staffList.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.displayName}
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
        <Input id="dueAt" name="dueAt" type="datetime-local" defaultValue={initial?.dueAt ?? ""} />
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
