import { LegalPage, LegalSection, LegalReviewNote } from "../_components/legal-page";
import { brand } from "@/config/brand";

export const metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" lastUpdated="25 October 2026">
      <LegalReviewNote />

      <LegalSection title="Information we collect">
        <p>
          When you create an account we collect your name and email address, and the workspace
          information you enter (business name, contact details, currency, and timezone). As you use{" "}
          {brand.productName}, we store the documents and records you create - invoices, quotes,
          bookkeeping transactions, receipts, drive earnings, and mileage - together with the
          activity and audit history associated with your workspace.
        </p>
        <p>
          We also collect basic technical data from your requests, such as IP address, browser type,
          and approximate location, for security, rate limiting, and abuse prevention.
        </p>
      </LegalSection>

      <LegalSection title="How we use your information">
        <p>
          We use your information to provide {brand.productName}: to authenticate you, render your
          workspace, process payments, send invoices and quotes to your customers on your behalf,
          and notify you about activity in your workspace. We do not sell your personal information.
        </p>
      </LegalSection>

      <LegalSection title="Mobile capture and precise location">
        <p>
          When you start a mileage shift, the mobile app records precise GPS samples, including in
          the background until you stop or pause recording. Recording may be interrupted by your
          device; review distance and any gaps before saving. Reviewed mileage summaries are shared
          according to your workspace permissions.
        </p>
        <p>
          Precise routes are private to the person who recorded them. Route syncing is off by
          default and can be enabled in account preferences. Routes remain on your device or, when
          enabled, in your private synced history until you delete them or close your account.
          Turning syncing off stops new uploads; use Delete route history to remove earlier uploads.
          Other devices apply deletions when they reconnect.
        </p>
        <p>
          Drafts, receipt images and recording state can be stored on your device while offline.
          Camera, photo library, notifications and biometric unlocking are optional device features.
          Home-screen financial summaries are optional and show their last sync time. App and widget
          data is cleared on sign-out or when revoked access is detected; an offline device receives
          account changes when it reconnects.
        </p>
      </LegalSection>

      <LegalSection title="Data sharing and subprocessors">
        <p>
          We share data only with the third parties needed to operate the service, under terms that
          require them to protect it. Our current subprocessors include:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Supabase - authentication and database hosting</li>
          <li>Stripe - payment processing and billing</li>
          <li>Resend - transactional email delivery</li>
          <li>Cloud AI providers - receipt extraction and the assistant, when enabled</li>
          <li>Apple and Google - native subscription billing and platform services</li>
          <li>Expo and Apple/Google notification services - device push delivery</li>
        </ul>
        <p>
          We may also disclose information when required by law or to protect our rights or the
          safety of others.
        </p>
      </LegalSection>

      <LegalSection title="Data retention">
        <p>
          We retain workspace data while the workspace is active. Account closure immediately
          disables access. Personal data and content in closed workspaces is deleted within 30 days.
          Continuing shared workspaces retain their business records with anonymised attribution.
          Purchase references and minimal records needed to resolve billing disputes are retained
          without your public profile. Provider backups expire under the provider’s normal retention
          schedules.
        </p>
      </LegalSection>

      <LegalSection title="Your rights">
        <p>
          Depending on your jurisdiction, you may have rights to access, correct, export, or delete
          your personal information, or to object to its processing. You can manage most of this
          from your workspace settings; for anything else, contact us using the details below.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          {brand.companyName} is the data controller for {brand.productName}. Questions about this
          policy or your data can be sent to the support contact listed on our{" "}
          <a href="/support" className="text-primary underline-offset-4 hover:underline">
            support page
          </a>
          .
        </p>
      </LegalSection>
      <LegalSection title="Delete your account">
        <p>
          Start an authenticated deletion request at{" "}
          <a href="/delete-account" className="underline">
            Delete your account
          </a>{" "}
          or from the mobile app. Export needed records and transfer or close owned workspaces
          before confirming.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
