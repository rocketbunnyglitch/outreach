import { auth, authProviderStatus } from "@/auth";
import { Alert } from "@/components/ui/alert";
import { staffMembers } from "@/db/schema";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { and, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { signInAsStaff, signInWithGoogle } from "./_actions";
import { DevImpersonationForm } from "./_dev-form";
import { GoogleSignInButton } from "./_google-button";

export const metadata = {
  title: "Sign in · Crawl Engine",
};

// The login page reads the seed staff list at request time. Never prerender.
export const dynamic = "force-dynamic";

interface LoginPageProps {
  searchParams: Promise<{ from?: string; error?: string }>;
}

/**
 * NextAuth error code → human-readable copy. Covers the common cases the
 * operator might hit so they get a clear next step instead of a raw enum
 * string in the URL bar.
 *
 * Reference: https://next-auth.js.org/configuration/pages#error-codes
 */
function errorMessageFor(code: string | undefined): string | null {
  if (!code) return null;
  switch (code) {
    case "AccessDenied":
      return "That account isn't a recognized staff member. Ask an admin to add your email to the staff list and try again.";
    case "OAuthSignin":
    case "OAuthCallback":
    case "OAuthCreateAccount":
      return "Couldn't complete the Google sign-in handshake. Refresh and try again, or contact an admin if it keeps happening.";
    case "OAuthAccountNotLinked":
      return "Your Google account is tied to a different sign-in method on file. Ask an admin to reconcile your staff record.";
    case "Callback":
      return "Sign-in callback failed. Refresh and try again.";
    case "SessionRequired":
      return "You need to be signed in to view that page. Sign in below to continue.";
    case "Configuration":
      return "The auth provider isn't configured correctly on the server. Contact an admin.";
    case "Verification":
      return "Your sign-in link is invalid or has expired. Try again.";
    default:
      return `Sign-in failed (${code}). Try again or contact an admin.`;
  }
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await auth();
  if (session?.user?.staffId) {
    redirect("/");
  }

  const { from = "/", error } = await searchParams;
  const { googleEnabled, devCredentialsEnabled } = authProviderStatus;
  const errorMessage = errorMessageFor(error);
  const workspaceDomain = env.GOOGLE_WORKSPACE_DOMAIN;

  // Load active staff for the dev picker. Only used in non-prod.
  const devStaff = devCredentialsEnabled
    ? await db
        .select({
          id: staffMembers.id,
          displayName: staffMembers.displayName,
          primaryEmail: staffMembers.primaryEmail,
          role: staffMembers.role,
        })
        .from(staffMembers)
        .where(and(eq(staffMembers.status, "active"), isNull(staffMembers.archivedAt)))
        .orderBy(staffMembers.displayName)
    : [];

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-gradient-to-br from-zinc-50 via-white to-zinc-100 px-6 py-12 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-900">
      {/* Soft brand glow in the background */}
      <div
        aria-hidden="true"
        className="-z-10 pointer-events-none absolute inset-0 opacity-40 dark:opacity-20"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 800px 400px at 50% 0%, rgba(99,102,241,0.15), transparent 60%)",
        }}
      />

      <div className="w-full max-w-md">
        <header className="mb-8 text-center">
          <p className="font-mono text-[10px] text-zinc-500 uppercase tracking-[0.18em]">
            Crawl Engine
          </p>
          <h1 className="mt-2 font-semibold text-4xl tracking-tight">Sign in.</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Pre-provisioned staff only.
          </p>
        </header>

        <div className="rounded-2xl border border-zinc-200/80 bg-white/80 p-7 shadow-lg shadow-zinc-200/40 backdrop-blur-md dark:border-zinc-800/60 dark:bg-zinc-950/60 dark:shadow-none">
          {errorMessage && (
            <div className="mb-6">
              <Alert tone="error">{errorMessage}</Alert>
            </div>
          )}

          {googleEnabled && (
            <form action={signInWithGoogle} className="flex flex-col gap-3">
              <input type="hidden" name="from" value={from} />
              <GoogleSignInButton />
              <p className="text-center text-xs text-zinc-500">
                {workspaceDomain ? (
                  <>
                    Sign in with your{" "}
                    <code className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300">
                      @{workspaceDomain}
                    </code>{" "}
                    account.
                  </>
                ) : (
                  <>You'll be redirected to Google to sign in.</>
                )}
              </p>
            </form>
          )}

          {googleEnabled && devCredentialsEnabled && (
            <div className="my-6 flex items-center gap-3 font-mono text-[10px] text-zinc-400 uppercase tracking-[0.18em]">
              <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              or dev
              <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            </div>
          )}

          {devCredentialsEnabled && (
            <DevImpersonationForm staff={devStaff} from={from} action={signInAsStaff} />
          )}

          {!googleEnabled && !devCredentialsEnabled && (
            <Alert tone="error">
              No authentication providers are configured. Set{" "}
              <code className="font-mono text-xs">GOOGLE_OAUTH_CLIENT_ID</code> and{" "}
              <code className="font-mono text-xs">GOOGLE_OAUTH_CLIENT_SECRET</code>, or enable{" "}
              <code className="font-mono text-xs">ENABLE_DEV_IMPERSONATION=1</code> for local
              development.
            </Alert>
          )}
        </div>

        <footer className="mt-6 text-center font-mono text-[10px] text-zinc-400 uppercase tracking-[0.14em]">
          {googleEnabled ? "Google OAuth · Workspace gated" : "Dev impersonation mode"}
        </footer>
      </div>
    </main>
  );
}
