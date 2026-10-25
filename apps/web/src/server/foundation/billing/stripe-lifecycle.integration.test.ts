import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getDataClient } from "@/server/infrastructure/db/client";
import { unwrap } from "@/server/infrastructure/db/helpers";
import { cleanupWorkspaces, seedUsers } from "@/testing/db-helpers";
import { branded, type WorkspaceId, type UserId } from "@/types/ids";
import { createWorkspace } from "@/server/foundation/workspaces";
import { clearEventBus } from "@/server/infrastructure/events";
import { ensureSubscription } from "@/server/foundation/billing/subscriptions";
import {
  ensureStripeCustomer,
  createCheckoutSession,
} from "@/server/foundation/billing/stripe/stripe-lifecycle";
import { getStripe } from "@/server/infrastructure/stripe/client";

/**
 * Explicit Stripe test-mode integration suite backed by disposable local Supabase.
 * Creates customers and uncompleted Checkout sessions, then expires the sessions
 * and deletes the customers. The dedicated config rejects nonlocal data services
 * and live Stripe credentials; ordinary deterministic tests exclude this suite.
 *
 *   INTEGRATION_ENV_FILE=.env.stripe pnpm test:stripe
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
    const customerEmails = new Map<WorkspaceId, string>();
    const stripeObjectIds = {
      customers: new Set<string>(),
      sessions: new Set<string>(),
    };
    const deletedCustomerIds = new Set<string>();

    beforeAll(async () => {
      clearEventBus();
      await seedUsers([
        { id: actor, email: "stripe-lifecycle@soletrade-test.local", fullName: "Stripe LC" },
      ]);

      // Keep the real API calls while capturing IDs before later persistence or
      // assertion failures can prevent the test body from registering cleanup.
      const stripe = getStripe();
      const createCustomer = stripe.customers.create.bind(stripe.customers);
      vi.spyOn(stripe.customers, "create").mockImplementation(async (...args) => {
        const customer = await createCustomer(...args);
        stripeObjectIds.customers.add(customer.id);
        return customer;
      });
      const createSession = stripe.checkout.sessions.create.bind(stripe.checkout.sessions);
      vi.spyOn(stripe.checkout.sessions, "create").mockImplementation(async (...args) => {
        const session = await createSession(...args);
        stripeObjectIds.sessions.add(session.id);
        return session;
      });
    });

    async function cleanupStripeObjects() {
      const stripe = getStripe();
      const failures: Error[] = [];
      const isMissing = (error: unknown) =>
        Boolean(
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "resource_missing",
        );

      // Recover customers even when Checkout creation failed before returning.
      if (workspaceIds.length > 0) {
        try {
          const rows = await unwrap(
            getDataClient()
              .from("subscriptions")
              .select("stripe_customer_id")
              .in("workspace_id", workspaceIds),
          );
          for (const row of rows) {
            if (row.stripe_customer_id && !deletedCustomerIds.has(row.stripe_customer_id)) {
              stripeObjectIds.customers.add(row.stripe_customer_id);
            }
          }
        } catch {
          failures.push(new Error("Unable to recover Stripe customers from test workspaces."));
        }
      }

      async function clean(label: string, operation: () => Promise<void>) {
        try {
          await operation();
          return true;
        } catch (error) {
          const code = error && typeof error === "object" && "code" in error ? error.code : null;
          if (isMissing(error)) return true;
          // Avoid logging request metadata or credentials from provider errors.
          failures.push(
            new Error(
              `${label} failed (${error instanceof Error ? error.name : "unknown"}, ${String(code)}).`,
            ),
          );
          return false;
        }
      }

      // Recover an accepted customer create whose response was lost before the
      // service could persist its ID. Filter by this run's unique email and workspace.
      for (const [workspaceId, email] of customerEmails) {
        await clean(`Customer recovery for ${workspaceId}`, async () => {
          for await (const customer of stripe.customers.list({ email, limit: 100 })) {
            if (
              customer.metadata.workspaceId === workspaceId &&
              !deletedCustomerIds.has(customer.id)
            ) {
              stripeObjectIds.customers.add(customer.id);
            }
          }
        });
      }

      async function expireSession(sessionId: string) {
        try {
          const session = await stripe.checkout.sessions.retrieve(sessionId);
          if (session.status === "open") await stripe.checkout.sessions.expire(sessionId);
          else if (session.status !== "expired") {
            throw new Error("The test unexpectedly completed a Checkout session.");
          }
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
      }

      for (const sessionId of stripeObjectIds.sessions) {
        const cleaned = await clean(`Checkout session ${sessionId}`, () =>
          expireSession(sessionId),
        );
        if (cleaned) stripeObjectIds.sessions.delete(sessionId);
      }

      for (const customerId of stripeObjectIds.customers) {
        const cleaned = await clean(`Customer ${customerId}`, async () => {
          // A transport failure may have created a session without returning its
          // ID. Only inspect sessions belonging to this suite's own customers.
          for await (const session of stripe.checkout.sessions.list({
            customer: customerId,
            status: "open",
            limit: 100,
          })) {
            await expireSession(session.id);
            stripeObjectIds.sessions.delete(session.id);
          }
          await stripe.customers.del(customerId);
        });
        if (cleaned) {
          deletedCustomerIds.add(customerId);
          stripeObjectIds.customers.delete(customerId);
        }
      }

      if (failures.length > 0) throw new AggregateError(failures, "Stripe test cleanup failed.");
      customerEmails.clear();
    }

    afterEach(cleanupStripeObjects);

    afterAll(async () => {
      try {
        // Retry any failed cleanup before removing the local recovery records.
        await cleanupStripeObjects();
        await cleanupWorkspaces(
          workspaceIds,
          [actor],
          [
            { table: "module_installations" },
            { table: "billing_contracts" },
            { table: "subscriptions" },
            { table: "audit_logs" },
          ],
        );
      } finally {
        vi.restoreAllMocks();
        clearEventBus();
      }
    });

    async function freshWorkspace(slug: string): Promise<WorkspaceId> {
      const ws = await createWorkspace(
        actor,
        `Stripe LC ${slug}`,
        `stripe-lc-${slug}-${Date.now()}`,
      );
      workspaceIds.push(ws);
      customerEmails.set(ws, `stripe-lc+${ws}@soletrade-test.local`);
      await ensureSubscription(ws);
      return ws;
    }

    it("ensureStripeCustomer creates a customer and is idempotent on second call", async () => {
      const ws = await freshWorkspace("customer");
      const id1 = await ensureStripeCustomer(ws, { email: customerEmails.get(ws)! });
      expect(id1).toMatch(/^cus_/);
      const id2 = await ensureStripeCustomer(ws, { email: null });
      expect(id2).toBe(id1); // idempotent
    });

    it("createCheckoutSession returns a hosted Checkout URL for a chosen module set", async () => {
      const ws = await freshWorkspace("checkout");
      const { url, sessionId } = await createCheckoutSession(ws, {
        moduleKeys: ["books", "invoices"],
        interval: "monthly",
        email: customerEmails.get(ws)!,
        successUrl: "https://example.com/s?session_id={CHECKOUT_SESSION_ID}",
        cancelUrl: "https://example.com/c",
      });
      expect(sessionId).toMatch(/^cs_test_/);
      expect(url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    });
  },
);
