# Troubleshooting with Claude — operator playbook

This doc turns Claude / Claude Code into a junior developer for
this codebase. When something breaks, copy the error blob from
the UI, paste it into a Claude chat, and Claude can grep the
logs + walk the code paths to diagnose without my help.

This file is the prompt context. Paste it into a fresh Claude
chat (or have Claude Code read it) BEFORE pasting an error blob.

---

## How the error code system works

Every server-side error that's caught gets a short code like
`E-2K9P-7F3M`:

- The code is shown to the operator in the UI (on the toast or
  the error boundary card) next to a "Copy for Claude" button.
- The same code is written to the PM2 log in one line tagged
  `[op-error E-2K9P-7F3M] action.tag.name`.
- The log line includes the full error context (stack, params,
  staff id, ids the action was touching) — everything Claude
  needs to diagnose.

So one grep finds everything:

```bash
pm2 logs --lines 5000 --nostream | grep E-2K9P-7F3M
```

If the operator pastes:

```
Error code: E-2K9P-7F3M
Message: Couldn't add to cold outreach.
Action: city_campaigns.upsertColdOutreachEntry
URL: /city-campaigns/abc-123
Time: 2026-05-31T20:42:00.123Z

Please diagnose this for me.
```

Claude should:

1. Read the action name (`city_campaigns.upsertColdOutreachEntry`).
2. Find the file: `app/(admin)/city-campaigns/_cold-outreach-actions.ts`.
3. Read the action's body to understand what it's doing.
4. Ask the operator to run the grep above and paste the result.
5. From the grep, identify the underlying error (DB constraint
   violation, missing FK, Zod schema mismatch, etc).
6. Propose a fix and walk the operator through applying it.

---

## Architecture quick reference

- **Server actions** live in `app/(admin)/**/_*-actions.ts` and
  `app/(admin)/**/_actions/*.ts`. They use Drizzle ORM.
- **Database schema**: `db/schema/*.ts` — Drizzle definitions.
  Production migrations: `db/migrations/*.sql`. The newest
  migration number is the source of truth for what's deployed.
- **Logger**: `lib/logger.ts` — Pino, structured JSON in prod.
  Captured by PM2 under `~/.pm2/logs/crawl-engine-*.log`.
- **Error code generator**: `lib/op-error.ts` — `newOpError(tag)`
  returns `{code, log}`. The catch block calls `op.log(err, ctx)`
  and returns `{ok: false, error: msg, code: op.code}`.
- **Toast**: `components/ui/toast.tsx` — when a toast has a
  `code` property on an error toast, it renders the code + a
  "Copy for Claude" button.
- **Global error boundary**: `app/(admin)/error.tsx` — catches
  render-time errors and shows the Next.js `digest` with a
  "Copy for Claude" button.

---

## When the operator pastes a render-time error blob

```
Next.js digest: 3a7f1e9c
Message: Cannot read properties of undefined (reading 'name')
URL: /city-campaigns/abc-123
Time: 2026-05-31T20:42:00.123Z
```

There's no operator error code, only the Next.js `digest`.
Grep for that instead:

```bash
pm2 logs --lines 5000 --nostream | grep 3a7f1e9c
```

The PM2 logs include the full stack on the server side that
Next.js suppresses in the browser. Identify the failing
component from the stack, ask the operator to paste the
component file, and walk through the fix.

---

## When the operator says "the page is slow"

There's no error blob yet. Ask:

1. What URL?
2. How long does it take? (rough — 5 seconds? 30 seconds?)
3. Does it happen every time or just sometimes?

Then look at the page's loader. Patterns to check:

- **N+1 queries** — look for `await db.select(...)` inside a
  loop. Drizzle is happy to fire 100 queries; Postgres less so.
- **Missing indexes** — see `db/migrations/` for `CREATE INDEX`
  patterns. If a column is being filtered in a hot WHERE and
  has no index, that's the fix.
- **Bulk Realtime broadcasts** — `lib/realtime-publish.ts`.
  If a save fires hundreds of these the page hangs.

---

## When the operator can't reproduce a bug

Ask:

1. Was anyone else on the team using the app at the time?
   (Realtime + Drizzle sometimes race on the same row.)
2. Did they refresh between steps?
3. Was the dev server running locally, or are they in prod?

Then look at the structured log around the timestamp the
operator gives. Pino logs include `time` (ISO) — bracket the
incident and read the surrounding lines.

---

## Code-base conventions Claude should know

- **TypeScript strict + `noUncheckedIndexedAccess`** is on.
  Array access returns `T | undefined`. Helpers that look like
  they should always work might still trip on this.
- **`server-only`** import at the top of every `lib/*.ts`
  module that touches the DB. Don't break that — client bundles
  fail at build time if `lib/ai-*.ts` ends up imported from a
  client component.
- **Color reservations**: emerald = healthy/done, rose =
  destructive/warning, amber = in-progress, blue = info, violet
  = AI-assisted, zinc = neutral. Never mix.
- **No em-dashes or curly apostrophes** in prose. Use `--` and
  `'` ascii equivalents (this is enforced for Claude-generated
  prose specifically).
- **Migration sequencing**: every new SQL file is the NEXT
  integer (zero-padded to 4). Current latest is 0078. Never
  re-use an existing number; never edit a shipped migration.

---

## Useful greps for common questions

```bash
# Where is action X defined?
grep -rn "export async function actionName" app/

# Where is column Y used?
grep -rn "venueType" db/schema/ lib/ app/

# What's the latest migration?
ls db/migrations/ | sort | tail -5

# All places this AI feature can be killed
grep -rn "AI_QUICK_REPLIES_ENABLED" .

# All places error codes are generated
grep -rn "newOpError(" app/ lib/

# Find error code in logs (after ssh)
pm2 logs --lines 5000 --nostream | grep E-XXXX-YYYY
```

---

## When to escalate

If after grepping + reading the action source you still can't
find the cause, ask the operator to:

1. Open `~/.pm2/logs/crawl-engine-error.log` and paste the last
   200 lines.
2. Run `pm2 status` and paste the output.
3. Tell you what changed recently — was a migration applied?
   Was a new commit deployed?

The pattern is always the same: ID the error code or digest,
find the matching log line, read the action source, propose a
fix. You don't need me for any of this.
