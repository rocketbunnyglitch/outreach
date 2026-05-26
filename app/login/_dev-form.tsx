"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

interface DevStaff {
  id: string;
  displayName: string;
  primaryEmail: string;
  role: string;
}

type SignInResult = { ok: boolean; error?: string } | null;

interface DevImpersonationFormProps {
  staff: DevStaff[];
  from: string;
  action: (prev: SignInResult, fd: FormData) => Promise<SignInResult>;
}

/**
 * Dev-only sign-in form. Renders one button per active staff_member in the
 * seed. Picking one calls the bound server action which invokes NextAuth's
 * Credentials provider with that staffer's primary_email.
 *
 * In production, this whole component is gated behind authProviderStatus
 * and never rendered.
 */
export function DevImpersonationForm({ staff, from, action }: DevImpersonationFormProps) {
  const [state, formAction] = useActionState<SignInResult, FormData>(action, null);

  if (staff.length === 0) {
    return (
      <Alert tone="info">
        No active staff members seeded. Run <code className="font-mono text-xs">pnpm db:seed</code>{" "}
        first.
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-zinc-500 uppercase tracking-widest">Dev impersonation</p>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-medium text-[10px] text-amber-800 uppercase tracking-wider dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          Dev only
        </span>
      </div>
      <p className="text-xs text-zinc-500">
        Pick a seeded staff member to sign in as. This provider is disabled in production builds.
      </p>

      {state && !state.ok && state.error && <Alert tone="error">{state.error}</Alert>}

      <form action={formAction} className="flex flex-col gap-2">
        <input type="hidden" name="from" value={from} />
        {staff.map((s) => (
          <StaffButton
            key={s.id}
            displayName={s.displayName}
            primaryEmail={s.primaryEmail}
            role={s.role}
          />
        ))}
      </form>
    </div>
  );
}

function StaffButton({
  displayName,
  primaryEmail,
  role,
}: {
  displayName: string;
  primaryEmail: string;
  role: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="email"
      value={primaryEmail}
      variant="outline"
      size="lg"
      disabled={pending}
      className="w-full justify-between"
    >
      <span className="font-medium">{displayName}</span>
      <span className="font-mono text-[10px] text-zinc-400 uppercase tracking-wider">{role}</span>
    </Button>
  );
}
