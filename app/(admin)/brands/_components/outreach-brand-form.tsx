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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { OutreachBrand } from "@/db/schema";
import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

type FormState =
  | { ok: true; data: { id: string; slug?: string } }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }
  | null;

interface OutreachBrandFormProps {
  initial?: OutreachBrand;
  /** Bound server action (create or update). */
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
}

export function OutreachBrandForm({ initial, action }: OutreachBrandFormProps) {
  const [state, formAction] = useActionState<FormState, FormData>(action, null);
  const fieldErrors = state && state.ok === false ? (state.fieldErrors ?? {}) : {};
  const isEdit = !!initial;
  const hasPostmark = !!initial?.postmarkServerToken;

  return (
    <form action={formAction} className="flex flex-col gap-10">
      {state && !state.ok && state.error && <Alert tone="error">{state.error}</Alert>}

      <FormSection
        title="Identity"
        description="How venues see this brand in From lines and signatures."
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
              placeholder="Eventsperse"
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
              placeholder="eventsperse"
              disabled={isEdit}
            />
          </FieldShell>
        </FieldRow>

        <FieldShell
          name="emailDomain"
          label="Email domain"
          required
          hint="Send-from domain. Must have SPF/DKIM/DMARC configured in DNS."
          error={fieldErrors.emailDomain?.[0]}
        >
          <Input
            id="emailDomain"
            name="emailDomain"
            defaultValue={initial?.emailDomain ?? ""}
            placeholder="eventsperse.com"
          />
        </FieldShell>
      </FormSection>

      <FormSection
        title="Postmark"
        description="Transactional email provider. One account per outreach brand (DECISIONS.md#015)."
      >
        <FieldRow>
          <FieldShell
            name="postmarkAccountId"
            label="Account ID"
            hint="Reference only — not used to send."
          >
            <Input
              id="postmarkAccountId"
              name="postmarkAccountId"
              defaultValue={initial?.postmarkAccountId ?? ""}
            />
          </FieldShell>

          <FieldShell
            name="postmarkSenderSignature"
            label="Sender signature"
            hint="The From address verified in Postmark."
          >
            <Input
              id="postmarkSenderSignature"
              name="postmarkSenderSignature"
              defaultValue={initial?.postmarkSenderSignature ?? ""}
              placeholder="hello@eventsperse.com"
            />
          </FieldShell>
        </FieldRow>

        <FieldShell name="postmarkServerToken" label="Server token">
          <Input
            id="postmarkServerToken"
            name="postmarkServerToken"
            type="password"
            autoComplete="off"
            placeholder={hasPostmark ? "•••••••• (configured)" : ""}
          />
          <SecretConfiguredHint configured={hasPostmark} />
        </FieldShell>
      </FormSection>

      <FormSection
        title="Email signature"
        description="Appended to every cold and follow-up email sent under this brand."
      >
        <FieldShell name="emailSignatureHtml" label="HTML" hint="Used for the multipart HTML body.">
          <Textarea
            id="emailSignatureHtml"
            name="emailSignatureHtml"
            defaultValue={initial?.emailSignatureHtml ?? ""}
            rows={5}
            placeholder="<p>Best,<br/>The Eventsperse Team</p>"
          />
        </FieldShell>

        <FieldShell
          name="emailSignatureText"
          label="Plain text"
          hint="Used when the recipient's client prefers plain text."
        >
          <Textarea
            id="emailSignatureText"
            name="emailSignatureText"
            defaultValue={initial?.emailSignatureText ?? ""}
            rows={4}
            placeholder="Best,&#10;The Eventsperse Team"
          />
        </FieldShell>
      </FormSection>

      <FormSection title="Other">
        <FieldRow>
          <FieldShell
            name="quoLineE164"
            label="Quo line"
            hint="E.164 format. Phone shown in signature and for Quo calls."
            error={fieldErrors.quoLineE164?.[0]}
          >
            <Input
              id="quoLineE164"
              name="quoLineE164"
              defaultValue={initial?.quoLineE164 ?? ""}
              placeholder="+14165551234"
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

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : isEdit ? "Save changes" : "Create outreach brand"}
    </Button>
  );
}
