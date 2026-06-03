# Reference docs

This directory holds the canonical operational reference documents that the
PERSE outreach engine consults at runtime and that operators read inside the
app.

## What lives here

- `halloween-2026-intl-engine-reference.md` - the locked, canonical reference
  for the Halloween 2026 international outreach campaign. It is the source of
  truth for templates, cadence, reply classification, turnout math, host
  workflows, and post-confirm operations. Engine templates implement these
  rules; this document explains the reasoning behind them.

## How these docs reach the engine

The markdown files here are the authoritative, human-edited source. The engine
does not parse the raw markdown at request time. Instead, a loader script
(`scripts/load-reference-doc.ts`, added in Phase 0.3) parses each markdown file
into sections, generates embeddings, and persists them to the `reference_docs`
and `reference_doc_sections` tables (schema added in Phase 0.2).

At runtime, AI code paths call `lib/reference-retrieval.ts` (Phase 0.4) to fetch
the sections relevant to a given task, which grounds the AI in these rules.

## Editing workflow

1. Edit the `.md` file in this directory. This is the canonical edit path.
2. Re-run the loader so the database rows stay in sync:
   `npm run reference-docs:load -- --slug halloween-2026-intl`
3. Commit the `.md` change. A pre-commit drift check
   (`npm run reference-docs:check`) blocks the commit if a loaded doc changed
   without a reload. It skips gracefully when the DB is unreachable or
   `DATABASE_URL` is unset, so DB-less commit environments are never blocked.
4. Deploy. `scripts/deploy.sh` re-runs the loader after migrations on every
   deploy (idempotent, non-fatal), so the deployed engine always has the latest
   doc loaded. This is the deploy-side equivalent of a CI sync job: the spec
   called for a GitHub Action, but the prod database is reachable only from the
   VPS (localhost), so the load is wired into the deploy instead.

The database rows are derived artifacts. Never edit reference content directly
in the database; always edit the `.md` here and re-run the loader.
