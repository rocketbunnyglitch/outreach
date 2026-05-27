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
import type { Campaign } from "@/db/schema";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

interface CampaignFormProps {
  mode: "create" | "edit";
  initial?: Pick<Campaign, "slug" | "name" | "holidayType" | "status" | "startDate" | "endDate">;
  action: (
    prev: unknown,
    fd: FormData,
  ) => Promise<{
    ok: boolean;
    error?: string;
    fieldErrors?: Record<string, string[]>;
  }>;
}

const HOLIDAYS = [
  { value: "halloween", label: "Halloween" },
  { value: "stpaddys", label: "St. Patrick's" },
  { value: "newyears", label: "New Year's" },
  { value: "custom", label: "Custom" },
];
const STATUSES = [
  { value: "planning", label: "Planning" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
];

/**
 * CampaignForm — slimmed down per operator session 11. Previous form
 * asked for a brand pair, public subdomain, and dollar-based goals.
 * Operator decisions:
 *
 *   #022: brand pair removed — staff picks alias at send time
 *   #024: public subdomain removed — public pages are not subdomains
 *         of this app
 *   #025: goals refactored — outreach goals move to a future page,
 *         admin-only $ goals live at /admin/goals
 *
 * What's left: identity (slug, name) + timing (holiday, status, dates).
 * The server action auto-fills the legacy brand FK columns with the
 * first-available brand of each type so the NOT NULL constraint in
 * the DB still passes. Those columns are slated for removal in a
 * follow-up migration after all UI references are gone.
 */
export function CampaignForm({ mode, initial, action }: CampaignFormProps) {
  const [state, formAction] = useActionState(action, null);

  return (
    <form action={formAction} className="flex flex-col gap-10">
      {state && !state.ok && state.error && <Alert tone="error">{state.error}</Alert>}

      <FormSection
        title="Identity"
        description="Slug and display name. Slug is permanent once created."
      >
        <FieldRow>
          <FieldShell label="Slug" name="slug" required>
            <Input
              id="slug"
              name="slug"
              required
              readOnly={mode === "edit"}
              defaultValue={initial?.slug}
              placeholder="halloween-2026-toronto"
              pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
            />
          </FieldShell>
          <FieldShell label="Display name" name="name" required>
            <Input
              id="name"
              name="name"
              required
              defaultValue={initial?.name ?? ""}
              placeholder="Halloween 2026 — Toronto"
            />
          </FieldShell>
        </FieldRow>
      </FormSection>

      <FormSection
        title="Timing & status"
        description="Optional date range and lifecycle status. Status defaults to Planning on create."
      >
        <FieldRow>
          <FieldShell label="Holiday type" name="holidayType" required>
            <Select name="holidayType" defaultValue={initial?.holidayType ?? "halloween"} required>
              <SelectTrigger id="holidayType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOLIDAYS.map((h) => (
                  <SelectItem key={h.value} value={h.value}>
                    {h.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldShell>
          <FieldShell label="Status" name="status">
            <Select name="status" defaultValue={initial?.status ?? "planning"}>
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldShell>
        </FieldRow>
        <FieldRow>
          <FieldShell label="Start date" name="startDate">
            <Input
              id="startDate"
              name="startDate"
              type="date"
              defaultValue={initial?.startDate ?? ""}
            />
          </FieldShell>
          <FieldShell label="End date" name="endDate">
            <Input id="endDate" name="endDate" type="date" defaultValue={initial?.endDate ?? ""} />
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
            ? "Create campaign"
            : "Save changes"}
      </Button>
    </div>
  );
}
