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
import type { ActionResult } from "@/lib/form-utils";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { GoalScopePicker, type ScopeOption } from "./goal-scope-picker";

interface GoalFormProps {
  mode: "create" | "edit";
  campaigns: ScopeOption[];
  outreachBrands: ScopeOption[];
  crawlBrands: ScopeOption[];
  cityCampaigns: ScopeOption[];
  staff: ScopeOption[];
  initial?: {
    id?: string;
    scope?: "campaign" | "outreach_brand" | "crawl_brand" | "city_campaign" | "staff_weekly";
    scopeId?: string;
    metric?:
      | "revenue_cents"
      | "venue_count"
      | "emails_sent"
      | "calls_made"
      | "confirmations"
      | "replies_received";
    targetValueDisplay?: number;
    periodStart?: string;
    periodEnd?: string;
    version?: number;
  };
  action: (prev: unknown, formData: FormData) => Promise<ActionResult<{ id: string }>>;
}

export function GoalForm({
  mode,
  campaigns,
  outreachBrands,
  crawlBrands,
  cityCampaigns,
  staff,
  initial,
  action,
}: GoalFormProps) {
  const [state, formAction, pending] = useActionState<
    ActionResult<{ id: string }> | null,
    FormData
  >(action, null);
  const [metric, setMetric] = useState(initial?.metric ?? "revenue_cents");

  const fieldErrors = state && !state.ok && state.fieldErrors ? state.fieldErrors : {};

  const isRevenue = metric === "revenue_cents";

  return (
    <form action={formAction} className="flex max-w-2xl flex-col gap-6">
      {state && !state.ok && state.error && <Alert tone="error">{state.error}</Alert>}

      {mode === "edit" && initial?.id && (
        <>
          <input type="hidden" name="id" value={initial.id} />
          <input type="hidden" name="version" value={initial.version ?? 1} />
        </>
      )}

      {mode === "create" && (
        <FieldShell
          name="scope"
          label="Scope"
          required
          error={fieldErrors.scope?.[0] ?? fieldErrors.scopeId?.[0]}
          hint="What this goal applies to. Pick the record on the right."
        >
          <GoalScopePicker
            campaigns={campaigns}
            outreachBrands={outreachBrands}
            crawlBrands={crawlBrands}
            cityCampaigns={cityCampaigns}
            staff={staff}
            defaultScope={initial?.scope}
            defaultScopeId={initial?.scopeId}
          />
        </FieldShell>
      )}

      <FieldShell name="metric" label="Metric" required error={fieldErrors.metric?.[0]}>
        <Select name="metric" value={metric} onValueChange={(v) => setMetric(v as typeof metric)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="revenue_cents">Revenue (dollars)</SelectItem>
            <SelectItem value="venue_count">Venues confirmed</SelectItem>
            <SelectItem value="emails_sent">Emails sent</SelectItem>
            <SelectItem value="calls_made">Calls made</SelectItem>
            <SelectItem value="confirmations">Confirmations</SelectItem>
            <SelectItem value="replies_received">Replies received</SelectItem>
          </SelectContent>
        </Select>
      </FieldShell>

      <FieldShell
        name="targetValueDisplay"
        label={isRevenue ? "Target ($)" : "Target (count)"}
        required
        error={fieldErrors.targetValueDisplay?.[0]}
        hint={
          isRevenue
            ? "Enter whole dollars (e.g. 50000 for $50k). Cents are not tracked at the goal level."
            : "Enter a whole-number target."
        }
      >
        <Input
          id="targetValueDisplay"
          name="targetValueDisplay"
          type="number"
          min={1}
          step={1}
          required
          defaultValue={initial?.targetValueDisplay ?? ""}
          placeholder={isRevenue ? "50000" : "100"}
        />
      </FieldShell>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FieldShell
          name="periodStart"
          label="Period start"
          required
          error={fieldErrors.periodStart?.[0]}
        >
          <Input
            id="periodStart"
            name="periodStart"
            type="date"
            required
            defaultValue={initial?.periodStart ?? ""}
          />
        </FieldShell>
        <FieldShell name="periodEnd" label="Period end" required error={fieldErrors.periodEnd?.[0]}>
          <Input
            id="periodEnd"
            name="periodEnd"
            type="date"
            required
            defaultValue={initial?.periodEnd ?? ""}
          />
        </FieldShell>
      </div>

      <div className="flex items-center gap-3 border-zinc-200 border-t pt-6 dark:border-zinc-800">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {mode === "create" ? "Create goal" : "Save changes"}
        </Button>
        <Link
          href="/goals"
          className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
