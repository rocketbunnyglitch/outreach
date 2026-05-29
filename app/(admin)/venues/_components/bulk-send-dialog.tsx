"use client";

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
import { type OutreachPhase, phaseCapability } from "@/lib/outreach-phase";
import { computeSendSchedule, formatGap } from "@/lib/send-spacing";
import { Loader2, Send, X } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";

interface BrandOption {
  id: string;
  displayName: string;
  outreachPhase: OutreachPhase;
}

interface TemplateOption {
  id: string;
  name: string;
  stage: string;
}

interface InboxStatus {
  inboxId: string | null;
  minSecondsBetweenSends: number;
  effectiveDailyCap: number;
  sent24h: number;
  warmupDay: number | null;
}

interface Props {
  selectedVenueIds: string[];
  brands: BrandOption[];
  brandConfig: Record<
    string,
    {
      templates: TemplateOption[];
      inbox: InboxStatus | null;
    }
  >;
  queueAction: (
    prev: unknown,
    formData: FormData,
  ) => Promise<
    ActionResult<{
      batchId: string;
      count: number;
      firstScheduledFor: string;
      lastScheduledFor: string;
      avgGapSeconds: number;
    }>
  >;
  onClose: () => void;
}

/**
 * Bulk send queue dialog.
 *
 * Workflow:
 *   1. Operator has N venues selected on the list page, clicks
 *      'Queue bulk send' → this dialog opens
 *   2. Picks brand + template + window
 *   3. Live schedule preview: 'These 27 venues will go out between 10:00
 *      and 4:00pm, average gap ~13 minutes'
 *   4. Click 'Queue' → server action inserts scheduled_sends rows
 *
 * Phase 2 gate: if the brand is at Phase 1, this dialog refuses with a
 * clear 'raise the phase' message. Phase 1 operators can still send
 * one at a time via the composer.
 */
export function BulkSendDialog({
  selectedVenueIds,
  brands,
  brandConfig,
  queueAction,
  onClose,
}: Props) {
  const [brandId, setBrandId] = useState<string>(brands[0]?.id ?? "");
  const [templateId, setTemplateId] = useState<string>("");
  const [batchLabel, setBatchLabel] = useState("");
  // Default window: 10am-4pm today (in local TZ)
  const [windowStart, setWindowStart] = useState(() => defaultWindowStart());
  const [windowEnd, setWindowEnd] = useState(() => defaultWindowEnd());
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Awaited<ReturnType<typeof queueAction>> | null>(null);

  const brand = brands.find((b) => b.id === brandId);
  const config = brandConfig[brandId];
  const phase = brand?.outreachPhase ?? 1;
  const canBulk = phaseCapability.canBulkQueue(phase);
  const inbox = config?.inbox ?? null;

  // Schedule preview — recompute on input changes
  const preview = useMemo(() => {
    if (!inbox || selectedVenueIds.length === 0) return null;
    try {
      return computeSendSchedule({
        count: selectedVenueIds.length,
        windowStart: new Date(windowStart),
        windowEnd: new Date(windowEnd),
        minSpacingSeconds: inbox.minSecondsBetweenSends,
        jitterSeconds: Math.round(inbox.minSecondsBetweenSends * 0.25),
        seed: 42, // stable preview; queue action uses random seed
      });
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Scheduling error" };
    }
  }, [inbox, selectedVenueIds.length, windowStart, windowEnd]);

  // Reset template when brand changes
  // Reset template when brand changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: brandId is the trigger
  useEffect(() => setTemplateId(""), [brandId]);

  const remainingCap = inbox ? inbox.effectiveDailyCap - inbox.sent24h : 0;
  const exceedsCap = inbox && selectedVenueIds.length > remainingCap;

  function handleSubmit() {
    if (!brandId || !templateId) return;
    const fd = new FormData();
    fd.set("outreachBrandId", brandId);
    fd.set("emailTemplateId", templateId);
    fd.set("venueIds", selectedVenueIds.join(","));
    fd.set("windowStart", new Date(windowStart).toISOString());
    fd.set("windowEnd", new Date(windowEnd).toISOString());
    if (batchLabel) fd.set("batchLabel", batchLabel);

    startTransition(async () => {
      const r = await queueAction(null, fd);
      setResult(r);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="card-surface mx-4 w-full max-w-2xl p-6">
        <header className="mb-4 flex items-baseline justify-between">
          <h2 className="font-semibold text-xl tracking-tight">
            Queue bulk send
            <span className="ml-2 font-mono font-normal text-xs text-zinc-500">
              {selectedVenueIds.length} venues
            </span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {!canBulk && (
          <Alert tone="info">
            Brand <strong>{brand?.displayName}</strong> is at Phase {phase}. Bulk queue requires
            Phase 2 (Controlled send). Raise the phase in Brands → Edit when ready.
          </Alert>
        )}

        {result?.ok && (
          <Alert tone="success">
            Queued {result.data?.count} sends. Average gap{" "}
            {formatGap(result.data?.avgGapSeconds ?? 0)}.{" "}
            <a href={`/send-queue?batch=${result.data?.batchId}`} className="underline">
              View batch →
            </a>
          </Alert>
        )}
        {result && !result.ok && result.error && <Alert tone="error">{result.error}</Alert>}

        {!result?.ok && (
          <div className="flex flex-col gap-4">
            {/* Brand */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Radix Select / Input controls */}
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
                  Brand
                </span>
                <Select value={brandId} onValueChange={setBrandId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {brands.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.displayName} (Phase {b.outreachPhase})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              {/* Template */}
              {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Radix Select / Input controls */}
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
                  Template
                </span>
                <Select
                  value={templateId}
                  onValueChange={setTemplateId}
                  disabled={!config || config.templates.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a template…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(config?.templates ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} · {t.stage}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>

            {/* Window */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Radix Select / Input controls */}
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
                  Window start
                </span>
                <Input
                  type="datetime-local"
                  value={windowStart}
                  onChange={(e) => setWindowStart(e.target.value)}
                />
              </label>
              {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Radix Select / Input controls */}
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
                  Window end
                </span>
                <Input
                  type="datetime-local"
                  value={windowEnd}
                  onChange={(e) => setWindowEnd(e.target.value)}
                />
              </label>
            </div>

            {/* Batch label */}
            {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Radix Select / Input controls */}
            <label className="flex flex-col gap-1.5">
              <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
                Batch label (optional)
              </span>
              <Input
                value={batchLabel}
                onChange={(e) => setBatchLabel(e.target.value)}
                placeholder="Halloween cold batch #1"
              />
            </label>

            {/* Schedule preview */}
            {inbox && (
              <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-900/40">
                {preview && "error" in preview ? (
                  <p className="text-rose-600 dark:text-rose-400">{preview.error}</p>
                ) : preview ? (
                  <>
                    <p className="text-zinc-700 dark:text-zinc-300">
                      <strong>{selectedVenueIds.length}</strong> sends · first at{" "}
                      <strong>
                        {preview.scheduledTimestamps[0]?.toLocaleTimeString([], {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </strong>
                      , last at{" "}
                      <strong>
                        {preview.scheduledTimestamps[
                          preview.scheduledTimestamps.length - 1
                        ]?.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </strong>{" "}
                      · avg gap <strong>{formatGap(preview.avgGapSeconds)}</strong>
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-zinc-500 uppercase tabular-nums tracking-widest">
                      Inbox cap today: {inbox.sent24h}/{inbox.effectiveDailyCap} · {remainingCap}{" "}
                      remaining
                      {inbox.warmupDay !== null && ` · warm-up day ${inbox.warmupDay}/14`}
                    </p>
                    {exceedsCap && (
                      <p className="mt-2 text-rose-700 dark:text-rose-300">
                        Batch ({selectedVenueIds.length}) exceeds remaining daily cap (
                        {remainingCap}). Worker will fire what fits and pause the rest until
                        tomorrow's window.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-zinc-500">Select brand to preview schedule.</p>
                )}
              </div>
            )}

            {!inbox && config && (
              <Alert tone="info">
                No connected inbox for this brand. Connect Gmail in{" "}
                <a href="/settings/inboxes" className="underline">
                  Settings → Inboxes
                </a>{" "}
                first.
              </Alert>
            )}

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 border-zinc-200 border-t pt-4 dark:border-zinc-800">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={
                  pending ||
                  !canBulk ||
                  !brandId ||
                  !templateId ||
                  !inbox ||
                  selectedVenueIds.length === 0 ||
                  !!(preview && "error" in preview)
                }
              >
                {pending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Queueing…
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5" />
                    Queue {selectedVenueIds.length} sends
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function defaultWindowStart(): string {
  const now = new Date();
  // 10am local today (or tomorrow if it's already past 10)
  const target = new Date(now);
  target.setHours(10, 0, 0, 0);
  if (target < now) target.setDate(target.getDate() + 1);
  return formatLocalDateTime(target);
}

function defaultWindowEnd(): string {
  const start = new Date(defaultWindowStart());
  start.setHours(16, 0, 0, 0); // 4pm
  return formatLocalDateTime(start);
}

function formatLocalDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
