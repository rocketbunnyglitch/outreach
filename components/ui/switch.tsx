"use client";

import { cn } from "@/lib/cn";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as React from "react";

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(function Switch({ className, ...props }, ref) {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent",
        "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-1",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:bg-stone-900 data-[state=unchecked]:bg-stone-200",
        "dark:data-[state=checked]:bg-stone-100 dark:data-[state=unchecked]:bg-stone-800",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm",
          "transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5",
          "dark:bg-stone-950",
        )}
      />
    </SwitchPrimitive.Root>
  );
});
