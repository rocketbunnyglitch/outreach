# PERSE Engine Phased Build Spec — Halloween 2026

> **Purpose:** Phased, continuously-trackable build spec for aligning the PERSE outreach engine with the Halloween 2026 International Outreach Reference doc. Designed to be handed to Claude Code (or any agent) one phase at a time, with explicit acceptance criteria + a tracker the agent updates as it goes.
>
> **Reference doc:** `halloween-2026-intl-engine-reference.md` (1908 lines, locked) — referred to throughout as "the Reference Doc."
>
> **Repo:** `outreach.barcrawlconnect.com` (rocketbunnyglitch/outreach). Workspace: `/tmp/outreach-test`.

---

## How to use this document

### For the operator handing this to Claude Code

This spec is designed to be executed **one phase at a time** in fresh Claude Code sessions. Each phase is self-contained and small enough to fit comfortably in a single session.

**Recommended workflow:**

1. Read the Build Tracker (below) to see what's next.
2. Copy the next unchecked phase block to Claude Code with this prefix:

   ```
   Working from /Users/[you]/path/to/engine-build-spec-phased.md.
   Execute PHASE X.Y exactly as written. When done:
     1. Verify all acceptance criteria pass
     2. Run pre-commit gates (tsc, biome, server-only audit)
     3. Commit with the suggested message
     4. Push to main
     5. Update the Build Tracker in this doc by checking the phase complete
     6. Report back with: commit SHA, files changed, any deviations from spec
   ```

3. Review the agent's output, verify the commit, then start the next phase in a fresh session.

### For Claude Code executing a phase

When you receive a phase:

1. **Read the phase block in full.** Don't skim.
2. **Check phase dependencies.** If the prior phase is unchecked in the tracker but is listed as a dependency, STOP and tell the operator.
3. **Reference the Reference Doc by section code** when implementing rules — `[ReferenceDoc §6.3]` should appear in code comments where the doc's section drove the behavior.
4. **Do not invent scope.** Build exactly what's specified. If something seems wrong or ambiguous, flag it and ask before proceeding.
5. **Test before committing.** Each phase has acceptance criteria that should be verifiable from a fresh clone.
6. **Update the tracker** when complete. Edit this file to flip the checkbox.

### For the operator monitoring progress

The Build Tracker (below) is the single source of truth for build progress. After each phase commits, the tracker is updated. To check overall progress, just look at how many checkboxes are filled in.

---

## Build Tracker

> Claude Code: when you complete a phase, edit this section by changing `[ ]` to `[x]` and appending the commit SHA in parentheses.

### Phase 0 — Reference doc integration (foundation)

- [x] 0.1 — Doc formatting + repo placement (e7945e8)
- [x] 0.2 — Reference docs schema migration (fb6c18e)
- [x] 0.3 — Doc loader script (parse + tag + persist; full-text not embeddings) (1d72974, refactor e0beaf5)
- [x] 0.4 — AI retrieval helper (`lib/reference-retrieval.ts`) (3709236)
- [x] 0.5 — Operator-facing reference viewer page (ef134aa)
- [ ] 0.6 — CI sync workflow + doc-change detection

### Phase 1 — Templates, cadence, turnout (foundation)

- [ ] 1.1 — Migration: campaign-scoped templates schema
- [ ] 1.2 — Seed T1-T17 templates for Halloween 2026
- [ ] 1.3 — Seed H0a, H0b, V1 host/venue templates
- [ ] 1.4 — `lib/template-picker.ts` with `pickTemplate(ctx)`
- [ ] 1.5 — Composer integration of `pickTemplate`
- [ ] 1.6 — `lib/turnout-quote.ts` helper
- [ ] 1.7 — Migration: cadence_state enum + venue_campaign_touch_log
- [ ] 1.8 — `lib/cadence-engine.ts` (replace `follow-up-cadence.ts`)
- [ ] 1.9 — Cadence floor enforcement in send pipeline
- [ ] 1.10 — Daily cadence cron rewrite
- [ ] 1.11 — Migrate existing threads to new cadence_state
- [ ] 1.12 — Reply classification enum: add `stalled_warm`, `cancelled_by_them`
- [ ] 1.13 — Classifier prompt updated to use Reference Doc retrieval
- [ ] 1.14 — 90% confidence threshold logic + needs-attention flagging

### Phase 2 — Operator daily UX

- [ ] 2.1 — `/worklist` page scaffolding + nav entry
- [ ] 2.2 — Worklist Section 1: Drafts to review and send
- [ ] 2.3 — Worklist Section 2: Pending replies
- [ ] 2.4 — Worklist Section 3: Follow-ups due (next few days)
- [ ] 2.5 — Worklist Section 4: Calls to make today
- [ ] 2.6 — Worklist empty-state + completion stats
- [ ] 2.7 — Inbox: engine suggestion bar above reply
- [ ] 2.8 — Inbox: classification confirmation chip
- [ ] 2.9 — Inbox: suggested-response UI for questions
- [ ] 2.10 — Inbox: cadence floor warning in composer
- [ ] 2.11 — Inbox: quick-action chips (Engaged / Soft No / etc.)
- [ ] 2.12 — Cold outreach: cadence-aware row states + next-action column
- [ ] 2.13 — Cold outreach: bulk actions (schedule next touches / bulk add / bulk reassign)
- [ ] 2.14 — Cold outreach: cross-domain handoff flow
- [ ] 2.15 — Effective priority computation + worklist sorting

### Phase 3 — Post-confirm + lifecycle

- [ ] 3.1 — `lib/lifecycle-scheduler.ts` with `scheduleLifecycle(venueEventId, confirmedAt)`
- [ ] 3.2 — Lifecycle scheduling on venue-confirm action
- [ ] 3.3 — Multi-night venue bundling logic
- [ ] 3.4 — Late-addition flow (<2 wks → bundled T9-near)
- [ ] 3.5 — Slot-change reply handling (cancel + re-confirm pattern)
- [ ] 3.6 — H0a hire-time briefing email + trigger
- [ ] 3.7 — H0b week-of briefing email + trigger
- [ ] 3.8 — Migration: per-venue × per-domain relationship flag table
- [ ] 3.9 — Relationship flag auto-detection from inbound replies
- [ ] 3.10 — Hard-block on send for `bad`-flagged domain × venue pairs
- [ ] 3.11 — Auto-decay cron for `bad` flags (1-year horizon)
- [ ] 3.12 — Post-event relationship-flag prompt UI
- [ ] 3.13 — V2-call task surfacing (floor-staff confirmation)

### Phase 4 — Cancellation + safety nets

- [ ] 4.1 — `lib/cancellation-flow.ts` with `triggerVenueCancellation()`
- [ ] 4.2 — Auto-detection of cancellation language in inbound replies
- [ ] 4.3 — Stop-downstream-touches logic on cancellation
- [ ] 4.4 — T16 cancellation email template + draft generation
- [ ] 4.5 — Multi-staff notification fan-out (in-app + email)
- [ ] 4.6 — Acknowledgment tracking + auto-escalation
- [ ] 4.7 — Cancelled-by-Venue dedicated table view (`/campaigns/[id]/cancelled-venues`)
- [ ] 4.8 — Comeback flow handling
- [ ] 4.9 — Misrouted positive reply routing

### Phase 5 — NYE / SMS (post-Halloween 2026)

- [ ] 5.1 — Twilio account + A2P 10DLC registration kickoff
- [ ] 5.2 — `lib/sms.ts` send + receive infrastructure
- [ ] 5.3 — Inbound webhook + STOP handling + consent log
- [ ] 5.4 — Host H1-H5 SMS cadence
- [ ] 5.5 — Lineup-change SMS to working hosts
- [ ] 5.6 — Host payment confirmation SMS
- [ ] 5.7 — Engine lineup state read-API for Smart Map
- [ ] 5.8 — Engine lineup change pub/sub events
- [ ] 5.9 — Eventbrite push integration (re-point from web-form)
- [ ] 5.10 — Smart Map re-point (from Sheets to engine)

### Phase 6 — Polish (post-NYE)

- [ ] 6.1 — Cron-driven cancellation review queue (Tue/Wed/Thu)
- [ ] 6.2 — Emergency replacement mode (mass T8 push)
- [ ] 6.3 — Post-event host SMS (distribution count)
- [ ] 6.4 — Operator debrief notes field
- [ ] 6.5 — Misclassification review surface
- [ ] 6.6 — Cross-campaign state transitions automation
- [ ] 6.7 — A/B testing infrastructure
- [ ] 6.8 — Mobile operator app (read-only first)

---

# PHASE 0 — Reference doc integration

This phase puts the Reference Doc into the engine so the AI can consult it at runtime + operators can read it from the engine. It's a prerequisite for everything else because subsequent phases reference it.

## PHASE 0.1 — Doc formatting + repo placement

**Goal:** Copy the Reference Doc into the repo at a stable path. Verify markdown structure is parseable.

**Dependencies:** None.

**Build steps:**

1. Create directory `lib/reference-docs/`.
2. Copy the Reference Doc to `lib/reference-docs/halloween-2026-intl-engine-reference.md`.
3. Verify markdown structure:
   - All section headers use `##`, `###`, `####` consistently
   - Section codes (`0.1`, `7.13.9`, etc.) appear at the start of each header
   - No emojis or non-ASCII characters in section codes (the pre-commit gates would block these anyway)
4. Add `lib/reference-docs/README.md` explaining:
   - What docs live here
   - How they're loaded into the engine (loader script — Phase 0.3)
   - That direct edits to the .md file are the canonical edit path; the DB rows are derived

**Acceptance criteria:**
- File exists at `lib/reference-docs/halloween-2026-intl-engine-reference.md`
- `wc -l` matches the original doc line count
- README.md present alongside it
- Commit gates pass (tsc, biome, server-only audit, no em-dash/curly-quote check)

**Suggested commit message:** `feat(reference-docs): add halloween 2026 reference doc to repo`

---

## PHASE 0.2 — Reference docs schema migration

**Goal:** Schema for storing reference docs + their parsed sections + semantic embeddings.

**Dependencies:** None (uses pgvector — confirm it's enabled in the DB first).

**Build steps:**

1. Verify pgvector extension exists in the DB:
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'vector';
   ```
   If missing, the migration includes `CREATE EXTENSION IF NOT EXISTS vector;`.

2. Create migration `0091_reference_docs.sql`:

   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   
   CREATE TABLE reference_docs (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     doc_slug TEXT NOT NULL,
     campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
     version INT NOT NULL,
     full_markdown TEXT NOT NULL,
     loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     file_hash TEXT NOT NULL,  -- sha256 of the .md file content; detect drift
     UNIQUE(doc_slug, version)
   );
   
   CREATE INDEX reference_docs_slug_version_idx ON reference_docs(doc_slug, version DESC);
   
   CREATE TABLE reference_doc_sections (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     reference_doc_id UUID NOT NULL REFERENCES reference_docs(id) ON DELETE CASCADE,
     section_code TEXT NOT NULL,
     section_title TEXT NOT NULL,
     section_body TEXT NOT NULL,
     section_level INT NOT NULL,  -- 1 for ##, 2 for ###, 3 for ####
     parent_section_code TEXT,    -- "7.13.9" has parent "7.13"
     section_order INT NOT NULL,  -- preserves doc order for navigation
     embedding vector(1536),       -- nullable; populated by loader
     tags TEXT[] NOT NULL DEFAULT '{}',
     UNIQUE(reference_doc_id, section_code)
   );
   
   CREATE INDEX rds_doc_id_idx ON reference_doc_sections(reference_doc_id);
   CREATE INDEX rds_section_code_idx ON reference_doc_sections(section_code);
   CREATE INDEX rds_embedding_cosine_idx ON reference_doc_sections 
     USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
   CREATE INDEX rds_tags_gin_idx ON reference_doc_sections USING gin (tags);
   ```

3. Add Drizzle schema files:
   - `db/schema/reference-docs.ts` — both tables typed
   - Register in `db/schema/index.ts`

4. Run `npm run db:generate` and verify the migration file is created correctly.

**Acceptance criteria:**
- Migration applies cleanly on a fresh DB
- pgvector extension is enabled
- Both tables exist with all indexes
- Drizzle types are exported and importable

**Suggested commit message:** `feat(reference-docs): add reference_docs + reference_doc_sections tables (0091)`

---

## PHASE 0.3 — Doc loader script

**Goal:** A script that parses the markdown into sections, generates embeddings via OpenAI, and persists to the DB. Idempotent and runnable on doc changes.

**Dependencies:** 0.1, 0.2.

**Build steps:**

1. Create `scripts/load-reference-doc.ts`:

   ```ts
   /**
    * Usage:
    *   npx tsx scripts/load-reference-doc.ts --slug halloween-2026-intl
    *   npx tsx scripts/load-reference-doc.ts --slug halloween-2026-intl --campaign-id <uuid>
    *
    * Reads lib/reference-docs/<slug>-engine-reference.md, parses into sections,
    * generates embeddings for each section, persists to the DB.
    *
    * Idempotent: if the file hash matches the latest loaded version, no-op.
    * If hash differs, bumps version + reloads.
    */
   ```

2. Markdown parsing rules:
   - Section starts at each `##`, `###`, `####` header
   - Section code extracted from header text (e.g. `### 7.13.9 Host briefing (H0a + H0b)` → code `7.13.9`, title `Host briefing (H0a + H0b)`)
   - Section body is everything from the header until the next same-or-higher-level header
   - Section level: `##` → 1, `###` → 2, `####` → 3
   - Parent section code derived by stripping the last `.N` (e.g. `7.13.9` → parent `7.13`)
   - Special: the top-level `##` sections (0 through 12) become the top-level grouping

3. Tag extraction (for retrieval):
   - Scan section body for keywords matching a curated tag map. Initial map:
     ```ts
     const TAG_KEYWORDS = {
       "cadence": ["cadence", "follow-up", "follow up", "touch 1", "touch 2", "touch 3"],
       "classification": ["classify", "classification", "engaged", "soft no", "hard no"],
       "turnout": ["turnout", "guest count", "wave qualifier"],
       "host": ["host", "H0a", "H0b", "H1", "external host", "internal host"],
       "cancellation": ["cancel", "cancelled", "cancellation"],
       "template": ["template", "T1", "T9", "T17"],
       "compliance": ["compliance", "low buy-in", "GDPR", "CASL"],
       "operator-ux": ["operator", "worklist", "draft", "queue"],
       "integration": ["smart map", "eventbrite", "twilio", "SMS"],
     };
     ```

4. Embedding generation:
   - For each section, call OpenAI `text-embedding-3-small` (1536-dim) with `section_title + "\n\n" + section_body` as input
   - Use the existing `OPENAI_API_KEY` env var that the engine already has for the AI features
   - Batch requests (up to 100 sections per call) to minimize API overhead
   - Cost: ~0.5¢ for the full doc; tracked + logged

5. Persistence:
   - Compute sha256 hash of the markdown file
   - Look up `reference_docs` for the latest version with this slug
   - If hash matches → log "no changes" and exit 0
   - If hash differs (or no existing row) → insert new `reference_docs` row at version `latest + 1`, then bulk-insert all sections

6. Wire to `package.json` scripts:
   ```json
   "reference-docs:load": "tsx scripts/load-reference-doc.ts"
   ```

7. Run once locally + commit the resulting DB state (or document that it runs at deploy time — recommended).

**Acceptance criteria:**
- `npm run reference-docs:load -- --slug halloween-2026-intl` succeeds
- `reference_docs` has one row with `doc_slug = 'halloween-2026-intl'`
- `reference_doc_sections` has ~80+ rows (one per section in the doc)
- Every section has a non-null embedding
- Re-running the script with no doc changes is a no-op
- Tags are populated correctly for at least 50% of sections (manual spot check)

**Suggested commit message:** `feat(reference-docs): add loader script with markdown parsing + pgvector embeddings`

---

## PHASE 0.4 — AI retrieval helper

**Goal:** A typed helper any AI-using code path calls to fetch relevant doc sections for a given task. This is the runtime interface between AI and the Reference Doc.

**Dependencies:** 0.2, 0.3.

**Build steps:**

1. Create `lib/reference-retrieval.ts`:

   ```ts
   import "server-only";
   
   export type ReferenceTask =
     | "classify_reply"
     | "suggest_response"
     | "pick_template"
     | "compute_turnout"
     | "draft_t17"
     | "draft_t16"
     | "cancellation_response"
     | "host_briefing"
     | "cadence_decision"
     | "free_text_question"
     | "general";  // fallback — uses semantic search alone
   
   export interface RetrievedSection {
     sectionCode: string;
     sectionTitle: string;
     body: string;
     score: number;  // 0-1 relevance
   }
   
   export interface RetrieveArgs {
     task: ReferenceTask;
     docSlug?: string;  // defaults to active campaign's doc
     query?: string;    // free-text for semantic search; falls back to task's curated list
     topK?: number;     // default 3
     campaignId?: string;
   }
   
   export async function retrieveRelevantSections(args: RetrieveArgs): Promise<RetrievedSection[]>;
   
   /**
    * Convenience: format retrieved sections as a system-prompt block for AI calls.
    */
   export function formatAsSystemPrompt(sections: RetrievedSection[]): string;
   ```

2. Task → section map (the "curated retrieval" part) lives in `lib/reference-retrieval-task-map.ts`:

   ```ts
   export const TASK_TO_SECTIONS: Record<ReferenceTask, string[]> = {
     classify_reply: ["6.3", "6.4", "8.3", "8.4"],
     suggest_response: ["5", "8.5", "0.1"],
     pick_template: ["7", "8.7", "9.2"],
     compute_turnout: ["5", "5.2", "5.3"],
     draft_t17: ["7.15", "7.15.1", "10.1"],
     draft_t16: ["7.10", "7.16"],
     cancellation_response: ["7.10", "7.16", "7.16.8", "8.3"],
     host_briefing: ["7.13", "7.13.9", "7.14.2"],
     cadence_decision: ["6", "6.2", "6.3", "9.1"],
     free_text_question: ["5", "8.5", "8.6"],
     general: [],
   };
   ```

3. Retrieval algorithm:
   - If `task` has a curated section list AND `query` is empty: load those sections by `section_code`, ordered by `section_order`
   - If `query` provided: do hybrid search — start with curated sections, then top up to `topK` with semantic search (cosine similarity on `embedding` vector)
   - Always return at most `topK` sections; if curated list > topK, take the first topK (they're listed in dependency order)

4. `formatAsSystemPrompt` produces:
   ```
   The following sections from the PERSE Halloween 2026 Reference Doc apply 
   to this task. Follow these rules exactly. If a request conflicts with these 
   rules, flag it for human review rather than override.
   
   ----- Section 8.4 — Auto-classification confidence threshold -----
   [body]
   
   ----- Section 6.3 — Cold sequence -----
   [body]
   ```

5. Add unit tests in `lib/reference-retrieval.test.ts`:
   - `classify_reply` returns sections 6.3, 6.4, 8.3, 8.4
   - Free-text query "what's the turnout for prio 1 wristband" semantic-matches Section 5.2
   - topK is respected
   - Returns empty array gracefully if no doc loaded

**Acceptance criteria:**
- `retrieveRelevantSections({ task: 'classify_reply' })` returns the 4 curated sections
- Semantic search works for free-text queries
- `formatAsSystemPrompt` output is well-structured
- Tests pass

**Suggested commit message:** `feat(reference-docs): add AI retrieval helper with curated + semantic search`

---

## PHASE 0.5 — Operator-facing reference viewer page

**Goal:** A page in the engine where operators can read the Reference Doc, search across it, and navigate by section.

**Dependencies:** 0.2, 0.3.

**Build steps:**

1. Create `app/(admin)/reference/[slug]/page.tsx`:
   - Loads the latest version of the doc by slug
   - Renders the markdown using existing markdown renderer (or `react-markdown` if not already in stack)
   - Sidebar TOC generated from `reference_doc_sections` ordered by `section_order`
   - Anchor links per section using `section_code` as the URL fragment (e.g. `/reference/halloween-2026-intl#7.13.9`)
   - "Last loaded: [timestamp]" + "Version: N" + "File hash: [first 8 chars]" in the header

2. Search:
   - Input box at top of TOC
   - Submits to `/api/reference/search?q=...&slug=...`
   - API uses `retrieveRelevantSections({ task: 'general', query, topK: 10 })`
   - Returns section codes; UI highlights matching sections in the TOC + jumps to first hit

3. Navigation from other engine pages:
   - Export a `<ReferenceLink section="7.13.9">` component that renders as a small badge/link to the relevant doc section
   - Use it in error messages, warning tooltips, and explanation popups elsewhere in the engine

4. Add `/reference` to the engine sidebar nav (visible to all staff roles).

**Acceptance criteria:**
- Visiting `/reference/halloween-2026-intl` renders the doc
- TOC navigation works (clicking a section scrolls to it + updates URL fragment)
- Search finds relevant sections
- `<ReferenceLink section="7.13.9">` renders an anchor that jumps to that section

**Suggested commit message:** `feat(reference-docs): add operator-facing reference viewer at /reference`

---

## PHASE 0.6 — CI sync workflow + doc-change detection

**Goal:** When the .md file changes in the repo, the loader runs automatically. No drift between doc and DB.

**Dependencies:** 0.3.

**Build steps:**

1. Add to `package.json`:
   ```json
   "reference-docs:check": "tsx scripts/check-reference-doc-drift.ts"
   ```

2. Create `scripts/check-reference-doc-drift.ts`:
   - Computes sha256 of all `.md` files in `lib/reference-docs/`
   - Queries DB for the latest version of each doc slug
   - If file hash differs from DB hash, exits non-zero with a message

3. Add to the pre-commit hook (`.husky/pre-commit` or equivalent):
   ```sh
   npm run reference-docs:check || (echo "Reference doc changed — run 'npm run reference-docs:load' before commit" && exit 1)
   ```

4. Add a GitHub Action (or whatever CI is in use) workflow `reference-docs.yml`:
   - On every push touching `lib/reference-docs/**`, runs `npm run reference-docs:load`
   - This ensures the deployed engine always has the latest doc loaded

5. Document the workflow in `lib/reference-docs/README.md`:
   - Edit the .md file
   - Run `npm run reference-docs:load` locally
   - Commit both the .md and (if needed) the DB seed update
   - CI re-loads on push as a safety net

**Acceptance criteria:**
- Editing the .md file without running the loader triggers the pre-commit warning
- CI re-loads after a doc-change push
- README is clear about the workflow

**Suggested commit message:** `feat(reference-docs): add CI sync + pre-commit drift detection`

---

# PHASE 1 — Templates, cadence, turnout (foundation)

This phase makes templates campaign-scoped, rewrites the cadence engine to match the Reference Doc, and adds the turnout-quote helper. Most of Halloween 2026's correct behavior comes from this phase.

## PHASE 1.1 — Migration: campaign-scoped templates schema

**Goal:** Schema changes to support T1-T17 codes + campaign scoping + auto-pick context.

**Dependencies:** 0.x (recommended but not strictly required — you CAN ship templates first and add doc retrieval later).

**Build steps:**

1. Migration `0092_campaign_scoped_templates.sql`:

   ```sql
   ALTER TABLE email_templates
     ADD COLUMN campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
     ADD COLUMN template_code TEXT,
     ADD COLUMN trigger_context JSONB NOT NULL DEFAULT '{}'::jsonb,
     ADD COLUMN auto_pick_priority INTEGER NOT NULL DEFAULT 0;
   
   -- Backfill existing templates: legacy_<stage>
   UPDATE email_templates 
   SET template_code = 'legacy_' || stage
   WHERE template_code IS NULL;
   
   ALTER TABLE email_templates
     ALTER COLUMN template_code SET NOT NULL;
   
   -- Campaign-scoped templates need unique (campaign, code)
   CREATE UNIQUE INDEX email_templates_campaign_code_unique
     ON email_templates(campaign_id, template_code)
     WHERE campaign_id IS NOT NULL;
   
   -- Global (campaign-null) templates need unique (brand, code)
   CREATE UNIQUE INDEX email_templates_global_code_unique
     ON email_templates(outreach_brand_id, template_code)
     WHERE campaign_id IS NULL;
   
   CREATE INDEX email_templates_campaign_idx ON email_templates(campaign_id);
   CREATE INDEX email_templates_trigger_gin ON email_templates USING gin (trigger_context);
   ```

2. Update `db/schema/templates.ts` to add the new columns. Type `triggerContext` as a `jsonb()` with a Drizzle helper to a typed shape:
   ```ts
   interface TriggerContext {
     channel?: "cold" | "warm" | "post_confirm" | "lifecycle" | "cancellation" | "post_event";
     stage?: "first_touch" | "follow_up" | "detail" | "confirmation" | "graphic" | "info_sheets" | "pre_event" | "day_before" | "day_of";
     event_type?: "night" | "day_party" | "any";
     ask_size?: "big_open" | "small_specific";
     priority?: number[];
     crawls?: "multiple" | "single" | "any";
     wristband_only?: boolean;
     prior_relationship?: boolean;
     min_days_to_event?: number;
     max_days_to_event?: number;
   }
   ```

3. Update `lib/validation/email-templates.ts` to add validation for the new fields.

**Acceptance criteria:**
- Migration applies cleanly
- Existing templates retain their data with `template_code = 'legacy_<stage>'`
- No FK or unique-index violations

**Suggested commit message:** `feat(templates): add campaign_id + template_code + trigger_context (0092)`

---

## PHASE 1.2 — Seed T1-T17 templates for Halloween 2026

**Goal:** Insert the 17 Halloween 2026 templates into the engine.

**Dependencies:** 1.1.

**Build steps:**

1. Create `scripts/seed-halloween-2026-templates.ts`. Templates are sourced from the Reference Doc's Section 7 + the existing Halloween template pack.

2. Each template insert specifies:
   - `campaign_id` — the Halloween 2026 campaign UUID (loaded from env or arg)
   - `outreach_brand_id` — the active outreach brand for this campaign (or NULL if shared across brands)
   - `template_code` — `T1` through `T17`
   - `name` — human-readable, e.g. "T1 — Cold opener, night crawls"
   - `subject_template`, `body_template_text`, `body_template_html`
   - `trigger_context` — the JSONB per Phase 1.1's schema, matching the spec in [the earlier audit doc Part 3.3]
   - `auto_pick_priority` — 100 by default; higher = preferred when multiple templates match a context

3. The 17 templates (sourced from Reference Doc Section 7):

   | Code | trigger_context |
   |---|---|
   | T1 | `{channel: "cold", stage: "first_touch", event_type: "night", ask_size: "big_open"}` |
   | T2 | `{channel: "cold", stage: "first_touch", event_type: "day_party"}` |
   | T3 | `{channel: "warm", stage: "first_touch", prior_relationship: true}` |
   | T4 | `{stage: "detail", event_type: "night", crawls: "multiple"}` |
   | T5 | `{stage: "detail", event_type: "night", crawls: "single"}` |
   | T6 | `{stage: "detail", event_type: "day_party"}` |
   | T7A | `{stage: "insert_block", priority: [1,2,3]}` |
   | T7B | `{stage: "insert_block", priority: [4,5,6]}` |
   | T8 | `{channel: "cold", stage: "first_touch", ask_size: "small_specific"}` |
   | T9-far | `{channel: "post_confirm", stage: "confirmation", min_days_to_event: 21}` |
   | T9-near | `{channel: "post_confirm", stage: "confirmation", max_days_to_event: 21}` |
   | T10 | `{channel: "lifecycle", stage: "graphic"}` |
   | T11-wristband | `{channel: "lifecycle", stage: "info_sheets", wristband_only: true}` |
   | T11-other | `{channel: "lifecycle", stage: "info_sheets", wristband_only: false}` |
   | T13 | `{channel: "lifecycle", stage: "pre_event", max_days_to_event: 14, min_days_to_event: 7}` |
   | T14 | `{channel: "lifecycle", stage: "day_before", max_days_to_event: 7, min_days_to_event: 1}` |
   | T15 | `{channel: "lifecycle", stage: "day_of", max_days_to_event: 0}` |
   | T16 | `{channel: "cancellation"}` |
   | T17 | `{channel: "post_event"}` |

4. Body content for each template:
   - Use the merge-field syntax already in `lib/template-render.ts` (e.g. `{{venue.name}}`, `{{event.date}}`)
   - New merge fields introduced by this phase:
     - `{{turnout_quote}}` — populated by `lib/turnout-quote.ts` at render time (Phase 1.6)
     - `{{your_name}}`, `{{company_name}}` — alias-specific signature fields
     - `{{cancellation_reason_phrase}}` (T16 only) — one of 4 variants per Reference Doc §7.10
   - All template bodies must match the template pack text already documented in the Reference Doc

5. Idempotency: the script should be safely re-runnable. Use UPSERT on `(campaign_id, template_code)`.

6. Add to `package.json`:
   ```json
   "campaigns:seed-halloween-2026": "tsx scripts/seed-halloween-2026-templates.ts"
   ```

7. Run the seed against the dev DB + verify all 17 rows exist with correct trigger_context.

**Acceptance criteria:**
- 17 rows in `email_templates` with `campaign_id = <halloween_2026_campaign_id>` and `template_code` matching T1-T17
- `trigger_context` JSONB matches spec for each row
- Re-running the seed is a no-op (idempotent)
- Template body for T17 includes the NYE re-engagement block per Reference Doc §7.15.1

**Suggested commit message:** `feat(templates): seed T1-T17 Halloween 2026 templates`

---

## PHASE 1.3 — Seed H0a, H0b, V1 host/venue templates

**Goal:** Three additional templates for host briefings + internal-host venue confirmation.

**Dependencies:** 1.1.

**Build steps:**

1. Extend `scripts/seed-halloween-2026-templates.ts` to add three more rows:
   - **H0a — Hiring confirmation** (email to external host at hire time)
   - **H0b — Operational briefing** (email to external host week-of)
   - **V1 — Venue confirmation** (email to internal-host city venue Mon/Tue of event week)

2. Bodies per Reference Doc §7.13.9 (host briefings) and §7.14.3 (V1).

3. New merge fields:
   - `{{host_name}}`, `{{host_manager_name}}`, `{{host_manager_phone}}`
   - `{{pay_rate}}`, `{{payment_method}}`
   - `{{wristband_venue_address}}`, `{{wristband_venue_contact}}`
   - `{{full_lineup_with_times_and_addresses}}` — formatted block listing all venues + times for the night

4. Trigger contexts:
   - H0a: `{channel: "host_brief", stage: "hire_time"}`
   - H0b: `{channel: "host_brief", stage: "week_of"}`
   - V1: `{channel: "venue_confirm_internal", stage: "week_of"}`

**Acceptance criteria:**
- 3 additional rows seeded
- All merge fields render correctly with sample data
- Template bodies match Reference Doc

**Suggested commit message:** `feat(templates): seed H0a, H0b, V1 host + venue templates`

---

## PHASE 1.4 — `lib/template-picker.ts` with `pickTemplate(ctx)`

**Goal:** The engine's auto-pick logic that selects the right template for a given context.

**Dependencies:** 1.1, 1.2, 1.3, and ideally 0.4 (so the picker can reference the doc).

**Build steps:**

1. Create `lib/template-picker.ts`:

   ```ts
   import "server-only";
   import { db } from "@/lib/db";
   import { emailTemplates } from "@/db/schema";
   import { eq, and, isNull, sql } from "drizzle-orm";
   import { retrieveRelevantSections } from "./reference-retrieval";
   
   export interface PickContext {
     campaignId: string;
     venueId?: string;
     threadId?: string;
     cityPriority?: 1|2|3|4|5|6;
     crawlCount?: number;
     slotType?: "wristband" | "middle" | "final" | "alt_final";
     eventType?: "night" | "day_party";
     daysToEvent?: number;
     isWarmRelationship?: boolean;
     askSize?: "big_open" | "small_specific";
     lifecycleStep?: "confirmation" | "graphic" | "info_sheets" | "pre_event" | "day_before" | "day_of" | "cancellation" | "post_event";
   }
   
   export interface PickedTemplate {
     template: typeof emailTemplates.$inferSelect;
     reason: string;             // human-readable why this was picked
     matchScore: number;         // 0-1
     alternatives: { templateCode: string; reason: string }[];
   }
   
   export async function pickTemplate(ctx: PickContext): Promise<PickedTemplate | null>;
   ```

2. Scoring algorithm:
   - Load all templates for `ctx.campaignId`
   - For each template, score against `ctx`:
     - `trigger_context` field-by-field match: +10 per matching dimension, -5 per conflicting dimension
     - Priority: if template has `priority: [1,2,3]` and ctx has `cityPriority = 1`, that's a match
     - Days-to-event: respect `min_days_to_event` / `max_days_to_event` as hard filters
     - `wristband_only`: hard filter
   - Apply `auto_pick_priority` as a tiebreaker
   - Return the highest-scoring template (or null if none scores > 0)
   - Top 3 alternative codes returned for the UI's "see alternatives" dropdown

3. `reason` string examples:
   - `"Cold opener for night crawl in a Prio 1 multi-crawl city"`
   - `"Slot detail for single-crawl city (Prio 5-6)"`
   - `"Post-event re-engagement with NYE pitch (2 days post-event)"`

4. Add unit tests in `lib/template-picker.test.ts`:
   - Cold open for Toronto (Prio 1, 3 crawls, night event) → picks T1
   - Cold open for daytime party → picks T2
   - Slot detail for single-crawl city → picks T5
   - Confirmation 4 weeks out → picks T9-far
   - Confirmation 1 week out → picks T9-near
   - Post-event → picks T17

**Acceptance criteria:**
- All unit tests pass
- Function returns a template + reason + alternatives for valid contexts
- Returns null gracefully when no template matches

**Suggested commit message:** `feat(templates): add lib/template-picker.ts with auto-pick scoring`

---

## PHASE 1.5 — Composer integration of `pickTemplate`

**Goal:** When the composer opens from cold outreach or inbox reply, the engine's pick is pre-selected. Operator can override via dropdown.

**Dependencies:** 1.4.

**Build steps:**

1. Modify `app/(admin)/_components/composer/composer-window.tsx`:
   - When composer opens with a `venueId` + `cityCampaignId` context (cold outreach send) or a `threadId` (inbox reply), compute a `PickContext` from available data and call `pickTemplate`
   - If a picked template is returned, auto-load it (subject, body, merge fields applied)
   - Show the pick reason as a subtle banner above the editor: `🤖 Engine picked: T4 (Slot detail, multi-crawl). [See alternatives ▾] [Use blank instead]`
   - Click "See alternatives" expands to show the top 3 alternative codes — clicking one swaps the loaded template

2. Add an "engine-picked" attribution on the email_drafts row when auto-loaded:
   - New column `email_drafts.engine_picked_template_id` (nullable UUID)
   - Tracks whether the operator kept the engine's pick or overrode it (data for misclassification review later)

3. Migration `0093_email_drafts_engine_picked.sql`:
   ```sql
   ALTER TABLE email_drafts
     ADD COLUMN engine_picked_template_id UUID REFERENCES email_templates(id) ON DELETE SET NULL;
   ```

**Acceptance criteria:**
- Opening composer from cold-outreach pre-loads T1 (or appropriate template)
- The banner shows reason + alternatives
- Selecting an alternative swaps the loaded template
- `email_drafts.engine_picked_template_id` is set on auto-load

**Suggested commit message:** `feat(composer): integrate engine template auto-pick`

---

## PHASE 1.6 — `lib/turnout-quote.ts` helper

**Goal:** Deterministic turnout phrase generator per Reference Doc §5.

**Dependencies:** 0.x (so the helper can pull §5 rules at runtime — optional but recommended).

**Build steps:**

1. Create `lib/turnout-quote.ts`:

   ```ts
   import "server-only";
   
   export interface InitialPitchArgs {
     priority: 1|2|3|4|5|6;
     slotType: "wristband" | "middle" | "final";
     slotContext: "pickup_window" | "slot" | "night" | "afternoon";
   }
   
   export interface SalesUpdateArgs {
     ticketsSold: number;
     slotType: "wristband" | "middle" | "final";
     slotContext: "pickup_window" | "slot" | "night" | "afternoon";
   }
   
   export function initialPitchQuote(args: InitialPitchArgs): string;
   export function salesUpdateQuote(args: SalesUpdateArgs): { phrase: string; honestSlowFlag: boolean };
   ```

2. Priority × slot table (from Reference Doc §5.2). Encode as a lookup constant.

3. Sales-update math (from Reference Doc §5.3):
   - Under 20 tickets: phrase = "10-20", `honestSlowFlag = true`
   - 20-50: "10-20", flag false
   - 50-100: "30-50", flag false
   - 100-150: "around 80", flag false
   - 150+: 70% of sold rounded down (e.g. 200 sold → "around 140")

4. Always append the wave qualifier: `"in waves or small groups of 5 to 10 at a time, not all at once — coming through across your [slotContext]"`.

5. Helpers for prefix/suffix:
   - If single number (not a range), prefix with `"around "` or suffix with `"-ish"`
   - Always round down at boundaries

6. Wire into template merge-field system:
   - `{{turnout_quote}}` — calls `initialPitchQuote` using venue's priority + slot
   - `{{turnout_quote_sales_update}}` — calls `salesUpdateQuote` using current sales (queried from Eventbrite or campaign's sales counter)

7. Unit tests in `lib/turnout-quote.test.ts`:
   - Prio 1 wristband → expected phrase per §5.2
   - 80 tickets sold → "30-50 in waves..."
   - 200 tickets sold → "around 140 in waves..."
   - Wave qualifier always present
   - Always rounds down (151 sold → 70% = 105 → "around 105")

**Acceptance criteria:**
- All test cases pass
- `{{turnout_quote}}` merge field works in template rendering
- Code comments reference `[ReferenceDoc §5.2]` and `[ReferenceDoc §5.3]`

**Suggested commit message:** `feat(turnout): add deterministic turnout-quote helper [ReferenceDoc §5]`

---

## PHASE 1.7 — Migration: cadence_state enum + venue_campaign_touch_log

**Goal:** Schema changes for the new cadence engine.

**Dependencies:** None.

**Build steps:**

1. Migration `0094_cadence_rewrite.sql`:

   ```sql
   CREATE TYPE cadence_state AS ENUM (
     'cold_pending_touch_1',
     'cold_sent_touch_1',
     'cold_pending_touch_2',
     'cold_sent_touch_2',
     'cold_pending_touch_3',
     'cold_sent_touch_3',
     'cold_exhausted_ready_for_handoff',
     'warm_pending_response',
     'warm_responded_pending_nudge_1',
     'warm_nudge_1_sent',
     'warm_pending_nudge_2',
     'warm_nudge_2_sent',
     'warm_pending_nudge_3',
     'warm_nudge_3_sent',
     'stalled_warm',
     'declined_this_campaign',
     'opt_out_permanent',
     'cancelled_by_them',
     'confirmed',
     'lifecycle_active'
   );
   
   ALTER TABLE email_threads
     ADD COLUMN cadence_state cadence_state,
     ADD COLUMN cadence_next_due_at TIMESTAMPTZ;
   
   CREATE INDEX email_threads_cadence_state_idx ON email_threads(cadence_state);
   CREATE INDEX email_threads_cadence_due_idx ON email_threads(cadence_next_due_at) 
     WHERE cadence_state IS NOT NULL;
   
   CREATE TABLE venue_campaign_touch_log (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
     campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
     staff_outreach_email_id UUID NOT NULL REFERENCES staff_outreach_emails(id),
     outreach_brand_id UUID NOT NULL REFERENCES outreach_brands(id),
     touch_kind TEXT NOT NULL,
     sent_at TIMESTAMPTZ NOT NULL,
     email_message_id UUID REFERENCES email_messages(id) ON DELETE SET NULL
   );
   
   CREATE INDEX vctl_venue_campaign_idx ON venue_campaign_touch_log(venue_id, campaign_id, sent_at DESC);
   CREATE INDEX vctl_brand_recent_idx ON venue_campaign_touch_log(venue_id, outreach_brand_id, sent_at DESC);
   ```

2. Drizzle schema additions in `db/schema/outreach.ts` (cadence_state on emailThreads) and new `db/schema/venue-campaign-touch-log.ts`.

3. Register the new schema in `db/schema/index.ts`.

**Acceptance criteria:**
- Migration applies cleanly
- New enum + table exist with all indexes
- Drizzle types compile

**Suggested commit message:** `feat(cadence): add cadence_state enum + venue_campaign_touch_log (0094)`

---

## PHASE 1.8 — `lib/cadence-engine.ts`

**Goal:** The new cadence engine replacing `lib/follow-up-cadence.ts`. Implements Reference Doc §6 rules.

**Dependencies:** 1.7, and ideally 0.x for doc retrieval.

**Build steps:**

1. Create `lib/cadence-engine.ts`:

   ```ts
   import "server-only";
   
   export interface NextTouchPlan {
     venueId: string;
     campaignId: string;
     recommendedTemplateCode: string;
     recommendedAliasId: string;
     earliestAllowedSendAt: Date;
     reasonIfBlocked?: string;
     cadenceState: CadenceState;
   }
   
   export interface CadenceFloorCheckArgs {
     venueId: string;
     campaignId: string;
     sendingAliasId: string;
     sendingOutreachBrandId: string;
   }
   
   export interface CadenceFloorCheckResult {
     allowed: boolean;
     reason?: string;
     earliestAllowedAt?: Date;
     totalTouchCount: number;
     hardCapReached: boolean;
     crossDomainFloorMet: boolean;
   }
   
   export async function planNextTouch(venueId: string, campaignId: string): Promise<NextTouchPlan | null>;
   export async function checkCadenceFloors(args: CadenceFloorCheckArgs): Promise<CadenceFloorCheckResult>;
   export async function recordTouch(args: {
     venueId: string;
     campaignId: string;
     sendingAliasId: string;
     sendingOutreachBrandId: string;
     touchKind: string;
     emailMessageId?: string;
   }): Promise<void>;
   ```

2. Cadence rules implementation (from Reference Doc §6):
   - **Cold sequence**: 3 touches at 0 / +5 / +7 days
   - **Warm cadence**: 3 nudges at +4 / +5 / +7 days post-engagement
   - **Cross-domain 7-day floor**: enforced via `venue_campaign_touch_log` lookup
   - **Hard cap**: 5-6 touches per venue × campaign total (default 6, configurable per campaign)
   - **Calls don't count**: only email touches enter `venue_campaign_touch_log`

3. State transitions:
   - On send: insert `venue_campaign_touch_log` row + update `email_threads.cadence_state` + set `cadence_next_due_at`
   - On inbound engaged reply: transition to `warm_pending_response`
   - On inbound decline: transition to `declined_this_campaign`
   - On inbound unsubscribe / hard-no: transition to `opt_out_permanent`
   - On no-reply through full cold sequence: transition to `cold_exhausted_ready_for_handoff`

4. Code comments reference `[ReferenceDoc §6.X]` at each rule.

5. Unit tests in `lib/cadence-engine.test.ts`:
   - Cold touch 1 → next is touch 2 at +5 days
   - Cold touch 2 → next is touch 3 at +7 days
   - Cross-domain 7-day floor: send from brand A 4 days ago → brand B blocked, allowed at +3 days
   - Hard cap: 6 touches already logged → blocked even cross-domain

**Acceptance criteria:**
- All test cases pass
- `planNextTouch` returns correct template code + alias + due date
- `checkCadenceFloors` correctly enforces both 7-day floor + hard cap

**Suggested commit message:** `feat(cadence): replace follow-up-cadence with new cadence-engine [ReferenceDoc §6]`

---

## PHASE 1.9 — Cadence floor enforcement in send pipeline

**Goal:** Block sends that violate cadence rules. Surface inline warnings in the composer.

**Dependencies:** 1.8.

**Build steps:**

1. Modify the composer's pre-send validation (`compose-send-impl.ts` or equivalent):
   - Before send, call `checkCadenceFloors({ venueId, campaignId, sendingAliasId, sendingOutreachBrandId })`
   - If `allowed === false`:
     - Return an error to the UI with `reason`, `earliestAllowedAt`, `totalTouchCount`, `hardCapReached`
     - UI surfaces the warning shown in Phase 2.10 (see below)
     - Admin can override with a confirmation; non-admins get hard-blocked

2. Add `email_send_events.cadence_override_reason` column (migration 0095) to log admin overrides:
   ```sql
   ALTER TABLE email_send_events
     ADD COLUMN cadence_override_reason TEXT;
   ```

3. Unit + integration tests:
   - Non-admin sending to a venue with 6 prior touches → blocked
   - Admin sending with override → goes through; `cadence_override_reason` populated

**Acceptance criteria:**
- Block works for non-admins
- Override works for admins
- Logged in send_events

**Suggested commit message:** `feat(cadence): enforce floors + hard cap in send pipeline (0095)`

---

## PHASE 1.10 — Daily cadence cron rewrite

**Goal:** Daily cron that uses the new engine to advance states + generate engine drafts.

**Dependencies:** 1.8, 1.4 (template picker), 1.2 (T1-T17 seeded).

**Build steps:**

1. Replace the existing cadence cron (or modify it) to:
   - Scan all `email_threads` where `cadence_state IS NOT NULL` AND `cadence_next_due_at <= NOW()`
   - For each, call `planNextTouch(venueId, campaignId)`
   - Generate an `email_drafts` row using the picked template, assigned to the current owner of the thread
   - Update `cadence_state` and `cadence_next_due_at` to the next state
   - Log everything to `cron_runs` (existing observability table)

2. Cron schedule: every morning at 6 AM in the operator's timezone (configurable per campaign).

3. The generated drafts surface in the operator's worklist on Phase 2.

**Acceptance criteria:**
- Cron runs successfully against a seeded test campaign
- Drafts are generated for due touches
- Cron-runs log shows execution metrics

**Suggested commit message:** `feat(cadence): rewrite daily cadence cron to use new engine`

---

## PHASE 1.11 — Migrate existing threads to new cadence_state

**Goal:** Backfill existing threads so the new engine has a starting state for everything.

**Dependencies:** 1.7, 1.8.

**Build steps:**

1. Create `scripts/migrate-cadence-state.ts`:
   - For each active `email_thread`:
     - If `follow_up_stage = 0` and last outbound was cold → `cadence_state = 'cold_sent_touch_1'`
     - If `follow_up_stage = 1` → `cadence_state = 'cold_pending_touch_2'`
     - If `follow_up_stage = 2` → `cadence_state = 'cold_exhausted_ready_for_handoff'`
     - If thread state = `closed_won` → `cadence_state = 'confirmed'`
     - If thread state = `closed_lost` → `cadence_state = 'declined_this_campaign'`
     - If thread state = `closed_dnc` → `cadence_state = 'opt_out_permanent'`
   - Also backfill `venue_campaign_touch_log` from existing `email_messages` (outbound rows)

2. Run on dev DB first; verify counts roughly match expectations; then run on prod.

3. After 1 week of safe operation with new engine, deprecate old `follow_up_stage` / `follow_up_next_due_at` columns (keep the schema for safety; remove only the cron that updates them).

**Acceptance criteria:**
- Every active thread has a non-null `cadence_state`
- `venue_campaign_touch_log` has entries for past outbound emails
- Old cron is deprecated; new cron is the only writer to cadence fields

**Suggested commit message:** `chore(cadence): migrate existing threads to cadence_state`

---

## PHASE 1.12 — Reply classification enum: add stalled_warm, cancelled_by_them

**Goal:** Reconcile engine's classification enum with the Reference Doc.

**Dependencies:** None.

**Build steps:**

1. Migration `0096_reply_classification_additions.sql`:
   ```sql
   ALTER TYPE reply_classification ADD VALUE 'stalled_warm';
   ALTER TYPE reply_classification ADD VALUE 'cancelled_by_them';
   ```

2. Update Drizzle types in `db/schema/enums.ts`.

3. Document the mapping in code comments:
   - Reference Doc `engaged` → engine `interested` or `warm`
   - Reference Doc `soft-no` → engine `decline`
   - Reference Doc `hard-no` → engine `unsubscribe`
   - Reference Doc `stalled-warm` → engine `stalled_warm` (NEW)
   - Reference Doc `cancelled-by-them` → engine `cancelled_by_them` (NEW)
   - Reference Doc `question` → engine `question`
   - Reference Doc `unclassifiable` → engine `unclassified`

**Acceptance criteria:**
- Migration applies cleanly
- Drizzle types expose the new enum values

**Suggested commit message:** `feat(classify): add stalled_warm + cancelled_by_them classifications (0096)`

---

## PHASE 1.13 — Classifier prompt uses Reference Doc retrieval

**Goal:** AI classifier prompt is grounded in the Reference Doc's classification rules via retrieval.

**Dependencies:** 0.4, 1.12.

**Build steps:**

1. Modify `lib/ai.ts` (or wherever the classifier prompt is constructed):
   - Before classifying, call:
     ```ts
     const sections = await retrieveRelevantSections({ task: "classify_reply" });
     const systemPrompt = formatAsSystemPrompt(sections) + "\n\n" + existingClassifierInstructions;
     ```
   - The doc sections (6.3, 6.4, 8.3, 8.4) are prepended to the prompt

2. Update the existing classifier output schema to support `stalled_warm` and `cancelled_by_them`.

3. Add logging: when the AI classifies, log which sections were retrieved + the resulting classification + confidence to a new table:
   ```sql
   CREATE TABLE classifier_runs (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     thread_id UUID NOT NULL REFERENCES email_threads(id),
     message_id UUID NOT NULL REFERENCES email_messages(id),
     retrieved_section_codes TEXT[] NOT NULL,
     classification reply_classification NOT NULL,
     confidence NUMERIC(4,3) NOT NULL,
     model TEXT NOT NULL,
     run_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
   ```

4. Migration `0097_classifier_runs.sql` for the table.

**Acceptance criteria:**
- Classifier produces same-or-better classifications on a held-out test set
- `classifier_runs` rows show retrieved section codes
- Reference Doc rules are demonstrably applied (e.g. classifier correctly emits `cancelled_by_them` for "we have to cancel")

**Suggested commit message:** `feat(classify): classifier uses Reference Doc retrieval [ReferenceDoc §6.3, §8.4]`

---

## PHASE 1.14 — 90% confidence threshold logic + needs-attention flagging

**Goal:** Per Reference Doc §8.4: classifier auto-acts at >= 90% confidence; below that, flags for human triage.

**Dependencies:** 1.13.

**Build steps:**

1. In the classifier pipeline:
   - If `confidence >= 0.90`: write `email_threads.classification = <auto-classified>`, trigger downstream state transitions (cancellation flow, opt-out marking, etc.)
   - If `confidence < 0.90`: write `email_threads.suggestedClassification = <auto-classified>` but leave `email_threads.classification = 'unclassified'`. Flag for human triage in the UI.

2. Add `email_threads.needs_attention` boolean column (or reuse existing `is_stale` for this purpose — verify what exists):
   - Migration `0098_needs_attention_flag.sql`
   - Default false
   - Set true when classifier confidence < 0.90 OR engine can't generate a suggested response

3. Worklist (Phase 2) surfaces all `needs_attention` threads at the top of the pending-replies section.

**Acceptance criteria:**
- Threads with confidence < 0.90 get `needs_attention = true`
- Threads with confidence >= 0.90 auto-classify cleanly
- Operator can manually flip `needs_attention = false` after triage

**Suggested commit message:** `feat(classify): 90% confidence threshold + needs-attention flag [ReferenceDoc §8.4]`

---

# PHASE 2 — Operator daily UX

This phase builds the `/worklist` page (single biggest dummy-proofing surface) + integrates engine-suggested templates and classifications into the inbox.

## PHASE 2.1 — `/worklist` page scaffolding + nav entry

**Goal:** Empty page at `/worklist` with 4 section placeholders + nav entry.

**Dependencies:** None.

**Build steps:**

1. Create `app/(admin)/worklist/page.tsx` (server component). Layout:
   - Page title: "Daily worklist"
   - Subtitle: "Everything you need to do today"
   - 4 section components: `<DraftsSection />`, `<RepliesSection />`, `<FollowUpsSection />`, `<CallsSection />`
   - Empty-state component for when all sections are empty

2. Create the section component placeholders (server components with hardcoded empty state for now). Real data wiring happens in 2.2-2.6.

3. Add `/worklist` to the side nav as the primary entry point for `outreach` and `lead` roles. `admin` role can still see it but their default is `/admin`.

4. Set as the default redirect after login for `outreach` role.

**Acceptance criteria:**
- Page renders at `/worklist`
- 4 sections show empty state
- Nav links to it

**Suggested commit message:** `feat(worklist): scaffold /worklist page with 4 section placeholders`

---

## PHASE 2.2 — Worklist Section 1: Drafts to review and send

**Goal:** Query + render engine-generated drafts queued for the current operator.

**Dependencies:** 2.1, 1.10 (so drafts are being generated).

**Build steps:**

1. Implement `<DraftsSection />` server component:
   - Query: `email_drafts WHERE owner_user_id = currentStaff.id AND sent_at IS NULL AND (scheduled_for IS NULL OR scheduled_for <= NOW() + interval '24 hours')`
   - Join with `email_templates` to show the template code + name
   - Join with `venues` + `city_campaigns` to show the venue + city context

2. Sort by urgency:
   - Drafts with `scheduled_for IN PAST` (overdue) first
   - Then drafts where cadence floor is closest to violation
   - Then routine drafts (no deadline pressure)

3. Render each row with:
   - Template code badge (e.g. "T4")
   - Venue + city
   - Reason (from the engine pick attribution)
   - Primary action: "Review & send" → opens composer
   - Secondary: "Schedule for tomorrow"

4. Pagination: show 10 per page; "Expand all" reveals the rest.

**Acceptance criteria:**
- Drafts owned by the logged-in user appear
- Sort order is correct
- Clicking "Review & send" opens the composer with the draft pre-loaded

**Suggested commit message:** `feat(worklist): Section 1 — Drafts to review and send`

---

## PHASE 2.3 — Worklist Section 2: Pending replies

**Goal:** Render inbound replies needing operator attention.

**Dependencies:** 2.1, 1.14 (needs_attention flag).

**Build steps:**

1. Implement `<RepliesSection />` server component:
   - Query: `email_threads WHERE state IN ('needs_reply', 'follow_up_due') AND assigned_staff_id = currentStaff.id`
   - Sort: `needs_attention = true` rows first; then by classification urgency (engaged > question > soft-no); then by last_message_at DESC

2. Render each row with:
   - Classification badge (engaged / question / needs-attention / etc.)
   - Venue + city + slot
   - Snippet of the venue's latest message
   - Engine's suggested next action (from `aiNextAction` field)
   - Primary action: "Open thread"

3. Use color coding aligned with engine's existing palette (no rose/red unless destructive):
   - Engaged → blue
   - Question → amber
   - Needs-attention → amber + bold
   - Soft-no → zinc (muted)
   - Cancelled-by-them → rose (destructive — this is the one exception; it's a fire-drill)

**Acceptance criteria:**
- Pending replies appear sorted correctly
- Clicking opens the thread
- needs_attention rows are visually distinct

**Suggested commit message:** `feat(worklist): Section 2 — Pending replies`

---

## PHASE 2.4 — Worklist Section 3: Follow-ups due (next few days)

**Goal:** Surface upcoming cadence touches across the operator's owned venues.

**Dependencies:** 2.1, 1.8 (cadence engine).

**Build steps:**

1. Implement `<FollowUpsSection />` server component:
   - Query: `email_threads WHERE cadence_next_due_at BETWEEN NOW() AND NOW() + interval '7 days' AND assigned_staff_id = currentStaff.id`
   - Group by day (Today / Tomorrow / Wednesday / etc.)
   - Also include lifecycle touches (T11/T13/T14 scheduled drafts where `scheduled_for` is in the next 7 days)

2. Render each group as an accordion-style section.

3. Per row:
   - Cadence touch label (e.g. "Touch 2", "T11 info sheets")
   - Venue + city
   - Days since last touch
   - Action: "Draft now" (pulls into Drafts section immediately)

**Acceptance criteria:**
- Follow-ups appear grouped by day
- Lifecycle touches included
- "Draft now" pulls forward

**Suggested commit message:** `feat(worklist): Section 3 — Follow-ups due this week`

---

## PHASE 2.5 — Worklist Section 4: Calls to make today

**Goal:** Surface high-priority phone calls for the day.

**Dependencies:** 2.1.

**Build steps:**

1. Implement `<CallsSection />` server component:
   - Source: `cold_outreach_entries` + `email_threads`
   - Criteria for "should call today":
     - Cities the operator owns (filter by `assigned_staff_id`)
     - City priority 1, 2, or 3
     - Status: `email_sent` with no reply after 5+ days, OR `stalled_warm`, OR explicit operator flag
     - Last call attempt > 2 days ago OR null
   - Cap: 8 calls per operator per day (operators can't realistically do more)

2. Render each row with:
   - Venue name + city + priority badge
   - Last contact summary (e.g. "3 emails sent, no reply" or "Engaged then silent")
   - Phone number with "Click to call via OpenPhone" link (use existing Quo integration)
   - Best time to call (from venue hours data if available)

**Acceptance criteria:**
- Up to 8 calls show, ranked by priority
- Phone click triggers OpenPhone via Quo
- Calls are excluded for cities the operator doesn't own

**Suggested commit message:** `feat(worklist): Section 4 — Calls to make today`

---

## PHASE 2.6 — Worklist empty-state + completion stats

**Goal:** When all 4 sections are empty, show a celebratory empty state.

**Dependencies:** 2.2-2.5.

**Build steps:**

1. Detect when all 4 section queries return empty.
2. Render the empty state:
   ```
   🎉 You're all caught up for today.
   
   Today's activity:
     X drafts sent
     Y replies handled
     Z calls completed
   
   Tomorrow's queue is being built. Check back tomorrow morning.
   ```
3. Stats query: today's activity for the current operator (sent drafts, classified replies, logged calls). Pull from `email_send_events`, `email_threads` (classification updated), `call_logs`.

**Acceptance criteria:**
- Empty state renders when all sections are empty
- Stats are accurate for the current day

**Suggested commit message:** `feat(worklist): celebratory empty-state with completion stats`

---

## PHASE 2.7 — Inbox: engine suggestion bar above reply

**Goal:** Engine surfaces its pick of template above the reply bar in the inbox thread view.

**Dependencies:** 1.4 (template picker), 0.4 (retrieval — optional).

**Build steps:**

1. Modify `ThreadReplyBar.tsx`:
   - On thread load, compute a `PickContext` from the thread + venue + campaign
   - Call `pickTemplate(ctx)`
   - If a template is picked, render a banner above the reply input:
     ```
     🤖 Suggested: Send T4 — Slot detail (multi-crawl)
     This venue replied "send me the slots" and they're in Toronto (Prio 1, 3 crawls).
     [ Use this template ]  [ See alternatives ▾ ]
     ```

2. "Use this template" loads the template into the composer with merge fields applied.

3. "See alternatives ▾" expands to show top 3 alternatives with rationale; clicking swaps the template.

**Acceptance criteria:**
- Banner appears on threads with valid context
- Click "Use" loads template into composer
- Alternatives dropdown works

**Suggested commit message:** `feat(inbox): engine suggestion bar with template auto-pick`

---

## PHASE 2.8 — Inbox: classification confirmation chip

**Goal:** Surface `suggestedClassification` as a one-click confirm chip; below 90% confidence, show all-categories triage buttons.

**Dependencies:** 1.13, 1.14.

**Build steps:**

1. Modify thread header to show classification status:
   - If `suggestedClassification` is set AND `suggestedClassificationConfidence >= 0.90` AND `classification = 'unclassified'`:
     ```
     [ Engine classification: ENGAGED (94%)  ✓ Confirm  Override ▾ ]
     ```
   - If `confidence < 0.90`:
     ```
     [ ⚠️ Engine couldn't classify (62%) — Needs your triage:
       [ Engaged ] [ Soft no ] [ Hard no ] [ Stalled warm ] [ Cancelled ] [ Question ] [ Other ] ]
     ```

2. Server actions for confirm/override that update `email_threads.classification` and clear `suggestedClassification`.

3. Log the override to `classifier_runs` for later misclassification review.

**Acceptance criteria:**
- High-confidence threads show 1-click confirm
- Low-confidence threads show all triage buttons
- Confirms/overrides update DB correctly

**Suggested commit message:** `feat(inbox): classification confirmation chip with 90% threshold`

---

## PHASE 2.9 — Inbox: suggested-response UI for questions

**Goal:** When a reply is classified as `question`, surface engine's suggested response.

**Dependencies:** 0.4, 2.8.

**Build steps:**

1. When classifying a thread as `question`, also generate a suggested response by calling the AI with:
   - The original venue question
   - The retrieved Reference Doc sections (via `retrieveRelevantSections({ task: "suggest_response" })`)
   - The venue context (priority, slot, city)

2. Store suggested response in `email_threads.aiQuickReplies` (already exists; use it for this).

3. Surface in the inbox UI above the reply bar:
   ```
   Venue asked: "What time is the wristband slot?"
   
   🤖 Suggested response:
   "Wristband slot is 7:30 PM to 10:30 PM — that's the check-in window where guests 
    pick up wristbands before starting the crawl. Let me know if that works for you."
   
   [ Use this response ]  [ Edit ]  [ Discard suggestion ]
   ```

4. If the engine can't generate a confident suggestion, surface the thread with no suggestion and the `needs_attention` flag (already covered by Phase 1.14).

**Acceptance criteria:**
- Question threads show a suggested response
- "Use" loads it into the composer
- "Edit" opens composer with the suggestion as starting point
- Threads where engine couldn't suggest don't show this UI

**Suggested commit message:** `feat(inbox): suggested-response UI for question replies [ReferenceDoc §8.5]`

---

## PHASE 2.10 — Inbox: cadence floor warning in composer

**Goal:** Block sends that violate cadence; show inline warning with options.

**Dependencies:** 1.9.

**Build steps:**

1. When composer attempts to send (server action), check `checkCadenceFloors`:
   - If `allowed === false`, return the error to the composer UI

2. Composer renders the warning inline:
   ```
   ⚠️ Cross-domain cadence floor would be violated
   
   This venue was last contacted from contacteventsperse.com 4 days ago.
   Sending from crawlconnector.com today would feel like spam.
   
   Wait until: Thursday, Oct 30 (3 more days)
   Or send from contacteventsperse.com — that's allowed.
   
   [ Cancel ]  [ Schedule for Oct 30 ]  [ Override (admin only) ]
   ```

3. "Schedule for Oct 30" sets `email_drafts.scheduled_for` instead of sending.

4. "Override" only shown to admin role; requires a reason text input; logs to `email_send_events.cadence_override_reason`.

**Acceptance criteria:**
- Non-admin send blocked correctly with warning
- Schedule action works
- Admin override works with reason logged

**Suggested commit message:** `feat(inbox): cadence floor warning + schedule + admin override`

---

## PHASE 2.11 — Inbox: quick-action chips

**Goal:** Common state transitions accessible as chips above the reply bar.

**Dependencies:** 1.12.

**Build steps:**

1. Add chip row above reply bar:
   ```
   [ Mark as Engaged ]  [ Mark as Soft No ]  [ Mark as Hard No ]
   [ Mark as Cancelled-by-them ]  [ Snooze 5 days ]  [ Assign to... ]
   ```

2. Each chip is a server action:
   - "Mark as Engaged" → set `classification = 'interested'`, `state = 'needs_reply'`, close to worklist
   - "Mark as Soft No" → set `classification = 'decline'`, transition cadence_state to `declined_this_campaign`
   - "Mark as Hard No" → set `classification = 'unsubscribe'`, transition to `opt_out_permanent`, mark venue × all-campaigns
   - "Mark as Cancelled-by-them" → trigger the cancellation flow (Phase 4)
   - "Snooze 5 days" → set `cadence_next_due_at = NOW() + 5 days`, `state = 'waiting_on_them'`
   - "Assign to..." → opens user picker

**Acceptance criteria:**
- All 6 chips work
- State transitions are correct
- Thread closes from operator's worklist after action

**Suggested commit message:** `feat(inbox): quick-action chips for common state transitions`

---

## PHASE 2.12 — Cold outreach: cadence-aware row states + next-action column

**Goal:** The cold outreach table at `/city-campaigns/[id]` shows cadence state + engine-picked next action.

**Dependencies:** 1.8, 1.4.

**Build steps:**

1. Modify `cold-outreach-table.tsx`:
   - Add a "Cadence state" column showing the rich state per Phase 4 spec:
     - 📨 Cold opener sent — 5 days ago — Touch 2 due tomorrow
     - 📨 Cold opener sent — 14 days ago — Sequence exhausted, ready for cross-domain handoff
     - ✅ Replied: Engaged — needs slot detail
     - 💤 Stalled warm — engaged once, ghosted 3 nudges
   - Compute from `cadence_state` + `venue_campaign_touch_log`

2. Add a "Next action" column showing the engine's pre-picked template:
   ```
   [ Send T1 ▾ ]   |   [ Send Touch 2 ▾ ]   |   [ Call ▾ ]
   ```
   - Dropdown caret shows alternatives

3. Wire the button to open the composer with `templateId` pre-set.

**Acceptance criteria:**
- Row state column accurate
- Action button reflects engine pick
- Alternatives dropdown works

**Suggested commit message:** `feat(cold-outreach): cadence-aware row state + next-action column`

---

## PHASE 2.13 — Cold outreach: bulk actions

**Goal:** Bulk operations operators use routinely.

**Dependencies:** 2.12.

**Build steps:**

1. Add three bulk actions to the cold outreach table header:
   - "Schedule next touches for this city" — for all rows in this city × campaign with cadence due in the next N days, generate drafts in one go
   - "Bulk add venues" — open a dialog to upload CSV (or paste venue names/addresses); engine resolves to existing venue records (or creates new ones) and adds them to `cold_outreach_entries`
   - "Bulk reassign owner" — change `assigned_staff_id` on selected rows

2. UI: checkbox column to select rows; bulk action toolbar appears when selection is non-empty.

**Acceptance criteria:**
- Each bulk action works on a sample of selected rows
- Drafts are generated for "Schedule next touches"

**Suggested commit message:** `feat(cold-outreach): bulk schedule + bulk add + bulk reassign`

---

## PHASE 2.14 — Cold outreach: cross-domain handoff flow

**Goal:** When a venue has exhausted a 3-touch sequence, surface the handoff option.

**Dependencies:** 1.8, 2.12.

**Build steps:**

1. Rows with `cadence_state = 'cold_exhausted_ready_for_handoff'` show a "Handoff to other domain" button.

2. Click opens a picker:
   - Lists alternative outreach_brands (filtered to ones with the 7-day floor already passed)
   - Each option shows: brand name, last touch from this brand (or "never"), alias to send from

3. Selecting an option:
   - Creates a new cold_outreach_entry (or updates ownership) with the new brand
   - Resets cadence_state to `cold_pending_touch_1`
   - Generates a fresh T1 draft via the engine

**Acceptance criteria:**
- Exhausted rows show handoff button
- Picker correctly filters by 7-day floor
- Handoff resets state + generates new draft

**Suggested commit message:** `feat(cold-outreach): cross-domain handoff flow [ReferenceDoc §9.1]`

---

## PHASE 2.15 — Effective priority computation + worklist sorting

**Goal:** Starting at 21 days before each event, the engine computes an "effective priority" per city that combines static priority with current ticket sales. Operator worklist + cold outreach views sort by effective priority. Static priority remains visible but doesn't drive scheduling once sales data is available.

**Dependencies:** 2.1 (worklist), 2.12 (cold outreach row state).

**Build steps:**

1. Create `lib/effective-priority.ts`:

   ```ts
   import "server-only";
   
   export interface EffectivePriorityArgs {
     staticPriority: 1|2|3|4|5|6;
     ticketsSold: number;        // current sold count for this city × campaign
     daysToEvent: number;         // days until earliest event in this city
   }
   
   export interface EffectivePriorityResult {
     effective: 1|2|3|4|5|6;
     reason: string;              // human-readable why
     pivotActive: boolean;        // true if sales-based adjustment is applied
   }
   
   export function computeEffectivePriority(args: EffectivePriorityArgs): EffectivePriorityResult;
   ```

2. Algorithm (per Reference Doc §1.6):
   - If `daysToEvent > 21`: pivot NOT active. `effective = staticPriority`. Reason: "Static priority — too early for sales data."
   - If `daysToEvent <= 21`:
     - **Sales boost:** if `ticketsSold > 20`, bump effective UP by 1 tier. If `ticketsSold > 50`, bump UP by 2 tiers.
     - **Sales drag:** if `ticketsSold === 0` AND `daysToEvent <= 14`, bump effective DOWN by 1 tier. If `ticketsSold === 0` AND `daysToEvent <= 7`, bump DOWN by 2 tiers.
   - Clamp result to [1, 6].
   - Reason string summarizes adjustment: "Bumped up from 4 → 2 because 35 tickets sold by day -14" or "Bumped down from 1 → 3 because 0 tickets sold by day -14".

3. Wire into worklist + cold outreach sorting:
   - Worklist `<CallsSection />` (Phase 2.5): sort by effective priority instead of static
   - Worklist `<DraftsSection />` (Phase 2.2): include effective priority as a secondary sort key after urgency
   - Cold outreach table sort: add "Effective priority" as a sortable column

4. UI changes — show effective priority badge:
   - In any city/venue row that uses priority, render the badge with both numbers if they differ:
     ```
     Toronto · Prio 1 (effective 3)
     Detroit · Prio 4 (effective 2)
     ```
   - Tooltip on hover shows the reason from `computeEffectivePriority`.

5. The ticket sales data source — query the existing Eventbrite integration (or whatever ticket count source the engine has). If Eventbrite integration isn't live yet, treat `ticketsSold` as 0 for now and add a TODO comment for when the integration ships. **Do NOT block this phase on Eventbrite — sorting still works with all-zeros, the pivot just doesn't trigger.**

6. Unit tests in `lib/effective-priority.test.ts`:
   - Day -30, static 1, 0 sold → effective 1, pivot inactive
   - Day -14, static 1, 0 sold → effective 3 (bumped down 2)
   - Day -14, static 4, 35 sold → effective 2 (bumped up 2)
   - Day -7, static 6, 100 sold → effective 4 (bumped up 2)
   - Clamping: static 1 with sales boost stays at 1

**Acceptance criteria:**
- Helper computes correct effective priority for all test cases
- Worklist + cold outreach views sort by effective priority when inside the 21-day window
- UI badge shows both numbers when they differ
- Code comments cite `[ReferenceDoc §1.6]`
- No regressions for cities outside the 21-day window (they sort by static priority normally)

**Suggested commit message:** `feat(priority): effective priority pivot at 21 days out [ReferenceDoc §1.6]`

---

# PHASE 3 — Post-confirm + lifecycle

This phase makes the engine auto-drive the post-confirmation sequence (T9-T17, H0a/H0b, V1) and adds the per-venue × per-domain relationship flag.

## PHASE 3.1 — `lib/lifecycle-scheduler.ts`

**Goal:** When a venue is marked confirmed, the engine auto-schedules all downstream touches.

**Dependencies:** 1.2 (T9-T17 seeded), 1.4 (template picker).

**Build steps:**

1. Create `lib/lifecycle-scheduler.ts`:
   ```ts
   import "server-only";
   
   export interface ScheduleLifecycleArgs {
     venueEventId: string;
     campaignId: string;
     confirmedAt: Date;
     eventDate: Date;
     ownerStaffId: string;  // Bryle by default
     isWristbandVenue: boolean;
     isMultiNight: boolean;
   }
   
   export async function scheduleLifecycle(args: ScheduleLifecycleArgs): Promise<{
     scheduledDraftIds: string[];
     skippedTouches: { code: string; reason: string }[];
   }>;
   ```

2. Implementation:
   - Compute scheduled_for for each lifecycle touch:
     - T9: now (immediate)
     - T10: 4-5 weeks before event (when graphic is ready — handled separately by graphics tracker)
     - T11: 3 weeks before event
     - T13: 2 weeks before event
     - T14: 1 week before event
     - T15: morning of event
     - T17: 2 days post-event
   - For each: pick the right template via `pickTemplate`, generate an `email_drafts` row with `scheduled_for` set
   - Skip touches where `scheduled_for` is in the past (e.g. for late confirmations < 2 weeks out, T11 is skipped)

3. Late-addition handling (Reference Doc §9.3):
   - If `daysToEvent < 14`: fire T9-near instead of T9-far, bundle T11/T13 content into T9-near, skip T11 and T13 separate touches
   - T14, T15, T17 still scheduled

4. Multi-night handling (Reference Doc §9.2):
   - If `isMultiNight`: bundle T9/T11/T13/T14/T17 into one combined email per touch
   - T10 graphics: split per night (separate drafts per crawl)
   - T15 day-of: split per night
   - T16 cancellation: only the cancelled night

**Acceptance criteria:**
- Calling `scheduleLifecycle` for a confirmed venue creates the right set of drafts
- Late-addition skips T11/T13 separate; bundles into T9-near
- Multi-night bundles correctly

**Suggested commit message:** `feat(lifecycle): scheduler for T9-T17 touchpoints [ReferenceDoc §7]`

---

## PHASE 3.2 — Lifecycle scheduling on venue-confirm action

**Goal:** Trigger `scheduleLifecycle` when an operator marks a venue as confirmed.

**Dependencies:** 3.1.

**Build steps:**

1. Find the existing "mark venue confirmed" action (likely in `_slot-actions.ts` or `_actions.ts` under city-campaigns).

2. After the confirm transaction succeeds, call `scheduleLifecycle()` with the venue's data.

3. Surface a toast: "Confirmed. Engine scheduled 5 lifecycle touchpoints (T9 immediate, T11 in 3 weeks, T13 in 2 weeks, T14 in 1 week, T15 morning-of, T17 post-event)."

**Acceptance criteria:**
- Confirming a venue creates lifecycle drafts visible in worklist
- Toast shows the count of scheduled touchpoints

**Suggested commit message:** `feat(lifecycle): auto-schedule on venue confirm`

---

## PHASE 3.3 — Multi-night venue bundling logic

**Goal:** When a venue is confirmed for multiple crawl-nights, lifecycle touches bundle correctly.

**Dependencies:** 3.1.

**Build steps:**

1. Detect multi-night confirmations:
   - A venue with multiple `venue_event` rows in the same campaign
   - Each row has its own slot + night

2. When `scheduleLifecycle` is called for ANY of those `venueEventId`s:
   - Check for sibling venue_events (same venue + same campaign)
   - If siblings exist, bundle drafts: one T9 covering all nights, one T11 with bundled info, etc.
   - Specific touches that split per night: T10 graphics, T15 day-of, T16 cancellation (only the cancelled night)

3. Bundled draft content uses merge fields that list all nights' details:
   - `{{venue_nights_summary}}` — formatted "Thursday Oct 29 as wristband + Friday Oct 30 as middle"

**Acceptance criteria:**
- A venue confirmed for 2 nights gets one T9 (not two)
- T15 still fires twice (one per night)
- T10 generates two separate drafts (one per night's graphic)

**Suggested commit message:** `feat(lifecycle): multi-night bundling [ReferenceDoc §9.2]`

---

## PHASE 3.4 — Late-addition flow

**Goal:** Venues confirmed within 2 weeks of event get bundled T9-near with no separate T11/T13.

**Dependencies:** 3.1.

**Build steps:**

1. In `scheduleLifecycle`, detect `daysToEvent < 14`:
   - Skip T11 + T13 separate touches
   - Generate one T9-near draft with bundled content (everything T9 + T11 + T13 would have said)
   - T14, T15, T17 still scheduled normally

2. T9-near template body (from Reference Doc §7.2) includes the bundled merge fields for info-gathering, wristband prep, etc.

**Acceptance criteria:**
- Venue confirmed 5 days before event gets only T9-near + T14 + T15 + T17 drafts
- T9-near body includes wristband + info-sheet content

**Suggested commit message:** `feat(lifecycle): late-addition bundles T9-near [ReferenceDoc §9.3]`

---

## PHASE 3.5 — Slot-change reply handling

**Goal:** When a venue replies "actually we can only do [other slot]", cleanly cancel original + re-confirm for new.

**Dependencies:** 3.2, plus Phase 4's cancellation flow.

**Build steps:**

1. Detect slot-change intent in inbound classifier:
   - Keywords: "actually can't do [day]", "can do [other day]", "switch to", "swap to"
   - Likely needs a new classification value or a special-case flag

2. When detected, surface in operator's pending-replies with a "Slot change requested" indicator + suggested handling:
   ```
   Venue wants to swap: Thursday → Friday
   [ Approve swap ]  [ Open thread to discuss ]  [ Decline (slot is taken) ]
   ```

3. "Approve swap" triggers:
   - `triggerVenueCancellation` for the original slot (Phase 4)
   - Confirm venue for the new slot, kicking off `scheduleLifecycle` fresh

**Acceptance criteria:**
- Slot-change replies are detected and flagged
- "Approve swap" cleanly transitions venue × campaign state

**Suggested commit message:** `feat(lifecycle): slot-change reply handling [ReferenceDoc §9.4]`

---

## PHASE 3.6 — H0a hire-time briefing email + trigger

**Goal:** When an external host is hired, engine generates H0a draft.

**Dependencies:** 1.3 (H0a seeded).

**Build steps:**

1. Find the existing "create external host" action (in `external-hosts/_actions.ts` or similar).

2. After host creation + linking to a venue_event, generate an H0a `email_drafts` row:
   - Owner: the host manager assigned to this host (default: Bryle)
   - Recipient: the host's email
   - Body merged with host name, pay rate, payment method, host manager contact info
   - `scheduled_for = NULL` (review + send immediately)

**Acceptance criteria:**
- Hiring an external host generates an H0a draft for the host manager
- Merge fields render correctly

**Suggested commit message:** `feat(lifecycle): H0a hire-time briefing email`

---

## PHASE 3.7 — H0b week-of briefing email + trigger

**Goal:** Monday/Tuesday of event week, engine generates H0b draft for the host.

**Dependencies:** 1.3 (H0b seeded), 3.1.

**Build steps:**

1. In `scheduleLifecycle`, for each external host assigned to a venue_event, also schedule an H0b draft for Monday of event week:
   - Scheduled_for: Monday at 9 AM in operator's timezone
   - Owner: host manager
   - Body merged with wristband venue address, contact, full lineup, wristband image attachment

2. Add a cron task (daily) that materializes scheduled H0b drafts so they appear in the worklist on the day they're due.

**Acceptance criteria:**
- H0b draft scheduled correctly per event
- Appears in worklist on Monday of event week

**Suggested commit message:** `feat(lifecycle): H0b week-of host briefing`

---

## PHASE 3.8 — Migration: venue × outreach_brand relationship flag

**Goal:** Per Reference Doc §3.3, track per-venue × per-domain relationship history.

**Dependencies:** None.

**Build steps:**

1. Inspect existing `venue_domain_aliases` table (migration 0084) — verify if it's already storing this data. If yes, extend; if no, create new table.

2. Migration `0099_venue_domain_relationships.sql`:
   ```sql
   CREATE TABLE venue_domain_relationships (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     venue_id UUID NOT NULL REFERENCES venues(id) ON DELETE CASCADE,
     outreach_brand_id UUID NOT NULL REFERENCES outreach_brands(id) ON DELETE CASCADE,
     status TEXT NOT NULL CHECK (status IN ('good', 'neutral', 'bad', 'no_history')),
     set_by TEXT NOT NULL CHECK (set_by IN ('auto_inbound', 'manual_operator', 'post_event_flag')),
     set_by_staff_id UUID REFERENCES staff_members(id),
     notes TEXT,
     set_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     auto_clear_at TIMESTAMPTZ,
     UNIQUE(venue_id, outreach_brand_id)
   );
   
   CREATE INDEX vdr_venue_idx ON venue_domain_relationships(venue_id);
   CREATE INDEX vdr_status_idx ON venue_domain_relationships(status);
   ```

3. Drizzle schema in `db/schema/venue-domain-relationships.ts`.

**Acceptance criteria:**
- Migration applies
- Drizzle types compile

**Suggested commit message:** `feat(relationships): venue × outreach_brand relationship table (0099)`

---

## PHASE 3.9 — Relationship flag auto-detection from inbound

**Goal:** When the classifier sees clear positive/negative signals, auto-update the relationship flag.

**Dependencies:** 1.13, 3.8.

**Build steps:**

1. In the classifier pipeline, after each inbound classification:
   - If classification is `hard_no` (unsubscribe / "remove us"): set venue × brand relationship to `bad`, `set_by = 'auto_inbound'`, `auto_clear_at = NOW() + 1 year`
   - If classification is `engaged` AND no prior relationship row exists: set to `neutral` (don't auto-flag good — that requires explicit positive signal per Reference Doc §7.15.3a)
   - If classification is `cancelled_by_them`: stay neutral, do NOT auto-flag bad (Reference Doc §7.16.4 — don't punish cancellations)

2. Log the auto-flag in a per-venue audit trail.

**Acceptance criteria:**
- Hard-no replies auto-flag bad
- Engaged + no prior history sets neutral
- Cancellations don't auto-flag bad

**Suggested commit message:** `feat(relationships): auto-detect from inbound classifications [ReferenceDoc §3.3]`

---

## PHASE 3.10 — Hard-block on send for bad-flagged pairs

**Goal:** Prevent operators from sending FROM a brand to a venue where the relationship is bad.

**Dependencies:** 3.8.

**Build steps:**

1. In `checkCadenceFloors` (Phase 1.9), add an additional check:
   - Lookup `venue_domain_relationships` for the sending brand + recipient venue
   - If `status = 'bad'`: hard-block the send. UI shows:
     ```
     ⛔ This venue is flagged as 'bad' relationship for [brand].
     This block was set [date] by [operator] (reason: [notes]).
     Auto-clears: [auto_clear_at]
     [ Cancel ]  [ Change override (admin only) ]
     ```

2. Admin can override with reason logged to `email_send_events.cadence_override_reason`.

3. The engine's template picker (`pickTemplate`) should also factor in relationship — prefer brands with `good` or `no_history` flags when handing off cross-domain.

**Acceptance criteria:**
- Send blocked for bad-flagged pairs
- Admin override works
- Picker avoids bad-flagged brands

**Suggested commit message:** `feat(relationships): hard-block sends for bad pairs`

---

## PHASE 3.11 — Auto-decay cron for bad flags

**Goal:** Bad flags auto-clear after 1 year per Reference Doc §3.3.

**Dependencies:** 3.8.

**Build steps:**

1. Daily cron that runs:
   ```sql
   UPDATE venue_domain_relationships
   SET status = 'no_history', set_by = 'auto_inbound', notes = COALESCE(notes, '') || ' [auto-cleared after 1 year]'
   WHERE status = 'bad' AND auto_clear_at < NOW();
   ```

2. Log to cron_runs.

**Acceptance criteria:**
- Bad flags older than 1 year auto-clear
- Logged in cron_runs

**Suggested commit message:** `feat(relationships): auto-decay bad flags after 1 year`

---

## PHASE 3.12 — Post-event relationship-flag prompt UI

**Goal:** After each event, prompt operators to flag the venue × brand relationship.

**Dependencies:** 3.8.

**Build steps:**

1. Add a daily cron or post-event trigger that, for each venue_event where event_date is 1-2 days in the past, creates a `relationship_flag_pending` task row.

2. Surface in the operator's worklist as a new mini-section:
   ```
   ┌─ RELATIONSHIP FLAGS PENDING (3) ─────────────────────────┐
   │ Bar Opium (Toronto Halloween 2026):                      │
   │ Did the event go well? [ Good ] [ Neutral ] [ Bad ]      │
   │ Optional notes: _________                                │
   └──────────────────────────────────────────────────────────┘
   ```

3. Click an option → updates `venue_domain_relationships` row + dismisses the prompt.

**Acceptance criteria:**
- Prompts appear in worklist 1-2 days post-event
- Click updates DB + dismisses

**Suggested commit message:** `feat(relationships): post-event flag prompt in worklist [ReferenceDoc §7.15.3]`

---

## PHASE 3.13 — V2-call task surfacing (floor-staff confirmation)

**Goal:** Per Reference Doc §7.14.3a, the host manager's worklist surfaces a "V2-call" task for every confirmed venue 4 days before its event. Operator calls the venue's frontline staff (not the manager) to make sure floor staff know the crawl is happening. Tracks call attempts + outcomes.

**Dependencies:** 2.5 (calls section in worklist), 3.2 (venues are being confirmed via lifecycle scheduler so the engine knows what events are confirmed).

**Build steps:**

1. Migration `0100_floor_staff_briefed.sql`:
   ```sql
   ALTER TABLE venue_events
     ADD COLUMN floor_staff_briefed_at TIMESTAMPTZ,
     ADD COLUMN floor_staff_call_attempts INTEGER NOT NULL DEFAULT 0,
     ADD COLUMN floor_staff_last_call_at TIMESTAMPTZ,
     ADD COLUMN floor_staff_last_call_outcome TEXT;
   
   -- Outcome values: 'confirmed_with_floor_staff' | 'manager_again_partial' 
   --                  | 'no_answer' | 'voicemail' | 'issue_raised'
   ```

2. Cron job that runs daily: for every confirmed `venue_event` where `event_date - NOW() BETWEEN 0 AND 4 days`:
   - If `floor_staff_briefed_at IS NULL`: surface a V2-call task to the host manager's worklist
   - Tasks include: venue name, slot type, slot times, phone number, OpenPhone click-to-call link, script preview (per Reference Doc §7.14.3a)
   - Sort: by event date ascending (most urgent first), then by static priority

3. Worklist integration — modify Phase 2.5's `<CallsSection />` to include a sub-group "Floor-staff briefing calls" when the current operator is the host manager:
   ```
   ┌─ FLOOR-STAFF BRIEFING CALLS (8 due in next 4 days) ─────┐
   │                                                          │
   │ 📞 Bar Opium (Toronto Halloween, Saturday Oct 31)        │
   │    Wristband venue, 7:30-10:30 PM                        │
   │    Phone: +1 416 555 0100                                │
   │    [ Click to call via OpenPhone ]  [ Script ▾ ]         │
   │    Attempts: 0  •  Last: never                           │
   │                                                          │
   │ 📞 Le Petit Chat (Toronto Halloween, Friday Oct 30)      │
   │    Middle venue, 8:30-11:30 PM                           │
   │    Phone: +1 416 555 0234                                │
   │    Attempts: 1 (no answer Wed 2pm)                       │
   │    [ Click to call ]  [ Mark as voicemail again ]        │
   │                                                          │
   └──────────────────────────────────────────────────────────┘
   ```

4. After-call outcome buttons (one of the 5 outcomes):
   - **Confirmed with floor staff** → set `floor_staff_briefed_at = NOW()`, increment `floor_staff_call_attempts`, dismiss from worklist
   - **Talked to manager again** → increment attempts, schedule retry for tomorrow, leave on worklist
   - **No answer / voicemail** → increment attempts. If 3+ failed attempts AND <2 days to event, escalate to "needs attention" flag + notify campaign manager
   - **Issue raised on call** → open a note field, flag for host manager / operator follow-up, leave on worklist until resolved

5. Surface `floor_staff_briefed_at` as a small pill on the event-day readiness dashboard (the existing `/admin/event-day-readiness` page or wherever event-day status lives):
   - Green pill: "Floor staff briefed [date]"
   - Amber pill: "Floor staff NOT briefed yet — X days to event"
   - Red pill: "Floor staff NOT briefed AND <2 days to event"

6. Code comments cite `[ReferenceDoc §7.14.3a]` where the rule is encoded.

**Acceptance criteria:**
- Daily cron surfaces V2-call tasks 4 days before each confirmed event
- Tasks appear in the host manager's worklist only (NOT in regular operator worklists per Reference Doc §8.2)
- After-call outcome buttons correctly update `venue_events.floor_staff_*` columns
- Event-day readiness pill renders correctly per status
- 3+ failed attempts within 2 days of event escalates to needs-attention

**Suggested commit message:** `feat(post-confirm): V2-call floor-staff briefing surface [ReferenceDoc §7.14.3a]`

---

# PHASE 4 — Cancellation + safety nets

This phase handles the fire-drill case: confirmed venues canceling. Multi-staff coordination, T16, Cancelled-by-Venue table.

## PHASE 4.1 — `lib/cancellation-flow.ts`

**Goal:** Central function that handles all state changes when a venue cancels.

**Dependencies:** 1.8 (cadence), 3.1 (lifecycle scheduler — to know what to cancel).

**Build steps:**

1. Create `lib/cancellation-flow.ts`:
   ```ts
   import "server-only";
   
   export interface CancellationArgs {
     venueEventId: string;
     campaignId: string;
     triggerSource: "auto_inbound" | "manual_operator" | "venue_call";
     operatorId: string;
     reasonText?: string;
   }
   
   export async function triggerVenueCancellation(args: CancellationArgs): Promise<{
     cancelledDraftIds: string[];
     notificationsScheduled: number;
   }>;
   ```

2. Operations performed:
   - Mark venue × campaign state as `cancelled_by_them`
   - Set venue_event status to `cancelled`
   - Cancel all scheduled `email_drafts` for this venue_event (set `archived_at = NOW()`)
   - Open the slot as `needs_replacement`
   - Generate T16 cancellation email draft for original confirmer
   - Trigger fan-out notifications (Phase 4.5)

3. Wrap in a transaction so the state is consistent.

**Acceptance criteria:**
- Calling the function transitions all state cleanly
- T16 draft generated
- Future drafts cancelled

**Suggested commit message:** `feat(cancellation): central cancellation flow [ReferenceDoc §7.16]`

---

## PHASE 4.2 — Auto-detection of cancellation language

**Goal:** Classifier detects cancellation intent and triggers the flow at >= 90% confidence.

**Dependencies:** 1.13, 4.1.

**Build steps:**

1. In the classifier, when classifying as `cancelled_by_them` with confidence >= 0.90:
   - Auto-call `triggerVenueCancellation`
   - Set `set_by = "auto_inbound"`

2. If confidence < 0.90, surface with `needs_attention = true` + a "Looks like a cancellation — confirm?" chip.

**Acceptance criteria:**
- Cancellation language auto-triggers flow at high confidence
- Lower confidence flags for operator confirmation

**Suggested commit message:** `feat(cancellation): auto-detect from inbound replies`

---

## PHASE 4.3 — Stop-downstream-touches logic

**Goal:** All scheduled lifecycle drafts for the cancelled venue × campaign are stopped immediately.

**Dependencies:** 4.1.

**Build steps:**

1. In `triggerVenueCancellation`:
   - `UPDATE email_drafts SET archived_at = NOW() WHERE venue_id = X AND campaign_id = Y AND sent_at IS NULL`
   - Log how many drafts were archived

2. Worklist + cold-outreach views filter out archived drafts.

**Acceptance criteria:**
- No future T11/T13/T14/T15 drafts appear for cancelled venue

**Suggested commit message:** `feat(cancellation): stop downstream touches on cancel`

---

## PHASE 4.4 — T16 cancellation email + draft generation

**Goal:** Engine generates T16 draft for the original confirmer to review + send.

**Dependencies:** 1.2 (T16 seeded), 4.1.

**Build steps:**

1. In `triggerVenueCancellation`, generate one `email_drafts` row:
   - Template: T16
   - Owner: original confirmer (the staff member who originally confirmed this venue)
   - Recipient: venue's primary contact email
   - Merge field `{{cancellation_reason_phrase}}` populated from one of 4 variants per Reference Doc §7.10 — operator picks during review

**Acceptance criteria:**
- T16 draft appears in original confirmer's worklist
- Reason phrase variant pickable from dropdown

**Suggested commit message:** `feat(cancellation): T16 draft generation`

---

## PHASE 4.5 — Multi-staff notification fan-out

**Goal:** When a venue cancels, multiple staff are notified in parallel per Reference Doc §7.16.8.

**Dependencies:** 4.1.

**Build steps:**

1. Create `lib/cancellation-notifications.ts`:
   - Identifies which staff need to be notified based on the venue_event + campaign:
     - Original confirmer
     - Bryle (or whoever owns post-confirm coordination for this campaign)
     - Host manager (if a host was assigned)
     - Brandon (if a wristband shipment is in flight OR a host payment is scheduled)
     - Graphics designer (if T10 graphic in progress)
     - Campaign manager
   - Generates one notification per relevant staff with:
     - In-app alert (always)
     - Email (for 2+ weeks-out cancellations)
     - SMS (for week-of or day-of cancellations — Phase 5, deferred for now: log as "would have sent SMS" until Twilio is live)

2. Use existing `notifications` table (verify schema; if no in-app notification system exists, build one as part of this phase).

**Acceptance criteria:**
- 5-6 notifications generated per cancellation depending on context
- Each notification shows the right urgency tier

**Suggested commit message:** `feat(cancellation): multi-staff notification fan-out`

---

## PHASE 4.6 — Acknowledgment tracking + auto-escalation

**Goal:** Each notification has an Acknowledge button. Engine escalates if no ack within window.

**Dependencies:** 4.5.

**Build steps:**

1. Notifications table gets `acknowledged_at`, `acknowledged_by` columns (migration).

2. UI shows "Acknowledge" button on each notification.

3. Cron job runs every 15 minutes:
   - For day-of cancellations: if not acked within 15 min, page everyone
   - For week-of: if not acked within 2 hours, escalate to campaign manager
   - For 2-3 weeks-out: if not acked within 24 hours, surface to campaign manager

**Acceptance criteria:**
- Ack persists
- Escalation cron fires correctly per urgency tier

**Suggested commit message:** `feat(cancellation): acknowledgment + auto-escalation`

---

## PHASE 4.7 — Cancelled-by-Venue dedicated table view

**Goal:** A page or section showing all cancelled-by-them venues for a campaign with operational tails.

**Dependencies:** 4.1.

**Build steps:**

1. Create `app/(admin)/campaigns/[id]/cancelled-venues/page.tsx`:
   - Table with columns per Reference Doc §7.16.10:
     - Venue name
     - Date cancelled
     - Days before event
     - Slot they had
     - Original confirmer
     - Replacement venue (when found)
     - Wristband shipping status
     - Host reassignment status
     - Relationship flag set
     - Acknowledgment status per staff

2. Filter: hide rows where all operational tails are resolved (archive view).

**Acceptance criteria:**
- Page renders with all cancelled-by-them venues
- Operational columns accurate

**Suggested commit message:** `feat(cancellation): Cancelled-by-Venue dedicated table view [ReferenceDoc §7.16.10]`

---

## PHASE 4.8 — Comeback flow handling

**Goal:** If a cancelled venue tries to come back, handle politely.

**Dependencies:** 4.1.

**Build steps:**

1. Classifier detects "comeback" intent on inbound replies from `cancelled_by_them` venues:
   - "We can do Saturday after all"
   - "Sorry, the wedding fell through"
   - Etc.

2. Surface in operator's worklist:
   ```
   Bar Opium (cancelled 5 days ago) wants to come back.
   Slot status: [STILL OPEN | FILLED BY REPLACEMENT]
   
   If still open: [ Re-confirm them ]  [ Polite decline ]
   If filled: [ Send "thanks but already filled" reply ]
   ```

3. "Re-confirm them" transitions venue × campaign back to `confirmed`, schedules a fresh lifecycle (Phase 3.2).

**Acceptance criteria:**
- Comeback replies surface in worklist
- Re-confirm action works
- "Polite decline" sends a templated response

**Suggested commit message:** `feat(cancellation): comeback flow [ReferenceDoc §7.16.6]`

---

## PHASE 4.9 — Misrouted positive reply routing

**Goal:** When a positive reply lands on the wrong alias's inbox, route to original pitcher's queue.

**Dependencies:** None (small fix).

**Build steps:**

1. In the inbound poller, when a thread is matched to a venue × campaign:
   - Check `venue_campaign_touch_log` for the most recent outbound to this venue in this campaign
   - If the most recent send was from a DIFFERENT alias than the one receiving the reply:
     - Assign the thread to the original sender (original confirmer)
     - Surface a small note: "Reply landed on [other alias], routed to [original pitcher]'s queue"

2. Both aliases see the thread in their secondary queue; either can act.

**Acceptance criteria:**
- Misrouted replies appear in original pitcher's worklist
- Note visible in thread metadata

**Suggested commit message:** `feat(inbox): misrouted reply routing [ReferenceDoc §9.5]`

---

# PHASE 5 — NYE / SMS (post-Halloween 2026)

Phases 5+ are post-Halloween work; spec'd here so it's tracked but not blocking.

## PHASE 5.1 — Twilio account + A2P 10DLC registration kickoff

**Goal:** Procurement + admin work. Not engineering — but needs to start early because A2P 10DLC takes 1-3 weeks.

**Steps:**
1. Sign up Twilio account
2. Buy local long-code numbers (1-2 per region: NA, UK/EU, AU)
3. Submit A2P 10DLC registration for US sending
4. Document credentials in env config

## PHASE 5.2 — `lib/sms.ts` infrastructure

**Goal:** Send + receive SMS via Twilio.

**Build steps:**

1. Create `lib/sms.ts`:
   ```ts
   export async function sendSMS(args: { to: string; body: string; campaignId?: string }): Promise<{ sid: string }>;
   ```

2. Webhook endpoint at `/api/sms/inbound` for Twilio to POST to.

3. Tables:
   - `sms_messages` (outbound + inbound logs)
   - `sms_consent_log` (when opt-in/STOP happened)

## PHASE 5.3 — Inbound webhook + STOP handling

**Goal:** Inbound SMS processing.

## PHASE 5.4 — Host H1-H5 SMS cadence

**Goal:** Automated 5-touch SMS cadence for external hosts per Reference Doc §7.14.2.

## PHASE 5.5 — Lineup-change SMS to working hosts

## PHASE 5.6 — Host payment confirmation SMS

## PHASE 5.7-5.10 — Smart Map + Eventbrite integration

**Goal:** Re-point existing systems to consume from the engine instead of Sheets/web-form.

(Detailed specs deferred to Phase 5 kickoff time.)

---

# PHASE 6 — Polish (post-NYE)

Detailed specs to be expanded at Phase 6 kickoff. Items per the Build Tracker.

---

# Appendix A — Doc-to-engine retrieval task map

The full map of which Reference Doc sections each AI task pulls. Maintained in `lib/reference-retrieval-task-map.ts` (Phase 0.4).

| Task | Sections retrieved |
|---|---|
| `classify_reply` | 6.3, 6.4, 8.3, 8.4 |
| `suggest_response` | 5, 8.5, 0.1 |
| `pick_template` | 7, 8.7, 9.2 |
| `compute_turnout` | 5, 5.2, 5.3 |
| `draft_t17` | 7.15, 7.15.1, 10.1 |
| `draft_t16` | 7.10, 7.16 |
| `cancellation_response` | 7.10, 7.16, 7.16.8, 8.3 |
| `host_briefing` | 7.13, 7.13.9, 7.14.2 |
| `cadence_decision` | 6, 6.2, 6.3, 9.1 |
| `free_text_question` | 5, 8.5, 8.6 |

---

# Appendix B — Pre-flight checks (before Phase 1)

1. Halloween 2026 campaign exists in DB. Note the UUID for seeding scripts.
2. Priority numbers assigned to all cities.
3. Host roster + alias mapping finalized (Reference Doc §3.1 — pending operator finalization).
4. `venue_domain_aliases` (migration 0084) inspected — verify if it's already the relationship flag table.
5. Bryle's user_id confirmed (referenced by lifecycle scheduler as default owner).
6. Brandon's user_id + role confirmed (referenced by host payment confirmations).
7. `OPENAI_API_KEY` is set and the existing AI features work (Phase 0.3 uses this for embeddings).
8. pgvector extension installed on the DB (Phase 0.2 will install if missing).

---

# Appendix C — Audit summary

The engine is roughly **60% built** against the Reference Doc.

**What's built:**
- Inbox triage + AI classification (80%)
- Templates + composer (50% — needs campaign scoping)
- Cadence engine (40% — needs rewrite)
- Cold outreach pipeline (70%)
- Post-confirm ops (30% — has deliverables, no T9-T17 generation)
- Host management (50%)
- Cancellation flow (20%)
- Adjacent system integration (10%)

**What's not:**
- Twilio SMS infrastructure
- Host briefing flows (H0a/H0b)
- Operator daily worklist
- Cancellation alert fan-out
- Per-venue × per-domain relationship flag
- Smart Map ↔ engine integration
- Eventbrite ↔ engine integration

**Highest ROI for Halloween 2026:**
1. Phase 1 — Templates, cadence, turnout (foundation)
2. Phase 2 — Operator daily UX (biggest dummy-proof gain)
3. Phase 3 — Post-confirm + lifecycle
4. Phase 4 — Cancellation + safety nets

Phases 5 + 6 are post-Halloween, before NYE / St. Patrick's.

---

*End of phased build spec. Hand each PHASE block to Claude Code in sequence. Mark complete in the Build Tracker as you go.*
