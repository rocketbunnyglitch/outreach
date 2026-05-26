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

interface Props {
  mode: "create" | "edit";
  cityCampaigns: Array<{ id: string; label: string }>;
  initial?: {
    id?: string;
    cityCampaignId?: string;
    name?: string;
    dayPart?: string;
    notes?: string;
    status?: string;
    venueIds?: string; // CSV from cluster builder
    version?: number;
  };
  action: (prev: unknown, formData: FormData) => Promise<ActionResult<{ id: string }>>;
}

export function MiddleGroupForm({ mode, cityCampaigns, initial, action }: Props) {
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

      {/* Hidden — passed through from cluster builder when applicable */}
      {initial?.venueIds && <input type="hidden" name="venueIds" value={initial.venueIds} />}

      {mode === "create" && (
        <FieldShell
          name="cityCampaignId"
          label="City × Campaign"
          required
          error={fieldErrors.cityCampaignId?.[0]}
          hint="Which city-campaign this group belongs to."
        >
          <Select name="cityCampaignId" defaultValue={initial?.cityCampaignId ?? ""} required>
            <SelectTrigger>
              <SelectValue placeholder="Pick city × campaign" />
            </SelectTrigger>
            <SelectContent>
              {cityCampaigns.length === 0 ? (
                <SelectItem value="_none" disabled>
                  No city-campaigns yet — create one first
                </SelectItem>
              ) : (
                cityCampaigns.map((cc) => (
                  <SelectItem key={cc.id} value={cc.id}>
                    {cc.label}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </FieldShell>
      )}

      <FieldShell
        name="name"
        label="Group name"
        required
        error={fieldErrors.name?.[0]}
        hint="e.g. 'Friday Middle Group A' — surfaced when picking middles for an event."
      >
        <Input
          id="name"
          name="name"
          required
          maxLength={120}
          defaultValue={initial?.name ?? ""}
          placeholder="Friday Middle Group A"
        />
      </FieldShell>

      <FieldShell
        name="dayPart"
        label="Day part"
        error={fieldErrors.dayPart?.[0]}
        hint="Optional. Tags the group so the right one surfaces when picking middles for, e.g., Fri Night #2."
      >
        <Select name="dayPart" defaultValue={initial?.dayPart ?? ""}>
          <SelectTrigger>
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

      {mode === "edit" && (
        <FieldShell
          name="status"
          label="Status"
          hint="Free-text. planning | active | confirmed | cancelled."
        >
          <Input
            id="status"
            name="status"
            defaultValue={initial?.status ?? "planning"}
            placeholder="planning"
          />
        </FieldShell>
      )}

      <FieldShell name="notes" label="Notes" hint="Optional. Internal context, route quirks, etc.">
        <Textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={initial?.notes ?? ""}
          placeholder="Free-text notes…"
        />
      </FieldShell>

      <div className="flex items-center gap-3 border-zinc-200 border-t pt-6 dark:border-zinc-800">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {mode === "create" ? "Create group" : "Save changes"}
        </Button>
        <Link
          href="/middle-groups"
          className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
