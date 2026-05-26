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
import type { Country } from "@/db/schema";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

interface CityFormProps {
  mode: "create" | "edit";
  initial?: {
    countryCode: string;
    name: string;
    region: string | null;
    timezone: string;
    location: { lng: number; lat: number } | null;
  };
  countries: Country[];
  action: (
    prev: unknown,
    fd: FormData,
  ) => Promise<{
    ok: boolean;
    error?: string;
    fieldErrors?: Record<string, string[]>;
  }>;
}

// A small curated set of timezones — covers most operator destinations.
// Operators can type a custom IANA timezone too.
const COMMON_TIMEZONES = [
  "America/Toronto",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Vancouver",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Paris",
  "Europe/Berlin",
  "Australia/Sydney",
];

export function CityForm({ mode, initial, countries, action }: CityFormProps) {
  const [state, formAction] = useActionState(action, null);

  return (
    <form action={formAction} className="flex flex-col gap-10">
      {state && !state.ok && state.error && <Alert tone="error">{state.error}</Alert>}

      <FormSection title="Location" description="Where this city sits.">
        <FieldRow>
          <FieldShell label="Country" name="countryCode" required>
            <Select name="countryCode" defaultValue={initial?.countryCode} required>
              <SelectTrigger id="countryCode">
                <SelectValue placeholder="Pick country" />
              </SelectTrigger>
              <SelectContent>
                {countries.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.name} ({c.code})
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
              placeholder="Toronto"
            />
          </FieldShell>
        </FieldRow>
        <FieldRow>
          <FieldShell label="Region (state / province)" name="region">
            <Input
              id="region"
              name="region"
              defaultValue={initial?.region ?? ""}
              placeholder="ON"
            />
          </FieldShell>
          <FieldShell label="IANA timezone" name="timezone" required>
            <Input
              id="timezone"
              name="timezone"
              required
              defaultValue={initial?.timezone ?? "America/Toronto"}
              list="timezones"
              placeholder="America/Toronto"
            />
            <datalist id="timezones">
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </FieldShell>
        </FieldRow>
      </FormSection>

      <FormSection
        title="Coordinates (optional)"
        description="PostGIS point used for venue clustering and map widgets. Provide both, or neither."
      >
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
              placeholder="-79.3832"
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
              placeholder="43.6532"
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
    <div className="flex items-center justify-end gap-3 border-zinc-200 border-t pt-6 dark:border-zinc-800">
      <Button type="submit" disabled={pending} size="lg">
        {pending
          ? mode === "create"
            ? "Creating…"
            : "Saving…"
          : mode === "create"
            ? "Create city"
            : "Save changes"}
      </Button>
    </div>
  );
}
