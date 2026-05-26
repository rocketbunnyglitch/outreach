import { cn } from "@/lib/cn";
import * as React from "react";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = "text", ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-zinc-200 bg-white px-3 py-1 text-sm",
        "shadow-sm transition-colors",
        "file:border-0 file:bg-transparent file:font-medium file:text-sm",
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
