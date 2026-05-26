# OPEN_QUESTIONS.md

> Decisions pending from stakeholders. Prevents silent assumption-making. When a question is answered, the resolution moves to DECISIONS.md and the entry here is closed.

Each entry: **Question** · **Options** · **Recommendation** · **Status** · **Blocks**.

Last updated: Phase 0 scaffold, post-resolution batch.

---

## Still open

### #Q001 — Server SSH access

**Status:** open · **Blocks:** Phase 0 server-side completion (everything in the repo can proceed without it)

The repo scaffold and markdown files are produced ahead of server access. We need to actually run `scripts/setup-server.sh` to install Postgres + PostGIS, Redis, Caddy, Docker, create the `crawl_engine` DB and limited-privilege user, and stage daily backups.

**Recommendation:** Owner provides SSH access; script runs in a screen session with output captured.

---

### #Q005 — Brand details for seeding

**Status:** open · **Blocks:** Phase 2 (multi-brand foundation). Phase 0 and 1 unblocked.

Need the following before Phase 2 seed data:

**OutreachBrands (2):**

| Field | Eventsperse | TBD-2 |
|---|---|---|
| Display name | Eventsperse | ? |
| Email domain | ? | ? |
| Postmark account credentials (encrypted at rest) | ? | ? |
| Standard email signature | ? | ? |
| Quo phone line | ? | ? |
| Staff email addresses (one per staff per brand) | ? | ? |

**CrawlBrands (6):**

| Brand | Holiday | Geography | Domain | Eventbrite org | Primary hex | Tagline |
|---|---|---|---|---|---|---|
| Fright Crawl | Halloween | International | ? | ? | ? | ? |
| Trick or Drink | Halloween | Toronto | ? | ? | ? | ? |
| Midnight Pass | NYE | Toronto | ? | ? | ? | ? |
| The Drop Pass | NYE | International | ? | ? | ? | ? |
| StPaddysCrawl | St. Patrick's | International | ? | ? | ? | ? |
| The Clover Crawl | St. Patrick's | Toronto | ? | ? | ? | ? |

**Brand pairing logic:**
- Default OutreachBrand for each CrawlBrand? Or per-campaign decision?
- Will the second (unnamed) outreach brand cover all 6 crawl brands, or only some?

---

### #Q020 — Name for the second OutreachBrand

**Status:** open · **Blocks:** Phase 2 (its Postmark account, Gmail accounts, signature template)

Owner mentioned a second outreach brand is planned but not yet named. Need a name plus the same details as Eventsperse before Phase 2 seeds it.

**Recommendation:** Defer. v1 can launch with only Eventsperse seeded; the second outreach brand record can be added later via the admin UI when ready. The schema and code support N OutreachBrands from day one.

---

## Resolved (see DECISIONS.md for full rationale)

| Q# | Resolved as | DECISION # |
|---|---|---|
| Q002 | Admin domain: `admin.barcrawlconnect.com` | #016 |
| Q003 | Backups: Backblaze B2 | #014 |
| Q004 | Git host: GitHub private | #017 |
| Q006 | Postmark: one account per OutreachBrand | #015 |
| Q007 | Open tracking: disabled | #011 |
| Q008 | Time zones: user TZ for cross-city, city TZ for city-specific | #012 |
| Q009 | Staff PTO: deferred to v2 | #018 |
| Q010 | Currency: CAD/USD/GBP plain text, no FX | #013 |
| — | OutreachBrand vs CrawlBrand split | #010 |
| — | Recommend bare-domain landing page per OutreachBrand | #019 (advisory) |

---

## What unblocks next

- **Phase 0 completes** independent of #Q005 and #Q020. Server access (#Q001) is the gate.
- **Phase 1 completes** independent of #Q005 and #Q020 — the schema supports them, seed data uses placeholders.
- **Phase 2 needs** at least Eventsperse details from #Q005 and at least one CrawlBrand's full details to seed and demo.
