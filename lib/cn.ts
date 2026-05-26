/**
 * Tailwind-aware className merger. Combines `clsx` (conditional class
 * resolution) with `tailwind-merge` (resolves Tailwind conflicts like
 * "p-2 p-4" → "p-4").
 *
 * Usage:
 *   <div className={cn("p-2", isActive && "p-4 bg-blue-500", className)} />
 */

import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
