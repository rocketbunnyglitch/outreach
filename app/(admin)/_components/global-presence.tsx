"use client";

import { usePresenceHeartbeat } from "@/components/ui/data-table/use-presence-heartbeat";
import { usePathname } from "next/navigation";

// Routes that already mount their own presence widget (with focus tracking) —
// skip here so we don't double-beat the same Redis key and clobber focus.
const SKIP = [/^\/city-campaigns\//, /^\/inbox/];

/**
 * App-wide presence heartbeat. Mounted once in the admin layout so every page a
 * staffer visits reports their route — feeding the dashboard "who's online"
 * strip. Renders nothing.
 */
export function GlobalPresence({ staffId }: { staffId: string }) {
  const pathname = usePathname() || "/";
  const skip = SKIP.some((re) => re.test(pathname));
  usePresenceHeartbeat({ route: pathname, currentStaffId: staffId, enabled: !skip });
  return null;
}
