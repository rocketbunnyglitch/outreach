# TODO.md

> Running list of small tasks, bugs, and follow-ups too minor for a separate issue. When the list exceeds ~20 items, or an item exceeds half a day of work, it graduates to a GitHub issue. Clean regularly.

Last updated: June 2026.

> NOTE: The Phase 0-1 era items below are historical and mostly superseded
> (the app is in production). The live backlog now lives in the June 2026
> hardening audit + docs/QA_MATRIX.md. Open code follow-ups at time of
> writing: all-crawls total_slots should count required slots per crawl
> format (lib/all-crawls-data.ts); wire domain-alias matching into the venue
> timeline reader (lib/venue-communication.ts); auto-populate timezone/coords
> on CSV city import; add normalized name+address dedupe to the Maps venue
> add; remove dead sendThreadReply; expand automated tests. Items requiring
> live accounts (Gmail backfill/labels/stars, Sheets export, Maps paste-add)
> are tracked in docs/QA_MATRIX.md and must be human-verified before the
> 9/10 gate.

---

## Immediate next steps (Phase 4 prep)

- [ ] Phase 4: Campaigns table + Campaigns CRUD UI (FK to both OutreachBrand and CrawlBrand; reuses Phase 3's auth + audit attribution).
- [ ] Phase 4: Campaign switcher dropdown in top nav. Selecting a campaign sets a cookie that drives brand-context resolution everywhere downstream.
- [ ] Phase 4: City + CityCampaign CRUD.
- [ ] Phase 4: Venue + VenueEvent CRUD with inline editing.
- [ ] Phase 4: Self-hosted Supabase Realtime for collaborative editing (add to `compose.yaml`, wire up subscriptions on tabular views).
- [ ] Phase 4: CSV import flow to migrate operator off Google Sheets.

## Phase 3 cleanup / nice-to-haves

- [ ] When real Google OAuth client lands (#Q005), exercise the full Workspace-domain flow end-to-end.
- [ ] Consider an admin "audit log viewer" page showing the last N mutations with `changed_by` resolved to display names — useful for operator trust now that attribution works.
- [ ] Add a Playwright e2e test that drives the full sign-in → edit → verify audit_log flow.

## Phase 2 cleanup / nice-to-haves

- [ ] Add `e2e` test for brand-create roundtrip once Playwright lands.
- [ ] Asset upload flow (logos, poster backgrounds) — pushed to Phase 4 since it needs object storage.
- [ ] Consider extracting the form-section pattern into a generic `<EntityForm>` if more entities follow the same shape (probably true for Campaigns, Cities).
- [ ] The retired-brands `<details>` could use a small animation; low priority.

## Phase 1 cleanup / nice-to-haves

- [ ] Add `db/relations.ts` for Drizzle relations API (`relations()` calls) once we have query examples that need them.
- [ ] Write a unit test for `withAuditContext` UUID validation (currently relies on regex).

## Phase 0 scaffolding — remaining

- [ ] Commit `pnpm-lock.yaml` (run `pnpm install` locally first).
- [ ] Run `setup-server.sh` once SSH access is available (#Q001).
- [ ] Point DNS for `admin.barcrawlconnect.com` and `api.barcrawlconnect.com`.
- [ ] Configure rclone B2 remote on the server.
- [ ] First production deploy via `update-from-zip.sh`.

## Phase 0 + 1 — done

- [x] Eight canonical markdown files.
- [x] Spec docx in repo.
- [x] VERSION at `0.1.0-pre`.
- [x] Full Next.js 15 + TypeScript + Tailwind 4 + Drizzle scaffold.
- [x] Biome lint+format with strict rules.
- [x] commitlint + husky pre-commit hooks.
- [x] GitHub Actions CI (typecheck + lint + build + commitlint).
- [x] `.env.example` documenting every variable, phase-grouped.
- [x] `compose.yaml` for local Postgres + PostGIS + Redis.
- [x] PM2 ecosystem file.
- [x] `setup-server.sh` (awaiting SSH).
- [x] `update-from-zip.sh` deploy script.
- [x] `build-with-version.sh` build wrapper.
- [x] `lib/env.ts`, `lib/version.ts`, `lib/logger.ts`, `lib/db.ts`, `lib/redis.ts`, `lib/crypto.ts`.
- [x] Hello-world landing + `/api/health` endpoint with db/redis/encryption status.
- [x] Version footer component.
- [x] **Phase 1: 21 tables + 25 enums** in Drizzle schema split across 20 domain files.
- [x] **Audit trigger function** capturing actor, old/new values, skipping no-ops.
- [x] **Optimistic locking** via `bump_version_func` trigger.
- [x] **Auto `updated_at`** via `touch_updated_at_func` trigger.
- [x] **PostGIS GiST indexes** on cities.location and venues.location.
- [x] **Three migrations** validated end-to-end against Postgres 16 + PostGIS 3.4.
- [x] **`withAuditContext`** helper in lib/db.ts with UUID injection guard.
- [x] **AES-256-GCM encryption helpers** for at-rest secrets.
- [x] **Seed script** with all 6 CrawlBrands, Eventsperse OutreachBrand, 4 staff, 3 countries + cities with PostGIS coordinates.
- [x] **`fix-postgis-migrations.sh`** workaround for Drizzle's PostGIS quoting bug.
- [x] **Phase 2: Admin UI shell** with Apple-product aesthetic (Geist + Instrument Serif, OKLCH canvas, hairline borders, single amber accent).
- [x] **Phase 2: UI primitives** (Button, Input, Textarea, Label, Select, Switch, Badge, Card, Alert) built on Radix + CVA.
- [x] **Phase 2: OutreachBrand + CrawlBrand CRUD** end-to-end via server actions, with Zod validation, AES-256-GCM secret encryption, audit context, and friendly DB error mapping.
- [x] **Phase 2: `lib/brand-context.ts`** with `listOutreachBrands`, `listCrawlBrands`, `getCampaignBrands`, `requireCampaignBrands`, `checkCrawlBrandGeographyCompatibility`.
- [x] **Phase 2: Brand list** with config-status pill badges showing which fields are populated per brand.
- [x] **Phase 2: Runtime smoke-tested** against live Postgres + Redis. All 7 routes return 200. Home page shows live brand counts. Edit page round-trips real seeded data.
- [x] **Phase 2: Health endpoint hardened** with 1500ms timeouts on `pingDb` and `pingRedis` so it degrades gracefully when deps are down.
- [x] **Phase 3: NextAuth v5** with two-layer edge-safe/full-Node config split.
- [x] **Phase 3: Google OAuth provider** gated on env vars, Workspace-domain restricted, with offline+consent for refresh tokens.
- [x] **Phase 3: Dev impersonation Credentials provider** gated on `ENABLE_DEV_IMPERSONATION=1` AND no Google configured (belt-and-suspenders).
- [x] **Phase 3: Access control** via staff_members.primary_email lookup in signIn callback — pre-provisioning required.
- [x] **Phase 3: Edge middleware** redirects unauthenticated to `/login?from=<dest>` preserving destination.
- [x] **Phase 3: lib/auth.ts helpers** `getCurrentStaff()` and `requireStaff()`.
- [x] **Phase 3: Real staffId** passed to `withAuditContext` in all 6 brand server actions — verified end-to-end with `scripts/test-audit-attribution.ts` (Bryle's UUID lands in `audit_log.changed_by`).
- [x] **Phase 3: Top nav UserMenu** with initials avatar, role badge, sign-out, "· dev" suffix during impersonation; provider-aware DevModeBanner.
- [x] **Phase 3: Login page** with conditional Google button and one-click dev staff impersonation buttons.
- [x] **Phase 3: `trustHost: true`** in auth.config.ts so reverse-proxy and 127.0.0.1 deployments both work.

## Future considerations (don't action yet)

- [ ] Postmark per-brand setup checklist (manual step, document in OPERATOR.md).
- [ ] Google Workspace shared mailbox vs unified inbox UX — revisit at Phase 6.
- [ ] Eventbrite "Series" event handling (spec assumes single events).
- [ ] OpenTelemetry / structured tracing — defer until Phase 4.
- [ ] Audit log retention policy (currently unbounded; revisit at Phase 8 with admin viewer).
