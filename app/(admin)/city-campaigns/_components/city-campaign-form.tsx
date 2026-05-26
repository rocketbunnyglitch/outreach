"use client";

import { FieldRow, FieldShell, FormSection } from "@/app/(admin)/_components/form-field";
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
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

interface Props {
  initial: {
    priority: number;
    targetVenueCount: number;
    targetWristbandCount: number;
    targetMiddleCount: number;
    targetFinalCount: number;
    salesGoalCents: bigint | null;
    leadStaffId: string | null;
    status: string;
  };
  staff: { id: string; displayName: string }[];
  action: (
    prev: unknown,
    fd: FormData,
  ) => Promise<{
    ok: boolean;
    error?: string;
    fieldErrors?: Record<string, string[]>;
  }>;
}

export function CityCampaignForm({ initial, staff, action }: Props) {
  const [state, formAction] = useActionState(action, null);

  return (
    <form action={formAction} className="flex flex-col gap-8">
      {state && !state.ok && state.error && <Alert tone="error">{state.error}</Alert>}

      <FormSection
        title="Priority & status"
        description="How important this city is in the overall campaign."
      >
        <FieldRow>
          <FieldShell label="Priority (1-10)" name="priority">
            <Input
              id="priority"
              name="priority"
              type="number"
              min="1"
              max="10"
              defaultValue={initial.priority}
            />
          </FieldShell>
          <FieldShell label="Status" name="status">
            <Select name="status" defaultValue={initial.status}>
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="planning">Planning</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </FieldShell>
        </FieldRow>
      </FormSection>

      <FormSection
        title="Venue mix targets"
        description="How many venues of each role this city needs."
      >
        <FieldRow>
          <FieldShell label="Total venues" name="targetVenueCount">
            <Input
              id="targetVenueCount"
              name="targetVenueCount"
              type="number"
              min="0"
              defaultValue={initial.targetVenueCount}
            />
          </FieldShell>
          <FieldShell label="Wristband (anchor)" name="targetWristbandCount">
            <Input
              id="targetWristbandCount"
              name="targetWristbandCount"
              type="number"
              min="0"
              defaultValue={initial.targetWristbandCount}
            />
          </FieldShell>
        </FieldRow>
        <FieldRow>
          <FieldShell label="Middle" name="targetMiddleCount">
            <Input
              id="targetMiddleCount"
              name="targetMiddleCount"
              type="number"
              min="0"
              defaultValue={initial.targetMiddleCount}
            />
          </FieldShell>
          <FieldShell label="Final" name="targetFinalCount">
            <Input
              id="targetFinalCount"
              name="targetFinalCount"
              type="number"
              min="0"
              defaultValue={initial.targetFinalCount}
            />
          </FieldShell>
        </FieldRow>
      </FormSection>

      <FormSection
        title="Ownership & goals"
        description="Who runs this city, what's the target revenue."
      >
        <FieldRow>
          <FieldShell label="Lead staff" name="leadStaffId">
            <Select name="leadStaffId" defaultValue={initial.leadStaffId ?? "_none"}>
              <SelectTrigger id="leadStaffId">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">— None —</SelectItem>
                {staff.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldShell>
          <FieldShell label="Sales goal (cents)" name="salesGoalCents">
            <Input
              id="salesGoalCents"
              name="salesGoalCents"
              type="number"
              min="0"
              defaultValue={initial.salesGoalCents != null ? String(initial.salesGoalCents) : ""}
              placeholder="500000"
            />
          </FieldShell>
        </FieldRow>
      </FormSection>

      <div className="flex justify-end border-zinc-200 border-t pt-6 dark:border-zinc-800">
        <SubmitButton />
      </div>
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} size="lg">
      {pending ? "Saving…" : "Save changes"}
    </Button>
  );
}
