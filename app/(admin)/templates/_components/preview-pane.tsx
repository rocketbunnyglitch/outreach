"use client";

import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertCircle, Eye, Mail } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

interface CityOpt {
  id: string;
  cityName: string;
}
interface VenueOpt {
  id: string;
  name: string;
}
interface EventOpt {
  id: string;
  label: string;
}

interface Props {
  templateId: string;
  isCampaignScoped: boolean;
  currentCityCampaignId: string | undefined;
  currentVenueId: string | undefined;
  currentEventId: string | undefined;
  cities: CityOpt[];
  venues: VenueOpt[];
  events: EventOpt[];
  subjectRendered: string;
  bodyRendered: string;
  unresolved: string[];
}

/**
 * Server-rendered template preview with a client-driven city/venue/event
 * picker. Templates are campaign-scoped, so the context follows the real data
 * path: pick a city the campaign runs in, then a venue in that city. The event
 * is optional -- the merge builder falls back to the city's primary crawl.
 *
 * Changing a picker navigates with new query params so the server re-renders
 * the template against the new context, keeping the render engine server-only.
 */
export function PreviewPane({
  templateId,
  isCampaignScoped,
  currentCityCampaignId,
  currentVenueId,
  currentEventId,
  cities,
  venues,
  events,
  subjectRendered,
  bodyRendered,
  unresolved,
}: Props) {
  const router = useRouter();
  const search = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function navigate(updates: Record<string, string | undefined>) {
    const params = new URLSearchParams(search.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v === undefined || v === "") params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    startTransition(() => {
      router.push(`/templates/${templateId}${qs ? `?${qs}` : ""}`);
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold text-2xl tracking-tight ">
          <Eye className="h-5 w-5 text-zinc-400" />
          Live preview
        </h2>
        <span className="font-mono text-xs text-zinc-500 uppercase tracking-widest">
          {isPending ? "rendering" : "rendered"}
        </span>
      </header>

      {/* Context picker: city -> venue -> (optional) event */}
      <Card className="flex flex-col gap-4 p-5">
        <p className="font-medium text-xs text-zinc-500 uppercase tracking-widest">
          Preview context
        </p>
        {!isCampaignScoped && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            This template is not tied to a campaign, so there are no campaign cities to preview
            against. Merge fields that need venue or crawl data will render blank.
          </p>
        )}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="previewCity">City</Label>
            <Select
              value={currentCityCampaignId ?? cities[0]?.id ?? ""}
              onValueChange={(v) =>
                navigate({
                  previewCityCampaignId: v,
                  previewVenueId: undefined,
                  previewEventId: undefined,
                })
              }
              disabled={cities.length === 0}
            >
              <SelectTrigger id="previewCity">
                <SelectValue
                  placeholder={cities.length === 0 ? "No campaign cities" : "Pick a city"}
                />
              </SelectTrigger>
              <SelectContent>
                {cities.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.cityName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="previewVenue">Venue</Label>
            <Select
              value={currentVenueId ?? venues[0]?.id ?? ""}
              onValueChange={(v) => navigate({ previewVenueId: v })}
              disabled={venues.length === 0}
            >
              <SelectTrigger id="previewVenue">
                <SelectValue
                  placeholder={venues.length === 0 ? "No venues in this city" : "Pick a venue"}
                />
              </SelectTrigger>
              <SelectContent>
                {venues.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="previewEvent">Crawl (optional)</Label>
            <Select
              value={currentEventId ?? "_none"}
              onValueChange={(v) => navigate({ previewEventId: v === "_none" ? undefined : v })}
              disabled={events.length === 0}
            >
              <SelectTrigger id="previewEvent">
                <SelectValue
                  placeholder={events.length === 0 ? "No crawls for this city" : "Primary crawl"}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">Primary crawl (auto)</SelectItem>
                {events.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {/* Rendered preview */}
      <Card className="flex flex-col gap-0 overflow-hidden border-zinc-300 dark:border-zinc-700">
        <header className="flex items-center justify-between gap-3 border-zinc-200 border-b bg-zinc-50 px-5 py-2.5 dark:border-zinc-800 dark:bg-zinc-900">
          <span className="inline-flex items-center gap-2 font-mono text-xs text-zinc-500 uppercase tracking-widest">
            <Mail className="h-3.5 w-3.5" /> rendered output
          </span>
        </header>
        <div className="flex flex-col">
          <div className="border-zinc-100 border-b px-5 py-3 dark:border-zinc-900">
            <p className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest">Subject</p>
            <p className="mt-1 font-medium text-base">{subjectRendered}</p>
          </div>
          <div className="px-5 py-4">
            <p className="font-mono text-[10px] text-zinc-400 uppercase tracking-widest">Body</p>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-zinc-700 leading-relaxed dark:text-zinc-300">
              {bodyRendered}
            </pre>
          </div>
        </div>
      </Card>

      {unresolved.length > 0 && (
        <Alert tone="error">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">
              <p className="font-medium">
                {unresolved.length} unknown {unresolved.length === 1 ? "field" : "fields"} in this
                template
              </p>
              <p className="mt-1 text-xs">
                These render as <code>[??path??]</code> markers because the engine has no such merge
                field. Fix the field name in the template below. (Fields that are simply empty for
                this context render blank, not as markers.)
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {unresolved.map((f) => (
                  <li
                    key={f}
                    className="rounded border border-amber-300 bg-amber-100 px-2 py-0.5 font-mono text-[11px] dark:border-amber-800 dark:bg-amber-950"
                  >
                    {`{{${f}}}`}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Alert>
      )}
    </section>
  );
}
