/**
 * scripts/import-gmail-labels.ts
 *
 * One-shot import that backfills the team_labels namespace from
 * existing Gmail labels across every connected_account on a team.
 *
 * Workflow:
 *   1. List every user label on every connected_account on the
 *      target team (Gmail's users.labels.list — system labels like
 *      INBOX / CATEGORY_* are filtered out).
 *   2. Group by case-insensitive name. Each unique name becomes one
 *      team_labels row.
 *   3. Insert the team_label (idempotent — onConflictDoNothing on
 *      the unique index team_labels_team_name_unique).
 *   4. Insert one team_label_gmail_links row per (team_label,
 *      connected_account, gmail_label_id) tuple (idempotent on the
 *      composite unique index).
 *
 * Usage:
 *   TEAM_ID=00000000-0000-0000-0000-000000000001 \
 *     CREATED_BY_USER_ID=<some-admin-uuid> \
 *     pnpm tsx scripts/import-gmail-labels.ts
 *
 * Safe to re-run: re-running on a team that's already imported is a
 * no-op except for newly-added Gmail labels on accounts since the
 * last run.
 *
 * What does NOT happen:
 *   - Gmail-side renames are not pushed. If two accounts have a
 *     label "Toronto-2026" and the dashboard renames it to
 *     "Toronto 2026", the Gmail labels keep their old name. The
 *     team_label tracks both via the link table.
 *   - Colors are not imported. Gmail's color model doesn't map
 *     cleanly to the dashboard's Tailwind palette; team_labels.color
 *     stays null for imports (renders as neutral zinc) and can be
 *     set later via the /admin/labels UI.
 */

import "dotenv/config";
import { staffOutreachEmails, teamLabelGmailLinks, teamLabels } from "@/db/schema";
import { db } from "@/lib/db";
import { listGmailLabels } from "@/lib/gmail";
import { eq, sql } from "drizzle-orm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Gmail system label ids that should never be imported as team_labels. */
const GMAIL_SYSTEM_LABEL_IDS = new Set([
  "INBOX",
  "UNREAD",
  "STARRED",
  "IMPORTANT",
  "SENT",
  "DRAFT",
  "TRASH",
  "SPAM",
  "CHAT",
]);

interface LabelDiscovery {
  /** Canonical (case-preserved) name from the first account we saw it on. */
  name: string;
  /** Per-account map of gmail_label_id keyed by connected_account_id. */
  byAccount: Map<string, string>;
}

async function main() {
  const teamId = (process.env.TEAM_ID ?? "").trim();
  const createdBy = (process.env.CREATED_BY_USER_ID ?? "").trim() || null;

  if (!UUID_RE.test(teamId)) {
    console.error("TEAM_ID must be a UUID. e.g. TEAM_ID=00000000-0000-0000-0000-000000000001");
    process.exit(1);
  }
  if (createdBy && !UUID_RE.test(createdBy)) {
    console.error("CREATED_BY_USER_ID must be a UUID or unset.");
    process.exit(1);
  }

  // 1. List every connected account on the team that has a usable
  //    refresh token. Disconnected accounts have no labels to read.
  const accounts = await db
    .select({
      id: staffOutreachEmails.id,
      email: staffOutreachEmails.emailAddress,
      token: staffOutreachEmails.gmailOauthRefreshToken,
      status: staffOutreachEmails.status,
    })
    .from(staffOutreachEmails)
    .where(eq(staffOutreachEmails.teamId, teamId));

  if (accounts.length === 0) {
    // biome-ignore lint/suspicious/noConsoleLog: CLI script
    console.log(`No connected accounts on team ${teamId}. Nothing to do.`);
    process.exit(0);
  }

  // 2. Walk each account, collect labels, group by lowercased name.
  //    A single bad token just skips that account — the rest still
  //    proceed.
  const byName = new Map<string, LabelDiscovery>();

  for (const acct of accounts) {
    if (acct.status === "disconnected" || !acct.token) {
      // biome-ignore lint/suspicious/noConsoleLog: CLI script
      console.log(
        `Skipping ${acct.email}: status=${acct.status}, token=${acct.token ? "present" : "missing"}`,
      );
      continue;
    }
    try {
      const labels = await listGmailLabels(acct.token);
      for (const l of labels) {
        if (l.type !== "user") continue;
        if (GMAIL_SYSTEM_LABEL_IDS.has(l.id)) continue;
        if (l.id.startsWith("CATEGORY_")) continue;
        const key = l.name.toLowerCase();
        const existing = byName.get(key);
        if (existing) {
          existing.byAccount.set(acct.id, l.id);
        } else {
          byName.set(key, {
            name: l.name,
            byAccount: new Map([[acct.id, l.id]]),
          });
        }
      }
      // biome-ignore lint/suspicious/noConsoleLog: CLI script
      console.log(`  ${acct.email}: discovered ${labels.length} labels`);
    } catch (err) {
      console.error(
        `  ${acct.email}: listGmailLabels failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (byName.size === 0) {
    // biome-ignore lint/suspicious/noConsoleLog: CLI script
    console.log("No user labels found on any account. Done.");
    process.exit(0);
  }

  // biome-ignore lint/suspicious/noConsoleLog: CLI script
  console.log(`\nDistinct labels discovered: ${byName.size}`);

  // 3. Upsert team_labels rows + 4. upsert team_label_gmail_links rows.
  //    Both inserts use onConflictDoNothing so a re-run is a no-op.
  let labelInserts = 0;
  let labelExisting = 0;
  let linkInserts = 0;
  let linkExisting = 0;

  for (const discovery of byName.values()) {
    // Insert (or fetch existing) team_label row. The unique index
    // on (team_id, lower(name)) is created by migration 0047. We let
    // Postgres reject inserts that collide via the implicit
    // onConflictDoNothing (no `target` arg — any unique violation
    // triggers the do-nothing branch).
    const inserted = await db
      .insert(teamLabels)
      .values({
        teamId,
        name: discovery.name,
        color: null,
        createdBy,
        updatedBy: createdBy,
      })
      .onConflictDoNothing()
      .returning({ id: teamLabels.id, name: teamLabels.name });

    let teamLabelId: string;
    if (inserted[0]) {
      teamLabelId = inserted[0].id;
      labelInserts++;
    } else {
      // Conflict on (team_id, lower(name)) — the unique index. Fetch
      // the existing row using the same lower() comparison the index
      // uses, so case differences (e.g. "VIP" vs "vip" already
      // imported) still match.
      const existing = await db.execute<{ id: string }>(
        sql`SELECT id FROM team_labels WHERE team_id = ${teamId}::uuid AND lower(name) = lower(${discovery.name}) LIMIT 1`,
      );
      const rows = Array.isArray(existing)
        ? (existing as unknown as Array<{ id: string }>)
        : ((existing as unknown as { rows: Array<{ id: string }> }).rows ?? []);
      const row = rows[0];
      if (!row) {
        console.error(
          `  WARN: insert conflict for "${discovery.name}" but lookup found nothing. Skipping link inserts for this label.`,
        );
        continue;
      }
      teamLabelId = row.id;
      labelExisting++;
    }

    // Link rows: one per (team_label, connected_account, gmail_label_id).
    for (const [connectedAccountId, gmailLabelId] of discovery.byAccount) {
      const linkInserted = await db
        .insert(teamLabelGmailLinks)
        .values({ teamLabelId, connectedAccountId, gmailLabelId })
        .onConflictDoNothing()
        .returning({ id: teamLabelGmailLinks.id });
      if (linkInserted[0]) linkInserts++;
      else linkExisting++;
    }
  }

  // biome-ignore lint/suspicious/noConsoleLog: CLI script summary
  console.log(`
Import complete:
  team_labels      ${labelInserts} created, ${labelExisting} already existed
  link rows        ${linkInserts} created, ${linkExisting} already existed
`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(99);
});
