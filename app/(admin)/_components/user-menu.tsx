import { Button } from "@/components/ui/button";
import type { StaffMember } from "@/db/schema";
import { cn } from "@/lib/cn";
import { LogOut } from "lucide-react";
import { signOutAction } from "../_actions";

interface UserMenuProps {
  staff: Pick<StaffMember, "displayName" | "primaryEmail" | "role">;
  provider: string;
}

/**
 * Top-nav user display. Shows the signed-in staffer's initials + name and
 * a sign-out button. No dropdown yet — the operations team is 4 people, so
 * a flat row keeps the cognitive load low.
 *
 * If you want a dropdown with profile / settings / theme switch later,
 * this is the place to add it.
 */
export function UserMenu({ staff, provider }: UserMenuProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="hidden flex-col items-end leading-tight sm:flex">
        <span className="font-medium text-sm text-zinc-900 dark:text-zinc-100">
          {staff.displayName}
        </span>
        <span className="font-mono text-[10px] text-zinc-500 uppercase tracking-wider">
          {staff.role}
          {provider === "dev-staff-impersonate" && " · dev"}
        </span>
      </div>

      <Avatar displayName={staff.displayName} />

      <form action={signOutAction}>
        <Button type="submit" variant="ghost" size="icon" title="Sign out">
          <LogOut className="h-4 w-4" />
          <span className="sr-only">Sign out</span>
        </Button>
      </form>
    </div>
  );
}

function Avatar({ displayName }: { displayName: string }) {
  const initials =
    displayName
      .split(/\s+/)
      .map((word) => word[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";
  return (
    <div
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
        "bg-zinc-900 font-medium font-mono text-[10px] text-zinc-50 tracking-wider",
        "dark:bg-zinc-100 dark:text-zinc-900",
      )}
    >
      {initials}
    </div>
  );
}
