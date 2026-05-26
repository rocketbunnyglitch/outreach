"use client";

import { CommandPalette } from "@/components/ui/command-palette";
import { paletteSearch } from "../_actions/palette-search";

/**
 * Thin client wrapper that hands the server-side palette search
 * action to the CommandPalette primitive. Mounted in the admin
 * layout so Cmd+K works on every admin page.
 */
export function MountCommandPalette() {
  return <CommandPalette search={paletteSearch} />;
}
