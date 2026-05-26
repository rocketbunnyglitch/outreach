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
    eventbriteEventId: string | null;
    requiredVenueCountTotal: number;
    requiredWristbandCount: number;
    requiredMiddleCount: number;
    requiredFinalCount: number;
    status: string;
  };
  action: (prev: unknown, fd: FormData) => Promise<{ ok: boolean; error?: string }>;
}

export function EventForm({ initial, action }: Props) {
  const [state, formAction] = useActionState(action, null);

  return (
    <form action={formAction} className="flex flex-col gap-8">
      {state && !state.ok && state.error && <Alert tone="error">{state.error}</Alert>}

      <FormSection title="Required venue mix" description="Targets for this event night.">
        <FieldRow>
          <FieldShell label="Total venues" name="requiredVenueCountTotal">
            <Input
              id="requiredVenueCountTotal"
              name="requiredVenueCountTotal"
              type="number"
              min="0"
              defaultValue={initial.requiredVenueCountTotal}
            />
          </FieldShell>
          <FieldShell label="Wristband" name="requiredWristbandCount">
            <Input
              id="requiredWristbandCount"
              name="requiredWristbandCount"
              type="number"
              min="0"
              defaultValue={initial.requiredWristbandCount}
            />
          </FieldShell>
        </FieldRow>
        <FieldRow>
          <FieldShell label="Middle" name="requiredMiddleCount">
            <Input
              id="requiredMiddleCount"
              name="requiredMiddleCount"
              type="number"
              min="0"
              defaultValue={initial.requiredMiddleCount}
            />
          </FieldShell>
          <FieldShell label="Final" name="requiredFinalCount">
            <Input
              id="requiredFinalCount"
              name="requiredFinalCount"
              type="number"
              min="0"
              defaultValue={initial.requiredFinalCount}
            />
          </FieldShell>
        </FieldRow>
      </FormSection>

      <FormSection
        title="Status & external linking"
        description="Eventbrite ID is optional; Phase 8 sync uses it."
      >
        <FieldRow>
          <FieldShell label="Status" name="status">
            <Select name="status" defaultValue={initial.status}>
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="planned">Planned</SelectItem>
                <SelectItem value="confirmed">Confirmed</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </FieldShell>
          <FieldShell label="Eventbrite event ID" name="eventbriteEventId">
            <Input
              id="eventbriteEventId"
              name="eventbriteEventId"
              defaultValue={initial.eventbriteEventId ?? ""}
              placeholder="optional"
            />
          </FieldShell>
        </FieldRow>
      </FormSection>

      <div className="flex justify-end border-stone-200 border-t pt-6 dark:border-stone-800">
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
