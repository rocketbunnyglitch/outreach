# ARCHITECTURE.md

> The **current state** of the system as actually built — not the planned state. If this file disagrees with the code, the code is right and this file gets fixed immediately. The Word spec (see SPEC.md) describes the target; this describes the present.

Last updated: Phase 0 scaffold (initial commit).

---

## 1. Current phase

**Phase 6a — Email templates + render engine.** Complete. Operator can author outreach copy per `(outreach brand, stage)`, with live preview against any venue + event combination. Foundation for Phase 6b (Gmail OAuth, Postmark sending, BullMQ cadences) is now in place.

What works today:
- Everything from Phases 0-5a + Phase 7 (which jumped ahead).
- **`/templates`** — list grouped by outreach brand → stage, with default templates starred.
- **Create + edit templates** scoped per `(brand, stage, name)`. Stage and brand lock after creation; name and body stay editable.
- **`lib/template-render.ts`** — pure render engine. Mustache-style `{{field.path}}` substitution against a typed `RenderContext`. 21 documented merge fields across 7 contexts. Unknown fields render as `[??path??]` markers so the operator sees broken merges visually, not silently.
- **Live preview** at `/templates/[id]?previewVenueId=…&previewEventId=…`. The picker submits via URL query so the render engine stays server-only (easier to verify, no client/server split). Phase 6b cadence emails will use the same engine — no second implementation drift.
- **"Default for stage" invariant** enforced in the action: at most one default per `(brand, stage)`. Flipping ON clears any sibling defaults in the same `withAuditContext` transaction.
- Audit chain verified: created template via SQL with `app.current_user_id` set, `audit_log` shows `INSERT | email_templates | Bryle`. Update action's sibling-default-clear writes a second UPDATE entry to audit_log per affected row.

What's pending in Phase 6b:
- **Gmail OAuth** — per-staff per-outreach-brand `staff_outreach_emails` rows (separate flow from sign-in OAuth).
- **Postmark integration** — server tokens per outreach brand for transactional sends, with delivery webhooks updating `outreach_log` outcomes.
- **BullMQ cadence runner** — Redis-backed job queue running 2-week → 1-week → 3-day touchpoint sequences automatically, with per-job venue + event + template context.
- **Gmail History API** — poll for replies, auto-pause cadences when a venue responds.
- **Bulk cadence kickoff** — from the discovery page or venues list, kick off a cadence across N selected venues.

---

## 2. Production topology (target — not yet provisioned)

```
┌─────────────────────────────────────────────────────────────────────┐
│ Ubuntu Linux server (existing)                                      │
│                                                                     │
│ ┌──────────────────────────┐    ┌──────────────────────────┐       │
│ │ promoter-engine          │    │ crawl-engine (this app)  │       │
│ │ /var/www/promoter-engine │    │ /var/www/crawl-engine    │       │
│ │ Node 22 + Express +SQLite│    │ Node 22 + Next.js        │       │
│ │ PM2: "promoter"          │    │ PM2: "crawl-engine"      │       │
│ │ Domain: barcrawlconnect  │    │ Domain: admin.barcrawl   │       │
│ │                          │    │         connect.com      │       │
│ │                          │    │         + api.barcrawl   │       │
│ │                          │    │         connect.com      │       │
│ └──────────────────────────┘    └──────────────────────────┘       │
│                                                                     │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ Shared services (installed during Phase 0)                   │   │
│ │   - PostgreSQL 16 + PostGIS 3.4    (DB: crawl_engine)        │   │
│ │   - Redis 7                        (logical DB 1)            │   │
│ │   - Caddy 2                        (HTTPS for crawl app)     │   │
│ │   - Docker                         (Supabase Realtime, P3)   │   │
│ └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │ Outbound to Backblaze B2: daily pg_dump backup               │   │
│ └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

The two apps share the host machine but nothing else: no shared DB, no shared codebase, no cross-imports, no shared user accounts. They can be independently deployed and rolled back.

---

## 3. Repository layout (current)

```
crawl-engine/
├── README.md                       # Repository entry point
├── CLAUDE.md                       # AI/contributor onboarding (READ FIRST)
├── SPEC.md                         # Navigation map into the Word spec
├── ARCHITECTURE.md                 # This file
├── DECISIONS.md                    # Architectural decision log (append-only)
├── CHANGELOG.md                    # Release history (Keep-a-Changelog format)
├── ROADMAP.md                      # Phase tracker
├── TODO.md                         # Small tasks / follow-ups
├── OPEN_QUESTIONS.md               # Pending decisions
├── VERSION                         # Single-line semver string
├── package.json
├── tsconfig.json
├── biome.json                      # Lint + format config
├── commitlint.config.mjs           # Conventional Commits enforcement
├── drizzle.config.ts
├── next.config.ts                  # Build-time env injection, standalone output
├── postcss.config.mjs              # Tailwind 4 plugin
├── ecosystem.config.cjs            # PM2 config
├── compose.yaml                    # Local Postgres + PostGIS + Redis
├── .env.example
├── .gitignore
├── .husky/
│   ├── pre-commit                  # Biome + typecheck
│   └── commit-msg                  # commitlint
├── .github/
│   ├── workflows/ci.yml            # typecheck + lint + build + commitlint
│   └── PULL_REQUEST_TEMPLATE.md
├── app/                            # Next.js App Router
│   ├── globals.css                 # Tailwind 4 import + @theme
│   ├── layout.tsx                  # Root layout with VersionFooter
│   ├── page.tsx                    # Hello-world landing
│   └── api/
│       └── health/
│           └── route.ts            # GET /api/health
├── components/
│   └── version-footer.tsx          # Server-rendered version line
├── db/
│   ├── schema.ts                   # Empty in Phase 0; Phase 1 lands real schema
│   └── migrations/                 # (created by drizzle-kit on first generate)
├── lib/
│   ├── env.ts                      # Zod-validated env config
│   ├── version.ts                  # Build-time version info source
│   ├── logger.ts                   # Pino with redaction
│   ├── db.ts                       # Drizzle + Postgres pool + pingDb
│   └── redis.ts                    # ioredis client + pingRedis
├── docs/
│   └── Crawl_Outreach_Engine_Spec_v3.docx
└── scripts/
    ├── setup-server.sh             # Idempotent server provisioning
    ├── update-from-zip.sh          # Production deploy
    └── build-with-version.sh       # Wraps `next build` with version injection
```

**Coming in Phase 1+:**

- `db/schema.ts` populated with the full data model (Section 5 of the spec).
- `db/migrations/` populated by drizzle-kit.
- `scripts/seed.ts` for sample data.
- `app/(dashboard)/` and `app/(auth)/` route groups (Phase 3).

---

## 4. Tech stack with versions

| Layer | Tech | Version |
|---|---|---|
| Runtime | Node.js | 22 LTS |
| Package manager | pnpm | latest stable |
| Framework | Next.js | 15.x (App Router) |
| UI | React | 19.x |
| Language | TypeScript | 5.x strict |
| Styling | Tailwind CSS | 4.x |
| Components | shadcn/ui | latest |
| ORM | Drizzle | latest stable |
| Database | PostgreSQL | 16 with PostGIS 3.4+ |
| Cache / queues | Redis | 7.x |
| Auth | NextAuth.js (Auth.js) | v5 |
| Background jobs | BullMQ | latest stable |
| Linter / formatter | Biome | latest stable |
| Commit linting | commitlint + husky | latest |
| Process manager | PM2 | system-installed |
| Reverse proxy | Caddy | 2.x |

External services: Postmark, Gmail API (per-staff OAuth), ZeroBounce, Google Maps Platform (Places + Distance Matrix + Geocoding), Quo, Eventbrite API, Mapbox (consumed by external map pages, not by this engine).

---

## 5. Brand model (CRITICAL)

The system has **two distinct brand entities**. Conflating them produces wrong sends. See `DECISIONS.md#010` for the full rationale.

### OutreachBrand

Operational identity. The company venues think is contacting them.

| Property | Value |
|---|---|
| Examples | Eventsperse, [second TBD] |
| Customer-facing | No — never seen by ticket buyers or attendees |
| Web presence | None (no website, no public domain) |
| Owns | Email domain, Postmark account (one per brand — see #015), staff Gmail accounts (one per staffer per brand), email signature template, Quo line |
| Routed by | Campaign FK `outreach_brand_id` |

### CrawlBrand

Public, customer-facing identity. What ticket buyers and attendees see.

| Property | Value |
|---|---|
| Examples | Fright Crawl, Trick or Drink, Midnight Pass, The Drop Pass, StPaddysCrawl, The Clover Crawl |
| Customer-facing | Yes — on Eventbrite, posters, public maps, wristbands |
| Web presence | Each has its own public domain |
| Owns | Public domain, Eventbrite organization, participant poster template, public JSON API branding fields, ticket-buyer identity |
| Geography-scoped | Toronto-only or international, enforced when assigning to a campaign |
| Routed by | Campaign FK `crawl_brand_id` |

### Pairing in Campaign

A `Campaign` row has both `outreach_brand_id` and `crawl_brand_id` (both NOT NULL). On every send/asset path the engine resolves both contexts:

- "Who's this from?" → OutreachBrand (Postmark sender, Gmail account, signature)
- "Who's this for/about?" → CrawlBrand (Eventbrite org, poster template, public branding)

Participant posters credit **both**: large CrawlBrand identity ("Fright Crawl Halloween 2026"), with a small "Presented by Eventsperse" production credit on the same poster.

### Initial brands (seeded in Phase 2 when details available)

**OutreachBrands:**
1. Eventsperse
2. (TBD-2 — name pending; see OPEN_QUESTIONS.md#Q020)

**CrawlBrands:**

| Brand | Holiday | Geography |
|---|---|---|
| Fright Crawl | Halloween | International |
| Trick or Drink | Halloween | Toronto-only |
| Midnight Pass | NYE | Toronto-only |
| The Drop Pass | NYE | International |
| StPaddysCrawl | St. Patrick's | International |
| The Clover Crawl | St. Patrick's | Toronto-only |

Full per-brand details (domains, hex colors, taglines, Eventbrite org IDs, Postmark account credentials) pending in OPEN_QUESTIONS.md#Q005.

---

## 6. Database (Phase 1 — built)

- **Instance:** PostgreSQL 16 with PostGIS 3.4 extension.
- **Database name:** `crawl_engine`
- **DB user:** `crawl_engine_app` (limited privileges to the `crawl_engine` DB only).
- **Schema language:** SQL via Drizzle migrations. Migrations under `db/migrations/` are immutable once applied.
- **Spatial extension:** PostGIS enabled in `0000_setup.sql`.
- **Backups:** `pg_dump` daily, gzipped, uploaded to Backblaze B2. 14-day local retention, 90-day offsite. See `DECISIONS.md#014`.

### Schema organization

The Drizzle schema is split across 20 domain files in `db/schema/`:

| File | Tables |
|---|---|
| `enums.ts` | 25 pgEnum types |
| `brands.ts` | outreach_brands, crawl_brands |
| `staff.ts` | staff_members, staff_outreach_emails |
| `geography.ts` | countries, cities |
| `campaigns.ts` | campaigns |
| `city-campaigns.ts` | city_campaigns |
| `events.ts` | events |
| `venues.ts` | venues |
| `venue-events.ts` | venue_events |
| `outreach.ts` | outreach_log (append-only), email_threads, reply_inbox |
| `wristbands.ts` | wristbands |
| `tasks.ts` | tasks |
| `notes.ts` | notes |
| `info-sheets.ts` | staff_info_sheets |
| `templates.ts` | email_templates, poster_templates |
| `email-validations.ts` | email_validations |
| `goals.ts` | goals |
| `financial.ts` | financial_lines |
| `saved-filters.ts` | saved_filters |
| `audit.ts` | audit_log |

Total: 21 application tables, all with appropriate FKs, indexes, and CLAUDE.md §6 conventions applied (UUID PKs, TIMESTAMPTZ in UTC, BIGINT cents for money, audit columns, optional version + archived_at).

### Migrations

Three migration files run in order:

1. **`0000_setup.sql`** (hand-written, registered via `drizzle-kit generate --custom`):
   - Enables `pgcrypto` (for `gen_random_uuid()`) and `postgis` extensions.
   - Defines `audit_trigger_func()`, `touch_updated_at_func()`, `bump_version_func()`.
2. **`0001_init.sql`** (drizzle-generated from schema):
   - Creates all 25 enums and 21 tables with FKs and indexes.
   - Post-processed by `scripts/fix-postgis-migrations.sh` to strip over-quoting on `geography(POINT, 4326)`.
3. **`0002_audit_triggers_and_indexes.sql`** (hand-written, custom migration):
   - Attaches `touch_updated_at_func`, `bump_version_func`, and `audit_trigger_func` to every applicable table (CLAUDE.md §6).
   - Creates GiST spatial indexes on `cities.location` and `venues.location`.

### Audit log

- `audit_log` is populated automatically by `audit_trigger_func()` on every INSERT/UPDATE/DELETE of audited tables.
- Captures `old_values` and `new_values` as JSONB snapshots.
- Skips no-op UPDATEs (rows where every column is unchanged).
- `changed_by` is set from session-level `app.current_user_id` if present; NULL for system-initiated changes (background jobs, seeds).
- Exempt from auditing: `audit_log` itself (would recurse), `email_validations` (high churn, low forensic value), `email_threads` / `reply_inbox` / `staff_info_sheets` / `saved_filters` (touch+bump only).
- `outreach_log` gets INSERT-only audit since the table is append-only by design.

### Audit context

`lib/db.ts` exposes `withAuditContext(staffId, fn)` which wraps any mutation in a transaction with `SET LOCAL app.current_user_id = '<uuid>'`. UUID is validated against a regex before interpolation. NULL staffId is allowed for system-initiated transactions.

### Encrypted at-rest secrets

`lib/crypto.ts` provides AES-256-GCM `encrypt(plaintext)` / `decrypt(ciphertext)`. Used for:

- Postmark server tokens (`outreach_brands.postmark_server_token`)
- Eventbrite API tokens (`crawl_brands.eventbrite_api_token`)
- Gmail OAuth refresh tokens (`staff_outreach_emails.gmail_oauth_refresh_token`)

Encryption key is `APP_ENCRYPTION_KEY` env var (64 hex chars / 32 bytes). The schema columns themselves are plain `text` — the codebase enforces encryption.

---

## 7. Admin UI (Phase 2 — built)

### Route structure

```
app/
├── layout.tsx              ← root: fonts (Geist, Instrument Serif), <body>
├── globals.css             ← Tailwind 4 @theme; OKLCH warm-tint canvas
├── api/health/route.ts     ← liveness with db/redis/encryption status
└── (admin)/                ← admin route group
    ├── layout.tsx          ← sticky nav, demo banner, max-w-6xl content
    ├── page.tsx            ← home: live brand counts → /brands
    └── brands/
        ├── page.tsx        ← list: Outreach + Crawl sections
        ├── _actions.ts     ← server actions (create/update/archive)
        ├── _components/    ← form primitives, brand forms
        ├── outreach/{new,[id]}/page.tsx
        └── crawl/{new,[id]}/page.tsx
```

All `/brands/*` pages are `force-dynamic` — they read live DB state, never prerendered.

### Aesthetic decisions (CLAUDE.md follow-ups)

- **Typography:** Geist (UI) + Instrument Serif (display titles). Avoids overused Inter/Space Grotesk.
- **Canvas:** OKLCH warm tint (`oklch(0.99 0.005 80)`) — gives chrome a "paper" feel without committing to any brand color.
- **Borders:** 0.5px hairlines on 2× displays via `@media (min-resolution: 2dppx)`.
- **Brand color leakage:** Chrome stays neutral; brand colors appear only inside content previews (e.g., the 1.5px top stripe on a `CrawlBrandCard`). This is critical for the two-brand model — staffers need to see the brand at a glance, but admin chrome should not visually imply "you are operating as Brand X."
- **Accent:** Single muted amber for warnings and destructive actions. No purple gradients.

### UI primitives

Built on Radix + CVA for accessible behavior with custom styling. Each in `components/ui/`:

| Primitive | Notes |
|---|---|
| `Button` | Variants: default / ghost / outline / destructive. Supports `asChild` via Radix Slot. |
| `Input`, `Textarea`, `Label` | Hairline-bordered, focus ring on primary. |
| `Select`, `Switch` | Radix-backed for keyboard / a11y. |
| `Badge` | Tones default / success / warning / muted / accent. |
| `Card` + slots | Header / Title / Description / Content / Footer. Title uses Instrument Serif. |
| `Alert` | Tones info / error / success with lucide icons. |

### Brand-context helpers (`lib/brand-context.ts`)

The single point of truth for "what brand am I operating under?" Per CLAUDE.md §2, every code path that needs to send email or render assets resolves the OutreachBrand + CrawlBrand pair through here.

```ts
const { outreachBrand, crawlBrand } = await requireCampaignBrands(campaignId);
// Now you can safely:
//   - Use outreachBrand.postmarkServerToken (decrypted) to send email
//   - Use crawlBrand.posterTemplateId to render a poster
```

A geography compatibility check (`checkCrawlBrandGeographyCompatibility`) prevents Toronto-only brands from being assigned to non-Toronto cities — enforced at the campaign-creation server action.

### Server-action patterns

All mutations follow the same shape:

1. **Parse FormData** → plain object via `formToObject` (handles empty strings → undefined, `"_none"` sentinel → null, boolean strings → bool).
2. **Validate** with Zod (`lib/validation/brands.ts`).
3. **Encrypt** any secret values via `lib/crypto.ts` (Postmark tokens, Eventbrite tokens).
4. **Mutate** inside `withAuditContext(staffId, fn)` so `audit_log.changed_by` is populated. (Phase 2 passes null; Phase 3 will pass the real session user.)
5. **Revalidate** affected paths and return `{ ok: true, data }` or `{ ok: false, error, fieldErrors }`.

Errors from Postgres are mapped to friendly messages: `23505` (unique violation) → "Conflict: that X is already in use", `23503` (FK violation) → "Referenced record not found."

### Form patterns

Forms use Next 15's `useActionState` for progressive enhancement (works without JS) and `useFormStatus` for pending-state UI. Two patterns worth noting:

- **Hidden-input-before-Switch:** The Radix Switch only submits its `value` when checked. To always submit a value for boolean fields, place `<input type="hidden" name="x" value="false" />` immediately before `<Switch name="x" value="true" ... />` — `formToObject` takes the last value, so the Switch's "true" wins when checked, the hidden "false" wins when not.
- **`_none` sentinel for nullable FKs:** Radix Select requires non-empty values, so the dropdown for "Default outreach brand" uses `value="_none"` for the null option. `formToObject` translates this back to `null`, which the Zod schema's `.nullable()` accepts.

---

## 8. Authentication (Phase 3 — built)

### Design choice: two-layer NextAuth v5 split

NextAuth v5 requires an edge-safe config so middleware can run on the Edge runtime (no Node modules, no DB clients). Our setup splits into:

```
auth.config.ts    ← edge-safe: providers: [], pages, authorized callback
auth.ts           ← full Node config: imports auth.config, adds Google
                    + dev-impersonation providers, signIn/jwt/session callbacks
middleware.ts     ← imports auth.config only; runs at Edge
```

The middleware does a cookie/JWT check (cheap, edge-compatible). Real access control happens in `signIn()` callback in `auth.ts` at the Node-runtime route-handler level, where we can hit the DB to verify the email matches an active staff_member.

### Sign-in providers

Two providers are registered conditionally:

| Provider | Gated on | Use case |
|---|---|---|
| Google OAuth | `GOOGLE_OAUTH_CLIENT_ID && GOOGLE_OAUTH_CLIENT_SECRET` | Production. Restricted to operator's Google Workspace via the `hd` parameter. |
| Credentials (dev-staff-impersonate) | `ENABLE_DEV_IMPERSONATION === "1" && !googleEnabled` | Local dev, demos. Sign in as any seeded staff by primary_email. |

**Why `ENABLE_DEV_IMPERSONATION` and not `NODE_ENV !== "production"`:** Next.js standalone server.js hard-codes `process.env.NODE_ENV = 'production'` at startup, so `NODE_ENV` is unreliable as a gate in standalone builds. The explicit env var forces an intentional opt-in. Belt-and-suspenders: even if accidentally set in production, the provider stays off as long as Google is configured.

### Access control gate

The canonical gate is `staff_members.primary_email`. A Google Workspace account alone is not enough — the operator must pre-provision the row. The `signIn()` callback:

1. Looks up staff_members by primary_email
2. Rejects if missing or `status !== 'active'`
3. Rewrites `user.id` to the staff_members.id (uuid) for downstream
4. Persists `staffId` and `provider` on the JWT via the `jwt()` callback
5. Exposes them on the session via the `session()` callback

### Helpers

```ts
// lib/auth.ts
getCurrentStaff(): Promise<AuthContext | null>  // null = no session or inactive
requireStaff(): Promise<AuthContext>           // redirects to /login if null

interface AuthContext { staff: StaffMember; provider: string }
```

Used at the top of `app/(admin)/layout.tsx` and every brand server action. Performance is one SELECT by primary key per request — acceptable for the freshness benefit (deactivating a staffer takes effect on their next page load).

### Wired-in audit attribution

This is the Phase 3 milestone. Every brand server action now starts with:

```ts
const { staff } = await requireStaff();
// ...zod validation...
await withAuditContext(staff.id, async (tx) => { ... });
```

The chain `requireStaff() → staff.id → withAuditContext → SET LOCAL app.current_user_id → audit_trigger → audit_log.changed_by` is verified end-to-end in `scripts/test-audit-attribution.ts`.

### `trustHost: true`

NextAuth v5 by default only trusts the host from `AUTH_URL`. We deploy behind Caddy (where Host is normalized) and develop on 127.0.0.1, so we explicitly opt into `trustHost: true` in `auth.config.ts`. Safe because Caddy is the only ingress in prod.

---

## 9. Runtime conventions

- **Process:** Single Node process started by PM2 (`pm2 start ecosystem.config.cjs`). Cluster mode disabled initially; revisit when CPU-bound.
- **Workers:** BullMQ workers run in-process at small scale. Move to a separate Node process if queue depth becomes an issue.
- **Logs:** Pino structured logs to stdout; PM2 captures to `~/.pm2/logs/crawl-engine-*.log`.
- **Health check:** `GET /api/health` returns `{ status, version, commit, db, redis, uptime_seconds }`.
- **Graceful shutdown:** SIGTERM closes the HTTP server, drains BullMQ workers, then exits.

---

## 10. Versioning (planned)

- **Semver** in `package.json` and `VERSION`.
- **Build-time injection** of `BUILD_VERSION`, `BUILD_COMMIT` (short SHA), `BUILD_AT` (ISO timestamp).
- **Runtime version footer** on every admin page: `v0.4.2 · 7a3f1c2 · 2026-06-14T18:22Z`.
- **Git tagging:** `vX.Y.Z` on `main` only.

See `DECISIONS.md#003` for the rationale on PM2 vs systemd.

---

## 11. Security boundaries

- **Auth domain:** Google OAuth restricted to the operator's Google Workspace domain.
- **Secrets:** `.env` on the server, loaded by Next.js at boot. Never committed.
- **DB user isolation:** the app's DB user cannot read the referral engine's database. Different DB user, different DB.
- **Network:** Caddy terminates TLS for the admin dashboard. Postgres and Redis listen on `127.0.0.1` only. No public port for either.

---

## 12. What's deliberately NOT here

- **Customer-facing pages.** This engine exposes a JSON API; external map pages live in a separate project.
- **The referral engine.** Same server, separate everything.
- **Test infrastructure beyond unit tests.** No e2e or load testing yet. May add in Phase 6+.
