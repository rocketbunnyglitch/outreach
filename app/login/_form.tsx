"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import { type SignInResult, signInWithPassword } from "./_actions";

/**
 * Email + password login form.
 *
 * Uses React 19's useActionState to drive the server action without
 * client-side fetch. On submit, the action either redirects (success)
 * or returns { ok: false, error } which we render inline.
 */
export function PasswordLoginForm({ from }: { from: string }) {
  const [state, formAction, isPending] = useActionState<SignInResult, FormData>(
    signInWithPassword,
    { ok: true },
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="from" value={from} />
      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-sm">Email</span>
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-600 dark:focus:ring-zinc-600/30"
          placeholder="you@yourcompany.com"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="font-medium text-sm">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-400/30 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-600 dark:focus:ring-zinc-600/30"
        />
      </label>

      {!state.ok && state.error && <Alert tone="error">{state.error}</Alert>}

      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Signing in...
          </>
        ) : (
          "Sign in"
        )}
      </Button>

      <p className="text-center text-xs text-zinc-500">
        Don't have an account? Ask an admin to invite you.
      </p>
    </form>
  );
}
