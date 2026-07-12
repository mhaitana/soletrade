import { LegalPage, LegalSection, LegalReviewNote } from "../_components/legal-page";
import { brand } from "@/config/brand";

export const metadata = { title: "Privacy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy" lastUpdated="July 2026">
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
        </ul>
        <p>
          We may also disclose information when required by law or to protect our rights or the
          safety of others.
        </p>
      </LegalSection>

      <LegalSection title="Data retention">
        <p>
          We retain your workspace data for as long as your account is active. After account
          closure, we retain data as needed to comply with legal obligations and resolve disputes,
          then delete it within a reasonable period.
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
    </LegalPage>
  );
}
