import { referenceDocSections, referenceDocs } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { asc, desc, eq } from "drizzle-orm";
import { BookOpen } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ReferenceSearch } from "./_components/reference-search";

export const metadata = { title: "Reference" };
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

// Tailwind arbitrary-variant styles for the rendered markdown body. The repo
// has no typography plugin, so common elements are styled inline here. Section
// bodies contain no headers (the loader splits the doc on every header), so
// only prose/list/table/code styling matters.
const PROSE =
  "max-w-none text-sm leading-relaxed text-zinc-700 dark:text-zinc-300 " +
  "[&_p]:my-2 [&_a]:text-blue-600 [&_a]:underline dark:[&_a]:text-blue-400 " +
  "[&_strong]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 " +
  "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 " +
  "[&_code]:rounded [&_code]:bg-zinc-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs dark:[&_code]:bg-zinc-800 " +
  "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-zinc-100 [&_pre]:p-3 dark:[&_pre]:bg-zinc-900 [&_pre_code]:bg-transparent [&_pre_code]:p-0 " +
  "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-left " +
  "[&_th]:border [&_th]:border-zinc-200 [&_th]:px-2 [&_th]:py-1 [&_th]:font-medium dark:[&_th]:border-zinc-800 " +
  "[&_td]:border [&_td]:border-zinc-200 [&_td]:px-2 [&_td]:py-1 dark:[&_td]:border-zinc-800 " +
  "[&_blockquote]:border-zinc-300 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-zinc-500";

export default async function ReferencePage({ params }: PageProps) {
  const { slug } = await params;
  // Reference is an admin-only management view (business-rules doc). Gate the
  // route too, not just the nav link, so non-admins can't reach it by URL.
  await requireAdmin();

  const [doc] = await db
    .select()
    .from(referenceDocs)
    .where(eq(referenceDocs.docSlug, slug))
    .orderBy(desc(referenceDocs.version))
    .limit(1);

  if (!doc) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16 text-center">
        <BookOpen className="mx-auto h-8 w-8 text-zinc-400" />
        <h1 className="mt-4 font-semibold text-xl text-zinc-900 dark:text-zinc-100">
          Reference doc not loaded
        </h1>
        <p className="mt-2 text-sm text-zinc-500">
          No reference document is loaded for the slug "{slug}". Run the loader to populate it:
        </p>
        <code className="mt-3 inline-block rounded bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-800">
          npm run reference-docs:load -- --slug {slug}
        </code>
      </main>
    );
  }

  const sections = await db
    .select()
    .from(referenceDocSections)
    .where(eq(referenceDocSections.referenceDocId, doc.id))
    .orderBy(asc(referenceDocSections.sectionOrder));

  const loadedAt = doc.loadedAt instanceof Date ? doc.loadedAt : new Date(doc.loadedAt);
  const loadedLabel = `${loadedAt.toISOString().slice(0, 16).replace("T", " ")} UTC`;

  return (
    <div className="flex gap-6 px-4 py-6 lg:px-8">
      <aside className="hidden w-64 shrink-0 lg:block">
        <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2">
          <ReferenceSearch slug={slug} />
          <nav aria-label="Table of contents" className="mt-3 flex flex-col gap-0.5">
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.sectionCode}`}
                data-section-code={s.sectionCode}
                className="reference-toc-link truncate rounded px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100"
                style={{ paddingLeft: `${0.5 + (s.sectionLevel - 1) * 0.75}rem` }}
              >
                <span className="font-mono text-[10px] text-zinc-400">{s.sectionCode}</span>{" "}
                {s.sectionTitle}
              </a>
            ))}
          </nav>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <header className="border-zinc-200 border-b pb-4 dark:border-zinc-800">
          <h1 className="font-semibold text-2xl text-zinc-900 dark:text-zinc-100">{slug}</h1>
          <p className="mt-1 text-xs text-zinc-500">
            Version {doc.version} &middot; Last loaded {loadedLabel} &middot; File hash{" "}
            <span className="font-mono">{doc.fileHash.slice(0, 8)}</span>
          </p>
        </header>

        <div className="mt-6 flex flex-col gap-8">
          {sections.map((s) => (
            <section key={s.id} id={s.sectionCode} className="scroll-mt-20">
              <h2 className="font-semibold text-base text-zinc-900 dark:text-zinc-100">
                <span className="font-mono text-xs text-zinc-400">{s.sectionCode}</span>{" "}
                {s.sectionTitle}
              </h2>
              <div className={`mt-1 ${PROSE}`}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.sectionBody}</ReactMarkdown>
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
