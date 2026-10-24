import { test as setup, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { ensureAuthenticatedStorageState, type SeededRole } from "../fixtures/auth";

/**
 * Playwright setup project.
 *
 * Runs once before the main E2E projects to generate authenticated storage-state
 * files for every seeded role. Each downstream test then loads its role's saved
 * state, keeping specs fast and avoiding sign-in rate limits.
 */
const authDir = path.resolve(__dirname, "../.auth");
fs.mkdirSync(authDir, { recursive: true });

// Clear any stale storage states from a previous run so freshly seeded users are
// guaranteed to authenticate successfully.
for (const file of fs.readdirSync(authDir)) {
  if (file.endsWith(".json") || file.endsWith(".lock")) {
    fs.unlinkSync(path.join(authDir, file));
  }
}

const ROLES: SeededRole[] = ["owner", "admin", "accountant", "employee", "readonly", "pending"];

for (const role of ROLES) {
  setup(`authenticate ${role}`, async ({ browser }) => {
    const storageState = await ensureAuthenticatedStorageState(browser, role);
    expect(fs.existsSync(storageState)).toBe(true);
  });
}
