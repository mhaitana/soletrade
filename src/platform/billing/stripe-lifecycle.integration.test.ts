import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDataClient } from "@/server/db/client";
import { unwrapMaybe } from "@/server/db/helpers";
import { cleanupWorkspaces, seedUsers } from "@/tests/db-helpers";
import { branded, type WorkspaceId, type UserId } from "@/shared/types/ids";
import { createWorkspace } from "@/platform/workspaces";
import { clearEventBus } from "@/server/events";
import { ensureSubscription } from "@/platform/billing/subscriptions";
import { ensureStripeCustomer, createCheckoutSession } from "@/server/stripe/stripe-lifecycle";
import { getStripe } from "@/server/stripe/client";

/**
 * Optional real-Stripe test-mode integration suite. Only runs when BOTH
 * DATABASE_URL and STRIPE_SECRET_KEY (and the per-module price ids) are set —
 * manual / CI opt-in. Creates real Stripe customers/subscriptions and tears them down
 * in afterEach. Skipped by default (no keys in the normal CI run).
 *
 *   DATABASE_URL=... STRIPE_SECRET_KEY=sk_test_... \
 *   STRIPE_PRICE_BOOKS_STANDALONE_MONTHLY=... (×16) pnpm test:ci
 */
const HAS_DB = Boolean(process.env.DATABASE_URL);
const HAS_STRIPE = Boolean(process.env.STRIPE_SECRET_KEY);
const HAS_PRICES = Boolean(
  process.env.STRIPE_PRICE_BOOKS_STANDALONE_MONTHLY &&
  process.env.STRIPE_PRICE_INVOICES_ADDON_MONTHLY,
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
      clearEventBus();
      await seedUsers([
        { id: actor, email: "stripe-lifecycle@soletrade-test.local", fullName: "Stripe LC" },
      ]);
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
      await cleanupWorkspaces(
        workspaceIds,
        [actor],
        [{ table: "module_installations" }, { table: "subscriptions" }, { table: "audit_logs" }],
      );
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

    it("createCheckoutSession returns a hosted Checkout URL for a chosen module set", async () => {
      const ws = await freshWorkspace("checkout");
      const { url, sessionId } = await createCheckoutSession(ws, {
        moduleKeys: ["books", "invoices"],
        interval: "monthly",
        email: "lc-checkout@soletrade-test.local",
        successUrl: "https://example.com/s?session_id={CHECKOUT_SESSION_ID}",
        cancelUrl: "https://example.com/c",
      });
      expect(sessionId).toMatch(/^cs_test_/);
      expect(url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
      // We don't complete the checkout (no automated pay). Clean up the customer
      // created for this session.
      const row = await unwrapMaybe(
        getDataClient()
          .from("subscriptions")
          .select("stripe_customer_id")
          .eq("workspace_id", ws)
          .limit(1)
          .maybeSingle(),
      );
      if (row?.stripe_customer_id) stripeObjectIds.customers.push(row.stripe_customer_id);
    });
  },
);
