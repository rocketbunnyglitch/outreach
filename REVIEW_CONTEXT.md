# REVIEW_CONTEXT.md

This zip contains the **outreach engine** — a Next.js + Postgres + Redis app for managing multi-brand bar crawl outreach campaigns. It's a CRM + outreach automation system. This document orients a code reviewer (human or LLM) to what this project is, what state it's in, and what would be useful to critique.

**If you're reviewing this zip, start here. Read this top-to-bottom before opening any code.**

---

## 1. What this project does (the business)

The operator (Bryle) runs Halloween / NYE / St Patrick's bar crawl events in multiple cities. The product is a "crawl" — a curated multi-bar route ticket buyers walk through across a night. Each crawl has:

- A **CrawlBrand** (customer-facing, e.g. "Fright Crawl" for Halloween, "Midnight Pass" for NYE) — this is the brand on the poster, the website, the Eventbrite listing
- An **OutreachBrand** (venue-facing, e.g. "Eventsperse") — the identity that emails bar owners to book the venues. Different from the public brand on purpose; protects venue relationships from public brand wars.

A **Campaign** (e.g. "Halloween 2026") has FK to both. A campaign is split into **CityCampaigns** ("Halloween 2026 — Toronto", "Halloween 2026 — NYC"). Each CityCampaign has multiple **Events** (one per crawl date — e.g. Oct 28, Oct 29, Oct 30, Oct 31). Each Event has multiple **VenueEvents** (links to specific bars with a role: wristband pickup / middle / final).

The outreach work is the engine's job: track venues, send batch outreach emails, watch for replies, confirm venues per event, generate posters + staff sheets when confirmed.

For full details see SPEC.md and ARCHITECTURE.md.

## 2. Where the codebase is at right now

Phase 0-7a are **complete and deployed to production** at `https://outreach.barcrawlconnect.com` (server: `203.161.61.240`, Ubuntu 24.04, 2GB RAM going to 6GB). The deployment is:

- nginx (TLS) → Next.js standalone bundle on port 3001 (PM2-managed)
- Postgres 16 + PostGIS 3.4 (localhost)
- Redis 7 (localhost, for future Phase 6 BullMQ queues)

Phases shipped:

- **Phase 0**: Infrastructure (Next.js 15 + TS + Tailwind 4 + Drizzle + Geist + Instrument Serif)
- **Phase 1**: 21 tables, audit triggers, PostGIS GIST indexes
- **Phase 2**: Multi-brand foundation, Apple-product minimalism aesthetic
- **Phase 3**: NextAuth v5 with Google OAuth + dev-impersonation fallback
- **Phase 4a-d**: Campaigns + Cities + Venues + CSV import + audit viewer + bulk operations
- **Phase 5a**: Lead generation via Google Places (mock-mode fallback when API key unset)
- **Phase 6**: Email templates with Mustache-style merge field rendering
- **Phase 7a**: Confirmation cascade — poster + staff sheet print-only routes
- **Dashboard**: Stocky-aesthetic operations dashboard (`app/(admin)/page.tsx`) added last

Phases NOT yet shipped (see ROADMAP.md):

- **Phase 5b**: ZeroBounce email validation, multi-radius clustering
- **Phase 6 batch send**: Postmark sending with BullMQ + per-staff Gmail OAuth
- **Phase 7b**: Headless-browser-rendered poster PDFs
- **Phase 8**: Backups (B2), monitoring, observability

## 3. What state is the production server in?

- ✅ App live, PM2 process `outreach` running
- ✅ DB migrated + seeded (6 CrawlBrands, 1 OutreachBrand "Eventsperse", 4 staff, 3 cities — Toronto / NYC / London; no actual campaigns or venues yet)
- ✅ Health endpoint returns OK (`/api/health`)
- ✅ HTTPS via Let's Encrypt with auto-renewal
- ✅ Deploy loop verified end-to-end (`bash /root/deploy.sh` pulls + builds + reloads + health-checks)
- ⏳ Dev impersonation still on (`ENABLE_DEV_IMPERSONATION=1`); Google OAuth not yet configured
- ⏳ No real campaigns/venues/events yet; operator hasn't begun using the engine
- ⏳ No backups configured yet
- ⏳ No production integrations: GOOGLE_MAPS_API_KEY, ZEROBOUNCE_API_KEY, POSTMARK_TOKENS, Gmail OAuth — all blank

## 4. Architectural choices that are deliberate but worth questioning

These are things the project did on purpose, but a reviewer might want to challenge:

### 4.1 Two-brand-type model with NOT NULL FKs on Campaign
Every campaign carries both a CrawlBrand FK and an OutreachBrand FK, both NOT NULL. This is enforced at the DB level. The decision is DECISIONS.md#010. Trade-off: rigid but prevents the entire class of bug where a campaign accidentally sends from no brand or the wrong brand.

### 4.2 Audit triggers reading session var, not app-layer logging
Every mutating table has a trigger that reads `current_setting('app.current_user_id')` and writes a row to `audit_log`. Server actions wrap mutations in `withAuditContext(staff.id, tx)` which sets the session var. Trade-off: audit can't be forgotten in app code, but tying audit to DB sessions means batch jobs need to set the var too.

### 4.3 Drizzle for query building but raw SQL for migrations
We use Drizzle Kit to generate SQL files (`db/migrations/0000_setup.sql`, etc.) but apply them with `psql` directly in production, not via `drizzle-kit push`. Reason: `drizzle-kit push` requires interactive confirmation for some operations even with `--force`, breaking deployments. Trade-off: more rigid migration discipline required from devs.

### 4.4 Standalone Next.js + PM2 (not Docker, not serverless)
The Next.js app is built as a standalone bundle (`output: "standalone"` in next.config.ts) and run via PM2. No Docker, no Vercel/Fly serverless. Trade-off: simpler ops on a $20/mo VPS, but no auto-scaling.

### 4.5 Bare-metal Postgres on same box as app
Postgres + Redis run on the same VPS as the Next.js app, both bound to localhost only. Reason: 2GB RAM, can't afford the overhead of separate services for early-stage. Will migrate to managed Postgres (Supabase/Neon) when traffic justifies.

### 4.6 Two engines on same server
This same VPS also runs a separate **promoter-engine** at `/var/www/promoter-engine` on port 3000. That's a different codebase (Bryle's Eventbrite referral tracker, not outreach). They share nginx + PM2 instance + the box, but have separate DBs and separate codebases.

### 4.7 The "dashboard is mostly empty until you use it" UX
The dashboard expects you to create campaigns first. With no data, you see an empty-state CTA. Trade-off: clearer than fake data, but feels barren on first login.

## 5. Where I'd want a code reviewer to focus

If you (the reviewer) are an LLM evaluating this, here are the most useful things to critique:

### A. The new operations dashboard
Files: `app/(admin)/page.tsx`, `app/(admin)/_components/dashboard/*`, `lib/dashboard-queries.ts`

This is the newest code. Designed to match the "Stocky" trading-dashboard aesthetic (dark mode, sparklines, dense data tables). The cities table is the centerpiece — expandable rows showing campaigns → events.

Specific things to critique:
- Is the data query in `lib/dashboard-queries.ts` doing too much in one function? Should it split?
- The sparkline component is hand-rolled SVG with bezier smoothing. Is that the right call vs. installing recharts?
- The "KPI sparklines are placeholders flat at current value" — is that misleading? Better to hide them entirely?
- Status badges + alternating row colors — does the visual hierarchy work?
- Tabular-nums + Geist Mono for column alignment — does this play well with the warm-tinted canvas that's the rest of the app's aesthetic?

### B. Multi-brand identity model
Files: `db/schema/brands.ts`, `db/schema/campaigns.ts`, `lib/brand-context.ts`

The two-brand-type model is core. Is the abstraction right? Are there cases where the operator would want a campaign with only one or the other?

### C. Audit triggers
Files: `db/migrations/0002_audit_triggers_and_indexes.sql`, `lib/with-audit-context.ts`

Audit attribution relies on session variables. Is that fragile? Should it be in the app layer? What happens if a developer forgets `withAuditContext`?

### D. Server action discipline
Files: any `app/(admin)/**/actions.ts`

The pattern is: `requireStaff()` → `formToObject()` → Zod safeParse → DB error wrap → `withAuditContext(staff.id, tx)` → revalidatePath → redirect. This is repeated. Is it boilerplate-y enough to deserve a helper? Or is the explicitness worth it?

### E. Phase boundaries
Files: ROADMAP.md, DECISIONS.md

The phase model defers a lot to later. Are the right things deferred? Are any "must have day 1" things hiding in later phases?

### F. The deploy infrastructure
Files: `scripts/deploy.sh`, `DEPLOY.md`, `docs/server-setup.md`

One operator, one box, one git pull. Is this robust enough? Should there be a staging environment? What's missing for a serious deploy?

## 6. Things I'm explicitly aware of that need work

These are known. You don't need to flag them — they're on the punchlist:

- ⚠ Backups: no automated `pg_dump → B2` cron yet
- ⚠ Monitoring: no UptimeRobot / Sentry yet (planned Phase 8)
- ⚠ Email validation: ZeroBounce integration stub exists but no key
- ⚠ Real Postmark sending: not wired up yet (Phase 6 batch send)
- ⚠ Google OAuth: not configured; dev-impersonation still on
- ⚠ Tests: no unit/integration test suite. `scripts/test-*.ts` are ad-hoc verification scripts, not a real suite
- ⚠ Rate limiting: no rate limits on `/api/health` or any other endpoint
- ⚠ CSRF: NextAuth handles session CSRF but server actions don't have explicit token checks (Next.js's same-origin policy is the only defense)
- ⚠ The promoter-engine sharing this VPS is an ops smell — would be cleaner on its own box

## 7. What to look at first

In order:

1. **README.md** — what is this thing
2. **SPEC.md** — the original spec, what the engine is supposed to do
3. **ARCHITECTURE.md** — the deeper how
4. **DECISIONS.md** — the trade-offs and why
5. **ROADMAP.md** — what's done, what's next
6. **CHANGELOG.md** — everything that shipped, in order, with reasoning
7. **db/schema/** — the data model (especially brands, campaigns, events, venues)
8. **app/(admin)/page.tsx** + **lib/dashboard-queries.ts** — the dashboard (newest code)
9. **app/(admin)/venues/actions.ts** (or similar) — typical server action shape
10. **DEPLOY.md** + **docs/server-setup.md** — how this runs in production

## 8. What's NOT in this zip

- `node_modules/` (re-install with `npm ci`)
- `.next/` (build output)
- `.env` (secrets — see `.env.example` for the shape)
- `.git/` (no git history; if you want commit history clone from `github.com/toptorontoclubs/outreach` — note this is a private repo)
- The promoter-engine sibling codebase (unrelated)

## 9. How to actually run it locally if a reviewer wants to

```bash
# 1. Install deps
npm ci

# 2. Set up local Postgres + Redis (or use Docker)
docker compose up -d  # uses compose.yaml

# 3. Migrate
for f in db/migrations/*.sql; do psql ... -f "$f"; done

# 4. Seed
npx tsx scripts/seed.ts

# 5. Copy .env.example to .env and fill in values
cp .env.example .env
# Generate secrets: openssl rand -hex 32 (for NEXTAUTH_SECRET, APP_ENCRYPTION_KEY)
# Set ENABLE_DEV_IMPERSONATION=1 to bypass Google OAuth in dev

# 6. Run
npm run dev
# Open http://localhost:3000
```

---

*Generated for review on 2026-05-26. Project owner: Bryle (toptorontoclubs@gmail.com). Production at outreach.barcrawlconnect.com.*
