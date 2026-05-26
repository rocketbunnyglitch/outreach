"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";

export interface ScopeOption {
  id: string;
  label: string;
}

interface Props {
  campaigns: ScopeOption[];
  outreachBrands: ScopeOption[];
  crawlBrands: ScopeOption[];
  cityCampaigns: ScopeOption[];
  staff: ScopeOption[];
  defaultScope?: "campaign" | "outreach_brand" | "crawl_brand" | "city_campaign" | "staff_weekly";
  defaultScopeId?: string;
  disabled?: boolean;
}

/**
 * Pair of selects: first picks the scope (campaign / brand / etc), the
 * second changes to show options of that type. The form receives
 * `scope` and `scopeId` as hidden inputs that update with the user's pick.
 */
export function GoalScopePicker({
  campaigns,
  outreachBrands,
  crawlBrands,
  cityCampaigns,
  staff,
  defaultScope = "campaign",
  defaultScopeId,
  disabled,
}: Props) {
  const [scope, setScope] = useState(defaultScope);
  const [scopeId, setScopeId] = useState(defaultScopeId ?? "");

  const optionsForScope: Record<typeof scope, ScopeOption[]> = {
    campaign: campaigns,
    outreach_brand: outreachBrands,
    crawl_brand: crawlBrands,
    city_campaign: cityCampaigns,
    staff_weekly: staff,
  };

  function handleScopeChange(next: typeof scope) {
    setScope(next);
    setScopeId(""); // clear scopeId when scope changes
  }

  const options = optionsForScope[scope] ?? [];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="scopeId" value={scopeId} />
      <Select
        value={scope}
        onValueChange={handleScopeChange as (v: string) => void}
        disabled={disabled}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="campaign">Campaign</SelectItem>
          <SelectItem value="city_campaign">City × Campaign</SelectItem>
          <SelectItem value="outreach_brand">Outreach brand</SelectItem>
          <SelectItem value="crawl_brand">Crawl brand</SelectItem>
          <SelectItem value="staff_weekly">Staff member (weekly)</SelectItem>
        </SelectContent>
      </Select>
      <Select value={scopeId} onValueChange={setScopeId} disabled={disabled}>
        <SelectTrigger>
          <SelectValue placeholder={`Pick ${scope.replace("_", " ")}`} />
        </SelectTrigger>
        <SelectContent>
          {options.length === 0 ? (
            <SelectItem value="_none" disabled>
              No {scope.replace("_", " ")} records yet
            </SelectItem>
          ) : (
            options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    </div>
  );
}
