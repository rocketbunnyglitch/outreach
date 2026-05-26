"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Clock, GripVertical, Loader2, Plus, Repeat, Trash2 } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { deleteCadenceStep, upsertCadenceStep } from "../_cadence-actions";

interface TemplateOption {
  id: string;
  name: string;
  stage: string;
}

interface StepRow {
  id: string;
  stepNumber: number;
  emailTemplateId: string;
  templateName: string;
  delayDays: number;
  sendHour: number | null;
}

interface Props {
  brandId: string;
  steps: StepRow[];
  templates: TemplateOption[];
}

/**
 * Cadence editor for an outreach brand.
 *
 * Shows existing steps (2+) in order, each with a delete button.
 * 'Add step' opens an inline form for stepNumber = max+1.
 * Step 1 (the cold first-touch) isn't editable here — that's handled
 * by the composer + bulk queue.
 */
export function CadenceEditor({ brandId, steps, templates }: Props) {
  const [adding, setAdding] = useState(false);
  const [_pending, startTransition] = useTransition();

  const nextStepNumber = Math.max(1, ...steps.map((s) => s.stepNumber)) + 1;

  function handleDelete(stepId: string) {
    if (!confirm("Remove this cadence step? In-flight sequences will still complete normally.")) {
      return;
    }
    startTransition(async () => {
      await deleteCadenceStep(stepId);
    });
  }

  return (
    <section className="card-surface p-5">
      <header className="mb-4 flex items-baseline justify-between">
        <div>
          <h2 className="inline-flex items-center gap-2 font-semibold text-lg tracking-tight">
            <Repeat className="h-4 w-4 text-zinc-500" />
            Follow-up cadence
          </h2>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            Phase 3 — auto follow-ups. Steps fire in order with the configured delay (relative to
            the previous send). Sequence stops on reply, bounce, decline, or unsubscribe.
          </p>
        </div>
        {!adding && nextStepNumber <= 10 && (
          <Button type="button" size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-3 w-3" />
            Add step
          </Button>
        )}
      </header>

      {steps.length === 0 ? (
        <p className="rounded-md border border-zinc-300 border-dashed bg-zinc-50/50 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900/30">
          No follow-ups defined yet. Step 1 (cold first-touch) is always manual; add Step 2+ to
          enable auto follow-ups for this brand.
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {steps.map((step) => (
            <li
              key={step.id}
              className="flex items-center gap-3 rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900/40"
            >
              <GripVertical className="h-4 w-4 text-zinc-400" />
              <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
                Step {step.stepNumber}
              </span>
              <span className="flex-1 truncate text-sm">{step.templateName}</span>
              <span className="inline-flex items-center gap-1 font-mono text-[11px] text-zinc-600 tabular-nums dark:text-zinc-400">
                <Clock className="h-3 w-3" />+{step.delayDays}d
                {step.sendHour !== null && ` · ${step.sendHour}:00`}
              </span>
              <button
                type="button"
                onClick={() => handleDelete(step.id)}
                className="text-zinc-400 hover:text-rose-500"
                aria-label="Delete step"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ol>
      )}

      {adding && (
        <AddStepForm
          brandId={brandId}
          stepNumber={nextStepNumber}
          templates={templates}
          onClose={() => setAdding(false)}
        />
      )}
    </section>
  );
}

function AddStepForm({
  brandId,
  stepNumber,
  templates,
  onClose,
}: {
  brandId: string;
  stepNumber: number;
  templates: TemplateOption[];
  onClose: () => void;
}) {
  const [state, doSubmit, pending] = useActionState(upsertCadenceStep, null);
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [delayDays, setDelayDays] = useState("4");
  const [sendHour, setSendHour] = useState("");

  if (state?.ok) onClose();

  return (
    <form
      action={doSubmit}
      className="mt-3 flex flex-col gap-3 rounded-md border border-amber-200 bg-amber-50/40 p-3 dark:border-amber-900/40 dark:bg-amber-950/10"
    >
      <input type="hidden" name="outreachBrandId" value={brandId} />
      <input type="hidden" name="stepNumber" value={stepNumber} />
      <p className="font-mono text-[10px] text-zinc-600 uppercase tracking-widest">
        Adding step {stepNumber}
      </p>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            Template
          </span>
          <Select value={templateId} onValueChange={setTemplateId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name} · {t.stage}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input type="hidden" name="emailTemplateId" value={templateId} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            Delay (days)
          </span>
          <Input
            name="delayDays"
            type="number"
            min={0}
            max={90}
            value={delayDays}
            onChange={(e) => setDelayDays(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-widest">
            Send hour (optional)
          </span>
          <Input
            name="sendHour"
            type="number"
            min={0}
            max={23}
            placeholder="e.g. 10"
            value={sendHour}
            onChange={(e) => setSendHour(e.target.value)}
          />
        </label>
      </div>
      {state && !state.ok && state.error && <p className="text-rose-500 text-xs">{state.error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={pending || !templateId}>
          {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save step"}
        </Button>
      </div>
    </form>
  );
}
