"use client";
import { FieldRow, FieldShell, FormSection } from "@/app/(admin)/_components/form-field";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { KNOWN_MERGE_FIELDS, extractMergeFields } from "@/lib/template-render";
import { STAGE_LABELS } from "@/lib/validation/email-templates";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

interface BrandOpt {
  id: string;
  displayName: string;
}

interface Props {
  mode: "create" | "edit";
  initial?: {
    outreachBrandId: string;
    stage: string;
    name: string;
    subjectTemplate: string;
    subjectVariants?: string[] | null;
    bodyTemplateText: string;
    bodyTemplateHtml: string | null;
    isDefaultForStage: boolean;
  };
  brands: BrandOpt[];
  action: (
    prev: unknown,
    fd: FormData,
  ) => Promise<
    | {
        ok: boolean;
        error?: string;
        fieldErrors?: Record<string, string[]>;
      }
    | undefined
  >;
}

export function TemplateForm({ mode, initial, brands, action }: Props) {
  const [state, formAction] = useActionState(action, null);
  const [subject, setSubject] = useState(initial?.subjectTemplate ?? "");
  const [subjectVariants, setSubjectVariants] = useState(
    (initial?.subjectVariants ?? []).join("\n"),
  );
  const [body, setBody] = useState(initial?.bodyTemplateText ?? "");

  // Live extraction of merge fields used in the current draft. Helps
  // operator confirm `{{venue.name}}` is spelled correctly before they hit
  // send.
  const fieldsInUse = Array.from(
    new Set([...extractMergeFields(subject), ...extractMergeFields(body)]),
  ).sort();

  return (
    <form action={formAction} className="flex flex-col gap-8">
      {(() => {
        if (!state || typeof state !== "object" || !("ok" in state)) return null;
        if (state.ok) return null;
        if (!state.error) return null;
        return <Alert tone="error">{state.error}</Alert>;
      })()}

      <FormSection
        title="Scope"
        description={
          mode === "create"
            ? "Templates are unique per (outreach brand, stage, name)."
            : "Brand and stage are locked after creation; only the name is editable here."
        }
      >
        <FieldRow>
          <FieldShell label="Outreach brand" name="outreachBrandId">
            {mode === "create" ? (
              <Select name="outreachBrandId" required>
                <SelectTrigger id="outreachBrandId">
                  <SelectValue placeholder="Pick a brand" />
                </SelectTrigger>
                <SelectContent>
                  {brands.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                disabled
                value={
                  brands.find((b) => b.id === initial?.outreachBrandId)?.displayName ?? "Unknown"
                }
              />
            )}
          </FieldShell>
          <FieldShell label="Stage" name="stage">
            {mode === "create" ? (
              <Select name="stage" required defaultValue="cold">
                <SelectTrigger id="stage">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(STAGE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                disabled
                value={
                  STAGE_LABELS[initial?.stage as keyof typeof STAGE_LABELS] ?? initial?.stage ?? ""
                }
              />
            )}
          </FieldShell>
        </FieldRow>
        <FieldRow>
          <FieldShell label="Template name" name="name">
            <Input
              id="name"
              name="name"
              required
              defaultValue={initial?.name}
              placeholder="Default cold v2"
            />
          </FieldShell>
        </FieldRow>
      </FormSection>

      <FormSection
        title="Subject & body"
        description="Use {{venue.name}} style merge fields. Available fields shown in the sidebar."
      >
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_220px]">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="subjectTemplate">Subject</Label>
              <Input
                id="subjectTemplate"
                name="subjectTemplate"
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Want to host part of our {{event.dateFormatted}} crawl?"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="subjectVariants">Subject A/B variants (optional)</Label>
              <Textarea
                id="subjectVariants"
                name="subjectVariants"
                value={subjectVariants}
                onChange={(e) => setSubjectVariants(e.target.value)}
                rows={3}
                placeholder={
                  "One subject per line. Add 2+ to A/B test.\nWant a stop on our {{city}} crawl?\n{{venue_name}} + our Halloween crawl?"
                }
              />
              <p className="text-xs text-zinc-500">
                When 2+ lines are present, the composer picks one per draft (merge fields render
                normally) and analytics ranks them by reply rate. Leave empty to use the single
                subject above.
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bodyTemplateText">Body (plain text)</Label>
              <Textarea
                id="bodyTemplateText"
                name="bodyTemplateText"
                required
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={14}
                className="font-mono text-sm"
                placeholder={`Hi {{venue.name}} team,\n\n{{staff.displayName}} here from {{outreachBrand.displayName}}. We're producing the {{crawlBrand.displayName}} on {{event.dateFormatted}} in {{city.name}}, and {{venue.name}} would be a perfect fit as one of our stops...`}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bodyTemplateHtml">Body (HTML, optional)</Label>
              <Textarea
                id="bodyTemplateHtml"
                name="bodyTemplateHtml"
                defaultValue={initial?.bodyTemplateHtml ?? ""}
                rows={8}
                className="font-mono text-sm"
                placeholder="<p>Optional HTML version. If blank, plain-text body is used.</p>"
              />
            </div>
          </div>

          <aside className="flex flex-col gap-4">
            <div>
              <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">
                Fields in use ({fieldsInUse.length})
              </p>
              {fieldsInUse.length === 0 ? (
                <p className="mt-2 text-xs text-zinc-400 italic">No merge fields used yet.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1">
                  {fieldsInUse.map((f) => {
                    const known = KNOWN_MERGE_FIELDS.find((k) => k.path === f);
                    return (
                      <li
                        key={f}
                        className={`font-mono text-xs ${
                          known
                            ? "text-zinc-700 dark:text-zinc-300"
                            : "text-rose-600 dark:text-rose-400"
                        }`}
                        title={known?.description ?? "Unknown field"}
                      >
                        {`{{${f}}}`}
                        {!known && " ← unknown"}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="border-zinc-200 border-t pt-4 dark:border-zinc-800">
              <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">
                Available fields
              </p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {KNOWN_MERGE_FIELDS.map((f) => (
                  <li key={f.path} className="flex flex-col">
                    <code className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                      {`{{${f.path}}}`}
                    </code>
                    <span className="text-[10px] text-zinc-500">{f.description}</span>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </FormSection>

      <FormSection title="Behavior">
        <FieldRow>
          <FieldShell
            label="Default for this stage"
            name="isDefaultForStage"
            hint="Exactly one default per (brand, stage). Setting this to true unsets it on any sibling."
          >
            <input type="hidden" name="isDefaultForStage" value="false" />
            <Switch
              id="isDefaultForStage"
              name="isDefaultForStage"
              value="true"
              defaultChecked={initial?.isDefaultForStage ?? false}
            />
          </FieldShell>
        </FieldRow>
      </FormSection>

      <div className="flex justify-end border-zinc-200 border-t pt-6 dark:border-zinc-800">
        <SubmitButton mode={mode} />
      </div>
    </form>
  );
}

function SubmitButton({ mode }: { mode: "create" | "edit" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} size="lg">
      {pending ? "Saving…" : mode === "create" ? "Create template" : "Save changes"}
    </Button>
  );
}
