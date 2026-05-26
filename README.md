# Crawl Outreach Engine

A multi-brand CRM, outreach automation platform, and operations management system for running club crawls across many cities and concurrent campaigns. Replaces a Google Sheets workflow with a Postgres-backed CRM, automated lead generation, brand-aware outreach sequencing, and per-staff productivity tracking.

## Status

**Phase 0** — infrastructure prep, repository scaffold complete. Next.js app boots locally with a working health endpoint and version footer. Server-side setup pending SSH access.

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
pnpm db:migrate            # runs Drizzle migrations (empty in Phase 0)
pnpm dev                   # http://localhost:3001
```

Visit `http://localhost:3001` for the hello-world page and `http://localhost:3001/api/health` for the health endpoint.

## Production deployment

ZIP-based deploys to the existing Ubuntu server, modeled on the referral engine's deploy pattern (DECISIONS.md#003).

```bash
# Build a release
pnpm build
# (zip the standalone output + needed files — script in Phase 0 wrap-up)

# On the server
bash scripts/update-from-zip.sh /tmp/crawl-engine-X.Y.Z.zip
```

The deploy script handles snapshotting, rsync, migrations, build, PM2 restart, and health verification with three-tier exit codes.

## License

Proprietary. Internal use only.

## Version

Current production version: `v0.1.0-pre` (Phase 0)

<!-- PAT push test 2026-05-26, will be reverted -->
