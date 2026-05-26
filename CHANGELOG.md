# CHANGELOG

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Per `DECISIONS.md#008`, every PR that changes behavior updates this file in the `[Unreleased]` section. On release, the section is renamed to the new version number and a fresh `[Unreleased]` section is started.

---

## [Unreleased]

### Added — Deploy infrastructure
- **`scripts/deploy.sh`** — one-command deploy script. Pulls from GitHub, runs migrations, builds, reloads PM2 with zero downtime, health-checks. Supports `--rollback` and `--skip-build` flags. Logs to `/var/log/outreach-deploy.log`.
- **`DEPLOY.md`** — operator runbook for production. Covers common scenarios (deploy, rollback, debug, restart), disaster recovery, architecture diagram, port map, monitoring.
- **`docs/server-setup.md`** — exact step-by-step to bring up a fresh server from scratch. Includes apt installs, Postgres + Redis tuning, DB creation, GitHub deploy key setup, nginx + PM2 config, TLS issuance.
- **Deploy verified end-to-end** on production server `203.161.61.240`. Tested git push from sandbox → git pull on server loop using fine-grained PAT + read-only deploy key.


### Added — Phase 6a Email templates + render engine
- **Email template CRUD** at `/templates`. Templates are scoped per `(outreach_brand, stage, name)` — unique index on the triple prevents accidental dupes. List page groups by brand → stage, defaults marked with a ⭐ star icon.
- **Stage taxonomy** — 8 named stages (`cold`, `follow_up_1`, `follow_up_2`, `poster_delivery`, `confirm_2_week`, `confirm_1_week`, `floor_staff_3_day`, `custom`) matching the existing Postgres enum from Phase 1.
- **"Default for stage" invariant** — exactly one default template per `(outreach_brand, stage)`. Flipping one to default automatically clears the flag on siblings in the same transaction so the constraint stays consistent in audit_log.
- **`lib/template-render.ts`** — Mustache-style merge field engine. Supports `{{venue.name}}`, `{{event.dateFormatted}}`, `{{crawlBrand.displayName}}`, etc. — 21 documented fields across 7 contexts (venue / event / campaign / city / crawlBrand / outreachBrand / staff). Unknown fields render as `[??path??]` markers so broken merges are visible inline instead of silent. `extractMergeFields(template)` deduplicates the field paths referenced in a template for the UI's "fields in use" sidebar.
- **Template editor with sidebar** — author the template in the main pane while a sidebar shows (a) which fields are in use right now (highlighted red if unknown to the engine) and (b) the full catalogue of available fields with descriptions.
- **Server-rendered live preview** at `/templates/[id]?previewVenueId=…&previewEventId=…`. Pick any venue + event-linked-to-that-venue from a dropdown; the server re-renders the subject and body against that context and shows the rendered output above the editor. Unresolved fields surface in a red alert with pill-tag chips listing exactly which paths failed.
- **`scripts/test-template-render.ts`** unit test exercises extraction, render with context, unresolved-marker behavior, empty-context degradation, and plain-text passthrough. All 6 assertions pass.
- New `Templates` link in top nav between Import and Audit.

### Added — Phase 7 Confirmation cascade (posters + staff sheets)
- **Event poster** at `/events/[id]/poster` — print-friendly customer-facing layout. Header shows holiday-type kicker + city, huge Instrument Serif crawl-brand display name, optional tagline in accent color, and the event date. Body lists CONFIRMED-only venues with slot start times, role pill badges, and addresses. Footer shows the public subdomain text + a 220×220 QR code linking to the future Phase 8 public landing URL (`${APP_URL}/p/<subdomain>/<date>`). 8.5×11 letter portrait via `@page { size: letter portrait; margin: 0 }`. Hidden toolbar in `@media print` keeps printed output clean.
- **Staff sheet** at `/events/[id]/staff-sheet` — internal night-of operational checklist. Lists ALL non-cancelled venues (lead/interested/confirmed) since a venue can still confirm day-of. Grouped by role (wristband → middle → final). Per-venue card: name, address, status badge, slot times, night-of contact name + phone (clickable `tel:` link), our-contact staff name, agreed hours, drink specials, internal notes (truncated to 200 chars). Each card has its own 100×100 QR code linking to Google Maps directions (`https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>` or address fallback).
- **`(print)` route group** with its own minimal layout — calls `requireStaff()` for auth but renders standalone `<html>` without admin chrome (no nav, no DevModeBanner, no user menu) so print output stays clean. Uses Geist fonts + Instrument Serif from Google Fonts.
- **`PrintToolbar` client component** — small floating header visible on screen, hidden in print via `.no-print` class. Has a back link and a "Print / Save as PDF" button that calls `window.print()`.
- **`lib/qrcode.ts`** — wrapper around the `qrcode` npm package's `toString(data, { type: "svg" })`. Returns SVG strings that scale perfectly for print. Default 200px size, error correction M, margin 1 module.
- **Print buttons on event edit page** — a "Print" section between the header and form with two links opening the poster and staff sheet in new tabs (so the operator can keep editing the source event). Helpful caption notes that posters show *confirmed* venues while staff sheets show all *active* venues.

### Added — Phase 5a Lead generation via Google Places
- **Discover route** at `/discover`. Operator picks a city + place types + radius → server fetches Google Places API → results render as a checklist → bulk-import selected ones. Existing venues (by `google_place_id`) are visually marked "already in venues" and disabled.
- **`lib/google-places.ts`** — Places API (New) client targeting `places.googleapis.com/v1/places:searchNearby` with a tight field mask (id, displayName, formattedAddress, internationalPhoneNumber, websiteUri, rating, userRatingCount, types, location). Falls back to deterministic mock data when `GOOGLE_MAPS_API_KEY` is unset, so the full flow is testable in dev without burning API quota.
- **Mock-mode banner** on `/discover` when no API key is configured — explicit about why results look fake.
- **Auto-dedup on import** — pre-fetches existing `googlePlaceId` values for the result set, filters them out before insert. Re-running a search and re-importing is idempotent.
- **`servesAlcohol` auto-inferred** from place types: `bar`, `night_club`, `pub`, `wine_bar`, `cocktail_lounge` → true; others (e.g. `restaurant`, `cafe`) → false. Operator can override on the venue page.
- **Phone normalization** — Google returns "international" phones like `+1 416-555-1234`; we strip non-digits except the leading `+` to match our E.164 column constraint, dropping the value silently if it doesn't validate (better blank than wrong).
- **Hard cap 100 venues per import batch** + UUID validation on incoming JSON payloads (defense in depth — never trust round-tripped JSON).
- `scripts/test-discovery.ts` exercises the full chain end-to-end: 8 mock places → 8 venues inserted → 8 INSERT audit entries attributed to Bryle → dedup query confirms place_id uniqueness.
- New `Discover` link in the top nav between Venues and Import.

### Added — Phase 4d audit log viewer + bulk operations
- **Audit log viewer** at `/audit`. Lists every recorded mutation across all 10 audit-emitting tables, newest first, with: operation icon (Plus/Pencil/Trash), table name, changed field names (computed from old_values/new_values JSONB diff), staffer name, relative timestamp ("3m ago", "2d ago"), and a "view record" link to the entity's edit page. Filters by table and by staff. 50 entries per page, paginated with Newer / Older buttons.
- **Bulk operations on venues** — multi-select checkboxes on the venues list page, plus a select-all per city group. Sticky action bar appears when anything is selected, offering: Mark DNC (with optional reason field), Unmark DNC, Archive (with confirmation). Limit 200 venues per bulk action. All bulk mutations go through `withAuditContext(staff.id, tx)` so `audit_log` captures one UPDATE entry per affected row — verified with `scripts/test-bulk-update.ts` (2 venues marked DNC → 2 UPDATE audit entries attributed to Bryle, then cleaned up).
- **`bulkUpdateVenues(ids, operation, reason?)`** action in `venues/_actions.ts`. UUID-validates each id before submitting to the DB. Hard cap of 200 ids per call.
- Audit log link added to the top nav between Import and the user menu.

### Added — Phase 4c CityCampaign + Events + VenueEvent
- **CityCampaign CRUD** — "cities in this campaign" section on `/campaigns/[id]` with inline add form (city select, priority, venue mix targets, sales goal). Dedicated `/city-campaigns/[id]` detail page with full form for editing priority, targets, lead staff assignment, and status. Remove from campaign action with confirmation panel.
- **Events CRUD** — events list on each city-campaign page (grouped by date and slot), inline create form (date + slot number + venue mix counts). `/events/[id]` detail page with required-counts form, status select, optional Eventbrite event ID for Phase 8 sync.
- **VenueEvent CRUD** — full linkage UI on the event page. Add venues from the city (filtered to exclude already-linked and do-not-contact), assign role (wristband/middle/final) and status (lead → contacted → interested → negotiating → confirmed). Click-to-edit row reveals slot times, our-contact staff assignment, and an in-place remove. When status flips to `confirmed`, `confirmedAt` timestamp gets stamped automatically so Phase 6 cadences can branch on it.
- **`lib/form-utils.ts`** — extracted `formToObject` helper now shared across all four Phase 4 entities. Same conventions (empty→undefined, `_none`→null, "true"/"on"→true).
- **`lib/validation/{city-campaigns,events,venue-events}.ts`** — Zod schemas matching the existing Postgres enums (`event_status`, `venue_role`, `venue_event_status`, `city_campaign_status`).
- **Auto-stamp `confirmedAt`** — when a venue-event status transitions to `confirmed` via the update action, the action sets `confirmedAt = now()` so downstream cadence logic in Phase 6 can compute "N days since confirmed" without scanning the audit log.

### Added — Phase 4b CSV import + outreach log
- **CSV import for venues** at `/import`. Server action parses uploaded CSV with papaparse (header row required, columns normalized to lowercase_snake_case), validates each row with `venueCsvRowSchema` (E.164 phone enforcement, csv-friendly boolean parsing for yes/no/y/n/1/0), resolves city by name (with optional country disambiguation for collisions like "London, Canada" vs "London, UK"), and bulk-inserts all valid rows in a single `withAuditContext` transaction. Per-row results UI shows which rows imported, which skipped, which errored, with row numbers matching the operator's spreadsheet view.
- **Outreach log entries** rendered as a section on the venue edit page. Append-only form for logging a touchpoint (channel × outcome × outreach brand + optional subject and notes). History list below shows past entries newest-first with channel icons (Mail/Phone/MessageSquare/MapPin/FileText), the staffer who logged it, and the outreach brand. Defaults the outreach brand select to the current campaign's brand (Phase 4a campaign switcher) so logging takes one fewer click.
- **`lib/validation/csv-import.ts`** — CSV row Zod schema + summary types. Documents the supported columns and that phone numbers are NOT auto-reformatted (operator data quality matters — silent reformatting could turn a 9-digit number into something wrong).
- **`lib/validation/outreach-log.ts`** — schemas matching the `outreach_channel` and `outreach_outcome` Postgres enums exactly. Optional subject + notes; bodySnippet/externalId stay automation-only fields for Phase 6.
- **`scripts/test-csv-import.ts`** — exercises the parse → Zod → audit-context-insert chain. Verifies that a CSV with a valid row + a bad-email row produces 1 OK + 1 error, the inserted venue exists in the DB, and `audit_log.changed_by = bryle.id`.
- New `Import` link in the top nav between Venues and the user menu.

### Added — Phase 4a core CRM (campaigns + cities + venues + switcher)
- **Campaign CRUD** at `/campaigns`, `/campaigns/new`, `/campaigns/[id]`. Form sections: Identity (slug + name), Brand pair (locked after creation), Timing & status, Public-facing subdomain, Goals (revenue cents + venue count). Server-side compatibility check rejects mismatched holiday-type/CrawlBrand pairings. Revenue stored as BigInt cents.
- **City CRUD** at `/cities`, `/cities/new`, `/cities/[id]`. PostGIS point lat/lng optional (required together). IANA timezone with curated datalist (America/Toronto, America/Los_Angeles, Europe/London, etc.). Country code uppercase-transformed.
- **Venue CRUD** at `/venues`, `/venues/new`, `/venues/[id]`. List grouped by city for scanability. E.164 phone regex, URL validation, Instagram handle normalization (strips leading @). Switch toggles for `servesAlcohol` and `doNotContact` using the hidden-input-before-Switch pattern; DNC flag surfaced in amber panel with required reason field. Internal notes textarea up to 5000 chars.
- **Campaign switcher** in top nav (`app/(admin)/_components/campaign-switcher{.tsx,-client.tsx}`). Server component fetches available campaigns + current selection; client component uses native `<details>` for keyboard accessibility and free outside-click handling. `switchCurrentCampaign` server action writes the cookie and revalidates layout.
- **`lib/current-campaign.ts`** — cookie-driven current-campaign resolution. UUID-validated, HttpOnly, 30-day, secure in prod. `getCurrentCampaign()` joins to both brand tables and returns `{campaign, outreachBrand, crawlBrand}` or null (skips archived rows).
- **Shared form primitives moved** from `app/(admin)/brands/_components/form-field.tsx` to `app/(admin)/_components/form-field.tsx` so all 4 entities use the same `FormSection`/`FieldRow`/`FieldShell` shells.
- **Brand-aware Campaign action** validates holiday-type compatibility — a Halloween campaign cannot be paired with a stpaddys CrawlBrand (`custom` holidayType bypasses).
- All 4 entities follow the Phase 3 action chain: `requireStaff()` → Zod safeParse → `withAuditContext(staff.id, tx)` → revalidatePath → redirect. End-to-end audit attribution verified.

### Fixed — PostGIS EWKB hex parser
- `db/types.ts` `geographyPoint.fromDriver` now parses Postgres's default wire format (little-endian EWKB hex like `0101000020E6100000...`) in addition to WKT. Discovered when `/cities` returned 500 on the first SELECT of seeded data with location set. The 50-character hex parses as: 1 byte order + 4 bytes geometry type + 4 bytes SRID + 8 bytes X (lng) LE float64 + 8 bytes Y (lat) LE float64.

### Added — Phase 3 auth + admin shell
- `next-auth@5.0.0-beta.25` (Auth.js v5) configured with the recommended two-layer split:
  - `auth.config.ts` — edge-safe (no DB, no Node deps); used by `middleware.ts`.
  - `auth.ts` — full Node config; loaded by API routes and Server Components. Exports `auth`, `signIn`, `signOut`, `handlers`.
- Google OAuth provider (gated on `GOOGLE_OAUTH_CLIENT_ID`/`SECRET` env vars). Workspace-domain restriction via `hd` param. `offline` + `consent` so we get a refresh token even though Phase 3 only uses session auth (Phase 6 will reuse this OAuth path for Gmail).
- Dev impersonation Credentials provider (`dev-staff-impersonate`) gated on `ENABLE_DEV_IMPERSONATION === "1"` AND no Google configured. Required because Next.js standalone hard-codes `NODE_ENV=production` at startup, making `NODE_ENV` unreliable as a gate.
- Sign-in access control: `signIn` callback looks up `staff_members.primary_email` and rejects sign-in if no active row matches. A Google Workspace account alone is NOT enough — the operator must pre-provision the staff_members row.
- `middleware.ts` — Edge-runtime route protection. Redirects unauthenticated requests to `/login?from=<dest>` preserving the destination for post-sign-in bounce. Public surfaces: `/api/auth/*`, `/api/health`, `/login`, Next.js static.
- `lib/auth.ts` — `getCurrentStaff()` (returns AuthContext or null) and `requireStaff()` (redirects to /login if null). One SELECT by PK per request; acceptable for freshness.
- `types/next-auth.d.ts` — module augmentation adding `session.user.staffId` and `session.provider`.
- `app/(admin)/layout.tsx` — REWRITTEN. Calls `requireStaff()` at the top so child pages can assume an authenticated staffer. Renders a provider-aware DevModeBanner (only shows when signed in via the dev impersonation provider, never on real Google sign-ins). New `UserMenu` in the nav with initials avatar, role badge, sign-out icon, and a "· dev" suffix during impersonation.
- `app/login/page.tsx` + `app/login/_actions.ts` + `app/login/_dev-form.tsx` — Sign-in UI with conditional Google button and a list of one-click dev impersonation buttons (one per active seeded staff_member). Apple-product feel: Instrument Serif headline, hairline-bordered cards, Geist mono small-caps for the "Dev only" badge.
- `app/api/auth/[...nextauth]/route.ts` — NextAuth catchall handler (force-dynamic).
- `auth.config.ts` includes `trustHost: true` so deployments behind Caddy (where Host header is normalized) work without setting `AUTH_URL` in every environment.
- All 6 brand server actions in `app/(admin)/brands/_actions.ts` now call `requireStaff()` and pass the real `staff.id` to `withAuditContext`. **`audit_log.changed_by` now captures the staffer's UUID for every UI-driven mutation** — verified end-to-end via `scripts/test-audit-attribution.ts`.
- `scripts/test-audit-attribution.ts` — end-to-end test that opens `withAuditContext(bryle.id, tx)`, mutates a crawl_brands row, and asserts `audit_log.changed_by === bryle.id`.
- New env var `ENABLE_DEV_IMPERSONATION` added to `lib/env.ts` schema and `.env.example`.

### Added — Phase 2 multi-brand foundation
- `lib/cn.ts` — `clsx` + `tailwind-merge` className utility.
- `lib/brand-context.ts` — `listOutreachBrands`, `listCrawlBrands`, `getOutreachBrand`, `getCrawlBrand`, `getCampaignBrands`, `requireCampaignBrands`, `checkCrawlBrandGeographyCompatibility`.
- `lib/validation/brands.ts` — Zod schemas for OutreachBrand and CrawlBrand create + update inputs, with slug normalization, hex color regex, E.164 phone regex, email-domain regex.
- UI primitives in `components/ui/`: button (with variants default/ghost/outline/destructive and sizes), input, textarea, label, select (Radix), switch (Radix), badge (with tones default/success/warning/muted/accent), card (header/title/description/content/footer), alert (info/error/success).
- Admin shell at `app/(admin)/layout.tsx` — sticky top nav with backdrop blur, Demo Mode amber banner (Phase 3 auth pending), Geist + Instrument Serif typography pair, neutral chrome with brand colors only inside content previews.
- `app/(admin)/page.tsx` — admin home with live brand counts from DB.
- `app/(admin)/brands/page.tsx` — brand list view splitting Outreach + Crawl into sections with config-status pill badges (Postmark configured? Signature? Quo line? Eventbrite? Colors?). Retired brands collapsed into details element.
- `app/(admin)/brands/_actions.ts` — server actions for create / update / archive on both brand types. Zod validation, AES-256-GCM secret encryption via `lib/crypto`, audit context via `withAuditContext(null,...)`, DB error mapping for unique-violation (23505) and FK-violation (23503).
- `app/(admin)/brands/_components/form-field.tsx` — `FormSection` (left-rail label, right column fields), `FieldRow`, `FieldShell`, `SecretConfiguredHint` (shows configured status without revealing secret).
- `app/(admin)/brands/_components/outreach-brand-form.tsx` and `crawl-brand-form.tsx` — client forms using `useActionState` + `useFormStatus`, with proper Next 15 Server Action patterns and a hidden-input-before-Switch trick for boolean form submission.
- Create/edit pages under `brands/outreach/{new,[id]}/page.tsx` and `brands/crawl/{new,[id]}/page.tsx`.
- Refined-minimalism aesthetic: Apple-product feel via OKLCH warm-tint canvas, hairline 0.5px borders on 2x displays, Instrument Serif for display moments, Geist for UI, single muted amber accent for warnings/destructive (no purple gradients).
- Health endpoint hardened: `pingDb` and `pingRedis` now use `Promise.race` with 1500ms timeouts so the endpoint degrades gracefully when deps are down instead of hanging.
- Form submission robustness: `formToObject` in server actions translates empty strings to `undefined`, the `_none` sentinel to `null`, and string `"true"/"on"/"false"/"off"` to booleans.

### Added — Phase 1 data layer
- Drizzle schema split across 20 domain files in `db/schema/`: enums, brands (outreach + crawl), staff, geography, campaigns, city-campaigns, events, venues, venue-events, outreach, wristbands, tasks, notes, info-sheets, templates, email-validations, goals, financial, saved-filters, audit.
- `db/types.ts` with PostGIS `geographyPoint` custom type and shared audit/version/archive column helpers.
- 21 application tables + audit_log, all with appropriate indexes (incl. composite FK indexes and PostGIS GiST on venues.location and cities.location).
- 25 pgEnum types covering every status/role/category enumeration in the spec.
- Three migration files: `0000_setup.sql` (extensions, audit/touch/version trigger functions), `0001_init.sql` (drizzle-generated tables), `0002_audit_triggers_and_indexes.sql` (attach triggers, create GiST indexes).
- Audit trigger fires on every audited table; reads actor from `app.current_user_id` session setting.
- `lib/db.ts` `withAuditContext(staffId, fn)` helper for setting the session actor before mutations, with UUID validation to prevent injection.
- `lib/crypto.ts` AES-256-GCM encrypt/decrypt for at-rest secrets (Postmark tokens, OAuth refresh tokens, Eventbrite tokens). Pure Node built-in crypto, zero new dependencies.
- `scripts/seed.ts` with placeholder seed data — 3 countries, 3 cities (with PostGIS coordinates), Eventsperse OutreachBrand, all 6 CrawlBrands (Fright Crawl, Trick or Drink, Midnight Pass, The Drop Pass, StPaddysCrawl, The Clover Crawl), 4 staff members (Bryle, JC, Yasue, Brandon).
- `scripts/fix-postgis-migrations.sh` workaround for Drizzle's over-quoting of PostGIS custom types; wired into `pnpm db:generate`.

### Added — Phase 0 scaffold (already shipped)
- Initial repository scaffold.
- Eight canonical markdown files: README, CLAUDE, SPEC, ARCHITECTURE, DECISIONS, CHANGELOG, ROADMAP, TODO, OPEN_QUESTIONS.
- `docs/Crawl_Outreach_Engine_Spec_v3.docx` — canonical specification (v3.0, 40 pages).
- `scripts/setup-server.sh` — server provisioning script (Phase 0, idempotent, ready to run when SSH access available).
- `scripts/update-from-zip.sh` — production deploy script modeled on the referral engine pattern (DECISIONS.md#003).
- `scripts/build-with-version.sh` — wraps `next build` with `BUILD_VERSION`, `BUILD_COMMIT`, `BUILD_AT` env injection.
- `VERSION` file with `0.1.0-pre`.
- Next.js 15 App Router scaffold with TypeScript strict mode.
- Tailwind 4 + PostCSS configuration.
- Drizzle ORM configured (schema empty, populated in Phase 1).
- Biome lint + format with strict rules.
- Conventional Commits enforced via commitlint + husky.
- `.env.example` documenting every variable, grouped by build phase.
- `compose.yaml` for local Postgres + PostGIS + Redis via Docker.
- `lib/env.ts` — zod-validated environment config, phase-aware.
- `lib/version.ts` — build-time version info source.
- `lib/logger.ts` — Pino with secret redaction.
- `lib/db.ts` — Drizzle + Postgres pool with `pingDb()`.
- `lib/redis.ts` — ioredis client with `pingRedis()`.
- `components/version-footer.tsx` — server-rendered version footer on every page.
- `app/page.tsx` — hello-world landing with version details.
- `app/api/health/route.ts` — health endpoint returning `{ status, version, commit, db, redis, uptime }`.
- `ecosystem.config.cjs` — PM2 configuration with graceful shutdown.
- `.github/workflows/ci.yml` — typecheck, lint, build, commitlint on every PR.
- `.github/PULL_REQUEST_TEMPLATE.md`.
- Architectural decisions captured: OutreachBrand vs CrawlBrand split (#010), open tracking disabled (#011), TZ display strategy (#012), currency v1 scope (#013), Backblaze B2 backups (#014), one Postmark account per OutreachBrand (#015), admin domain at `admin.barcrawlconnect.com` (#016), GitHub private (#017), staff PTO deferred (#018), recommended landing pages per OutreachBrand (#019, advisory).

### Changed
- DECISIONS.md#002 (single Brand entity) superseded by #010 (OutreachBrand + CrawlBrand split).
- ARCHITECTURE.md restructured to add Section 5 "Brand model" reflecting the two-entity design.

### Removed
- N/A.

### Fixed
- N/A.

### Security
- N/A.

---

## Version conventions

- **MAJOR** — breaking changes to the public JSON API, data migrations requiring manual intervention, or fundamental UX restructuring.
- **MINOR** — new features, new API fields, new tables, backward-compatible additions.
- **PATCH** — bug fixes, performance improvements, dependency bumps without behavior changes.

**Pre-1.0 (current).** Breaking changes between `0.x` releases are expected during the initial build. `1.0.0` ships when all spec phases complete and the system is in steady production use.

---

## Release process

```bash
# 1. All Unreleased entries are accurate and complete.
# 2. Update VERSION file:
echo "0.2.0" > VERSION
# 3. Update package.json version to match.
# 4. Rename [Unreleased] section to [0.2.0] - YYYY-MM-DD; add fresh [Unreleased].
# 5. Commit: chore(release): v0.2.0
# 6. Tag: git tag -a v0.2.0 -m "Release v0.2.0"
# 7. Push: git push origin main --tags
```

---

[Unreleased]: https://github.com/[your-org]/crawl-engine/compare/v0.1.0...HEAD
