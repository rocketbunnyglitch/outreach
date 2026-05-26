import { cn } from "@/lib/cn";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import type * as React from "react";

const toneClasses = {
  info: "border-stone-200 bg-stone-50 text-stone-800 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200",
  error:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
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
