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

---

## Phase 2 engine build items (moved from reference doc section 11)

These items were captured from the canonical reference doc
(`lib/reference-docs/halloween-2026-intl-engine-reference.md`). They belong on
the engine roadmap, not in the reference doc itself, so they were moved here
when section 11 was removed from that doc. The reference-doc section number each
item traces back to is noted in parentheses. For what has already shipped, see
docs/IMPLEMENTATION_STATUS.md; for known gaps, docs/REFERENCE_DOC_GAPS.md.

1. Graphics tracker -- designer worklist + per-venue x campaign state (ready to be made / made / sent). (ref 7.3)
2. Info sheet generation tracker -- per-crawl x night, same workflow as graphics tracker. (ref 7.4)
3. Full call logging on venue detail page -- currently partial via OpenPhone integration; needs every call logged with outcome + operator + notes + timestamp. (ref 6.8)
4. Operator daily worklist surface -- "my drafts to review," "my pending replies," "my follow-ups due." (ref 7.1)
5. Per-venue x per-domain relationship flag -- auto-set from inbound signals + manual operator override; 1-year auto-decay. (ref 3.3)
6. Call -> email auto-fire -- when call outcome is "send me the email," engine fires next template immediately, bypassing cadence floor. (ref 6.7)
7. Outstanding calls alongside outstanding emails on daily worklist -- operators currently only see email queue. (ref 6.8)
8. Call attempt counter on venue page -- visible signal showing "called N times, last attempt X days ago, last outcome was Y." (ref 6.8)
9. Cancellation review queue -- Tuesday + Wed/Thu auto-surfacing of candidate crawls during event week. (ref 7.9)
10. Auto-deflated turnout phrase generation -- engine pulls priority + slot type + current ticket count, returns the right phrase with wave qualifier appended. (ref 5)
11. Amazon tracking integration -- auto-import tracking numbers and delivery status into the engine; surface shipping risk on campaign dashboard. (ref 7.12)
12. Subject rotation for cold sequences -- engine generates touch 1 / touch 2 / touch 3 subject variants automatically to avoid Gmail's repeat-subject spam scoring. (ref 6 / 10)
13. Host tracker -- per-city x host-type rate sheet inside the engine. Operators reference when hiring; Brandon references when paying. (ref 7.13.2)
14. Host re-confirmation reminders -- engine surfaces "host hired N days ago, hasn't been touched, event in M days" prompts to operators. (ref 7.13.4)
15. Host payment workflow as first-class engine surface -- Brandon's worklist of "hosts awaiting payment," one-click mark-paid flow, payment-method tracking with encrypted destination details. (ref 7.13.7)
16. Host reliability tracking -- per-host no-show count, lateness, performance feedback across multiple events. (ref 7.13.8)
17. Automated external host check-in cadence (H1-H5) -- 5-touch SMS sequence from 1 week out through arrival confirmation. (ref 7.14.2)
18. Single venue confirmation touch (V1) week-of for internal-host cities. (ref 7.14.3)
19. Host arrival escalation flow -- when a check-in milestone fails, engine pages the host manager. (ref 7.14.2)
20. Host briefing flow (H0a + H0b) -- two-stage email briefing for external hosts; H0a at hire time, H0b week-of with operational details. (ref 7.13.9)
21. Twilio SMS infrastructure + A2P 10DLC registration -- foundation for host SMS and any future engine-side SMS use cases. Local long-code number(s) per region, inbound webhook for replies, STOP handling, consent log.
22. Engine lineup state read-API -- stable feed exposing current confirmed lineup per crawl x night. Consumed by Smart Map (re-pointing from Google Sheets source) and Eventbrite push (re-pointing from web-form source). (ref 0.7)
23. Engine lineup change events (pub/sub) -- emits on confirm/swap/cancel. Subscribed to by Smart Map for real-time map updates and by the host SMS service for H-cadence lineup-change updates. (ref 0.7)
24. Eventbrite push integration -- operator-triggered (or auto-triggered) push of lineup info into Eventbrite event description via Eventbrite API. Revises the existing web-form-source version. (ref 0.7)
25. Lineup-change SMS to working hosts -- when lineup changes between H0b and event, engine fires brief diff SMS to the host(s) working that crawl. (ref 7.13.9)
26. Post-event relationship-flag prompt -- engine asks operators to flag each venue's event outcome (Good / Neutral / Bad) after each event. Drives T17 gating and future re-engagement decisions. (ref 7.15.3)
27. Host payment confirmation SMS -- when Brandon marks a host as paid, engine auto-sends confirmation SMS with payment details and reference number. (ref 7.15.5)
28. Cross-campaign venue state transitions -- engine moves venues between campaign states based on T17 replies (confirmed-for-nye / declined-nye-2026 / cold-outreach-nye / cooldown). (ref 7.15.6)
29. Post-event host SMS -- short single-question SMS to external hosts day-after asking distribution count; optional second message asking if anything to flag. (ref 7.15.4a)
30. Operator debrief notes field -- per crawl x night free-text notes operators fill in within a week of the event. Surfaces on campaign retrospective view. (ref 7.15.4a)
31. Emergency replacement mode -- operator-triggered emergency mode that surfaces curated candidate venues, batch-drafts T8s, suspends cross-domain cadence floors for the affected slot, prioritizes incoming replies. (ref 7.16.3)
32. Cancellation alert fan-out -- when a venue is detected as cancelled-by-them (auto from inbound reply or manual flag), engine sends parallel notifications to original confirmer, Bryle, host manager, Brandon, graphics designer, campaign manager. Multi-channel (in-app + email + SMS + phone call) with urgency tiers scaling with cancellation timing. Acknowledgment tracking with auto-escalation if owners don't respond in window. (ref 7.16.8)
33. Cancelled By Venue dedicated table -- separate per-campaign table from warm-leads, tracking acknowledgments + operational tails (shipping write-off, host reassignment, relationship flag, replacement venue). (ref 7.16.10)
34. Effective priority computation -- `lib/effective-priority.ts` combining static priority + current ticket sales + days-to-event into an adjusted priority. Wires into worklist + cold-outreach table sorting starting at day -21 of each event. Cities with sales get bumped up; cities with 0 sales near the event get bumped down. (ref 1.6)
35. V2-call task (floor-staff confirmation) -- engine adds a "V2-call" task to the host manager's daily worklist 4 days before each event for every confirmed venue. Phone call to frontline staff (not manager). Tracks call attempts + outcomes. Surfaces `floor_staff_briefed_at` on the event-day readiness view. (ref 7.14.3a)
36. Operator daily worklist surface -- the primary operator surface organized into "drafts to review," "pending replies," "follow-ups due," "calls to make," "host check-ins," "venues needing attention." (ref 8.2)
37. Auto-classification of inbound replies with confidence scoring -- engine reads inbound replies, applies one of 7 classifications with a 0-100% confidence score. Thresholds determine auto-action vs. operator-flag. Logs original classification + override for misclassification review. (ref 8.3 / 8.4)
38. Suggested response drafts for free-text questions -- engine reads venue's question, generates suggested response based on template context + venue record + reference doc rules. Operator reviews + sends. (ref 8.5)
39. Template auto-pick with one-click override -- engine picks the right template based on context (cold/warm, slot detail, big/specific ask, confirmation/lifecycle stage, post-event), operator can swap to a compatible template in one click. (ref 8.7)
40. Misclassification review surface -- admin view showing classification overrides operators have made; lets PERSE iterate on the classifier over time. (ref 8.4)
41. A/B testing infrastructure -- multiple template variants per touchpoint, random assignment per send, conversion tracking per variant, statistical significance reporting. Defer to year 2 once year-1 baseline data exists and PERSE has multi-city scale for proper sample sizes. (ref 10.3)
42. Mobile operator app -- read-only first (view worklist, log calls, mark hosts as arrived), eventually send-capable. Important for host manager use cases (moving between venues on event night). Phase 3 priority. (ref 10.6)
