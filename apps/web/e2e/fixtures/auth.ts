import { test as base, type Page, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * Seeded workspace roles usable in E2E specs.
 *
 * Credentials come from `supabase/seed.sql` (password for every seeded user is
 * `password123`). The `pending` user exists in auth.users but is not a workspace
 * member yet; it is exposed separately for invitation-flow specs.
 */
export type SeededRole = "owner" | "admin" | "accountant" | "employee" | "readonly" | "pending";

export const SEEDED_PASSWORD = "password123";

export type SeededUser = {
  role: SeededRole;
  email: string;
  fullName: string;
  workspaces: ("WS1" | "WS2")[];
};

export const SEEDED_USERS: Record<Exclude<SeededRole, "pending">, SeededUser> = {
  owner: {
    role: "owner",
    email: "owner@soletrade.test",
    fullName: "Alex Owner",
    workspaces: ["WS1", "WS2"],
  },
  admin: {
    role: "admin",
    email: "admin@soletrade.test",
    fullName: "Avery Admin",
    workspaces: ["WS1"],
  },
  accountant: {
    role: "accountant",
    email: "accountant@soletrade.test",
    fullName: "Quinn Accountant",
    workspaces: ["WS1"],
  },
  employee: {
    role: "employee",
    email: "employee@soletrade.test",
    fullName: "Ellie Employee",
    workspaces: ["WS1"],
  },
  readonly: {
    role: "readonly",
    email: "readonly@soletrade.test",
    fullName: "Robin Readonly",
    workspaces: ["WS1"],
  },
};

export const PENDING_USER: SeededUser = {
  role: "pending",
  email: "pending@soletrade.test",
  fullName: "Pat Pending",
  workspaces: [],
};

const AUTH_DIR = path.resolve(__dirname, "../.auth");

function storageStatePath(role: SeededRole): string {
  return path.join(AUTH_DIR, `${role}.json`);
}

/**
 * Sign in via the real login form and return the authenticated page.
 *
 * This is intentionally a real browser interaction (not a direct Supabase API
 * call) so the fixture exercises the same code path an end user uses. The
 * resulting storage state is saved so subsequent specs can reuse the session
 * without hitting sign-in rate limits.
 */
export async function signIn(page: Page, role: SeededRole): Promise<Page> {
  const user = role === "pending" ? PENDING_USER : SEEDED_USERS[role];
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(SEEDED_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/dashboard|\/onboarding/);
  return page;
}

/**
 * Ensure the on-disk storage state exists for a role, generating it once if
 * needed. Returns the path to the storage state JSON file.
 *
 * Uses an exclusive-create lock file so concurrent workers do not race when
 * generating the same role's storage state for the first time.
 */
export async function ensureAuthenticatedStorageState(
  browser: { newContext: (opts?: { storageState?: string }) => Promise<BrowserContext> },
  role: SeededRole,
): Promise<string> {
  const filePath = storageStatePath(role);

  if (fs.existsSync(filePath)) {
    return filePath;
  }

  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const lockPath = `${filePath}.lock`;
  // Try to acquire an exclusive lock. If another worker is already generating,
  // we wait for it to finish by polling the resulting storage state file.
  try {
    fs.openSync(lockPath, "wx");
  } catch {
    while (!fs.existsSync(filePath)) {
      await new Promise((r) => setTimeout(r, 250));
    }
    return filePath;
  }

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, role);
    await context.storageState({ path: filePath });
    await context.close();
  } finally {
    try {
      fs.unlinkSync(lockPath);
    } catch {
      // Lock file may already be gone - ignore.
    }
  }

  return filePath;
}

/**
 * Open the workspace switcher and select the target workspace.
 *
 * On mobile the switcher is surfaced inside the navigation Sheet, so this
 * helper opens that sheet first.
 */
export async function switchWorkspace(page: Page, workspaceName: string): Promise<void> {
  const isMobile = await page.evaluate(() => window.innerWidth < 768);

  if (isMobile) {
    await page.getByRole("button", { name: /open menu/i }).click();
    await page.getByRole("button", { name: /switch workspace/i }).click();
  } else {
    await page.getByRole("button", { name: /switch workspace/i }).click();
  }

  await page.getByRole("menuitem", { name: workspaceName }).click();
  await page.waitForLoadState("networkidle");
}

type AuthFixtures = {
  ownerPage: Page;
  adminPage: Page;
  accountantPage: Page;
  employeePage: Page;
  readonlyPage: Page;
  pendingPage: Page;
};

/**
 * Playwright test fixture that provides an authenticated `Page` for every
 * seeded role. Storage states are generated lazily with a file lock so
 * concurrent workers do not race; each test gets a fresh context loaded from
 * the saved state so specs run fast and avoid sign-in rate limits.
 */
export const test = base.extend<AuthFixtures>({
  ownerPage: async ({ browser }, use) => {
    const storageState = await ensureAuthenticatedStorageState(browser, "owner");
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  adminPage: async ({ browser }, use) => {
    const storageState = await ensureAuthenticatedStorageState(browser, "admin");
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  accountantPage: async ({ browser }, use) => {
    const storageState = await ensureAuthenticatedStorageState(browser, "accountant");
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  employeePage: async ({ browser }, use) => {
    const storageState = await ensureAuthenticatedStorageState(browser, "employee");
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  readonlyPage: async ({ browser }, use) => {
    const storageState = await ensureAuthenticatedStorageState(browser, "readonly");
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
  pendingPage: async ({ browser }, use) => {
    const storageState = await ensureAuthenticatedStorageState(browser, "pending");
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect } from "@playwright/test";
