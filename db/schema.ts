/**
 * Re-exports from db/schema/index.ts for compatibility with lib/db.ts.
 *
 * The actual schema modules live in db/schema/. This file exists because
 * `import * as schema from "@/db/schema"` is the convention Drizzle and
 * drizzle-kit expect. Keeping it as a thin re-export means we can grow the
 * schema directory without touching lib/db.ts.
 */

export * from "./schema/index";
