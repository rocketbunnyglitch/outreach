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
import type { Campaign, CrawlBrand, OutreachBrand } from "@/db/schema";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

interface CampaignFormProps {
  mode: "create" | "edit";
  initial?: Pick<
    Campaign,
    | "slug"
    | "name"
    | "outreachBrandId"
    | "crawlBrandId"
    | "holidayType"
    | "status"
    | "startDate"
    | "endDate"
    | "publicSubdomain"
    | "revenueGoalCents"
    | "venueCountGoal"
  >;
  outreachBrands: Pick<OutreachBrand, "id" | "displayName">[];
  crawlBrands: Pick<CrawlBrand, "id" | "displayName" | "holidayType">[];
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

export function CampaignForm({
  mode,
  initial,
  outreachBrands,
  crawlBrands,
  action,
}: CampaignFormProps) {
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
        title="Brand pair"
        description="Every campaign references both an outreach brand (whose Postmark sends the email) and a crawl brand (the public face). Both are required."
      >
        <FieldRow>
          <FieldShell label="Outreach brand" name="outreachBrandId" required>
            <Select
              name="outreachBrandId"
              defaultValue={initial?.outreachBrandId}
              required
              disabled={mode === "edit"}
            >
              <SelectTrigger id="outreachBrandId">
                <SelectValue placeholder="Pick an outreach brand" />
              </SelectTrigger>
              <SelectContent>
                {outreachBrands.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldShell>
          <FieldShell label="Crawl brand" name="crawlBrandId" required>
            <Select
              name="crawlBrandId"
              defaultValue={initial?.crawlBrandId}
              required
              disabled={mode === "edit"}
            >
              <SelectTrigger id="crawlBrandId">
                <SelectValue placeholder="Pick a crawl brand" />
              </SelectTrigger>
              <SelectContent>
                {crawlBrands.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.displayName} ({b.holidayType})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldShell>
        </FieldRow>
        {mode === "edit" && (
          <p className="text-stone-500 text-xs">
            The brand pair is locked after creation. To re-brand, archive and create a new campaign.
          </p>
        )}
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

      <FormSection
        title="Public-facing"
        description="Subdomain for the public crawl page (e.g. halloween-2026.crawl.example)."
      >
        <FieldRow>
          <FieldShell label="Public subdomain" name="publicSubdomain">
            <Input
              id="publicSubdomain"
              name="publicSubdomain"
              defaultValue={initial?.publicSubdomain ?? ""}
              placeholder="halloween-2026"
            />
          </FieldShell>
        </FieldRow>
      </FormSection>

      <FormSection
        title="Goals"
        description="Optional. Drives the dashboard widgets in later phases."
      >
        <FieldRow>
          <FieldShell label="Revenue goal (cents)" name="revenueGoalCents">
            <Input
              id="revenueGoalCents"
              name="revenueGoalCents"
              type="number"
              min="0"
              step="1"
              defaultValue={
                initial?.revenueGoalCents != null ? String(initial.revenueGoalCents) : ""
              }
              placeholder="500000"
            />
            <p className="mt-1 text-stone-500 text-xs">
              Stored as bigint cents in your campaign's currency (no FX).
            </p>
          </FieldShell>
          <FieldShell label="Venue count goal" name="venueCountGoal">
            <Input
              id="venueCountGoal"
              name="venueCountGoal"
              type="number"
              min="0"
              step="1"
              defaultValue={initial?.venueCountGoal ?? ""}
              placeholder="40"
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
            ? "Create campaign"
            : "Save changes"}
      </Button>
    </div>
  );
}
