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

interface VenueOpt {
  id: string;
  name: string;
  cityName: string;
}
interface EventOpt {
  id: string;
  eventDate: string;
}

interface Props {
  templateId: string;
  outreachBrandId: string;
  currentPreviewVenueId: string | undefined;
  currentPreviewEventId: string | undefined;
  venues: VenueOpt[];
  events: EventOpt[];
  subjectRendered: string;
  bodyRendered: string;
  unresolved: string[];
}

/**
 * Server-rendered template preview with a client-driven venue/event picker.
 *
 * Changing the venue or event navigates with new query params, so the
 * server re-renders the template against the new context. This keeps the
 * render engine server-only — easier to verify, easier to debug — at the
 * cost of one extra round-trip per picker change. Worth it.
 */
export function PreviewPane({
  templateId,
  currentPreviewVenueId,
  currentPreviewEventId,
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
          <Eye className="h-5 w-5 text-stone-400" />
          Live preview
        </h2>
        <span className="font-mono text-stone-500 text-xs uppercase tracking-widest">
          {isPending ? "rendering…" : "rendered"}
        </span>
      </header>

      {/* Context picker */}
      <Card className="flex flex-col gap-4 p-5">
        <p className="font-medium text-stone-500 text-xs uppercase tracking-widest">
          Preview context
        </p>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="previewVenueId">Venue</Label>
            <Select
              value={currentPreviewVenueId ?? venues[0]?.id ?? ""}
              onValueChange={(v) => navigate({ previewVenueId: v, previewEventId: undefined })}
            >
              <SelectTrigger id="previewVenueId">
                <SelectValue placeholder="Pick a venue" />
              </SelectTrigger>
              <SelectContent>
                {venues.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                    <span className="ml-2 text-stone-500 text-xs">{v.cityName}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="previewEventId">Event (linked to this venue)</Label>
            <Select
              value={currentPreviewEventId ?? events[0]?.id ?? "_none"}
              onValueChange={(v) => navigate({ previewEventId: v === "_none" ? undefined : v })}
              disabled={events.length === 0}
            >
              <SelectTrigger id="previewEventId">
                <SelectValue
                  placeholder={
                    events.length === 0 ? "No events linked to this venue" : "Pick an event"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">— No event context —</SelectItem>
                {events.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.eventDate}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {/* Rendered preview */}
      <Card className="flex flex-col gap-0 overflow-hidden border-stone-300 dark:border-stone-700">
        <header className="flex items-center justify-between gap-3 border-stone-200 border-b bg-stone-50 px-5 py-2.5 dark:border-stone-800 dark:bg-stone-900">
          <span className="inline-flex items-center gap-2 font-mono text-stone-500 text-xs uppercase tracking-widest">
            <Mail className="h-3.5 w-3.5" /> rendered output
          </span>
        </header>
        <div className="flex flex-col">
          <div className="border-stone-100 border-b px-5 py-3 dark:border-stone-900">
            <p className="font-mono text-[10px] text-stone-400 uppercase tracking-widest">
              Subject
            </p>
            <p className="mt-1 font-medium text-base">{subjectRendered}</p>
          </div>
          <div className="px-5 py-4">
            <p className="font-mono text-[10px] text-stone-400 uppercase tracking-widest">Body</p>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-stone-700 leading-relaxed dark:text-stone-300">
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
                {unresolved.length} unresolved {unresolved.length === 1 ? "field" : "fields"} in
                this preview
              </p>
              <p className="mt-1 text-xs">
                These render as <code>[??path??]</code> markers. Either pick a more complete preview
                context, or fix the field paths in the template below.
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
