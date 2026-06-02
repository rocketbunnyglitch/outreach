# ROADMAP.md

> Current build phase, what's done, what's next. Mirrors Section 11 of the canonical spec. Updated weekly during active build.

Last updated: June 2026 - production-hardening pass.

> CURRENT STATE: The app is deployed and in production use (Gmail inbox/CRM,
> campaign/city/crawl scheduling, venue directory, nightly Google Sheets
> backup). A June 2026 audit scored the inbox and non-inbox layers at ~7/10
> against a 9/10 production gate. The phase tables below are historical and
> may lag the code; treat docs/QA_MATRIX.md plus the audit backlog as the
> source of truth for what still needs work and live QA.

---

## Status legend

- 🟢 **Done** — shipped, in production, covered by smoke tests if applicable
- 🟡 **In progress** — actively being built right now
- ⚪ **Next** — next phase to start
- ⚫ **Planned** — scoped but not yet started
- 🔴 **Blocked** — waiting on a dependency (see OPEN_QUESTIONS.md)

---

## Phase overview

| Phase | Scope | Status | Est. duration |
|---|---|---|---|
| 0 | Infrastructure prep, repository scaffold, 8 canonical markdown files, version footer scaffolding, server setup script staged | 🟡 In progress | ~3 days |
| 1 | Data layer (Drizzle schema, all tables, PostGIS indexes, audit triggers, encrypted secrets, seed data) | 🟢 Done | ~4 days |
| 2 | Multi-brand foundation (Brand CRUD, asset uploads, brand-aware routing, brand context in every query path) | 🟢 Done | ~3 days |
| 3 | Auth + shell (Google OAuth multi-account per staff per brand, campaign switcher, base layout, realtime infra live) | 🟢 Done | ~4 days |
| 4 | Core CRM (City/Venue/VenueEvent CRUD, inline editing, realtime sync, outreach log, bulk ops, CSV import — **migrate off Sheets**) | 🟢 Done (5a wraps remaining work into Phase 5) | ~8 days |
| 5 | Lead generation (Google Places discover, PostGIS cluster builder, ZeroBounce, website/IG enrichment) | 🟡 In progress (5a done) | ~6 days |
| 6 | Outreach automation (email templates + render engine [done in 6a]; Gmail OAuth + BullMQ cadences + Postmark + reply detection [pending in 6b]) | 🟡 In progress (6a done) | ~9 days |
| 7 | Confirmation automations (print posters + staff sheets + QR codes [done in 7a]; Postmark per brand + full cascade + task system [pending in 7b]) | 🟡 In progress (7a done) | ~6 days |
| 8 | External sync + admin dashboard (Eventbrite prose blocks, JSON API with OpenAPI + webhooks, wristband shipping, goals, admin metrics, audit log viewer, daily digest, financials) | ⚫ Planned | ~8 days |

**Total:** ~51 working days, ~10–11 weeks with slack.
**Critical-path milestone:** end of Phase 4 (~22 working days) = team can migrate off Google Sheets.

---

## Phase 0 — current

### Done
- [x] Repository directory structure created.
- [x] All eight canonical markdown files written.
- [x] `docs/Crawl_Outreach_Engine_Spec_v3.docx` in repo.
- [x] `VERSION` file initialized at `0.1.0-pre`.
- [x] Initial architectural decisions captured in DECISIONS.md (#001–#019).
- [x] Next.js 15 + TypeScript + Tailwind 4 + Drizzle scaffold.
- [x] `.env.example` documenting every required env var, phase-grouped.
- [x] Biome config + commitlint + husky pre-commit/commit-msg hooks.
- [x] GitHub Actions CI (typecheck + lint + build + commitlint).
- [x] PR template.
- [x] Health endpoint at `/api/health` with db + redis ping.
- [x] Version footer component (server-rendered, all-staff visible).
- [x] Build-time injection of `BUILD_VERSION`, `BUILD_COMMIT`, `BUILD_AT`.
- [x] `compose.yaml` for local Postgres + PostGIS + Redis.
- [x] PM2 ecosystem file (`ecosystem.config.cjs`).
- [x] Deploy script (`scripts/update-from-zip.sh`) modeled on referral engine pattern.
- [x] Server setup script (`scripts/setup-server.sh`) including B2 backup config.

### In progress
- [ ] First local `pnpm install` + `pnpm dev` smoke test.
- [ ] First production deploy (blocked on SSH access).

### Blocked / waiting
- [ ] `scripts/setup-server.sh` — written but not yet run (needs server SSH access; OPEN_QUESTIONS.md#Q001).
- [x] ~~Daily backup script — backup target~~ → resolved: Backblaze B2 (DECISIONS.md#014)
- [x] ~~Admin dashboard domain~~ → resolved: `admin.barcrawlconnect.com` (DECISIONS.md#016)
- [x] ~~Git host~~ → resolved: GitHub private (DECISIONS.md#017)
- [ ] First brand records — pending brand details (OPEN_QUESTIONS.md#Q005); does NOT block Phase 0 or 1.

### Phase 0 exit criteria
- [ ] Hello-world Next.js app deployed to `admin.barcrawlconnect.com` over HTTPS.
- [ ] Drizzle migrations run cleanly against the new `crawl_engine` Postgres DB.
- [ ] Referral engine still running, untouched.
- [ ] All eight markdown files exist and cross-reference correctly.
- [ ] Version footer renders `v0.1.0 · <sha> · <time>` on the hello-world page.
- [ ] `git log` shows clean Conventional Commits.
- [ ] Tagged `v0.1.0` on `main`.

---

## Phase progress notes

This section accumulates a one-line note per significant milestone reached, oldest first.

- Phase 0 scaffold: Next.js 15 + TypeScript + Tailwind 4 + Drizzle + Biome + commitlint + GitHub Actions, all verified end-to-end with `pnpm install && pnpm build`.
- Phase 1 data layer: 21 tables + 25 enums + audit triggers + PostGIS indexes + encrypted-secrets helper + seed script, validated end-to-end against Postgres 16 + PostGIS 3.4. All 6 CrawlBrands and Eventsperse OutreachBrand seeded. Audit log captured all inserts/updates; optimistic locking version-bump trigger verified.
- Phase 2 multi-brand foundation: admin UI for CRUD on OutreachBrand and CrawlBrand. UI primitives (Button, Input, Textarea, Label, Select, Switch, Badge, Card, Alert) on Geist + Instrument Serif typography pair with refined minimalism aesthetic. Server actions with Zod validation, AES-256-GCM secret encryption, audit-context-aware transactions, and graceful DB error mapping (unique-violation, FK-violation). Brand-context helpers in `lib/brand-context.ts`: `listOutreachBrands`, `listCrawlBrands`, `getCampaignBrands`, `requireCampaignBrands`, `checkCrawlBrandGeographyCompatibility`. Runtime-tested end-to-end: all 6 routes return 200, home page shows live brand counts (1 outreach, 6 crawl), edit page round-trips real seeded data including Phase-1 Bryle-authored tagline updates. Health endpoint hardened with 1500ms timeouts on db/redis pings to fail gracefully when deps are down.
- Phase 3 auth + admin shell: NextAuth v5 with two-layer config split (edge-safe `auth.config.ts` for middleware; full Node `auth.ts` for callbacks). Google OAuth as canonical sign-in (gated on env vars, restricted to operator's Workspace domain via `hd` param). Opt-in dev impersonation Credentials provider for demos (gated on `ENABLE_DEV_IMPERSONATION=1` AND no Google configured — belt-and-suspenders). Access control via `staff_members.primary_email` lookup in `signIn` callback. Edge middleware redirects unauthenticated to `/login?from=<dest>`. `lib/auth.ts` helpers `getCurrentStaff()`/`requireStaff()` wire into all 6 brand server actions so `audit_log.changed_by` now captures the real staffer UUID — verified end-to-end via `scripts/test-audit-attribution.ts`. Top nav with provider-aware DevModeBanner, UserMenu with initials avatar, role badge, sign-out icon, "· dev" suffix during impersonation. Login page with conditional Google button and one-click dev staff impersonation buttons.
