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
    eventbriteUrl: string | null;
    dayPart:
      | "thursday_night"
      | "friday_night"
      | "saturday_day"
      | "saturday_night"
      | "sunday_day"
      | "sunday_night"
      | "other"
      | null;
    crawlNumber: number | null;
    ticketSalesCount: number;
    startsAt: Date | null;
    endsAt: Date | null;
    routeLabel: string | null;
    requiredVenueCountTotal: number;
    requiredWristbandCount: number;
    requiredMiddleCount: number;
    requiredFinalCount: number;
    status: string;
  };
  action: (prev: unknown, fd: FormData) => Promise<{ ok: boolean; error?: string }>;
}

/** Format a Date as the YYYY-MM-DDTHH:MM value <input type="datetime-local"> expects. */
function toLocalInput(d: Date | null): string {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function EventForm({ initial, action }: Props) {
  const [state, formAction] = useActionState(action, null);

  return (
    <form action={formAction} className="flex flex-col gap-8">
      {state && !state.ok && state.error && <Alert tone="error">{state.error}</Alert>}

      <FormSection
        title="Crawl identity"
        description="Daypart + crawl number identify this event within the city campaign (e.g. Friday Night #2)."
      >
        <FieldRow>
          <FieldShell label="Day part" name="dayPart">
            <Select name="dayPart" defaultValue={initial.dayPart ?? ""}>
              <SelectTrigger id="dayPart">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="thursday_night">Thursday Night</SelectItem>
                <SelectItem value="friday_night">Friday Night</SelectItem>
                <SelectItem value="saturday_day">Saturday Day</SelectItem>
                <SelectItem value="saturday_night">Saturday Night</SelectItem>
                <SelectItem value="sunday_day">Sunday Day</SelectItem>
                <SelectItem value="sunday_night">Sunday Night</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </FieldShell>
          <FieldShell label="Crawl number" name="crawlNumber" hint="1, 2, 3 within the daypart">
            <Input
              id="crawlNumber"
              name="crawlNumber"
              type="number"
              min="1"
              max="20"
              defaultValue={initial.crawlNumber ?? ""}
              placeholder="e.g. 2"
            />
          </FieldShell>
        </FieldRow>
        <FieldRow>
          <FieldShell
            label="Route label"
            name="routeLabel"
            hint="Optional free-text route or neighborhood name"
          >
            <Input
              id="routeLabel"
              name="routeLabel"
              defaultValue={initial.routeLabel ?? ""}
              placeholder="e.g. King West loop"
            />
          </FieldShell>
        </FieldRow>
      </FormSection>

      <FormSection
        title="Schedule"
        description="Actual start/end times. The date itself is set when the event is created."
      >
        <FieldRow>
          <FieldShell label="Starts at" name="startsAt">
            <Input
              id="startsAt"
              name="startsAt"
              type="datetime-local"
              defaultValue={toLocalInput(initial.startsAt)}
            />
          </FieldShell>
          <FieldShell label="Ends at" name="endsAt">
            <Input
              id="endsAt"
              name="endsAt"
              type="datetime-local"
              defaultValue={toLocalInput(initial.endsAt)}
            />
          </FieldShell>
        </FieldRow>
      </FormSection>

      <FormSection
        title="Sales"
        description="Ticket count is the operational primary. Revenue rolls up at the city_campaign level."
      >
        <FieldRow>
          <FieldShell
            label="Tickets sold"
            name="ticketSalesCount"
            hint="Update as Eventbrite reports come in. Defaults to 0."
          >
            <Input
              id="ticketSalesCount"
              name="ticketSalesCount"
              type="number"
              min="0"
              defaultValue={initial.ticketSalesCount}
            />
          </FieldShell>
        </FieldRow>
      </FormSection>

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
        title="Status & Eventbrite"
        description="Eventbrite ID is what the sync job uses; URL is the pasteable public link."
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
        <FieldRow>
          <FieldShell label="Eventbrite URL" name="eventbriteUrl">
            <Input
              id="eventbriteUrl"
              name="eventbriteUrl"
              type="url"
              defaultValue={initial.eventbriteUrl ?? ""}
              placeholder="https://www.eventbrite.com/e/..."
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
