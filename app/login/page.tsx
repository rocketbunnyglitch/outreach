import { auth } from "@/auth";
import { Alert } from "@/components/ui/alert";
import Image from "next/image";
import { redirect } from "next/navigation";
import { PasswordLoginForm } from "./_form";

export const metadata = {
  title: "Sign in",
};

// The login page is dynamic — it reads the session cookie.
export const dynamic = "force-dynamic";

interface LoginPageProps {
  searchParams: Promise<{ from?: string; error?: string }>;
}

/**
 * NextAuth error code -> human-readable copy. Covers the cases that can
 * still fire on the password-only flow.
 */
function errorMessageFor(code: string | undefined): string | null {
  if (!code) return null;
  switch (code) {
    case "CredentialsSignin":
      return "Invalid email or password. Try again or contact an admin.";
    case "SessionRequired":
      return "You need to be signed in to view that page. Sign in below to continue.";
    case "Configuration":
      return "The auth provider isn't configured correctly on the server. Contact an admin.";
    case "AccessDenied":
      return "Your account is not active. Contact an admin.";
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
  const errorMessage = errorMessageFor(error);

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-gradient-to-br from-zinc-50 via-white to-zinc-100 px-6 py-12 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-900">
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
          <Image
            src="/perse-wordmark.png"
            alt="Perse"
            width={258}
            height={28}
            priority
            className="mx-auto h-7 w-auto select-none brightness-0 dark:brightness-100"
          />
          <h1 className="mt-4 font-semibold text-4xl tracking-tight">Sign in.</h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Email + password. Admins provision accounts.
          </p>
        </header>

        <div className="rounded-2xl border border-zinc-200/80 bg-white/80 p-7 shadow-lg shadow-zinc-200/40 backdrop-blur-md dark:border-zinc-800/60 dark:bg-zinc-950/60 dark:shadow-none">
          {errorMessage && (
            <div className="mb-6">
              <Alert tone="error">{errorMessage}</Alert>
            </div>
          )}

          <PasswordLoginForm from={from} />
        </div>

        <footer className="mt-6 flex flex-col items-center gap-2 font-mono text-[10px] text-zinc-400 uppercase tracking-[0.14em]">
          <span>PERSE -- outreach engine</span>
          <div className="flex items-center gap-2 text-[10px]">
            <a href="/privacy" className="hover:text-zinc-600 dark:hover:text-zinc-300">
              Privacy
            </a>
            <span className="opacity-40">·</span>
            <a href="/terms" className="hover:text-zinc-600 dark:hover:text-zinc-300">
              Terms
            </a>
          </div>
        </footer>
      </div>
    </main>
  );
}
