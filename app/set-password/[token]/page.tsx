import { inviteTokens, users } from "@/db/schema";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/invite-tokens";
import { and, eq, gt, isNull } from "drizzle-orm";
import Image from "next/image";
import { notFound } from "next/navigation";
import { SetPasswordForm } from "./_form";

export const metadata = { title: "Set your password" };
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

/**
 * /set-password/[token] — landing page for invite + reset links.
 *
 * Validates the token (exists, not accepted, not expired) and renders
 * a password form. On submit the form server-action consumes the
 * token atomically: marks it accepted, sets the password hash on the
 * users row (creating the row for an 'invite' kind), and signs the
 * user in.
 *
 * If the token is invalid we render a clean "this link is no longer
 * valid" message rather than redirecting silently — operators are
 * the ones running this app and a clear error is more useful than a
 * mystery redirect.
 */
export default async function SetPasswordPage({ params }: PageProps) {
  const { token } = await params;
  if (!token || typeof token !== "string") notFound();

  const tokenHash = hashToken(token);

  const rows = await db
    .select({
      id: inviteTokens.id,
      kind: inviteTokens.kind,
      email: inviteTokens.email,
      role: inviteTokens.role,
      targetUserId: inviteTokens.targetUserId,
      teamId: inviteTokens.teamId,
      expiresAt: inviteTokens.expiresAt,
      acceptedAt: inviteTokens.acceptedAt,
    })
    .from(inviteTokens)
    .where(eq(inviteTokens.tokenHash, tokenHash))
    .limit(1);
  const invite = rows[0];

  const shell = (body: React.ReactNode) => (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-gradient-to-br from-zinc-50 via-white to-zinc-100 px-6 py-12 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-900">
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
        </header>
        <div className="rounded-2xl border border-zinc-200/80 bg-white/80 p-7 shadow-lg shadow-zinc-200/40 backdrop-blur-md dark:border-zinc-800/60 dark:bg-zinc-950/60 dark:shadow-none">
          {body}
        </div>
      </div>
    </main>
  );

  if (!invite) {
    return shell(
      <>
        <h1 className="mb-2 font-semibold text-2xl tracking-tight">Link not valid.</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          This invite or password-reset link doesn't match anything in our records. It may have
          already been used. Ask an admin for a new one.
        </p>
      </>,
    );
  }

  if (invite.acceptedAt) {
    return shell(
      <>
        <h1 className="mb-2 font-semibold text-2xl tracking-tight">Already used.</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          This link was already used to set a password. Sign in normally, or ask an admin to send a
          new link if you need to reset it again.
        </p>
      </>,
    );
  }

  if (new Date(invite.expiresAt).getTime() < Date.now()) {
    return shell(
      <>
        <h1 className="mb-2 font-semibold text-2xl tracking-tight">Link expired.</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          This link has expired. Ask an admin to send you a new one.
        </p>
      </>,
    );
  }

  // For reset tokens, double-check the target user is still active.
  if (invite.kind === "reset" && invite.targetUserId) {
    const targetRows = await db
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, invite.targetUserId))
      .limit(1);
    if (!targetRows[0] || targetRows[0].status !== "active") {
      return shell(
        <>
          <h1 className="mb-2 font-semibold text-2xl tracking-tight">Account unavailable.</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            The account associated with this link is no longer active. Contact an admin.
          </p>
        </>,
      );
    }
  }

  return shell(
    <>
      <h1 className="mb-2 font-semibold text-2xl tracking-tight">
        {invite.kind === "reset" ? "Reset your password" : "Set your password"}
      </h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Signing in as <span className="font-mono">{invite.email}</span>.
      </p>
      <SetPasswordForm token={token} email={invite.email} />
    </>,
  );
}
