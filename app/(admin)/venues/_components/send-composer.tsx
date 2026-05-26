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
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/form-utils";
import { type OutreachPhase, PHASE_LABELS, phaseCapability } from "@/lib/outreach-phase";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  Mail,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useActionState, useEffect, useState } from "react";

interface BrandOption {
  id: string;
  displayName: string;
  outreachPhase: OutreachPhase;
}

interface TemplateOption {
  id: string;
  name: string;
  stage: string;
  subjectTemplate: string;
  bodyTemplateText: string;
  bodyTemplateHtml: string | null;
}

interface InboxStatus {
  /** Render context — staffOutreachEmailId if connected, null otherwise */
  inboxId: string | null;
  emailAddress: string | null;
  mode: "live" | "dev" | "no_inbox";
  throttleOk: boolean;
  throttleMessage?: string;
  effectiveDailyCap?: number;
  sent24h?: number;
  warmupDay?: number | null;
}

interface Props {
  venueId: string;
  venueEmail: string | null;
  brands: BrandOption[];
  defaultBrandId: string | null;
  /** Resolved venue + city + campaign context for merge fields */
  initialPreviewVars: {
    venueName: string;
    cityName: string;
    venueAddress: string | null;
    venueWebsite: string | null;
    staffFirstName: string;
    staffFullName: string;
  };
  /** Per-brand: templates + current inbox status for the logged-in staffer */
  brandConfig: Record<
    string,
    {
      templates: TemplateOption[];
      inbox: InboxStatus;
    }
  >;
  sendAction: (
    prev: unknown,
    formData: FormData,
  ) => Promise<ActionResult<{ outreachLogId: string; mode: string }>>;
}

/**
 * Phase 1 send composer.
 *
 * Flow:
 *   1. Operator picks brand (defaults to most-recent or only-option)
 *   2. Templates for that brand load in the dropdown
 *   3. Pick a template → engine renders the merge fields → editable
 *      subject + body appear
 *   4. Throttle status shown live (warm-up day, remaining cap, etc.)
 *   5. Send button submits to sendOutreachEmail server action
 *
 * Modes the button can be in:
 *   - "Send" (live) — Gmail OAuth connected + throttle ok
 *   - "Log send (dev mode)" — no Gmail OAuth yet
 *   - "Open in Gmail" (Phase 1 manual fallback) — opens mailto:
 *   - Disabled with reason — throttle denied / not connected
 *
 * If brand is at Phase 1, default send mode is "Open in Gmail" (manual)
 * with the actual API send as a secondary option. Higher phases default
 * to the API send.
 */
export function SendComposer({
  venueId,
  venueEmail,
  brands,
  defaultBrandId,
  initialPreviewVars,
  brandConfig,
  sendAction,
}: Props) {
  const [brandId, setBrandId] = useState<string>(defaultBrandId ?? brands[0]?.id ?? "");
  const [templateId, setTemplateId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [to, setTo] = useState(venueEmail ?? "");
  const [state, doSend, sending] = useActionState(sendAction, null);

  const currentBrand = brands.find((b) => b.id === brandId);
  const config = brandConfig[brandId];
  const phase: OutreachPhase = currentBrand?.outreachPhase ?? 1;

  // Re-render subject + body when template changes
  useEffect(() => {
    if (!templateId || !config) {
      setSubject("");
      setBodyText("");
      return;
    }
    const tpl = config.templates.find((t) => t.id === templateId);
    if (!tpl) return;
    setSubject(renderMerge(tpl.subjectTemplate, initialPreviewVars));
    setBodyText(renderMerge(tpl.bodyTemplateText, initialPreviewVars));
  }, [templateId, config, initialPreviewVars]);

  // Reset template when brand changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: brandId is the trigger, not a dep used inside the effect
  useEffect(() => {
    setTemplateId("");
    setSubject("");
    setBodyText("");
  }, [brandId]);

  if (brands.length === 0) {
    return (
      <section className="card-surface p-5">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No outreach brands configured. Create one in{" "}
          <a href="/brands" className="underline">
            Brands
          </a>{" "}
          to enable email sends.
        </p>
      </section>
    );
  }

  const inbox = config?.inbox;
  const canSend = inbox?.throttleOk ?? false;
  const isLiveMode = inbox?.mode === "live";

  // Phase 1 default = manual Gmail (mailto). Anything ≥2 = API send.
  const preferManual = phase === 1;

  function buildMailtoUrl(): string {
    const params = new URLSearchParams();
    params.set("subject", subject);
    params.set("body", bodyText);
    return `mailto:${encodeURIComponent(to)}?${params.toString()}`;
  }

  function handleManualOpen() {
    // Open the user's default mail client. We don't log here — they
    // need to click "Mark as sent" after sending manually.
    window.open(buildMailtoUrl(), "_blank");
  }

  return (
    <section className="card-surface p-5">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="inline-flex items-center gap-2 font-semibold text-lg tracking-tight">
          <Mail className="h-4 w-4 text-zinc-500" />
          Send outreach email
        </h2>
        {currentBrand && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            <ShieldCheck className="h-3 w-3" />
            Phase {phase} · {PHASE_LABELS[phase]}
          </span>
        )}
      </header>

      <form action={doSend} className="flex flex-col gap-4">
        <input type="hidden" name="venueId" value={venueId} />
        <input type="hidden" name="outreachBrandId" value={brandId} />
        <input type="hidden" name="sendKind" value="cold" />

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {/* Brand */}
          {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Radix Select / Input which provide their own ARIA */}
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
              Outreach brand
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
          {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Radix Select / Input which provide their own ARIA */}
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
                <SelectValue
                  placeholder={
                    config && config.templates.length === 0
                      ? "No templates for this brand"
                      : "Pick a template…"
                  }
                />
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

        {/* Inbox status banner */}
        {inbox && <InboxStatusBanner inbox={inbox} brandPhase={phase} />}

        {/* To */}
        {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Radix Select / Input which provide their own ARIA */}
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">To</span>
          <Input
            type="email"
            name="to"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="venue@example.com"
            required
          />
          {!venueEmail && (
            <span className="text-[11px] text-amber-600 dark:text-amber-400">
              No email on file for this venue — enter manually or update the venue first.
            </span>
          )}
        </label>

        {/* Subject */}
        {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Radix Select / Input which provide their own ARIA */}
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            Subject
          </span>
          <Input
            name="subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={templateId ? "" : "Pick a template or write a subject"}
            required
          />
        </label>

        {/* Body */}
        {/* biome-ignore lint/a11y/noLabelWithoutControl: wraps Radix Select / Input which provide their own ARIA */}
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            Body
          </span>
          <Textarea
            name="bodyText"
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            rows={10}
            placeholder={templateId ? "" : "Pick a template or write the email body"}
            required
            className="font-sans text-sm"
          />
          <span className="text-[10px] text-zinc-500">
            Merge fields like{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">{"{{venue.name}}"}</code>{" "}
            are filled in when you pick a template. Edit freely from there.
          </span>
        </label>

        {/* Hidden HTML body — for now, same as text. Future: rich editor. */}
        <input type="hidden" name="bodyHtml" value={textToHtml(bodyText)} />

        {/* Error from action */}
        {state && !state.ok && state.error && <Alert tone="error">{state.error}</Alert>}
        {state?.ok && (
          <Alert tone="success">
            {state.data?.mode === "dev"
              ? "Logged in dev mode (no Gmail OAuth configured yet). Will go live once credentials land."
              : "Sent."}
          </Alert>
        )}

        {/* Action row */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-zinc-200 border-t pt-4 dark:border-zinc-800">
          <div className="flex flex-col gap-1">
            {!canSend && inbox?.throttleMessage && (
              <p className="inline-flex items-center gap-1.5 text-amber-600 text-xs dark:text-amber-400">
                <AlertCircle className="h-3 w-3" />
                {inbox.throttleMessage}
              </p>
            )}
            {preferManual && (
              <p className="inline-flex items-center gap-1 font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
                <Sparkles className="h-3 w-3" />
                Phase 1: manual send recommended
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Open in Gmail / mailto: */}
            <Button
              type="button"
              variant="outline"
              onClick={handleManualOpen}
              disabled={!to || !subject || !bodyText}
            >
              Open in Mail
            </Button>

            {/* API send */}
            {phaseCapability.canManualSend(phase) && (
              <Button type="submit" disabled={sending || !canSend || (!templateId && !subject)}>
                {sending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Sending…
                  </>
                ) : isLiveMode ? (
                  <>
                    <Send className="h-3.5 w-3.5" />
                    Send via Gmail
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5" />
                    Log send (dev mode)
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}

function InboxStatusBanner({
  inbox,
  brandPhase: _brandPhase,
}: {
  inbox: InboxStatus;
  brandPhase: OutreachPhase;
}) {
  if (inbox.mode === "no_inbox") {
    return (
      <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900/40">
        <p className="text-zinc-600 dark:text-zinc-400">
          No Gmail inbox connected for this brand. Sends will be logged in dev mode until you
          connect at{" "}
          <a href="/settings/inboxes" className="underline">
            Settings → Inboxes
          </a>
          .
        </p>
      </div>
    );
  }

  if (!inbox.throttleOk) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs dark:border-amber-900/40 dark:bg-amber-950/20">
        <p className="font-medium text-amber-900 dark:text-amber-200">
          {inbox.throttleMessage ?? "Send blocked by throttle"}
        </p>
      </div>
    );
  }

  // OK to send — show the counter
  const cap = inbox.effectiveDailyCap ?? 0;
  const sent = inbox.sent24h ?? 0;
  const remaining = cap - sent;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs dark:border-emerald-900/40 dark:bg-emerald-950/20">
      <p className="inline-flex items-center gap-1.5 text-emerald-900 dark:text-emerald-200">
        <CheckCircle2 className="h-3 w-3" />
        Sending from <strong>{inbox.emailAddress}</strong>
      </p>
      <p className="inline-flex items-center gap-2 font-mono text-[10px] text-emerald-800 uppercase tracking-widest dark:text-emerald-300">
        {inbox.warmupDay !== null && inbox.warmupDay !== undefined && (
          <span>Warm-up {inbox.warmupDay}/14</span>
        )}
        <span className="tabular-nums">
          {sent}/{cap} today · {remaining} left
        </span>
      </p>
    </div>
  );
}

/**
 * Lightweight {{var}} renderer for the live preview. Matches the keys
 * the parent passes in initialPreviewVars. Server-side, lib/template-render
 * handles the real merge with the full context.
 */
function renderMerge(template: string, vars: Record<string, string | null>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, path) => {
    // Support dotted paths like venue.name, city.name
    const flat = path.split(".").pop() ?? path;
    const value = vars[flat] ?? vars[path];
    return value ?? match;
  });
}

/**
 * Bare-minimum text → HTML — wraps paragraphs and turns newlines into <br>.
 * Server normalizes this further before sending.
 */
function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
