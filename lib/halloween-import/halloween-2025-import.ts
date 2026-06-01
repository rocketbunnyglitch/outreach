/**
 * Halloween 2025 import — thin shim over the generic campaign
 * importer.
 *
 * Kept as its own file (with the legacy `runHalloween2025Import`
 * name) so the existing admin action signatures + the routing in
 * `app/(admin)/admin/_actions-halloween-import.ts` don't need to
 * change. New campaign imports (Phase 2) call `runCampaignImport`
 * directly with their own config.
 */

import {
  type CampaignImportConfig,
  HALLOWEEN_2025_CONFIG,
  type ImportReport,
  runCampaignImport,
} from "@/lib/import/generic-campaign-import";

export type { ImportReport, ImportDecisionRow } from "@/lib/import/generic-campaign-import";

interface ImportOpts {
  dryRun?: boolean;
  cityLimit?: number | null;
  onlySheetName?: string | null;
  staffId: string;
}

export async function runHalloween2025Import(opts: ImportOpts): Promise<ImportReport> {
  return runCampaignImport(HALLOWEEN_2025_CONFIG, opts);
}

/**
 * Re-export the config so future callers (e.g. the admin panel's
 * "What campaign am I importing?" header) can pull metadata without
 * needing to know it lives in the generic module.
 */
export const CONFIG: CampaignImportConfig = HALLOWEEN_2025_CONFIG;
