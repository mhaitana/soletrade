import {
  LegalPage,
  LegalSection,
  LegalReviewNote,
} from "@/features/marketing/components/components/legal-page";
import { brand } from "@/config/brand";

export const metadata = { title: "Terms" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" lastUpdated="25 October 2026">
      <LegalReviewNote />

      <LegalSection title="The service">
        <p>
          These terms govern your use of {brand.productName}, a workspace product for invoicing,
          quotes, bookkeeping, receipts, expenses, mileage, and earnings provided by{" "}
          {brand.companyName}. By creating an account or using the service, you agree to these
          terms.
        </p>
      </LegalSection>

      <LegalSection title="Your account">
        <p>
          You must be able to form a binding contract to use the service. You are responsible for
          keeping your credentials secure and for all activity under your account. You may invite
          other members to your workspace and are responsible for assigning their permissions.
        </p>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <p>
          You agree not to use the service for unlawful purposes, not to interfere with its
          operation, and not to abuse, reverse-engineer, or attempt to access systems beyond your
          workspace. You are responsible for the accuracy and lawfulness of the documents you
          create.
        </p>
      </LegalSection>

      <LegalSection title="Billing, subscriptions, and credits">
        <p>
          {brand.productName} is billed per active product. Your highest-priced active product is
          your anchor app, billed at its standalone price; every other active product is billed at a
          discounted add-on price. Annual billing gives you three months free.
        </p>
        <p>
          Payments are held as a credit balance and applied to charges as they occur. Cancelling a
          product refunds the unused portion of the current period to your credit balance, pro-rated
          per product. Credits may expire if unused for an extended period, as described on the
          billing page.
        </p>
      </LegalSection>

      <LegalSection title="Intellectual property">
        <p>
          {brand.companyName} owns the service and its branding. You retain all rights to the
          content and documents you create. You grant us the limited right to process that content
          solely to provide the service to you.
        </p>
      </LegalSection>
      <LegalSection title="Mobile subscriptions">
        <p>
          Subscriptions purchased through the App Store or Google Play are billed and managed by
          that provider. The price and billing period shown in the store purchase sheet apply. Store
          prices may differ from web prices. Renewals, changes, cancellations, refunds and
          promotional offers follow the original purchase provider’s terms and displayed effective
          dates.
        </p>
        <p>
          Store purchases grant workspace access and do not create a monetary credit balance. Web
          credits and Stripe promotions cannot pay for store renewals. A store subscription is
          linked to one workspace and its original purchaser; access is shared through that
          workspace’s membership permissions. Avoid purchasing a second subscription for an already
          covered workspace.
        </p>
        <p>
          The credit and prorated refund arrangements described above apply to eligible web
          subscriptions. They do not promise an automatic refund of an App Store or Google Play
          charge. Cancel store renewal with the provider even when requesting account deletion.
        </p>
      </LegalSection>

      <LegalSection title="Disclaimers and liability">
        <p>
          The service is provided &quot;as is&quot;. To the maximum extent permitted by law,{" "}
          {brand.companyName} excludes warranties and is not liable for indirect, incidental, or
          consequential damages. Our aggregate liability is limited to the amount you paid in the
          twelve months before the claim.
        </p>
      </LegalSection>

      <LegalSection title="Governing law">
        <p>
          These terms are governed by the laws of the jurisdiction in which {brand.companyName} is
          established, without regard to conflict-of-law principles.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions about these terms can be sent to the support contact listed on our{" "}
          <a href="/support" className="text-primary underline-offset-4 hover:underline">
            support page
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
