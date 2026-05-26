import { auth, authProviderStatus } from "@/auth";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { staffMembers } from "@/db/schema";
import { db } from "@/lib/db";
import { and, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { signInAsStaff, signInWithGoogle } from "./_actions";
import { DevImpersonationForm } from "./_dev-form";

export const metadata = {
  title: "Sign in · Crawl Engine",
};

// The login page reads the seed staff list at request time. Never prerender.
export const dynamic = "force-dynamic";

interface LoginPageProps {
  searchParams: Promise<{ from?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await auth();
  if (session?.user?.staffId) {
    redirect("/");
  }

  const { from = "/", error } = await searchParams;
  const { googleEnabled, devCredentialsEnabled } = authProviderStatus;

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
    <main className="min-h-screen px-6 py-16 sm:py-24">
      <div className="mx-auto flex max-w-md flex-col gap-10">
        <header className="text-center">
          <p className="font-mono text-stone-500 text-xs uppercase tracking-widest">Crawl Engine</p>
          <h1 className="mt-2 font-serif text-4xl tracking-tight">Sign in.</h1>
          <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">
            Only pre-provisioned staff can access this engine.
          </p>
        </header>

        {error === "AccessDenied" && (
          <Alert tone="error">
            That account isn't a recognized staff member. Ask an admin to add your email to{" "}
            <code className="font-mono text-xs">staff_members</code> and try again.
          </Alert>
        )}

        {googleEnabled && (
          <form action={signInWithGoogle} className="flex flex-col gap-3">
            <input type="hidden" name="from" value={from} />
            <Button type="submit" size="lg" className="w-full">
              <GoogleMark />
              Continue with Google
            </Button>
            <p className="text-center text-stone-500 text-xs">
              You'll be redirected to Google to sign in with your workspace account.
            </p>
          </form>
        )}

        {googleEnabled && devCredentialsEnabled && (
          <div className="flex items-center gap-3 text-stone-400 text-xs uppercase tracking-widest">
            <span className="h-px flex-1 bg-stone-200 dark:bg-stone-800" />
            or
            <span className="h-px flex-1 bg-stone-200 dark:bg-stone-800" />
          </div>
        )}

        {devCredentialsEnabled && (
          <DevImpersonationForm staff={devStaff} from={from} action={signInAsStaff} />
        )}

        {!googleEnabled && !devCredentialsEnabled && (
          <Alert tone="error">
            No authentication providers are configured. Set{" "}
            <code className="font-mono text-xs">GOOGLE_OAUTH_CLIENT_ID</code> and{" "}
            <code className="font-mono text-xs">GOOGLE_OAUTH_CLIENT_SECRET</code> in the
            environment, or run with <code className="font-mono text-xs">NODE_ENV=development</code>{" "}
            to enable the dev impersonation provider.
          </Alert>
        )}
      </div>
    </main>
  );
}

function GoogleMark() {
  // Inline SVG to avoid loading an external asset for the login screen.
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="currentColor"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="currentColor"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.26 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="currentColor"
        d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18A11 11 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.83z"
      />
      <path
        fill="currentColor"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.07l3.66 2.83C6.71 7.3 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}
