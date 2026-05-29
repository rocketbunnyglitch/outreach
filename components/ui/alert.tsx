import { cn } from "@/lib/cn";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import type * as React from "react";

const toneClasses = {
  info: "border-zinc-200 bg-zinc-50 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200",
  error:
    "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
} as const;

const toneIcons = {
  info: Info,
  error: AlertCircle,
  success: CheckCircle2,
} as const;

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: keyof typeof toneClasses;
}

export function Alert({ tone = "info", className, children, ...props }: AlertProps) {
  const Icon = toneIcons[tone];
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-md border px-4 py-3 text-sm",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">{children}</div>
    </div>
  );
}
