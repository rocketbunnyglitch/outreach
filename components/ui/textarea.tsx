import { cn } from "@/lib/cn";
import * as React from "react";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "flex min-h-[80px] w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm",
        "shadow-sm transition-colors",
        "placeholder:text-zinc-400",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-1",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "dark:border-zinc-800 dark:bg-zinc-950 dark:focus-visible:ring-zinc-100 dark:placeholder:text-zinc-500",
        className,
      )}
      {...props}
    />
  );
});
