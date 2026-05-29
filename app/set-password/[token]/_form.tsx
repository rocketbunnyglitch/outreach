"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { MIN_PASSWORD_LENGTH } from "@/lib/passwords";
import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import { consumeInvite, type ConsumeResult } from "./_actions";

export function SetPasswordForm({ token, email }: { token: string; email: string }) {
  const [state, formAction, isPending] = useActionState<ConsumeResult, FormData>(consumeInvite, {
    ok: true,
  });

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-sm">New password</span>
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-600 dark:focus:ring-zinc-600/30"
        />
        <span className="text-xs text-zinc-500">
          At least {MIN_PASSWORD_LENGTH} characters. Use a passphrase you can remember.
        </span>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-sm">Confirm password</span>
        <input
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-600 dark:focus:ring-zinc-600/30"
        />
      </label>
      {!state.ok && state.error && <Alert tone="error">{state.error}</Alert>}
      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Saving...
          </>
        ) : (
          "Set password and sign in"
        )}
      </Button>
      <p className="text-center text-xs text-zinc-500">Signing in as {email}.</p>
    </form>
  );
}
