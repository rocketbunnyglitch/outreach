# CLAUDE.md

> **Read this first.** This file bootstraps any AI assistant (or new human contributor) into the project in 5 minutes. Update it whenever a convention changes or a sharp edge is added. If your edit changes behavior, update this file *before* you ship.

---

## 1. What this is

The **Crawl Outreach Engine** — a multi-brand CRM, outreach automation platform, and operations management system for running club crawls across many cities and many concurrent campaigns. Replaces a Google Sheets workflow.

Runs alongside (but isolated from) the existing **promoter-engine** referral system on the same Ubuntu server. The two are completely separate apps with separate databases and separate domains.

What this is **not**:
- Not a SaaS product
- Not multi-tenant (it's multi-brand, which is different — see DECISIONS.md#002)
- Not a public-facing event discovery site
- Not a replacement for Eventbrite (we integrate with it)

The canonical spec lives in `docs/Crawl_Outreach_Engine_Spec_v3.docx`. Read SPEC.md for a navigation map into it.

---

## 2. Two-brand-type model (CRITICAL)

This system distinguishes between **two kinds of brand**. Conflating them produces wrong sends. Get this concept before touching any send path.

**CrawlBrand** — public, customer-facing identity. What ticket buyers and event attendees see.
- Examples: Fright Crawl, Trick or Drink, Midnight Pass, The Drop Pass, StPaddysCrawl, The Clover Crawl
- Owns: public domain, Eventbrite organization, participant posters (what venues display), public map JSON API output, ticket-buyer-facing assets
- Geography-tied: some CrawlBrands are Toronto-only, some are international

**OutreachBrand** — operational, venue-facing identity. The company venues think is contacting them.
- Examples: Eventsperse, [TBD-2]
- Owns: email domain, Postmark account (one per outreach brand), staff Gmail accounts (one per staffer per outreach brand), email signature/footer template
- Has NO website, NO public assets, NO ticket-buyer identity
- Exists primarily to give the operation reputation isolation: if one outreach brand gets burned, another spins up

A **Campaign** belongs to both: "Halloween 2026 in Boston, presented as Fright Crawl, with outreach handled by Eventsperse."

When the engine sends something, it asks two questions:
- "Who's this from?" → OutreachBrand (Postmark sender, Gmail, signature)
- "Who's this for/about?" → CrawlBrand (Eventbrite org, poster template, public branding)

**Never** treat them as one entity. **Never** route a send without resolving both.

---

## 3. Reading order before touching code

1. **CLAUDE.md** (this file) — conventions, sharp edges, what to never do.
2. **ARCHITECTURE.md** — current state of the built system.
3. **ROADMAP.md** — what's done, in progress, next.
4. **OPEN_QUESTIONS.md** — decisions pending; do not silently assume.
5. **DECISIONS.md** (skim) — the *why* behind the architecture. Read in full if you're tempted to refactor something.
6. **SPEC.md** — navigation map into the canonical Word spec.

If you're confused after reading those, add an entry to OPEN_QUESTIONS.md rather than guessing.

---

## 4. Tech stack (one paragraph)

Node 22 LTS, Next.js 15 (App Router), React 19, TypeScript strict, Tailwind 4 + shadcn/ui, Drizzle ORM against PostgreSQL 16 with PostGIS, NextAuth v5 (Auth.js) for Google OAuth (multi-account per staff per brand), BullMQ on Redis 7 for background jobs, Postmark for transactional email, Gmail API (per-staff OAuth) for cold outreach and reply detection, Puppeteer for poster generation, ZeroBounce for email validation, Google Maps Platform (Places + Distance Matrix + Geocoding) for lead generation, Quo API for calls, Eventbrite API for listing sync, Mapbox GL JS for the *external* map pages (this engine exposes a JSON API, not HTML). Process managed by PM2. Reverse proxy is Caddy. Self-hosted on the same Ubuntu server as the referral engine.

---

## 5. Coding conventions

- **TypeScript strict.** No implicit `any`. No `// @ts-ignore` without a comment explaining why.
- **All DB access via Drizzle.** No raw SQL outside `db/migrations/`. No ORMs other than Drizzle.
- **Server Actions for mutations** in the dashboard. API routes only for the public JSON API and webhooks.
- **No localStorage / sessionStorage** in React components. Use server state or React state in memory.
- **No client-side secrets.** Anything sensitive lives in `.env` (loaded server-side only).
- **Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `perf:`). Enforced by commitlint pre-commit hook.
- **Biome** for lint + format. Pre-commit hook enforces.
- **One concern per PR.** Refactor + feature in the same PR makes review impossible.

---

## 6. Database conventions

- **Soft deletes everywhere** via `archived_at TIMESTAMPTZ`. Never `DELETE` from a table with that column.
- **Audit columns required** on every mutable table: `created_at`, `updated_at`, `created_by`, `updated_by`.
- **Optimistic locking** via `version INT NOT NULL DEFAULT 0` on actively-edited tables (venues, venue_events, city_campaigns). Bump on every update; reject mismatched versions.
- **UUID primary keys** everywhere (`uuid_generate_v4()`). No serial IDs.
- **All timestamps `TIMESTAMPTZ`**, stored in UTC. Display TZ resolution: user TZ for cross-city/cross-campaign views, city TZ for city-specific detail views. See DECISIONS.md#013.
- **Money in `BIGINT` cents** (not `DECIMAL`). Avoids floating point. Currency in a sibling column. v1 supports CAD/USD/GBP as plain text — no FX conversion (DECISIONS.md#014).
- **PostGIS `geography(POINT)`** for venue and city coordinates. GiST index for cluster queries.
- **Append-only `outreach_log`.** Corrections are new rows, not edits.
- **Migrations are immutable** once applied. New migration to change something — never edit an applied one.

---

## 7. Multi-brand discipline (CRITICAL)

Get this wrong and venues see one outreach brand's email signed by another, or a participant poster credits the wrong crawl brand. Both are operationally expensive.

**OutreachBrand routing (sending paths):**
- Every send path resolves OutreachBrand context before composing.
- Cold emails route through `staff_brand_emails` matching the campaign's OutreachBrand.
- Transactional emails (posters, confirmations, staff-info-sheet delivery) route through the Postmark sender for that OutreachBrand.
- Email signature uses the OutreachBrand's footer template.

**CrawlBrand application (asset paths):**
- Participant posters use the CrawlBrand's template, logo, colors. The poster also credits the OutreachBrand as the producer.
- Public JSON API responses include the CrawlBrand's branding fields.
- Eventbrite sync targets the CrawlBrand's organization.
- Staff info sheet URLs are themed with CrawlBrand visuals.

**Cross-brand transparency (internal):**
- Staff see full venue history across all CrawlBrands and OutreachBrands in venue detail views.
- A venue's outreach log shows both brand contexts per touch.
- Cross-brand duplicate-contact prevention: if Bryle is mid-sequence with a venue under Eventsperse, system warns before starting outreach from the second OutreachBrand to the same venue in the same week.

**External isolation:**
- A venue receiving an Eventsperse email must never see signage, links, or signatures from the second OutreachBrand.
- A Fright Crawl participant poster must never include Trick or Drink branding.
- The public JSON API is scoped to one campaign; never exposes cross-brand history.

---

## 8. Critical "never do" list

1. **Never modify a migration after it's been applied.** Add a new migration that supersedes it.
2. **Never bypass the brand-context middleware** on send paths. If you find yourself reaching around it, ask in OPEN_QUESTIONS.md.
3. **Never commit secrets.** `.env` is gitignored. Use `.env.example` to document required vars.
4. **Never overwrite hand-edited Eventbrite description content outside the venue markers.** The marker pattern (`<!-- VENUES_BLOCK_START -->` / `<!-- VENUES_BLOCK_END -->`) exists to protect marketing copy.
5. **Never auto-confirm a VenueEvent from a parsed email.** Status flips to `confirmed` require a human click. False positives are operationally expensive.
6. **Never expose internal notes, do-not-contact reasons, financial data, or outreach history in the public JSON API.** Only confirmed venue facts.
7. **Never touch the promoter-engine codebase or its database from this engine.** They share a server, nothing else.
8. **Never enable open tracking on cold emails.** See DECISIONS.md#011. Reply detection via Gmail History API is the only signal; cadence advances by time, not opens.
9. **Never confuse OutreachBrand and CrawlBrand.** Section 2 of this file. Both are required on every send/asset path.
10. **Never use unicode bullet characters in generated documents.** Use the lists feature of whichever library you're in.

---

## 9. Build vs deploy environment

- **Local dev:** Node 22, Postgres + PostGIS via Docker Compose, Redis via Docker Compose, `pnpm dev` for the Next.js dev server.
- **Production:** Same Ubuntu server as the referral engine. Postgres + Redis installed as system services. App managed by **PM2** (`pm2 restart crawl-engine`). Caddy reverse-proxies HTTPS to the Next.js port. Deploys are ZIP-based via `scripts/update-from-zip.sh`, modeled on the referral engine's deploy script.

When generating code, default to assumptions valid in **both** environments unless explicitly working on local-only or prod-only paths.

---

## 10. What's already on the server (assumed)

- Ubuntu Linux
- Node 22.5+
- PM2
- A reverse proxy (we're adding Caddy for this app; promoter-engine has its own)
- promoter-engine running at `/var/www/promoter-engine` — **untouchable**

Everything else (Postgres, PostGIS, Redis, our Caddy config) is installed by `scripts/setup-server.sh` during Phase 0.

---

## 11. When in doubt

1. Re-read the relevant section of `docs/Crawl_Outreach_Engine_Spec_v3.docx` via SPEC.md.
2. Check DECISIONS.md for prior reasoning on similar points.
3. If still unclear, add to OPEN_QUESTIONS.md with options + recommendation and stop. Do not guess.

---

## 12. GUARDRAILS — production incidents

Every rule here is here because I (Claude) broke production in a way that cost a fix commit. Read this section before writing raw SQL or splitting modules across the server/client boundary.

### 12.1 Raw SQL is NOT type-checked. Verify every column.

Drizzle catches `venues.foo` at compile time when `foo` isn't a column. Raw `` sql`...` `` blocks are opaque strings to TypeScript. Every column name in a raw SQL block must be verified against the source-of-truth schema in `db/schema/*.ts` BEFORE the SQL is written, not after deploy crashes.

**My pattern-match failures (each cost a fix commit):**

| Wrong | Right | Table | Where |
|---|---|---|---|
| `staff_outreach_emails.display_name` | join `staff_members.display_name` via `staff_member_id` | `staff_outreach_emails` has `email_address`, NOT `display_name` | `9849827` |
| `events.ticket_price_cents` | no such column — use `NULL::int` or remove | `events` has `ticket_sales_count` but NO price column | `9a3a2ce` |
| `outreach_brands.brand_name` | `outreach_brands.display_name` | every brand-name SQL site | `68f1e14` |
| `cities.geocode` | `cities.location` (PostGIS `geography(POINT)`) | venue-suggestion + similar | `68f1e14` |
| `venue_events.crawl_position` | `venue_events.role` (enum) + `venue_events.slot_position` | role is the slot kind; position is within-role | `68f1e14` |
| `staff_outreach_emails.archived_at` | no such column — gate by `status` enum instead | this table has no soft-delete column | `2b569d2` |
| `cities.country` | `cities.country_code` (FK to countries) or `cities.region` | the column is country_code, not country | earlier fix |

**Process before writing raw SQL:** open `db/schema/<table>.ts`, `grep -E "^\s+\w+:"` the column list, write the SQL against THAT list. Don't trust memory, don't trust the column names in nearby SQL, don't trust the carry-over summary at the top of the transcript (it has been wrong before).

**Process before deploying raw SQL:** `bash scripts/audit-raw-sql.sh` and visually walk every column reference.

### 12.2 `import "server-only"` poisons the whole module for client value-imports

A module with `import "server-only"` at the top (or any transitive db/drizzle import) cannot have ANY values imported from a client component — only types. A value import pulls the whole module into the client bundle, webpack tries to bundle db/pg into the browser, build fails:

```
Import trace: lib/foo.ts -> some-client-component.tsx -> some-section.tsx
```

**Patterns:**

```ts
// ❌ WRONG: value import from server-only module in a client component
import { pipelineHealthFor } from "@/lib/city-progress"; // <- module is server-only

// ✅ OK: type-only import (erased at compile, no runtime bundle pull)
import type { CityProgressRow } from "@/lib/city-progress";

// ✅ OK: split client-safe pure helpers + types into a *-shared.ts module
// lib/foo-shared.ts            <- no server-only, no db, just types + pure fns
// lib/foo.ts                   <- imports "server-only", exports * from "./foo-shared", adds loaders
import { pipelineHealthFor } from "@/lib/city-progress-shared";
```

**When to split:** the moment a client component needs a non-type export from a server module, stop and split. Don't try to bend the import.

**Reference fix:** `ce5550e`. Pattern now lives as `lib/city-progress.ts` (server) + `lib/city-progress-shared.ts` (client-safe).

### 12.3 SQL errors in admin-shell rendering crash EVERY route

`getStaffSendCapStatus` is called by the top-bar pill in the admin shell. When it threw `42703 column does not exist`, every page in `/(admin)/*` rendered "Application error". Server-component throws in shell-level rendering kill the entire route group.

**Rule:** any query that runs in the layout / shell / sidebar / top-bar must be wrapped in `try/catch` with a graceful fallback. The pill should disappear, not crash the app.

Pre-deploy smoke test for shell components: load `/`, `/venues`, `/campaigns`, `/inbox`, `/city-campaigns/[any-id]` and confirm each renders without "Application error".

### 12.4 try/catch swallows SQL errors silently

`palette-search.ts` had the wrong column name for months — every Cmd+K search silently returned empty because the catch logged + returned `[]`. Users never saw an error, just felt the feature was broken.

**Rule:** when a try/catch around a query exists, the catch must log via `logger.error` with the full err object AND the query intent. Pre-deploy: `grep -rn "catch.*{$" lib/ app/` and check every catch surfaces the error to Sentry or stdout. Bonus: a silent-failure unit test that asserts a known-bad query throws.

### 12.5 The carry-over transcript summary is not a schema source

The transcript header from a compacted prior session lists column names. Those notes are second-hand and have been wrong (they had `staffOutreachEmails.emailAddress` documented correctly but I still tried to select a different non-existent column from that same table). The transcript is for context, not source-of-truth. `db/schema/*.ts` is source-of-truth.

Last updated: 2026-05-27 — added §12 after 4 production-breaking commits in one session.
