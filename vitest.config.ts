import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Minimal vitest config for pure-logic unit tests. Only the import-safe
// lib modules (no DB / network / server-only side effects at module load)
// are exercised here; integration coverage lives in docs/QA_MATRIX.md.
//
// The "@/..." path alias mirrors tsconfig.json so test files can import
// project modules the same way app code does.
export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
  test: {
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next", "dist"],
    environment: "node",
  },
});
