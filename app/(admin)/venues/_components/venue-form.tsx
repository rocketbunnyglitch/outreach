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
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

interface VenueFormProps {
  mode: "create" | "edit";
  initial?: {
    cityId: string;
    name: string;
    googlePlaceId: string | null;
    address: string | null;
    location: { lng: number; lat: number } | null;
    phoneE164: string | null;
    email: string | null;
    websiteUrl: string | null;
    instagramHandle: string | null;
    capacity: number | null;
    servesAlcohol: boolean;
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
        description="How we reach this venue. Phone in E.164 format (e.g. +14165551234)."
      >
        <FieldRow>
          <FieldShell label="Phone (E.164)" name="phoneE164">
            <Input
              id="phoneE164"
              name="phoneE164"
              defaultValue={initial?.phoneE164 ?? ""}
              placeholder="+14165551234"
              pattern="\+[1-9]\d{9,14}"
            />
          </FieldShell>
          <FieldShell label="Email" name="email">
            <Input
              id="email"
              name="email"
              type="email"
              defaultValue={initial?.email ?? ""}
              placeholder="events@venue.com"
            />
          </FieldShell>
        </FieldRow>
        <FieldRow>
          <FieldShell label="Website" name="websiteUrl">
            <Input
              id="websiteUrl"
              name="websiteUrl"
              type="url"
              defaultValue={initial?.websiteUrl ?? ""}
              placeholder="https://thedrakehotel.ca"
            />
          </FieldShell>
          <FieldShell label="Instagram handle" name="instagramHandle">
            <Input
              id="instagramHandle"
              name="instagramHandle"
              defaultValue={initial?.instagramHandle ?? ""}
              placeholder="thedrakehotel"
            />
          </FieldShell>
        </FieldRow>
      </FormSection>

      <FormSection
        title="Operations"
        description="Internal flags and notes. Not surfaced to venues."
      >
        <div className="flex items-center justify-between gap-3 rounded-md border border-stone-200 px-4 py-3 dark:border-stone-800">
          <div className="flex flex-col gap-0.5">
            <label htmlFor="servesAlcohol" className="font-medium text-sm">
              Serves alcohol
            </label>
            <p className="text-stone-500 text-xs">
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

        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50/30 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/30">
          <div className="flex flex-col gap-0.5">
            <label
              htmlFor="doNotContact"
              className="font-medium text-amber-900 text-sm dark:text-amber-200"
            >
              Do not contact
            </label>
            <p className="text-amber-800 text-xs dark:text-amber-300">
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

function SubmitRow({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return (
    <div className="flex items-center justify-end gap-3 border-stone-200 border-t pt-6 dark:border-stone-800">
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
