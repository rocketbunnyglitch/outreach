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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toE164 } from "@/lib/phone";
import { Plus, X } from "lucide-react";
import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { DuplicateWarning } from "./duplicate-warning";

interface VenueFormProps {
  mode: "create" | "edit";
  initial?: {
    id?: string;
    cityId: string;
    name: string;
    googlePlaceId: string | null;
    address: string | null;
    location: { lng: number; lat: number } | null;
    phoneE164: string | null;
    email: string | null;
    alternateEmails?: string[];
    contactName: string | null;
    websiteUrl: string | null;
    instagramHandle: string | null;
    capacity: number | null;
    servesAlcohol: boolean;
    hours: string | null;
    internalNotes: string;
    doNotContact: boolean;
    doNotContactReason: string | null;
  };
  cities: { id: string; name: string; region: string | null }[];
  action: (
    prev: unknown,
    fd: FormData,
  ) => Promise<{
    ok: boolean;
    error?: string;
    fieldErrors?: Record<string, string[]>;
  }>;
}

export function VenueForm({ mode, initial, cities, action }: VenueFormProps) {
  const [state, formAction] = useActionState(action, null);

  return (
    <form action={formAction} className="flex flex-col gap-10">
      {state && !state.ok && state.error && <Alert tone="error">{state.error}</Alert>}

      <FormSection title="Identity" description="What and where. Required for every venue.">
        <FieldRow>
          <FieldShell label="City" name="cityId" required>
            <Select name="cityId" defaultValue={initial?.cityId} required>
              <SelectTrigger id="cityId">
                <SelectValue placeholder="Pick a city" />
              </SelectTrigger>
              <SelectContent>
                {cities.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.region ? ` (${c.region})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldShell>
          <FieldShell label="Name" name="name" required>
            <Input
              id="name"
              name="name"
              required
              defaultValue={initial?.name ?? ""}
              placeholder="The Drake Hotel"
            />
          </FieldShell>
        </FieldRow>

        {/* Live duplicate-detection panel. Only renders when ≥3 chars typed
            AND at least one match. Doesn't block submit — operator can
            still create a "duplicate" if they know it's actually different. */}
        <DuplicateWarning
          nameInputId="name"
          cityInputId="cityId"
          addressInputId="address"
          ignoreVenueId={initial?.id}
        />
        <FieldRow>
          <FieldShell label="Google Place ID" name="googlePlaceId">
            <Input
              id="googlePlaceId"
              name="googlePlaceId"
              defaultValue={initial?.googlePlaceId ?? ""}
              placeholder="ChIJ..."
            />
          </FieldShell>
          <FieldShell label="Capacity" name="capacity">
            <Input
              id="capacity"
              name="capacity"
              type="number"
              min="0"
              step="1"
              defaultValue={initial?.capacity ?? ""}
              placeholder="180"
            />
          </FieldShell>
        </FieldRow>
        <FieldRow>
          <FieldShell label="Address" name="address" className="md:col-span-2">
            <Input
              id="address"
              name="address"
              defaultValue={initial?.address ?? ""}
              placeholder="1150 Queen St W, Toronto"
            />
          </FieldShell>
        </FieldRow>
        <FieldRow>
          <FieldShell label="Longitude" name="longitude">
            <Input
              id="longitude"
              name="longitude"
              type="number"
              step="any"
              min="-180"
              max="180"
              defaultValue={initial?.location?.lng ?? ""}
            />
          </FieldShell>
          <FieldShell label="Latitude" name="latitude">
            <Input
              id="latitude"
              name="latitude"
              type="number"
              step="any"
              min="-90"
              max="90"
              defaultValue={initial?.location?.lat ?? ""}
            />
          </FieldShell>
        </FieldRow>
      </FormSection>

      <FormSection
        title="Contact"
        description="How we reach this venue. Paste a phone in any format — it's auto-formatted on save."
      >
        <FieldRow>
          <FieldShell label="Contact name" name="contactName">
            <Input
              id="contactName"
              name="contactName"
              defaultValue={initial?.contactName ?? ""}
              placeholder="e.g. Sadie, Suraj, Jamal"
            />
          </FieldShell>
          <FieldShell label="Phone" name="phoneE164">
            <Input
              id="phoneE164"
              name="phoneE164"
              defaultValue={initial?.phoneE164 ?? ""}
              placeholder="any format — auto-formatted"
              // Paste any format; normalize to E.164 on blur so the operator
              // never has to format by hand (the server re-normalizes on save).
              onBlur={(e) => {
                const next = toE164(e.target.value);
                if (next !== e.target.value) e.target.value = next;
              }}
            />
          </FieldShell>
        </FieldRow>
        <FieldRow>
          <FieldShell label="Email" name="email">
            <MultiEmailField
              initialPrimary={initial?.email ?? ""}
              initialAlternates={initial?.alternateEmails ?? []}
            />
          </FieldShell>
          <FieldShell label="Website" name="websiteUrl">
            <Input
              id="websiteUrl"
              name="websiteUrl"
              type="url"
              defaultValue={initial?.websiteUrl ?? ""}
              placeholder="https://thedrakehotel.ca"
            />
          </FieldShell>
        </FieldRow>
        <FieldRow>
          <FieldShell label="Instagram handle" name="instagramHandle">
            <Input
              id="instagramHandle"
              name="instagramHandle"
              defaultValue={initial?.instagramHandle ?? ""}
              placeholder="thedrakehotel"
            />
          </FieldShell>
          <div /> {/* spacer to keep two-column grid */}
        </FieldRow>
      </FormSection>

      <FormSection
        title="Operations"
        description="Internal flags and notes. Not surfaced to venues."
      >
        <div className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex flex-col gap-0.5">
            <label htmlFor="servesAlcohol" className="font-medium text-sm">
              Serves alcohol
            </label>
            <p className="text-xs text-zinc-500">
              Affects which campaign types this venue is eligible for.
            </p>
          </div>
          <input type="hidden" name="servesAlcohol" value="false" />
          <Switch
            name="servesAlcohol"
            value="true"
            defaultChecked={initial?.servesAlcohol ?? true}
            id="servesAlcohol"
          />
        </div>

        <div className="flex items-center justify-between gap-3 rounded-md border border-rose-200 bg-rose-50/30 px-4 py-3 dark:border-rose-900 dark:bg-rose-950/30">
          <div className="flex flex-col gap-0.5">
            <label
              htmlFor="doNotContact"
              className="font-medium text-rose-900 text-sm dark:text-rose-200"
            >
              Do not contact
            </label>
            <p className="text-rose-800 text-xs dark:text-rose-300">
              Suppresses this venue from outreach campaigns entirely.
            </p>
          </div>
          <input type="hidden" name="doNotContact" value="false" />
          <Switch
            name="doNotContact"
            value="true"
            defaultChecked={initial?.doNotContact ?? false}
            id="doNotContact"
          />
        </div>

        <FieldRow>
          <FieldShell
            label="Do-not-contact reason"
            name="doNotContactReason"
            className="md:col-span-2"
          >
            <Input
              id="doNotContactReason"
              name="doNotContactReason"
              defaultValue={initial?.doNotContactReason ?? ""}
              placeholder="Owner asked to be removed from cold outreach"
            />
          </FieldShell>
        </FieldRow>

        <FieldRow>
          <FieldShell
            label="Opening hours"
            name="hours"
            className="md:col-span-2"
            hint="Paste from Google Maps. Free-form text. Used to suggest the best call window."
          >
            <Textarea
              id="hours"
              name="hours"
              rows={4}
              defaultValue={initial?.hours ?? ""}
              placeholder={
                "Monday: 4 PM \u2013 2 AM\nTuesday: 4 PM \u2013 2 AM\nWednesday: 4 PM \u2013 2 AM\n\u2026"
              }
            />
          </FieldShell>
        </FieldRow>

        <FieldRow>
          <FieldShell label="Internal notes" name="internalNotes" className="md:col-span-2">
            <Textarea
              id="internalNotes"
              name="internalNotes"
              rows={4}
              defaultValue={initial?.internalNotes ?? ""}
              placeholder="Past relationship, key contacts, anything useful for the next staffer to see."
            />
          </FieldShell>
        </FieldRow>
      </FormSection>

      <SubmitRow mode={mode} />
    </form>
  );
}

/**
 * Primary email + a dynamic list of additional emails (operator request
 * 2026-06-11: "can manually input multiple emails for one venue... and
 * the email will email them all"). Extra addresses land in
 * venues.alternate_emails; compose paths join primary + alternates into
 * the To line. The list serializes into ONE hidden JSON input because
 * the server's formToObject collapses repeated field names.
 */
function MultiEmailField({
  initialPrimary,
  initialAlternates,
}: {
  initialPrimary: string;
  initialAlternates: string[];
}) {
  const idCounter = useRef(initialAlternates.length);
  const [alternates, setAlternates] = useState<Array<{ id: string; value: string }>>(() =>
    initialAlternates.map((value, i) => ({ id: `alt-${i}`, value })),
  );

  function addField() {
    idCounter.current += 1;
    setAlternates((prev) => [...prev, { id: `alt-${idCounter.current}`, value: "" }]);
  }

  return (
    <div className="flex flex-col gap-2">
      <Input
        id="email"
        name="email"
        type="email"
        defaultValue={initialPrimary}
        placeholder="events@venue.com"
      />
      {alternates.map((alt) => (
        <div key={alt.id} className="flex items-center gap-2">
          <Input
            type="email"
            value={alt.value}
            onChange={(e) =>
              setAlternates((prev) =>
                prev.map((a) => (a.id === alt.id ? { ...a, value: e.target.value } : a)),
              )
            }
            placeholder="another@venue.com"
            aria-label="Additional email"
          />
          <button
            type="button"
            onClick={() => setAlternates((prev) => prev.filter((a) => a.id !== alt.id))}
            className="shrink-0 rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-rose-500/[0.08] hover:text-rose-600 dark:hover:text-rose-400"
            aria-label="Remove this email"
            title="Remove this email"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      {alternates.length < 9 && (
        <button
          type="button"
          onClick={addField}
          className="inline-flex w-fit items-center gap-1 rounded-md px-2 py-1 font-mono text-[10px] text-zinc-500 uppercase tracking-[0.08em] transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <Plus className="h-3 w-3" />
          Add email
        </button>
      )}
      <input
        type="hidden"
        name="alternateEmails"
        value={JSON.stringify(alternates.map((a) => a.value.trim()).filter(Boolean))}
      />
      {alternates.length > 0 && (
        <p className="text-[11px] text-zinc-500">
          Emails to this venue go to every address listed here.
        </p>
      )}
    </div>
  );
}

function SubmitRow({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return (
    <div className="flex items-center justify-end gap-3 border-zinc-200 border-t pt-6 dark:border-zinc-800">
      <Button type="submit" disabled={pending} size="lg">
        {pending
          ? mode === "create"
            ? "Creating…"
            : "Saving…"
          : mode === "create"
            ? "Create venue"
            : "Save changes"}
      </Button>
    </div>
  );
}
