# SPEC.md

> Navigation map into the canonical specification document.
> Spec file: `docs/Crawl_Outreach_Engine_Spec_v3.docx` (40 pages, version 3.0)

This file is a short index. The Word document is the single source of truth for *what* we're building. ARCHITECTURE.md describes what's actually *built* (may lag the spec). CLAUDE.md describes how to work on the code.

---

## Section index

| # | Section | What it covers |
|---|---|---|
| 1 | Executive Summary | One-page overview, principles, headline capabilities, out-of-scope items. |
| 2 | Background & Current Process | The Google Sheets workflow being replaced; pain points; team structure. |
| 3 | Goals & Success Criteria | Measurable outcomes Phase 8 must achieve. |
| 4 | System Architecture | Hosting topology, domain layout, tech stack, subscription costs. |
| 5 | Data Model | 4 permanent record types (Brand, StaffMember, City, Venue), all relations, schema-level tables for key entities, audit & integrity patterns. |
| 6 | Feature Specification | Per-feature detail across 13 subsections. |
| 6.1 | — Multi-Brand System | First-class brand layer; isolation rules; cross-brand transparency for staff. |
| 6.2 | — Main Dashboard | Inline editing, realtime sync, campaign switcher, "My work today". |
| 6.3 | — Global Search & Saved Filters | ⌘K palette, saved filter combinations. |
| 6.4 | — City & Venue Detail Pages | Realtime, cross-brand history for venues. |
| 6.5 | — Lead Generation | Paste-a-link, PostGIS cluster builder, enrichment. |
| 6.6 | — Outreach Engine | Per-brand Gmail sending, cadences, Quo calls. |
| 6.7 | — Unified Reply Inbox | Cross-staff cross-brand reply triage with SLA. |
| 6.8 | — Confirmation Automations | The full brand-aware cascade on status → confirmed. |
| 6.9 | — Staff Information Sheet | Digital sheet per VenueEvent with QR + view tracking. |
| 6.10 | — Wristband Tracker | Shipping workflow, address auto-detect. |
| 6.11 | — Eventbrite Integration | Prose-paragraph venue block with marker-based updates. |
| 6.12 | — Public Venue JSON API | Versioned read-only API consumed by external map pages. |
| 6.13 | — Bulk Operations & CSV Import | Sheets migration, bulk actions. |
| 7 | Admin Dashboard & Reporting | Per-staff activity, quality metrics, top-down goals, financials, system health, audit log. |
| 8 | Automation Inventory | Task-by-task table of what's automated; impact estimate (~90 → ~3 hours per campaign). |
| 9 | Repository Conventions | The eight canonical markdown files (this set). |
| 10 | Version Control & Versioning | Git strategy, semver, runtime version footer, per-brand asset versioning. |
| 11 | Build Plan & Phases | 9 phases over ~10–11 weeks. Phase 4 = off-Sheets milestone. |
| 12 | Non-Functional Requirements | Performance, reliability, security, maintainability, scalability headroom. |
| 13 | Open Questions | Decisions pending stakeholder input. |
| 14 | Appendix | Glossary, reference stack versions, doc maintenance policy. |

---

## How to use this file

- **Onboarding:** read CLAUDE.md, then skim sections 1, 4, 5 of the spec.
- **Picking up a phase:** read the matching subsection of section 11 of the spec.
- **Adding a feature:** read the matching section 6 subsection, then DECISIONS.md.
- **Fixing a bug:** ARCHITECTURE.md describes what's actually built, which is what you need.

---

## Spec lifecycle

The Word spec is version-controlled separately from this repo (it's a binary file). Major rewrites bump the spec major version (v3.0 → v4.0). This SPEC.md updates when the section structure changes.

Current spec version: **3.0**
Last updated: Phase 0 scaffold.
