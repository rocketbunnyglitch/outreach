/**
 * Button — the workhorse interactive element.
 *
 * Variants:
 *   default  — solid charcoal (the primary action)
 *   ghost    — transparent with hover (secondary actions)
 *   outline  — hairline border (tertiary / cancel)
 *   destructive — for archive / delete (rust accent)
 *
 * Sizes: sm | md | lg | icon
 *
 * Built on Radix's Slot primitive so it can pass props through to a custom
 * element via `asChild` — useful for wrapping <Link>.
 */

import { cn } from "@/lib/cn";
import { Slot } from "@radix-ui/react-slot";
import { type VariantProps, cva } from "class-variance-authority";
import * as React from "react";

const buttonVariants = cva(
  cn(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium",
    "transition-[background-color,color,border-color,box-shadow] duration-150",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50 dark:focus-visible:ring-offset-stone-950",
    "disabled:pointer-events-none disabled:opacity-50",
  ),
  {
    variants: {
      variant: {
        default:
          "bg-stone-900 text-stone-50 hover:bg-stone-800 focus-visible:ring-stone-900 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200 dark:focus-visible:ring-stone-100",
        ghost:
          "text-stone-700 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100",
        outline:
          "border border-stone-200 bg-transparent text-stone-700 hover:bg-stone-100 dark:border-stone-800 dark:text-stone-300 dark:hover:bg-stone-900",
        destructive:
          "text-amber-900 bg-amber-50 hover:bg-amber-100 border border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-900 dark:hover:bg-amber-900",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-4 text-sm",
        lg: "h-10 px-5 text-sm",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, ...props },
  ref,
) {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />;
});

export { buttonVariants };
