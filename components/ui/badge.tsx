import { cn } from "@/lib/cn";
import { type VariantProps, cva } from "class-variance-authority";
import type * as React from "react";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider whitespace-nowrap",
  {
    variants: {
      tone: {
        default: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
        success: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
        warning: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
        muted: "bg-zinc-50 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-500",
        accent: "bg-orange-50 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
      },
    },
    defaultVariants: { tone: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, className }))} {...props} />;
}
