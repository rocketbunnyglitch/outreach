import { requireAdmin } from "@/lib/auth";
import { listSnippets } from "./_actions";
import { SnippetsManager } from "./_components/snippets-manager";

export const metadata = { title: "Snippets" };
export const dynamic = "force-dynamic";

export default async function SnippetsAdminPage() {
  await requireAdmin();
  const snippets = await listSnippets();

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header>
        <p className="font-mono text-xs text-zinc-500 uppercase tracking-widest">Admin</p>
        <h1 className="mt-1 font-semibold text-4xl tracking-tight">Snippets</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Reusable body fragments your team can drop into the composer. In an email, type
          <code className="mx-1 rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">
            ;trigger
          </code>
          to insert one. Snippets may contain merge fields like
          <code className="mx-1 rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">
            {"{{venue_name}}"}
          </code>
          -- they render against the email's context on insert.
        </p>
      </header>
      <SnippetsManager initial={snippets} />
    </div>
  );
}
