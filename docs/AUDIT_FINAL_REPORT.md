# Full Audit — Final Report (P346)

> 347-phase deep audit of the Crawl Outreach Engine, 2026-06-11 → 2026-06-13.
> Directive: audit every tab, every feature, all data linkage; fix everything
> found; never stop to ask. This report is the closeout for Waves 0, 1, 3, 4.
> Wave 2's remainder (desktop confirmation passes + parked mobile checklist)
> continues separately — its cross-cutting fixes already shipped.

## Verdict

The engine is **production-sound for the Halloween 2026 campaign**. Every
load-bearing system — send safety, cadence, lifecycle, data linkage, metrics,
backups, alerts — has now been exercised against live data or fire-drilled,
not just read. 60+ defects were found and fixed during the audit itself; the
ones that remain are listed under SKIP-FLAG with owners.

## Scores (10 = best-in-class for its purpose)

| Area | Score | Notes |
|---|---|---|
| Data integrity / linkage | 9.5 | 48-check harness green; 32 families swept; writers fixed, not just data |
| Send safety | 9.5 | Engine-drafts/humans-send held under every drill; failure taxonomy complete |
| Cadence engine | 9 | Two structural bugs found+fixed (reply-advance, warm track); offsets exact vs refdoc |
| Lifecycle (T9-T17) | 9 | Fire-drilled end-to-end incl cancellation cascade; all review_required |
| Metrics truth | 9 | Dashboard/pipeline/tracker reconcile EXACTLY vs SQL; funnel rewritten venue-level |
| Inbox / reply ops | 8.5 | Gmail parity, classification loop now fed (retrieval fix); 5 inboxes await reconnect |
| Learning loop | 8.5 | Corpus healthy, retrieval fixed, per-message override accuracy, Loop C armed |
| Alerts / watchdogs | 9 | Dead-inbox + scope-403 chains proven live; rot single-sourced |
| Backups | 8 | First successful offsite backup ever (two stacked bugs fixed); restore drill user-gated |
| Security | 8.5 | Headers shipped, authz verified, IDOR clean, 2 guardrail scripts; CSP deferred |
| Performance | 8.5 | All routes <3s under build load; crawl-matrix (2.6s) the one candidate |
| UI/UX desktop | 8.5 | All primary tabs render clean; states complete; polish waves landed |
| UI/UX mobile | 7.5 | Cross-cutting classes fixed at true 390px; per-tab remainder parked |
| Integrations | 7 | Quo/EB/SMS code-sound but dormant (no live traffic yet — re-audit triggers set) |

## Highest-impact catches (the audit paid for itself here)

1. **Backups never worked** — pg_dump blocked by a scratch table AND the B2
   upload had a malformed endpoint since install. Zero offsite copies existed
   until tonight's verified 610MB encrypted upload.
2. **Corpus retrieval was a silent zero** — every quick-reply chip and
   classifier few-shot ran ungrounded since launch (AND-query demanded a
   near-verbatim duplicate). Fixed to keyword-OR; feedback loop now engages.
3. **384 replied threads stuck in cold cadence** (incl. 7 declines), 184 due
   for a wrong cold-T2 — defused before any wrong draft existed; warm-nudge
   track was structurally unreachable and is now live.
4. **Command center crashing in production** (raw-SQL column name) and
   **sergio's inbox invisibly dead** (scope-403s didn't flip status) — both
   found by the same log pull, both fixed and proven.
5. **Funnel blind spots** — cross-thread replies uncounted (28→37), bounces
   read from a never-populated table next to 13 real suppressions.
6. **Zero security headers served** — HSTS/nosniff/X-Frame/Referrer-Policy
   now ship app-level.
7. **CSV formula-injection + capacity/phone validation gaps** — fixed at
   import and at the backup-CSV writer.
8. **8,780 + 679 records under archived campaigns never cascaded**, 3,381
   corrupted thread counters, 246 garbage venue emails, 249k audit rows
   embedding OAuth tokens — all healed with writers fixed and invariants
   added (Wave 1).

## Operator actions outstanding

1. **Reconnect 5 inboxes**: julian, Bryle, brandon, alex, sergio (sergio must
   grant ALL permission checkboxes). Replies to these are invisible until then.
2. **Venue coordinates**: say "run the coord backfill" — 16 confirmed venues
   have no lat/lng; the Smart Map renders empty without it (script ready).
3. **NZ draft decision**: bookings@thirtynine.co.nz (re-release vs write-off).
4. **Brand content**: crawl-brand logo/colors/domain fields are all null —
   the public API serves them to the Smart Map.
5. Optional enables: daily-digest cron, E3 dispatch, restore drill, Twilio.

## SKIP-FLAG register

See FULL_AUDIT_PLAN.md §SKIP-FLAG log — 14 items, each with a reason and a
re-audit trigger. None block October operations.

## P347 — Retrospective + standing self-audit

**What worked:** live drills over code reading (every big catch came from
firing the real path); verified-commit pattern (caught 3 silent failures);
the iframe rig; lockstep harness+app invariant lists; era anchoring.

**What to keep running weekly (proposal — needs your OK on the cron):**
a Sunday-night self-audit pass that (1) runs the 48-check harness,
(2) force-fires one watchdog rule round-robin, (3) reconciles the 5 pipeline
lanes + funnel vs SQL, (4) checks backup log for "Upload OK" within 7 days,
(5) probes the lineup API auth + leak-scan. ~15 minutes of compute; surfaces
to /admin/command. Say the word and it gets wired into the in-app cron
registry (no OS crontab).
