# Crawl Outreach Engine

A multi-brand CRM, outreach automation platform, and operations management system for running club crawls across many cities and concurrent campaigns. Replaces a Google Sheets workflow with a Postgres-backed CRM, automated lead generation, brand-aware outreach sequencing, and per-staff productivity tracking.

## Status

**Production-hardening (June 2026).** Deployed and running in production (pm2 on the VPS, nightly Google Sheets backup armed). The Gmail inbox/CRM, campaign/city/crawl scheduling, venue directory, and Sheets export are all live. A June 2026 hardening audit scored both the inbox and non-inbox layers at ~7/10 against a 9/10 production gate; remaining work and known limitations are tracked in `ROADMAP.md` and `docs/QA_MATRIX.md`. Live QA on real Gmail/Sheets/Maps accounts is required before declaring the gate met.

See `ROADMAP.md` for the full phase plan and current progress.

## Quick links

- **`CLAUDE.md`** — start here if you're contributing (human or AI).
- **`SPEC.md`** — navigation map into the full Word spec (`docs/Crawl_Outreach_Engine_Spec_v3.docx`).
- **`ARCHITECTURE.md`** — current state of the built system.
- **`DECISIONS.md`** — architectural decisions and rationale.
- **`ROADMAP.md`** — phase tracker.
- **`OPEN_QUESTIONS.md`** — pending decisions.
- **`CHANGELOG.md`** — release history.
- **`TODO.md`** — small tasks, follow-ups.

## Tech stack

Node 22 · Next.js 15 · TypeScript · PostgreSQL 16 + PostGIS · Redis 7 · Drizzle ORM · NextAuth v5 · BullMQ · Tailwind 4 · shadcn/ui · Postmark · Gmail API · ZeroBounce · Google Maps Platform · Puppeteer · Quo · Eventbrite API · PM2 · Caddy

## Local development

```bash
# Prerequisites
node --version   # must be >= 22.5.0
pnpm --version   # must be >= 9.0.0
docker --version # for local Postgres + Redis

# First-time setup
cp .env.example .env       # default values work with docker compose
docker compose up -d       # starts Postgres + PostGIS + Redis
pnpm install
pnpm db:migrate            # runs Drizzle migrations (90+ SQL migrations in db/migrations)
pnpm dev                   # http://localhost:3001
```

Visit `http://localhost:3001` for the hello-world page and `http://localhost:3001/api/health` for the health endpoint.

## Production deployment

ZIP-based deploys to the existing Ubuntu server, modeled on the referral engine's deploy pattern (DECISIONS.md#003).

```bash
# Deploy (production runs git-based, not zip)
# On the VPS: pulls main, npm ci, applies new SQL migrations, builds,
# staggered zero-downtime pm2 reload, then a health check.
bash /root/deploy.sh
# Rollback: bash /root/deploy.sh --rollback
```

The deploy script handles fetch/rebase, migrations, build, staggered PM2 reload, and health verification (it self-syncs from scripts/deploy.sh in the repo).

## License

Proprietary. Internal use only.

## Version

Current production version: `v0.1.0-pre` (deployed; see `/api/health` for the running commit). Hardening pass in progress toward the 9/10 production gate.
