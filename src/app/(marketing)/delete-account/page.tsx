import Link from "next/link";
import { LegalPage, LegalSection } from "../_components/legal-page";
import { getCurrentUser } from "@/server/auth/session";
import { listUserWorkspaces } from "@/platform/workspaces";
import { env } from "@/shared/lib/env";
import { DeletionForm } from "./deletion-form";

export const metadata = { title: "Delete your account" };
export const dynamic = "force-dynamic";
export default async function DeleteAccountPage() {
  const user =
    env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ? await getCurrentUser()
      : null;
  const workspaces = user ? await listUserWorkspaces(user.id) : [];
  return (
    <LegalPage title="Delete your account" lastUpdated="25 October 2026">
      <LegalSection title="Your data and workspaces">
        <p>
          You can request deletion here or in the mobile app under More → Privacy, terms and account
          deletion. Your account is disabled immediately. Personal data and content in workspaces
          you close are deleted within 30 days. Business records in continuing shared workspaces
          remain with anonymised attribution.
        </p>
        <p>
          Export invoices, quotes, CSV records and reports you need before closing a workspace.
          Transfer a shared workspace to an existing member and wait for their acceptance, or
          explicitly choose to close it.
        </p>
      </LegalSection>
      <LegalSection title="Subscriptions and backups">
        <p>
          Deleting an account does not automatically cancel an App Store or Google Play
          subscription. Cancel renewal through the original purchase provider. For web
          subscriptions, use the billing settings before deletion. Provider backups expire under
          their normal retention schedules; deleted accounts cannot access them.
        </p>
      </LegalSection>
      {user ? (
        <DeletionForm workspaces={workspaces} email={user.email} />
      ) : (
        <LegalSection title="Request deletion">
          <p>
            Sign in with your account email to confirm ownership and choose how to handle your
            workspaces.
          </p>
          <Link
            className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-primary-foreground"
            href="/login?next=%2Fdelete-account"
          >
            Sign in to delete your account
          </Link>
        </LegalSection>
      )}
    </LegalPage>
  );
}
