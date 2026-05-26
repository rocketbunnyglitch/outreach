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
        "flex min-h-[80px] w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm",
        "shadow-sm transition-colors",
        "placeholder:text-stone-400",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-1",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "dark:border-stone-800 dark:bg-stone-950 dark:focus-visible:ring-stone-100 dark:placeholder:text-stone-500",
        className,
      )}
      {...props}
    />
  );
});
