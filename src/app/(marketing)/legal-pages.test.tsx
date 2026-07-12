import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import PrivacyPage from "./privacy/page";
import TermsPage from "./terms/page";

/**
 * Smoke test for the public legal/support pages. Each page is a static Server Component
 * built on the shared `LegalPage` shell — this guards the H1 and a representative section.
 *
 * The support page reads `env.SUPPORT_EMAIL` at module load, so its two contact branches
 * are exercised with explicit env stubs + `vi.resetModules()` + a dynamic re-import (the
 * same pattern `src/config/urls.test.ts` uses), making them deterministic regardless of
 * what `.env.local` happens to set.
 */
describe("legal pages", () => {
  it("privacy renders its title and the information-we-collect section", () => {
    const { getByRole, getByText } = render(<PrivacyPage />);
    expect(getByRole("heading", { level: 1, name: "Privacy" })).toBeTruthy();
    expect(getByText("Information we collect")).toBeTruthy();
  });

  it("terms renders its title and the billing section", () => {
    const { getByRole, getByText } = render(<TermsPage />);
    expect(getByRole("heading", { level: 1, name: "Terms of service" })).toBeTruthy();
    expect(getByText("Billing, subscriptions, and credits")).toBeTruthy();
  });

  describe("support page", () => {
    afterEach(() => {
      delete process.env.SUPPORT_EMAIL;
      vi.resetModules();
      vi.unstubAllEnvs();
    });

    it("renders its title and the contact section", async () => {
      const { default: SupportPage } = await import("./support/page");
      const { getByRole, getByText } = render(<SupportPage />);
      expect(getByRole("heading", { level: 1, name: "Support" })).toBeTruthy();
      expect(getByText("Contact us")).toBeTruthy();
    });

    it("shows a mailto link when SUPPORT_EMAIL is set", async () => {
      vi.stubEnv("SUPPORT_EMAIL", "help@soletrade.example");
      vi.resetModules();
      const { default: SupportPage } = await import("./support/page");
      const { container } = render(<SupportPage />);
      const mailto = container.querySelector('a[href^="mailto:"]');
      expect(mailto?.getAttribute("href")).toBe("mailto:help@soletrade.example");
    });

    it("shows a fallback contact line (no mailto) when SUPPORT_EMAIL is unset", async () => {
      delete process.env.SUPPORT_EMAIL;
      vi.resetModules();
      const { default: SupportPage } = await import("./support/page");
      const { container } = render(<SupportPage />);
      expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
    });
  });
});