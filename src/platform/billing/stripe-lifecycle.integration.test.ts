import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db";
import {
  subscriptions as subscriptionsTable,
  users as usersTable,
  workspaces as workspacesTable,
  workspaceMembers,
  auditLogs,
  moduleInstallations,
} from "@/server/db/schema";
import { branded, type WorkspaceId, type UserId } from "@/shared/types/ids";
import { createWorkspace } from "@/platform/workspaces";
import { clearEventBus } from "@/server/events";
import { ensureSubscription } from "@/platform/billing/subscriptions";
import { ensureStripeCustomer, createProCheckoutSession } from "@/server/stripe/stripe-lifecycle";
import { getStripe } from "@/server/stripe/client";

/**
 * Optional real-Stripe test-mode integration suite. Only runs when BOTH
 * DATABASE_URL and STRIPE_SECRET_KEY (and the 5 price ids) are set — manual / CI
 * opt-in. Creates real Stripe customers/subscriptions and tears them down in
 * afterEach. Skipped by default (no keys in the normal CI run).
 *
 *   DATABASE_URL=... STRIPE_SECRET_KEY=sk_test_... \
 *   STRIPE_PRICE_ANCHOR=... STRIPE_PRICE_MODULE_POS_0..3=... pnpm test:ci
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);
const HAS_STRIPE = Boolean(process.env.STRIPE_SECRET_KEY);
const HAS_PRICES = Boolean(
  process.env.STRIPE_PRICE_ANCHOR && process.env.STRIPE_PRICE_MODULE_POS_0,
);
const RUN = HAS_DB && HAS_STRIPE && HAS_PRICES;

describe.skipIf(!RUN)(
  "Stripe lifecycle real test-mode (requires DATABASE_URL + STRIPE_SECRET_KEY + price ids)",
  () => {
    const actor: UserId = branded<"UserId">("00000000-0000-4000-8000-0000000000b5");
    const workspaceIds: WorkspaceId[] = [];
    const stripeObjectIds: { customers: string[]; subscriptions: string[] } = {
      customers: [],
      subscriptions: [],
    };

    beforeAll(async () => {
      const db = getDb();
      clearEventBus();
      await db
        .insert(usersTable)
        .values({ id: actor, email: "stripe-lifecycle@soletrade-test.local", fullName: "Stripe LC" });
    });

    afterEach(async () => {
      // Tear down any real Stripe objects created during a test.
      const stripe = getStripe();
      for (const subId of stripeObjectIds.subscriptions) {
        try {
          await stripe.subscriptions.cancel(subId);
        } catch {
          /* already canceled */
        }
      }
      for (const cusId of stripeObjectIds.customers) {
        try {
          await stripe.customers.del(cusId);
        } catch {
          /* already deleted */
        }
      }
      stripeObjectIds.subscriptions = [];
      stripeObjectIds.customers = [];
    });

    afterAll(async () => {
      const db = getDb();
      if (workspaceIds.length > 0) {
        await db
          .delete(moduleInstallations)
          .where(inArray(moduleInstallations.workspaceId, workspaceIds));
        await db
          .delete(subscriptionsTable)
          .where(inArray(subscriptionsTable.workspaceId, workspaceIds));
        await db.delete(auditLogs).where(inArray(auditLogs.workspaceId, workspaceIds));
        await db
          .delete(workspaceMembers)
          .where(inArray(workspaceMembers.workspaceId, workspaceIds));
        await db.delete(workspacesTable).where(inArray(workspacesTable.id, workspaceIds));
      }
      await db.delete(usersTable).where(eq(usersTable.id, actor));
      clearEventBus();
    });

    async function freshWorkspace(slug: string): Promise<WorkspaceId> {
      const ws = await createWorkspace(
        actor,
        `Stripe LC ${slug}`,
        `stripe-lc-${slug}-${Date.now()}`,
      );
      workspaceIds.push(ws);
      await ensureSubscription(ws);
      return ws;
    }

    it("ensureStripeCustomer creates a customer and is idempotent on second call", async () => {
      const ws = await freshWorkspace("customer");
      const id1 = await ensureStripeCustomer(ws, { email: "lc-test@soletrade-test.local" });
      expect(id1).toMatch(/^cus_/);
      stripeObjectIds.customers.push(id1);
      const id2 = await ensureStripeCustomer(ws, { email: null });
      expect(id2).toBe(id1); // idempotent
    });

    it("createProCheckoutSession returns a hosted Checkout URL", async () => {
      const ws = await freshWorkspace("checkout");
      const { url, sessionId } = await createProCheckoutSession(ws, {
        email: "lc-checkout@soletrade-test.local",
        successUrl: "https://example.com/s?session_id={CHECKOUT_SESSION_ID}",
        cancelUrl: "https://example.com/c",
      });
      expect(sessionId).toMatch(/^cs_test_/);
      expect(url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
      // We don't complete the checkout (no automated pay). Clean up the customer
      // created for this session.
      const db = getDb();
      const rows = await db
        .select({ cus: subscriptionsTable.stripeCustomerId })
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.workspaceId, ws));
      if (rows[0]?.cus) stripeObjectIds.customers.push(rows[0].cus);
    });
  },
);
