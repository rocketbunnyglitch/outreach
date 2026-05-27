"use client";

import { Alert } from "@/components/ui/alert";
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
import type { CityProgressRow } from "@/lib/city-progress";
import { X } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { BulkAddCities } from "./bulk-add-cities";
import { CityProgressCard } from "./city-progress-card";

interface CityOption {
  id: string;
  name: string;
  region: string | null;
}

interface CityCampaignRow {
  id: string;
  cityName: string;
  cityRegion: string | null;
  priority: number;
  targetVenueCount: number;
  salesGoalCents: bigint | null;
  status: string;
  leadStaffName: string | null;
}

interface Props {
  campaignId: string;
  cityCampaigns: CityCampaignRow[];
  progressRows: CityProgressRow[];
  unassignedCities: CityOption[];
  addAction: (prev: unknown, fd: FormData) => Promise<{ ok: boolean; error?: string }>;
}

/**
 * "Cities in this campaign" inline section on the campaign edit page.
 * Lets the operator pick a city + priority and add it, and shows existing
 * city-campaigns with a link to drill into each.
 */
export function CityCampaignsSection({
  campaignId,
  cityCampaigns,
  progressRows,
  unassignedCities,
  addAction,
}: Props) {
  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="font-semibold text-2xl tracking-tight ">Cities</h2>
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-zinc-500 uppercase tracking-widest">
            {cityCampaigns.length} {cityCampaigns.length === 1 ? "city" : "cities"}
          </span>
        </div>
      </header>

      <BulkAddCities
        campaignId={campaignId}
        unassignedCities={unassignedCities}
        renderManualForm={() => (
          <AddCityForm
            campaignId={campaignId}
            unassignedCities={unassignedCities}
            action={addAction}
            onCancel={() => {
              /* manual form has no cancel here — embedded in tab */
            }}
          />
        )}
      />

      {cityCampaigns.length === 0 ? (
        <Card className="border-dashed bg-transparent p-6 text-center text-sm text-zinc-500">
          No cities in this campaign yet. Add one to start planning events.
        </Card>
      ) : (
        <ol className="flex flex-col gap-2">
          {progressRows.map((row) => (
            <li key={row.cityCampaignId}>
              <CityProgressCard row={row} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function AddCityForm({
  campaignId,
  unassignedCities,
  action,
  onCancel,
}: {
  campaignId: string;
  unassignedCities: CityOption[];
  action: Props["addAction"];
  onCancel: () => void;
}) {
  const [state, formAction] = useActionState(action, null);

  return (
    <Card className="flex flex-col gap-4 p-5">
      <p className="font-medium text-xs text-zinc-500 uppercase tracking-widest">Add city</p>
      {state && !state.ok && state.error && <Alert tone="error">{state.error}</Alert>}
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="campaignId" value={campaignId} />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <Label htmlFor="cityId">City</Label>
            <Select name="cityId" required>
              <SelectTrigger id="cityId">
                <SelectValue placeholder="Pick a city" />
              </SelectTrigger>
              <SelectContent>
                {unassignedCities.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.region ? ` (${c.region})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="priority">Priority</Label>
            <Input
              id="priority"
              name="priority"
              type="number"
              min="1"
              max="10"
              defaultValue="5"
              placeholder="5"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <NumField name="targetVenueCount" label="Target venues" defaultValue={4} />
          <NumField name="targetWristbandCount" label="Wristband (anchor)" defaultValue={1} />
          <NumField name="targetMiddleCount" label="Middle" defaultValue={2} />
          <NumField name="targetFinalCount" label="Final" defaultValue={1} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="salesGoalCents">Sales goal (cents)</Label>
          <Input
            id="salesGoalCents"
            name="salesGoalCents"
            type="number"
            min="0"
            placeholder="500000"
          />
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

function NumField({
  name,
  label,
  defaultValue,
}: { name: string; label: string; defaultValue: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type="number" min="0" defaultValue={defaultValue} />
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Adding…" : "Add"}
    </Button>
  );
}
