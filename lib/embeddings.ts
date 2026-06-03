/**
 * OpenAI embeddings client (text-embedding-3-small, 1536-dim).
 *
 * Powers semantic retrieval over the reference doc (lib/reference-retrieval.ts)
 * and is called by the loader (scripts/load-reference-doc.ts). Uses the global
 * fetch (Node 18+) so there is no SDK dependency to keep in sync.
 *
 * Self-contained on purpose: reads process.env directly and uses console for
 * errors (no @/lib/env or @/lib/logger import) so the decoupled loader script
 * can import it under tsx without dragging in the app env/runtime. It is only
 * imported by server code + scripts (never a client component), and the key is
 * read at call time, so it never reaches the browser bundle.
 *
 * When OPENAI_API_KEY is unset (or a call fails) every function returns null so
 * callers fall back to Postgres full-text search -- embeddings are an
 * enhancement, never a hard dependency.
 */

const ENDPOINT = "https://api.openai.com/v1/embeddings";
const DEFAULT_MODEL = "text-embedding-3-small";

/** Vector dimensionality of text-embedding-3-small (matches the DB column). */
export const EMBEDDING_DIM = 1536;

export function isEmbeddingsConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

function embeddingModel(): string {
  return process.env.OPENAI_EMBEDDING_MODEL || DEFAULT_MODEL;
}

/**
 * Embed a batch of texts. Returns vectors aligned to the input order, or null
 * when embeddings are unconfigured / the call fails. OpenAI accepts up to 2048
 * inputs per request; callers with more should chunk.
 */
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || texts.length === 0) return null;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: embeddingModel(), input: texts }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[embeddings] OpenAI ${res.status}: ${detail.slice(0, 200)}`);
      return null;
    }
    const json = (await res.json()) as { data: Array<{ embedding: number[]; index: number }> };
    // Re-sort by index defensively so output order matches input order.
    const ordered = [...json.data].sort((a, b) => a.index - b.index);
    return ordered.map((d) => d.embedding);
  } catch (err) {
    console.error("[embeddings] OpenAI error:", err);
    return null;
  }
}

/** Embed a single text, or null when unconfigured / failed. */
export async function embedText(text: string): Promise<number[] | null> {
  const out = await embedTexts([text]);
  return out?.[0] ?? null;
}

/** Format a vector as a pgvector literal: "[0.1,0.2,...]". */
export function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
