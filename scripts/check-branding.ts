// Deprecated customer-facing branding check.
//
// Flags occurrences of the old product names in src TS/TSX files so a future edit doesn't
// silently reintroduce pre-rebrand branding. Customer-facing brand strings must come from
// apps/web/src/config/brand.ts (product: "Soletrade", company: "Matt Haitana").
//
// Flagged phrases (case-insensitive): the old "soletrade OS", "soletrade Workspace" and legacy
// "soletrade suite" product forms. The valid repository/package slug `soletrade` is NEVER
// flagged (hyphenated, not a customer-facing brand), nor is the bare word "suite" (test
// suites, third-party tooling).
//
// Run: `pnpm branding:check`. Exits 1 with a file:line list if any deprecated branding is found.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Run via pnpm from the repo root, so process.cwd() is the repository root.
const ROOT = join(import.meta.dirname, "..");
const SOURCES = ["apps/web/src", "apps/mobile/src"].map((source) => join(ROOT, source));

// Case-insensitive deprecated phrases. The repo slug `soletrade` is excluded per-line below.
const DEPRECATED = ["soletrade os", "soletradeos", "soletrade suite", "soletrade workspace"];

// Files to scan: TS/TSX under src/ (code + UI - the customer-facing surface). Docs are excluded
// because migration runbooks legitimately reference the old name when describing what to update.
// Test files are excluded too: negative assertions legitimately spell out the deprecated names.
const ALLOWED_EXT = new Set([".ts", ".tsx"]);
const isTestFile = (name: string) =>
  name.endsWith(".test.ts") ||
  name.endsWith(".test.tsx") ||
  name.endsWith(".spec.ts") ||
  name.endsWith(".spec.tsx");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip node_modules / build artifacts / vendored shadcn primitives (not our copy).
      if (entry === "node_modules" || entry === ".next" || entry === "ui") continue;
      walk(full, out);
    } else if (ALLOWED_EXT.has(entry.slice(entry.lastIndexOf("."))) && !isTestFile(entry)) {
      out.push(full);
    }
  }
  return out;
}

const hits: { file: string; line: number; text: string }[] = [];
for (const file of SOURCES.flatMap((source) => walk(source))) {
  const lines = readFileSync(file, "utf8").split("\n");
  for (const [i, line] of lines.entries()) {
    // Never flag the valid repo/package slug `soletrade`.
    if (line.includes("soletrade")) continue;
    const lower = line.toLowerCase();
    if (DEPRECATED.some((p) => lower.includes(p))) {
      hits.push({ file: relative(ROOT, file), line: i + 1, text: line.trim() });
    }
  }
}

if (hits.length > 0) {
  console.error(
    "❌ Deprecated customer-facing branding found - use apps/web/src/config/brand.ts instead:",
  );
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}: ${h.text}`);
  }
  console.error(
    `\n${hits.length} hit(s). Replace with "Soletrade" (product) or "Matt Haitana" (company).`,
  );
  process.exit(1);
}
console.log("✅ No deprecated customer-facing branding found in applications.");
