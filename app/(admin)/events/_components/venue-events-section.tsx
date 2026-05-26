"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, X } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

interface VenueEventRow {
  id: string;
  venueId: string;
  venueName: string;
  role: string;
  status: string;
  slotStartTime: string | null;
  slotEndTime: string | null;
  ourContactName: string | null;
  confirmedAt: Date | null;
}

interface Props {
  eventId: string;
  venueEvents: VenueEventRow[];
  addableVenues: { id: string; name: string }[];
  staff: { id: string; displayName: string }[];
  addAction: (prev: unknown, fd: FormData) => Promise<{ ok: boolean; error?: string }>;
  updateAction: (
    id: string,
    prev: unknown,
    fd: FormData,
  ) => Promise<{ ok: boolean; error?: string }>;
  removeAction: (id: string) => Promise<void>;
}

export function VenueEventsSection({
  eventId,
  venueEvents,
  addableVenues,
  staff,
  addAction,
  updateAction,
  removeAction,
}: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-2xl tracking-tight ">Venues</h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowAdd((s) => !s)}
          disabled={addableVenues.length === 0}
          title={addableVenues.length === 0 ? "All city venues are already linked or DNC" : ""}
        >
          <Plus className="h-3 w-3" /> Add venue
        </Button>
      </header>

      {showAdd && addableVenues.length > 0 && (
        <AddVenueForm
          eventId={eventId}
          addableVenues={addableVenues}
          action={addAction}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {venueEvents.length === 0 ? (
        <Card className="border-dashed bg-transparent p-6 text-center text-sm text-zinc-500">
          No venues linked to this event yet.
        </Card>
      ) : (
        <ol className="flex flex-col gap-2">
          {venueEvents.map((ve) =>
            editingId === ve.id ? (
              <EditVenueEventCard
                key={ve.id}
                ve={ve}
                staff={staff}
                action={updateAction}
                removeAction={removeAction}
                onClose={() => setEditingId(null)}
              />
            ) : (
              <VenueEventRowDisplay key={ve.id} ve={ve} onEdit={() => setEditingId(ve.id)} />
            ),
          )}
        </ol>
      )}
    </section>
  );
}

function VenueEventRowDisplay({ ve, onEdit }: { ve: VenueEventRow; onEdit: () => void }) {
  return (
    <li>
      <button type="button" onClick={onEdit} className="block w-full text-left">
        <Card className="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900">
          <div className="flex flex-1 items-center gap-4">
            <Badge tone={roleTone(ve.role)}>{ve.role}</Badge>
            <div className="flex flex-col gap-0.5">
              <p className="font-medium">{ve.venueName}</p>
              <p className="text-xs text-zinc-500">
                {ve.slotStartTime && (
                  <>
                    {ve.slotStartTime.slice(0, 5)}
                    {ve.slotEndTime && ` – ${ve.slotEndTime.slice(0, 5)}`}
                  </>
                )}
                {ve.ourContactName && (
                  <>
                    {ve.slotStartTime ? " · " : ""}contact {ve.ourContactName}
                  </>
                )}
              </p>
            </div>
          </div>
          <Badge tone={statusTone(ve.status)}>{ve.status}</Badge>
        </Card>
      </button>
    </li>
  );
}

function EditVenueEventCard({
  ve,
  staff,
  action,
  removeAction,
  onClose,
}: {
  ve: VenueEventRow;
  staff: { id: string; displayName: string }[];
  action: Props["updateAction"];
  removeAction: Props["removeAction"];
  onClose: () => void;
}) {
  const boundAction = action.bind(null, ve.id);
  const [state, formAction] = useActionState(boundAction, null);

  async function handleRemove() {
    if (!confirm(`Remove ${ve.venueName} from this event?`)) return;
    await removeAction(ve.id);
    onClose();
  }

  return (
    <li>
      <Card className="flex flex-col gap-4 p-5">
        <header className="flex items-center justify-between gap-3">
          <h3 className="font-medium">{ve.venueName}</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-3 w-3" /> Done
          </Button>
        </header>
        {state && !state.ok && state.error && <Alert tone="error">{state.error}</Alert>}
        <form action={formAction} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`role-${ve.id}`}>Role</Label>
              <Select name="role" defaultValue={ve.role}>
                <SelectTrigger id={`role-${ve.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="wristband">Wristband (anchor)</SelectItem>
                  <SelectItem value="middle">Middle</SelectItem>
                  <SelectItem value="final">Final</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`status-${ve.id}`}>Status</Label>
              <Select name="status" defaultValue={ve.status}>
                <SelectTrigger id={`status-${ve.id}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lead">Lead</SelectItem>
                  <SelectItem value="contacted">Contacted</SelectItem>
                  <SelectItem value="interested">Interested</SelectItem>
                  <SelectItem value="negotiating">Negotiating</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="declined">Declined</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`ourContact-${ve.id}`}>Our contact</Label>
              <Select name="ourContactStaffId" defaultValue="_none">
                <SelectTrigger id={`ourContact-${ve.id}`}>
                  <SelectValue placeholder="None" />
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
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`start-${ve.id}`}>Slot start</Label>
              <Input
                id={`start-${ve.id}`}
                name="slotStartTime"
                type="time"
                defaultValue={ve.slotStartTime?.slice(0, 5) ?? ""}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`end-${ve.id}`}>Slot end</Label>
              <Input
                id={`end-${ve.id}`}
                name="slotEndTime"
                type="time"
                defaultValue={ve.slotEndTime?.slice(0, 5) ?? ""}
              />
            </div>
          </div>
          <div className="flex items-center justify-between border-zinc-100 border-t pt-4 dark:border-zinc-900">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleRemove}
              className="text-rose-700 dark:text-rose-400"
            >
              <Trash2 className="h-3 w-3" /> Remove from event
            </Button>
            <SubmitButton />
          </div>
        </form>
      </Card>
    </li>
  );
}

function AddVenueForm({
  eventId,
  addableVenues,
  action,
  onCancel,
}: {
  eventId: string;
  addableVenues: { id: string; name: string }[];
  action: Props["addAction"];
  onCancel: () => void;
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <Card className="flex flex-col gap-4 p-5">
      <p className="font-medium text-xs text-zinc-500 uppercase tracking-widest">Add a venue</p>
      {state && !state.ok && state.error && <Alert tone="error">{state.error}</Alert>}
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="eventId" value={eventId} />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <Label htmlFor="venueId">Venue</Label>
            <Select name="venueId" required>
              <SelectTrigger id="venueId">
                <SelectValue placeholder="Pick a venue" />
              </SelectTrigger>
              <SelectContent>
                {addableVenues.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="role">Role</Label>
            <Select name="role" required defaultValue="middle">
              <SelectTrigger id="role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="wristband">Wristband</SelectItem>
                <SelectItem value="middle">Middle</SelectItem>
                <SelectItem value="final">Final</SelectItem>
              </SelectContent>
            </Select>
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
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}

function roleTone(s: string): "default" | "success" | "muted" | "warning" {
  if (s === "wristband") return "success";
  if (s === "final") return "default";
  return "muted";
}

function statusTone(s: string): "default" | "success" | "muted" | "warning" {
  if (s === "confirmed") return "success";
  if (s === "declined" || s === "cancelled") return "warning";
  return "default";
}
