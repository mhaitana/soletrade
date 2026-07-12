import { LegalPage, LegalSection } from "../_components/legal-page";
import { brand } from "@/config/brand";
import { env } from "@/shared/lib/env";

export const metadata = { title: "Support" };

export default function SupportPage() {
  const supportEmail = env.SUPPORT_EMAIL;

  return (
    <LegalPage title="Support">
      <LegalSection title="Getting help">
        <p>
          Most day-to-day tasks - creating invoices, sending quotes, recording transactions, logging
          mileage - are covered in-product. For anything in your workspace, look for the assistant
          in the app, which can answer questions and act on your {brand.productName} data.
        </p>
      </LegalSection>

      <LegalSection title="Contact us">
        {supportEmail ? (
          <p>
            Email us at{" "}
            <a
              href={`mailto:${supportEmail}`}
              className="text-primary underline-offset-4 hover:underline"
            >
              {supportEmail}
            </a>
            . We aim to respond within two business days.
          </p>
        ) : (
          <p>
            You can reach us from the contact details provided when you signed up. A direct support
            email will appear here once configured.
          </p>
        )}
      </LegalSection>

      <LegalSection title="Billing and accounts">
        <p>
          For billing questions - subscriptions, the credit balance, cancellations, or switching
          between monthly and annual billing - visit the billing page in your workspace. Account and
          workspace settings live under settings.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
