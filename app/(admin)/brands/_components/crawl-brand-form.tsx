"use client";

import {
  FieldRow,
  FieldShell,
  FormSection,
  SecretConfiguredHint,
} from "@/app/(admin)/_components/form-field";
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
import type { CrawlBrand, OutreachBrand } from "@/db/schema";
import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

type FormState =
  | { ok: true; data: { id: string; slug?: string } }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }
  | null;

interface CrawlBrandFormProps {
  initial?: CrawlBrand;
  outreachBrands: Pick<OutreachBrand, "id" | "displayName">[];
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
}

export function CrawlBrandForm({ initial, outreachBrands, action }: CrawlBrandFormProps) {
  const [state, formAction] = useActionState<FormState, FormData>(action, null);
  const fieldErrors = state && state.ok === false ? (state.fieldErrors ?? {}) : {};
  const isEdit = !!initial;
  const hasEventbriteToken = !!initial?.eventbriteApiToken;

  return (
    <form action={formAction} className="flex flex-col gap-10">
      {state && !state.ok && state.error && <Alert tone="error">{state.error}</Alert>}

      <FormSection
        title="Identity"
        description="Customer-facing name and category. Geography is enforced at campaign assignment."
      >
        <FieldRow>
          <FieldShell
            name="displayName"
            label="Display name"
            required
            error={fieldErrors.displayName?.[0]}
          >
            <Input
              id="displayName"
              name="displayName"
              defaultValue={initial?.displayName ?? ""}
              placeholder="Fright Crawl"
            />
          </FieldShell>

          <FieldShell
            name="slug"
            label="Slug"
            required
            hint="Used internally. Lowercase, hyphens only."
            error={fieldErrors.slug?.[0]}
          >
            <Input
              id="slug"
              name="slug"
              defaultValue={initial?.slug ?? ""}
              placeholder="fright-crawl"
              disabled={isEdit}
            />
          </FieldShell>
        </FieldRow>

        <FieldRow>
          <FieldShell
            name="holidayType"
            label="Holiday"
            required
            error={fieldErrors.holidayType?.[0]}
          >
            <Select name="holidayType" defaultValue={initial?.holidayType}>
              <SelectTrigger id="holidayType">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="halloween">Halloween</SelectItem>
                <SelectItem value="newyears">New Year's Eve</SelectItem>
                <SelectItem value="stpaddys">St. Patrick's Day</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </FieldShell>

          <FieldShell
            name="geography"
            label="Geography"
            required
            hint="Toronto-only brands can't be used outside Toronto."
            error={fieldErrors.geography?.[0]}
          >
            <Select name="geography" defaultValue={initial?.geography}>
              <SelectTrigger id="geography">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="international">International</SelectItem>
                <SelectItem value="toronto">Toronto-only</SelectItem>
              </SelectContent>
            </Select>
          </FieldShell>
        </FieldRow>
      </FormSection>

      <FormSection
        title="Public presence"
        description="What customers see on Eventbrite, posters, and external map pages."
      >
        <FieldShell
          name="publicDomain"
          label="Public domain"
          hint="Where the customer-facing brand site lives, if any."
          error={fieldErrors.publicDomain?.[0]}
        >
          <Input
            id="publicDomain"
            name="publicDomain"
            defaultValue={initial?.publicDomain ?? ""}
            placeholder="frightcrawl.com"
          />
        </FieldShell>

        <FieldRow>
          <FieldShell
            name="primaryColorHex"
            label="Primary color"
            hint="Hex like #ff6b35."
            error={fieldErrors.primaryColorHex?.[0]}
          >
            <ColorInput
              id="primaryColorHex"
              name="primaryColorHex"
              defaultValue={initial?.primaryColorHex ?? ""}
            />
          </FieldShell>

          <FieldShell
            name="accentColorHex"
            label="Accent color"
            error={fieldErrors.accentColorHex?.[0]}
          >
            <ColorInput
              id="accentColorHex"
              name="accentColorHex"
              defaultValue={initial?.accentColorHex ?? ""}
            />
          </FieldShell>
        </FieldRow>

        <FieldShell name="tagline" label="Tagline" hint="One short line.">
          <Input
            id="tagline"
            name="tagline"
            defaultValue={initial?.tagline ?? ""}
            placeholder="Premium Halloween crawls in 100+ cities"
          />
        </FieldShell>

        <FieldShell name="publicFooterText" label="Public footer text">
          <Textarea
            id="publicFooterText"
            name="publicFooterText"
            defaultValue={initial?.publicFooterText ?? ""}
            rows={3}
          />
        </FieldShell>
      </FormSection>

      <FormSection
        title="Eventbrite"
        description="One organization per crawl brand (DECISIONS.md#010)."
      >
        <FieldShell name="eventbriteOrganizationId" label="Organization ID">
          <Input
            id="eventbriteOrganizationId"
            name="eventbriteOrganizationId"
            defaultValue={initial?.eventbriteOrganizationId ?? ""}
          />
        </FieldShell>

        <FieldShell name="eventbriteApiToken" label="API token">
          <Input
            id="eventbriteApiToken"
            name="eventbriteApiToken"
            type="password"
            autoComplete="off"
            placeholder={hasEventbriteToken ? "•••••••• (configured)" : ""}
          />
          <SecretConfiguredHint configured={hasEventbriteToken} />
        </FieldShell>
      </FormSection>

      <FormSection title="Operations">
        <FieldShell
          name="defaultOutreachBrandId"
          label="Default outreach brand"
          hint="When planning a campaign, this brand pre-fills as the outreach side."
        >
          <Select
            name="defaultOutreachBrandId"
            defaultValue={initial?.defaultOutreachBrandId ?? "_none"}
          >
            <SelectTrigger id="defaultOutreachBrandId">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">— None —</SelectItem>
              {outreachBrands.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldShell>

        <FieldRow>
          <FieldShell
            name="templateVersion"
            label="Template version"
            hint="Bump when poster or public assets change materially."
          >
            <Input
              id="templateVersion"
              name="templateVersion"
              defaultValue={initial?.templateVersion ?? "v1"}
            />
          </FieldShell>

          <FieldShell name="status" label="Status">
            <Select name="status" defaultValue={initial?.status ?? "active"}>
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="retired">Retired</SelectItem>
              </SelectContent>
            </Select>
          </FieldShell>
        </FieldRow>

        <div className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex flex-col gap-0.5">
            <Label htmlFor="publicAssetsEnabled">Public assets enabled</Label>
            <p className="text-xs text-zinc-500">
              Disable to pause public asset regeneration without retiring the brand.
            </p>
          </div>
          {/* Hidden false-input comes first; the Switch's "true" value
              overrides when checked (formToObject uses the last entry).
              When unchecked, only the false value is submitted. */}
          <input type="hidden" name="publicAssetsEnabled" value="false" />
          <Switch
            name="publicAssetsEnabled"
            value="true"
            defaultChecked={initial?.publicAssetsEnabled ?? true}
            id="publicAssetsEnabled"
          />
        </div>
      </FormSection>

      <div className="flex items-center justify-end gap-3 border-zinc-200 border-t pt-6 dark:border-zinc-800">
        <Button asChild variant="ghost">
          <Link href="/brands">Cancel</Link>
        </Button>
        <SubmitButton isEdit={isEdit} />
      </div>
    </form>
  );
}

function ColorInput({
  id,
  name,
  defaultValue,
}: {
  id: string;
  name: string;
  defaultValue: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        name={name}
        defaultValue={defaultValue}
        placeholder="#ff6b35"
        className="font-mono"
      />
      {defaultValue && (
        <div
          className="h-9 w-9 shrink-0 rounded-md border border-zinc-200 dark:border-zinc-800"
          style={{ backgroundColor: defaultValue }}
          aria-hidden
        />
      )}
    </div>
  );
}

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : isEdit ? "Save changes" : "Create crawl brand"}
    </Button>
  );
}
