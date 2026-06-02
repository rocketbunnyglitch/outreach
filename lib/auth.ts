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
  // requireStaff only runs AFTER the edge middleware allowed the request, i.e.
  // the JWT already authenticated at the edge. So a null ctx here means the
  // token is valid-but-stale (its user no longer exists / is inactive) — the
  // classic edge-authenticated / DB-rejected mismatch that loops /login -> /.
  // We can't clear the (HttpOnly, chunked) session cookie from a Server
  // Component, so we redirect to a route handler that CAN, breaking the loop
  // and auto-healing the browser. /login is reachable from there once cleared.
  if (!ctx) redirect("/api/session/clear");
  return ctx;
}

/**
 * Like requireStaff, but additionally enforces role='admin'.
 *
 * Non-admin staff hitting an admin page get a 404 (not a 403) so we
 * don't leak the existence of admin-only routes to outreach reps —
 * they simply see "Not found" and move on.
 *
 * Use this on every page/action under /admin/* and on any UI affordance
 * that exposes cross-user analytics or destructive bulk operations.
 */
export async function requireAdmin(): Promise<AuthContext> {
  const ctx = await requireStaff();
  if (ctx.staff.role !== "admin") {
    // Use notFound() instead of a 403 page — it's the convention in
    // Next 15 for "hide this route from non-privileged callers" and it
    // composes cleanly with the existing not-found.tsx.
    const { notFound } = await import("next/navigation");
    notFound();
  }
  return ctx;
}

/**
 * Pure read variant — returns null when not admin, useful in shared
 * components (e.g. the nav layout) that need to conditionally render
 * admin-only items without forcing a redirect.
 */
export async function getAdminOrNull(): Promise<AuthContext | null> {
  const ctx = await getCurrentStaff();
  if (!ctx || ctx.staff.role !== "admin") return null;
  return ctx;
}

/**
 * Role hierarchy (highest -> lowest):
 *
 *   admin    -- can do anything, including destructive bulk operations.
 *   lead     -- can manage shared resources (labels, suppression,
 *               cadence templates) but not user provisioning or
 *               cross-team analytics.
 *   outreach -- the default; can work threads, send mail, manage
 *               their own assignments + connections.
 *   readonly -- can view everything they would normally see but
 *               cannot mutate (no send, no assign, no label).
 *
 * STAFF_ROLE_RANK assigns a numeric tier so we can compare roles
 * with > / >= rather than chained equality. Higher = more
 * privileged. The numbers themselves are arbitrary; only the
 * order matters.
 *
 * The hierarchy is FLAT in the schema (db/schema/enums.ts) -- this
 * helper is the ONLY canonical place that knows "lead is between
 * admin and outreach." Call sites should use the helpers below,
 * never compare rank numbers directly, so the order can change
 * here in one place if the spec adds a new tier.
 */
export type StaffRole = StaffMember["role"];

const STAFF_ROLE_RANK: Record<StaffRole, number> = {
  admin: 40,
  lead: 30,
  outreach: 20,
  readonly: 10,
};

/**
 * Pure predicate: does `staff` have AT LEAST the privilege level
 * of `minRole`? Useful in JSX (`{hasMinimumRole(staff, "lead") &&
 * <ManageLabelsButton />}`) and in server-side branching where
 * throwing on insufficient role would be wrong (e.g. one of
 * several conditional fetches).
 *
 * Accepts any object with a `role` field of type StaffRole (i.e.
 * the full StaffMember row OR a narrow projection of just the
 * role). Callers commonly pass narrower types from select-
 * projected queries (e.g. lib/compose-send-impl's staff snapshot
 * is `{ id, teamId, role, displayName, primaryEmail }`).
 */
export function hasMinimumRole(staff: { role: StaffRole }, minRole: StaffRole): boolean {
  return STAFF_ROLE_RANK[staff.role] >= STAFF_ROLE_RANK[minRole];
}

/**
 * Like requireStaff, but additionally enforces role >= `minRole`.
 *
 * Behaves like requireAdmin for under-privileged callers: returns a
 * Next 404 (via notFound()) rather than a 403 so we don't leak the
 * existence of higher-tier routes to lower-tier staff. The route
 * just "doesn't exist" from their perspective.
 *
 * Examples:
 *   - requireMinimumRole("admin")   -- equivalent to requireAdmin
 *   - requireMinimumRole("lead")    -- admin OR lead
 *   - requireMinimumRole("outreach") -- everyone except readonly
 *
 * Use this for surfaces a lead should be able to touch (label
 * management, cadence templates, suppression list) but not the
 * destructive admin-only ones (purge a city, hard-delete a venue).
 */
export async function requireMinimumRole(minRole: StaffRole): Promise<AuthContext> {
  const ctx = await requireStaff();
  if (!hasMinimumRole(ctx.staff, minRole)) {
    const { notFound } = await import("next/navigation");
    notFound();
  }
  return ctx;
}

/**
 * Pure read variant of requireMinimumRole: returns null when the
 * caller doesn't meet the bar. Mirrors getAdminOrNull's shape so
 * shared nav / sidebar components can conditionally render rows
 * without forcing a redirect.
 */
export async function getMinimumRoleOrNull(minRole: StaffRole): Promise<AuthContext | null> {
  const ctx = await getCurrentStaff();
  if (!ctx || !hasMinimumRole(ctx.staff, minRole)) return null;
  return ctx;
}

/**
 * Superuser tier — strictly above `admin`. Reserved for irreversible
 * destructive operations (permanent hard-delete of cities, venues, etc.)
 * that even a normal admin shouldn't be able to do. Driven by env so we
 * don't need a schema change: SUPERUSER_EMAILS is a comma-separated list
 * of staff primary_email addresses; falls back to nauth.nathan@gmail.com.
 */
function isSuperUserEmail(email: string): boolean {
  const raw = process.env.SUPERUSER_EMAILS ?? "nauth.nathan@gmail.com";
  const set = new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  return set.has(email.toLowerCase());
}

export async function getSuperUserOrNull(): Promise<AuthContext | null> {
  const ctx = await getCurrentStaff();
  if (!ctx) return null;
  if (!isSuperUserEmail(ctx.staff.primaryEmail)) return null;
  return ctx;
}

export async function requireSuperUser(): Promise<AuthContext> {
  const ctx = await requireStaff();
  if (!isSuperUserEmail(ctx.staff.primaryEmail)) {
    const { notFound } = await import("next/navigation");
    notFound();
  }
  return ctx;
}
