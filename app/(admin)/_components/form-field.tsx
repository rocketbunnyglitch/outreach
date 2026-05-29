/**
 * Shared form-field components used by both brand forms.
 *
 * Keeps the create + edit pages declarative — instead of repeating label /
 * input / error layout, you write <Field name="slug" label="Slug" ...>.
 */

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/cn";
import type * as React from "react";

interface FieldShellProps {
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
  className?: string;
}

export function FieldShell({
  name,
  label,
  hint,
  required,
  error,
  children,
  className,
}: FieldShellProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={name}>
        {label}
        {required && <span className="ml-1 text-amber-700 dark:text-amber-400">*</span>}
      </Label>
      {children}
      {error ? (
        <p className="text-rose-700 text-xs dark:text-rose-400">{error}</p>
      ) : hint ? (
        <p className="text-xs text-zinc-500">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * Two-column layout for paired short fields (e.g. slug + display name).
 * Stacks on mobile.
 */
export function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>;
}

/**
 * Section heading inside a form.
 */
export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid grid-cols-1 gap-6 border-zinc-200 border-t pt-8 first:border-t-0 first:pt-0 sm:grid-cols-[200px_1fr] dark:border-zinc-800">
      <div>
        <h2 className="font-semibold text-lg tracking-tight ">{title}</h2>
        {description && <p className="mt-1 text-xs text-zinc-500">{description}</p>}
      </div>
      <div className="flex flex-col gap-5">{children}</div>
    </section>
  );
}

/**
 * Render-prop indicator that a secret is already configured. Replaces the
 * actual value (which we never display) with a status row + replace prompt.
 */
export function SecretConfiguredHint({ configured }: { configured: boolean }) {
  return (
    <p className="text-xs text-zinc-500">
      {configured ? (
        <>
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 align-middle" />{" "}
          Currently configured. Type a new value to replace; leave blank to keep.
        </>
      ) : (
        <>
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-zinc-300 align-middle dark:bg-zinc-700" />{" "}
          Not configured. Will be encrypted at rest with AES-256-GCM.
        </>
      )}
    </p>
  );
}
