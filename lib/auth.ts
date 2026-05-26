/**
 * Server-side auth helpers. Use these in Server Components, Server Actions,
 * and API routes — never in Edge middleware (use `auth()` from auth.ts
 * directly or, better, the edge-safe config in middleware.ts).
 *
 * Why a helper layer:
 *   - `await auth()` returns a NextAuth Session, but we work with
 *     staff_members rows everywhere else. These helpers turn one into the
 *     other.
 *   - We want a consistent "not authenticated" experience. `requireStaff()`
 *     throws a NEXT_REDIRECT to /login so the caller doesn't have to think
 *     about it.
 *
 * Performance note: getCurrentStaff() does a single SELECT by primary key
 * (uuid). The auth() call itself reads a JWT cookie — no DB round trip there.
 * If we want to avoid the DB query entirely, we could persist a full staff
 * snapshot on the JWT and call it good. For now, freshness wins over a
 * trivial SELECT.
 */

import { auth } from "@/auth";
import { type StaffMember, staffMembers } from "@/db/schema";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "./db";
import { logger } from "./logger";

export interface AuthContext {
  staff: StaffMember;
  provider: string;
}

/**
 * Returns the active staff member for the current session, or null if there
 * is no session or the staff member has been deactivated / archived since
 * the JWT was issued.
 */
export async function getCurrentStaff(): Promise<AuthContext | null> {
  const session = await auth();
  if (!session?.user?.staffId) return null;

  const rows = await db
    .select()
    .from(staffMembers)
    .where(eq(staffMembers.id, session.user.staffId))
    .limit(1);
  const staff = rows[0];

  if (!staff) {
    logger.warn(
      { staffId: session.user.staffId },
      "session referenced a staff_member that no longer exists",
    );
    return null;
  }
  if (staff.status !== "active") {
    logger.warn({ staffId: staff.id }, "session staff_member is no longer active");
    return null;
  }

  return {
    staff,
    provider: session.provider ?? "unknown",
  };
}

/**
 * Like getCurrentStaff but throws a redirect to /login if there's no
 * authenticated active staff member. Use at the top of every Server
 * Component / Server Action that requires authentication.
 */
export async function requireStaff(): Promise<AuthContext> {
  const ctx = await getCurrentStaff();
  if (!ctx) redirect("/login");
  return ctx;
}
