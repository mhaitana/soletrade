/**
 * Load an env file and override any existing `process.env` values.
 *
 * Node's built-in `process.loadEnvFile()` does NOT overwrite keys that already
 * exist, so if `.env.local` sets `STRIPE_SECRET_KEY=sk_test_…`, passing
 * `--env-file .env.prod` would silently keep the test key. This helper parses the
 * file explicitly and assigns every key so the override file always wins.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

export function loadEnvFileOverride(filePath: string): void {
  const fullPath = path.resolve(process.cwd(), filePath);
  const content = readFileSync(fullPath, "utf-8");
  // Mirrors dotenv's classic parsing: optional `export ` prefix, KEY=value,
  // optional single/double quotes, inline comments.
  const lineRegex = /^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)?\s*$/;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(lineRegex);
    if (!match) continue;
    const key = match[1];
    if (!key) continue;
    let value = match[2] ?? "";
    value = value.trim();
    const quote = value[0];
    const isQuoted = (quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1;
    if (isQuoted) {
      value = value.slice(1, -1);
      if (quote === '"') {
        value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
      }
    } else {
      // Remove trailing inline comments only when the value is unquoted.
      const unquotedHash = value.indexOf("#");
      if (unquotedHash !== -1) {
        value = value.slice(0, unquotedHash).trimEnd();
      }
    }
    process.env[key] = value;
  }
}
