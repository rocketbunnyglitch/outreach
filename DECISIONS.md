# DECISIONS.md

> Append-only log of architectural decisions. Each entry captures the *why* behind a choice so future contributors (human or AI) can avoid second-guessing or accidentally reversing it without context.
>
> **Never edit an entry after writing it.** Corrections come as new entries that supersede prior ones (`Supersedes: #N`). This file is the most important defense against the "I'll just refactor this because I don't understand why it's like this" failure mode.

Format per entry (lightweight ADR):

- **ID** (sequential)
- **Date** (ISO)
- **Decision** (one sentence)
- **Context** (problem prompting the decision)
- **Alternatives considered**
- **Rationale** (why this won)
- **Consequences** (what this commits us to)
- **Status** (active | superseded by #N)

---

## #001 — Single engine, campaigns layered inside

- **Date:** Phase 0 setup
- **Decision:** Build one outreach engine that hosts multiple campaigns inside a single database, rather than spinning up a separate engine instance per campaign.
- **Context:** Original instinct was to follow the referral engine's "one deployment per campaign" pattern (Halloween 2026, NYE 2026, SPD 2026 each get their own deployment). For outreach, we asked whether to do the same.
- **Alternatives considered:**
  1. One engine instance per campaign (matches referral engine).
  2. One engine, multi-campaign (chosen).
- **Rationale:** Outreach value compounds across campaigns. The same venue is contacted year after year; staff work across campaigns simultaneously; an admin needs cross-campaign productivity views. Per-instance siloing throws away the CRM property of venue history. The referral engine doesn't need cross-campaign data; this one does.
- **Consequences:**
  - Venue records permanent and shared across campaigns.
  - Campaign Switcher in admin UI; "My work today" view aggregates across campaigns.
  - Must handle 2–3 concurrent active campaigns gracefully.
  - Backup/restore touches one DB, not N.
- **Status:** active

---

## #002 — Multi-brand as first-class schema

- **Date:** Phase 0 setup
- **Decision:** Brand is a top-level entity with FKs from Campaign, StaffBrandEmail, OutreachLog, etc. Not a config-file deployment-time concept.
- **Context:** The business sometimes operates under a different brand when a region or campaign needs a reputation reset. Initial plan was deploy-time config (env var per brand). Owner indicated 5+ brands likely over 2–3 years and full transparency for staff across brands.
- **Alternatives considered:**
  1. Brand as env var per deploy (referral engine's pattern).
  2. Brand as DB row + per-record FK (chosen).
  3. Multi-tenant via Postgres schemas (`SET search_path`).
- **Rationale:** Owner wants staff to see cross-brand venue history (a venue from Frightcrawl Halloween 2024 should surface as a warm lead when planning StPaddysCrawl 2026). Env-var deployment makes that impossible — separate DBs. Schema-per-tenant adds operational complexity (N migrations to run, N backups) without value here. Single DB with Brand FK gives both isolation (every public-facing send/asset/URL is brand-scoped) and transparency (internal queries can JOIN across brands).
- **Consequences:**
  - Every outgoing send path resolves brand context before composing.
  - Public JSON API responses are campaign-scoped, never expose cross-brand history.
  - Postmark requires a sender signature per brand; Eventbrite requires an org per brand; staff need a Gmail OAuth connection per brand.
  - Adding a 6th brand is a 30-minute admin UI flow (modulo DNS), not a redeploy.
- **Status:** **superseded by #010** (the single "Brand" entity is split into two: OutreachBrand and CrawlBrand)

---

## #003 — PM2 (not systemd) for process management

- **Date:** Phase 0 setup
- **Decision:** Use PM2 to manage the Node process in production.
- **Context:** Original spec v3 called for systemd. Inspecting the existing referral engine showed the team already uses PM2 (`pm2 restart promoter`, `pm2 logs promoter`).
- **Alternatives considered:**
  1. systemd (more "standard Linux," better integration with the OS).
  2. PM2 (chosen).
- **Rationale:** Team has existing PM2 muscle memory. Same restart commands, same log commands across both apps. PM2 has cluster mode and log rotation built in. systemd would force the team to switch contexts between two process managers. The "more standard Linux" argument is real but loses to operational consistency in a small team.
- **Consequences:**
  - Deployment script restarts via `pm2 restart crawl-engine`.
  - Logs at `~/.pm2/logs/crawl-engine-*.log`.
  - Graceful shutdown handled via PM2 SIGTERM behavior.
  - PM2 ecosystem file (`ecosystem.config.cjs`) committed to the repo.
- **Status:** active

---

## #004 — Caddy as the reverse proxy for the admin dashboard

- **Date:** Phase 0 setup
- **Decision:** Use Caddy 2 as the reverse proxy for `crawls.[admin-domain]`.
- **Context:** The referral engine's docs say it's reverse-proxy agnostic; we don't know yet which proxy is actually on the production server. We need automatic HTTPS for the new admin domain and easy per-brand subdomain handling later.
- **Alternatives considered:**
  1. nginx (more familiar to most teams).
  2. Caddy (chosen).
  3. Apache (high-overhead for our use case).
- **Rationale:** Caddy's auto-TLS is genuinely simpler than Certbot + nginx for our zero-touch HTTPS goal. The Caddyfile is more readable than nginx config for our use case. If the referral engine is on nginx, both can coexist on different upstream ports without conflict (each listens on its own backend port; Caddy can also reverse-proxy to upstream nginx vhosts if needed).
- **Consequences:**
  - Caddy is installed during `setup-server.sh`.
  - Caddyfile lives at `/etc/caddy/Caddyfile`, managed alongside this app.
  - HTTPS is hands-free for new brand subdomains.
  - If the referral engine is on nginx, the two coexist; we don't touch nginx config.
- **Status:** active

---

## #005 — Public venue data via JSON API, not generated HTML

- **Date:** Phase 0 setup
- **Decision:** Expose confirmed-venue data via a versioned read-only JSON API (`/v1/campaigns/[slug]/venues`). Do not generate or host public HTML map pages from this engine.
- **Context:** Owner plans to design and host public map pages externally (potentially with Claude in a separate project). Original spec v2 had the engine writing HTML to per-brand subdomains.
- **Alternatives considered:**
  1. Engine writes static HTML to `/var/www/[brand]/[campaign]/`.
  2. Engine exposes JSON API; external sites consume (chosen).
  3. Both.
- **Rationale:** Decoupling lets the external map pages use any framework, any host. Multiple consumers (main map, partner widgets, embedded views) can share the same data. The engine stays focused on operational concerns. A new map page can be built in a separate project against a documented API.
- **Consequences:**
  - Single shared API on the engine's domain (not per-brand).
  - URL: `https://api.[engine-domain]/v1/campaigns/[slug]/venues`.
  - CORS-open, edge-cached by Caddy (30s TTL).
  - OpenAPI spec auto-generated at `/v1/openapi.json`.
  - Webhook system for cache invalidation on consumer sites.
  - Preview-mode tokens for testing against unconfirmed data during external map page development.
  - Staff info sheet URLs included in the JSON (public-linkable, dual-purpose with the QR flow).
- **Status:** active

---

## #006 — Eventbrite description integration via prose paragraphs with markers

- **Date:** Phase 0 setup
- **Decision:** The engine maintains a marker-delimited prose paragraph block inside the Eventbrite event description for participating venues. Format is prose (not structured tables), bounded by `<!-- VENUES_BLOCK_START -->` and `<!-- VENUES_BLOCK_END -->`.
- **Context:** Need to keep the venue list on the public Eventbrite page in sync, without overwriting hand-written marketing copy in the description.
- **Alternatives considered:**
  1. Engine owns the whole description (risky — overwrites marketing copy).
  2. Structured table inside markers (more scannable but feels mechanical).
  3. Prose paragraphs inside markers (chosen).
- **Rationale:** Owner preference for prose tone over table format. Marker pattern means engine only touches what it owns; hand-edits outside the markers are sacred. If markers are deleted in the Eventbrite UI, engine appends a new block at the end and warns admins (rather than silently no-op'ing).
- **Consequences:**
  - Eventbrite sync job fetches current description, locates markers, rewrites only the marked block, posts back.
  - Failure modes: missing markers → append + warn; description hand-edited outside → preserved; sync conflict → retry with exponential backoff.
  - Per-brand prose template lives on the Brand record.
- **Status:** active

---

## #007 — City priority is per-campaign, not global to city

- **Date:** Phase 0 setup
- **Decision:** Priority is stored on `city_campaigns` (the junction table), not on `cities`. Each campaign has its own priority for each city.
- **Context:** Owner noted that priority differs per campaign — a college town might be priority 1 for St. Paddy's and priority 4 for Halloween.
- **Alternatives considered:**
  1. Global priority on `cities` (simple but wrong for the business).
  2. Per-campaign on `city_campaigns` (chosen).
  3. Both (global default + per-campaign override).
- **Rationale:** Holiday character shifts which cities perform. Forcing a single number to mean the same thing across all campaigns would either be inaccurate or require constantly retuning a "global" value. Per-campaign captures reality directly.
- **Consequences:**
  - No `priority` column on `cities`.
  - `city_campaigns.priority` is required.
  - When cloning a campaign as a starting point, priority copies over but is independently editable.
- **Status:** active

---

## #008 — Eight canonical markdown files, no more

- **Date:** Phase 0 setup
- **Decision:** The repository carries exactly eight canonical markdown files at the root: README, CLAUDE, SPEC, ARCHITECTURE, DECISIONS, CHANGELOG, ROADMAP, TODO, OPEN_QUESTIONS. (Count of "eight" treats CHANGELOG and similar as one set; literal file count is 9 because OPEN_QUESTIONS was added.)
- **Context:** Need multi-chat continuity over months of AI-assisted development. Risk: too many docs, all drift from reality, all become misleading wallpaper.
- **Alternatives considered:**
  1. Per-feature spec docs (high doc-debt risk).
  2. Wiki / Notion (external, easily out of sync).
  3. Lean canonical set committed to repo (chosen).
- **Rationale:** Code review enforces doc updates; docs drift slower when they sit next to the PRs that change behavior. Eight files is the minimum to cover: entry point, AI bootstrap, spec navigation, what's built, why, what's shipped, what's planned, what's pending, what's TODO. More than that and they decay.
- **Consequences:**
  - PRs that change behavior should update CHANGELOG, ARCHITECTURE, and DECISIONS (if applicable) in the same PR.
  - No per-feature design docs.
  - API reference auto-generated from OpenAPI (not hand-written).
- **Status:** active

---

## #009 — Self-hosted Supabase for realtime, deferred to Phase 3

- **Date:** Phase 0 setup
- **Decision:** Use self-hosted Supabase Realtime (Docker) on top of our Postgres for the realtime sync layer.
- **Context:** Need realtime sync so the daily team meeting reflects live state across all open dashboards. Two options: roll-our-own LISTEN/NOTIFY + WebSockets, or use Supabase Realtime.
- **Alternatives considered:**
  1. Postgres LISTEN/NOTIFY + socket.io (more control, more code).
  2. Self-hosted Supabase Realtime (chosen).
  3. Hosted Supabase (works but adds an external dependency).
- **Rationale:** Supabase Realtime is a mature, Postgres-native realtime layer. Self-hosting via Docker keeps it on our infrastructure. Saves weeks of building a homegrown realtime stack. Decision-deferral note: Phase 3 will actually wire it up; Phase 0 just confirms the architectural direction.
- **Consequences:**
  - Phase 0 server setup installs Docker (for Supabase Realtime container).
  - Postgres ROLES configured for Supabase Realtime to subscribe.
  - Replication slot reserved.
  - Alternative remains available if Phase 3 finds Supabase Realtime unsuitable.
- **Status:** active

---

## #010 — Brand entity split into OutreachBrand and CrawlBrand

- **Date:** Phase 0 setup
- **Decision:** Replace the single `Brand` entity (#002) with two distinct entities: `OutreachBrand` (operational, venue-facing — Eventsperse, [TBD-2]) and `CrawlBrand` (public, customer-facing — Fright Crawl, Trick or Drink, Midnight Pass, The Drop Pass, StPaddysCrawl, The Clover Crawl). A Campaign references both.
- **Context:** Initial multi-brand design (#002) conflated two distinct concepts. Clarification: customer-visible "brand" (what ticket buyers see on Eventbrite, on posters, on the public map) is separate from "the company that contacts venues for bookings." The business plans to run 6 customer-facing crawl brands paired (per campaign) with 2 outreach brands.
- **Alternatives considered:**
  1. One `Brand` entity that does both jobs (original #002).
  2. Two entities: `OutreachBrand` + `CrawlBrand` (chosen).
  3. A single `Brand` with a `type` enum (cleaner-looking but loses the "every campaign needs both" constraint).
- **Rationale:** The two concepts have entirely different lifecycles, asset sets, and identity requirements. OutreachBrand owns email infrastructure and reputation; CrawlBrand owns ticket-sales identity. A Campaign in Boston might be Fright Crawl (CrawlBrand) handled by Eventsperse (OutreachBrand) one year and by the second outreach brand the next. The single-entity model couldn't represent that.
- **Consequences:**
  - Schema: `campaigns.outreach_brand_id` and `campaigns.crawl_brand_id` (both NOT NULL).
  - OutreachBrand owns: email domain, Postmark account (one per outreach brand — #015), staff Gmail accounts, email signature template, Quo line.
  - OutreachBrand does NOT own: website, public-facing assets, ticket-buyer identity.
  - CrawlBrand owns: public domain, Eventbrite organization (one per crawl brand), participant poster template, public JSON API branding fields, ticket-buyer identity.
  - CrawlBrand has a geography_scope field (toronto | international) to prevent assigning a Toronto-only brand to a non-Toronto campaign.
  - Participant posters credit BOTH (visible: CrawlBrand large; "Presented by [OutreachBrand]" credit footer).
  - Every send path must resolve both contexts.
- **Status:** active
- **Supersedes:** #002

---

## #011 — Open tracking disabled on cold emails

- **Date:** Phase 0 setup
- **Decision:** Do not embed open-tracking pixels in any cold outreach email. Cadence advances by time, not by opens. Reply detection via Gmail History API is the only inbound signal.
- **Context:** Original spec considered open tracking as a follow-up trigger ("no open in 4 days → follow-up").
- **Alternatives considered:**
  1. Enable pixel-based open tracking.
  2. Disable open tracking entirely (chosen).
- **Rationale:** Open tracking is unreliable in 2026. Apple Mail Privacy Protection prefetches every image instantly, producing false positives on roughly half of opens. Gmail image proxying and corporate Outlook image-blocking produce false negatives. Net effect: noisy data that misleads cadence decisions. Additionally, modern spam filters increasingly score tracking pixels in unsolicited B2B email as a negative deliverability signal. Reply detection is the only signal that matters for our use case (the goal is a reply, not an open).
- **Consequences:**
  - Cadence engine advances on time only: Day 4 → follow-up, Day 7 → no reply → call task.
  - Reply detection via Gmail History API auto-flips venue_event status to "interested" when affirmative reply parsed.
  - Click tracking on specific intentional links remains available as an opt-in per template (different mechanism, useful signal).
  - No tracking pixel in any outbound email.
- **Status:** active

---

## #012 — Time zone display strategy

- **Date:** Phase 0 setup
- **Decision:** All timestamps stored UTC. Display TZ resolution: user's TZ for cross-city/cross-campaign views; city's TZ for city-specific detail views.
- **Context:** Staff operate across many cities and campaigns. Single global TZ display would mislead in one direction; single city-specific TZ display would mislead in the other.
- **Alternatives considered:**
  1. Always user TZ (browser).
  2. Always city TZ.
  3. Configurable per user with sane defaults (chosen).
- **Rationale:** When looking at "today's tasks" or "this week's pipeline" the staff member needs their own TZ. When looking at "what time does this London venue open" they need the venue's TZ. Mixing is wrong; choosing one is wrong; resolving per-view is correct.
- **Consequences:**
  - DB: all timestamps `TIMESTAMPTZ` stored UTC.
  - Front-end: TZ resolver utility — accepts a "context" (cross-city | city-specific) and returns the right display TZ.
  - Cities table has `timezone` column (IANA tz).
  - User profile has `timezone` (default from browser, editable).
- **Status:** active

---

## #013 — Currency in v1: CAD, USD, GBP, plain-text, no FX

- **Date:** Phase 0 setup
- **Decision:** FinancialLine stores `currency` as plain text (ISO 4217). Display per-line. No FX conversion in v1. No base-currency rollups across mixed-currency campaigns.
- **Context:** Current geographic scope (Toronto + select international cities) is dominated by CAD, USD, GBP. Future scope unknown.
- **Alternatives considered:**
  1. Single base currency with FX rate table (chosen for v2 if scope expands).
  2. Mixed currency with no aggregation across currencies (chosen for v1).
  3. Multi-currency with daily FX snapshot (overkill for current scope).
- **Rationale:** v1 is operational, not financial-reporting-grade. Mixing currencies in the per-line view is the honest representation; staff can see "this Toronto event netted $X CAD; this London event netted £Y GBP." Forcing conversion in v1 invites stale-rate disputes during reconciliation.
- **Consequences:**
  - FinancialLine has `amount_cents BIGINT` and `currency TEXT NOT NULL`.
  - Per-campaign P&L in admin dashboard shows currency-segmented totals (not a single rolled-up number).
  - Cross-currency rollups deferred until needed.
- **Status:** active

---

## #014 — Backups to Backblaze B2

- **Date:** Phase 0 setup
- **Decision:** Daily `pg_dump` of crawl_engine DB uploaded to Backblaze B2.
- **Context:** Backup target was open until resolved. B2 is S3-compatible, ~$0.005/GB/month, with low egress fees.
- **Alternatives considered:**
  1. Backblaze B2 (chosen).
  2. AWS S3 (more expensive, more egress overhead).
  3. Another self-owned server.
  4. Local-only on host.
- **Rationale:** Cheapest credible offsite option. S3-compatible API means we can move providers later with no code change (rclone or aws-cli works with both).
- **Consequences:**
  - `scripts/backup-db.sh` writes daily `pg_dump`, gzips, uploads to B2 bucket.
  - Retention: 14 days local, 90 days offsite.
  - B2 credentials in `.env` (B2_KEY_ID, B2_APPLICATION_KEY, B2_BUCKET).
  - Restore procedure documented in OPERATOR.md (created during Phase 0 wrap).
- **Status:** active

---

## #015 — One Postmark account per OutreachBrand

- **Date:** Phase 0 setup
- **Decision:** Each OutreachBrand has its own Postmark account (not one shared account with multiple sender signatures).
- **Context:** Owner specified separate Postmark per outreach brand.
- **Alternatives considered:**
  1. One Postmark account, multiple sender signatures (cheaper, simpler billing).
  2. One Postmark account per OutreachBrand (chosen).
- **Rationale:** Full reputation isolation. If Eventsperse's deliverability deteriorates from a bad campaign, the second outreach brand's reputation is unaffected. Aligns with the operational purpose of the OutreachBrand split — reputation insulation.
- **Consequences:**
  - `outreach_brands.postmark_server_token` (encrypted) per row.
  - `outreach_brands.postmark_account_id` for admin reference.
  - Billing is per-account, scales with active outreach brands.
- **Status:** active

---

## #016 — Admin dashboard at `admin.barcrawlconnect.com`

- **Date:** Phase 0 setup
- **Decision:** The dashboard URL is `admin.barcrawlconnect.com`.
- **Context:** `barcrawlconnect.com` is the existing promoter-engine domain. Owner chose to put the new admin UI as a subdomain there.
- **Alternatives considered:**
  1. Subdomain of an existing brand domain (chosen).
  2. Dedicated brand-agnostic admin domain (cleaner separation).
  3. Subdomain of a future neutral domain.
- **Rationale:** Pragmatic — uses an existing domain, no new registration needed. Caveat noted: ties the admin URL's longevity to that one domain. If `barcrawlconnect.com` ever gets retired, the admin URL needs migration.
- **Consequences:**
  - Caddy fragment configures `admin.barcrawlconnect.com` → 127.0.0.1:3001.
  - NextAuth callback URL: `https://admin.barcrawlconnect.com/api/auth/callback/google`.
  - Public JSON API will live at `api.barcrawlconnect.com` (same pattern, separate routing).
  - Future migration to a brand-agnostic admin domain remains possible (Caddy config + NextAuth URL change, no code rewrite).
- **Status:** active

---

## #017 — Git host: GitHub private

- **Date:** Phase 0 setup
- **Decision:** Repository hosted as a private GitHub repo. CI via GitHub Actions.
- **Context:** Git host was open.
- **Alternatives considered:**
  1. GitHub private (chosen).
  2. GitLab.
  3. Self-hosted Gitea/Forgejo.
- **Rationale:** GitHub Actions is the most mature CI for our stack with the least operational burden. Free tier covers private-repo CI within reasonable limits.
- **Consequences:**
  - `.github/workflows/ci.yml` runs typecheck + lint + build on every PR.
  - PR template at `.github/PULL_REQUEST_TEMPLATE.md`.
  - Repository access controlled via GitHub team membership.
- **Status:** active

---

## #018 — Staff PTO deferred to v2

- **Date:** Phase 0 setup
- **Decision:** No PTO/availability awareness in v1. Workload auto-balancing assumes all staff equally available.
- **Context:** Admin dashboard's workload balancer would benefit from knowing when staff are out.
- **Alternatives considered:**
  1. Google Calendar integration (read OOO events).
  2. In-app availability profile.
  3. Defer to v2 (chosen).
- **Rationale:** PTO data is nice-to-have for v1. The team is small enough that the admin can mentally account for it. Adding a calendar integration in v1 means another OAuth scope, another reauth path, another failure mode — for marginal value at this team size.
- **Consequences:**
  - v1 workload balancer treats every active staff member as fully available.
  - v2 may add Google Calendar integration or an in-app availability toggle.
- **Status:** active

---

## #019 — Recommended brand-domain landing pages (advisory, not engine work)

- **Date:** Phase 0 setup
- **Decision:** Each OutreachBrand should have a single-page landing site at its bare domain — even though OutreachBrands have no website per se. This is **not** engine work; it's an operational recommendation for the owner.
- **Context:** Cold outreach to bars and restaurants: a non-trivial fraction of recipients will google the sending company before replying. If `eventsperse.com` resolves to nothing, reply rates suffer regardless of email quality. Engine doesn't build it; engine doesn't depend on it. Just flagged here to capture the discussion.
- **Recommendation to operator:** Single static HTML page per outreach brand: "We're a private event production company. For partnership inquiries, contact hello@[outreachbrand].com." Five minutes of work, real reply-rate impact.
- **Consequences:**
  - None for the engine.
  - Captured here so future contributors don't re-debate it.
- **Status:** advisory only

---

## #020 — `trustHost: true` for NextAuth v5

- **Date:** Phase 3 build
- **Decision:** Set `trustHost: true` in `auth.config.ts` so NextAuth accepts requests with any Host header.
- **Context:** NextAuth v5's default behavior is to only accept requests where the Host header matches `AUTH_URL`. Our deployment model is Caddy → Node behind a reverse proxy, where Caddy already normalizes Host. We also dev-test on 127.0.0.1 directly, where the host varies. Setting `AUTH_URL` per-environment would force every deployment to remember to set it; a single misconfiguration would break sign-in cryptically (UntrustedHost error in logs, redirects to wrong host).
- **Alternatives considered:**
  - Set `AUTH_URL` in every environment's env file — brittle, easy to forget.
  - Set `AUTH_TRUST_HOST=true` env var — works but easy to forget; making it explicit in code is louder.
  - Per-environment auth.config files — overkill.
- **Safety analysis:** `trustHost: true` lets NextAuth derive the redirect host from the incoming request's Host header. Risk surface: if an attacker can spoof Host headers reaching the Node process directly, they could potentially craft phishing redirects. Mitigation: in production, Caddy is the only ingress, and Caddy normalizes Host. In dev, the only Host header that reaches Node is what the dev sets locally.
- **Consequences:**
  - One less env var to manage.
  - Cleaner deployment story.
  - Documented in `auth.config.ts` why this is here.
- **Status:** active

---

## #021 — `ENABLE_DEV_IMPERSONATION` env var (not `NODE_ENV`)

- **Date:** Phase 3 build
- **Decision:** Gate the dev impersonation Credentials provider on an explicit `ENABLE_DEV_IMPERSONATION=1` env var, NOT on `NODE_ENV !== "production"`. Additionally require that Google OAuth is NOT configured (belt-and-suspenders).
- **Context:** Next.js's standalone `server.js` hard-codes `process.env.NODE_ENV = 'production'` at line 6 of the file, BEFORE any application code runs. So in production-style builds (which is what we use everywhere except `pnpm dev`), `env.NODE_ENV` is always `production`. Originally I gated the Credentials provider on `NODE_ENV !== "production"`, which seemed correct but never enabled in any standalone build.
- **Solution:** Explicit env var `ENABLE_DEV_IMPERSONATION`. Default off. The operator must consciously enable it for demos and dev.
- **Belt-and-suspenders:** Even if accidentally set in production, the provider stays off as long as `GOOGLE_OAUTH_CLIENT_ID` is set. So a misconfigured prod where the var leaked through still won't expose impersonation as long as Google is configured (which it must be in prod).
- **Consequences:**
  - One more env var to set in dev (a small inconvenience).
  - Cannot be accidentally enabled in production via env-var leakage.
  - Documented in `.env.example`.
- **Status:** active
