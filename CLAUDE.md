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

Last updated: phase 0 scaffold.
