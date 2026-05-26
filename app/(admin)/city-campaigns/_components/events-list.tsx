"use client";

import { createEvent } from "@/app/(admin)/events/_actions";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight, Calendar, Plus, X } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

interface EventRow {
  id: string;
  eventDate: string;
  slotNumber: number;
  status: string;
  requiredVenueCountTotal: number;
  venueCount: number;
}

interface Props {
  cityCampaignId: string;
  events: EventRow[];
}

export function EventsList({ cityCampaignId, events }: Props) {
  const [showAdd, setShowAdd] = useState(false);

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-2xl tracking-tight">Events</h2>
        <div className="flex items-center gap-3">
          <span className="font-mono text-stone-500 text-xs uppercase tracking-widest">
            {events.length} {events.length === 1 ? "event" : "events"}
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => setShowAdd((s) => !s)}>
            <Plus className="h-3 w-3" /> New event
          </Button>
        </div>
      </header>

      {showAdd && (
        <AddEventForm cityCampaignId={cityCampaignId} onCancel={() => setShowAdd(false)} />
      )}

      {events.length === 0 ? (
        <Card className="border-dashed bg-transparent p-6 text-center text-sm text-stone-500">
          No events yet. Add one to start assigning venues.
        </Card>
      ) : (
        <ol className="flex flex-col gap-2">
          {events.map((e) => (
            <li key={e.id}>
              <Link href={`/events/${e.id}`} className="group block">
                <Card className="flex items-center justify-between gap-4 p-4 transition-colors group-hover:bg-stone-50 dark:group-hover:bg-stone-900">
                  <div className="flex items-center gap-3">
                    <Calendar className="h-4 w-4 text-stone-400" />
                    <div className="flex flex-col gap-0.5">
                      <p className="font-medium">
                        {e.eventDate}
                        {e.slotNumber !== 1 && (
                          <span className="ml-2 font-mono text-stone-500 text-xs">
                            slot {e.slotNumber}
                          </span>
                        )}
                      </p>
                      <p className="text-stone-500 text-xs">
                        {e.venueCount} / {e.requiredVenueCountTotal} venues
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={statusTone(e.status)}>{e.status}</Badge>
                    <ArrowRight className="h-4 w-4 text-stone-400 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function AddEventForm({
  cityCampaignId,
  onCancel,
}: { cityCampaignId: string; onCancel: () => void }) {
  const [state, formAction] = useActionState(createEvent, null);
  return (
    <Card className="flex flex-col gap-4 p-5">
      <p className="font-medium text-stone-500 text-xs uppercase tracking-widest">New event</p>
      {state && !state.ok && state.error && <Alert tone="error">{state.error}</Alert>}
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="cityCampaignId" value={cityCampaignId} />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="eventDate">Event date</Label>
            <Input id="eventDate" name="eventDate" type="date" required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="slotNumber">Slot</Label>
            <Input id="slotNumber" name="slotNumber" type="number" min="1" defaultValue="1" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="requiredVenueCountTotal">Total venues</Label>
            <Input
              id="requiredVenueCountTotal"
              name="requiredVenueCountTotal"
              type="number"
              min="0"
              defaultValue="4"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="requiredWristbandCount">Wristband</Label>
            <Input
              id="requiredWristbandCount"
              name="requiredWristbandCount"
              type="number"
              min="0"
              defaultValue="1"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="requiredMiddleCount">Middle</Label>
            <Input
              id="requiredMiddleCount"
              name="requiredMiddleCount"
              type="number"
              min="0"
              defaultValue="2"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="requiredFinalCount">Final</Label>
            <Input
              id="requiredFinalCount"
              name="requiredFinalCount"
              type="number"
              min="0"
              defaultValue="1"
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            <X className="h-3 w-3" /> Cancel
          </Button>
          <SubmitButton />
        </div>
      </form>
    </Card>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating…" : "Create event"}
    </Button>
  );
}

function statusTone(s: string): "default" | "success" | "muted" | "warning" {
  if (s === "confirmed" || s === "completed") return "success";
  if (s === "cancelled") return "warning";
  return "default";
}
