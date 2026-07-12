import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";

// Auth-scoped page - never statically prerendered.
export const dynamic = "force-dynamic";
import { listUserWorkspaces } from "@/platform/workspaces";
import { tryAdminContext } from "@/platform/admin/services/admin-auth";
import { Logo } from "@/shared/components/logo";
import { CreateWorkspaceForm } from "./create-workspace-form";
import { brand } from "@/config/brand";

export const metadata = { title: "Create your workspace" };

export default async function OnboardingPage() {
  const user = await requireUser();
  const adminCtx = await tryAdminContext();
  if (adminCtx && adminCtx.roles.includes("super_admin")) {
    redirect("/admin");
  }
  // Brand-new users land here with zero workspaces (via /auth/callback +
  // requireWorkspaceContext); existing users arrive via the WorkspaceSwitcher's
  // "Create workspace" link to add another. We no longer redirect the latter -
  // the page branches its copy instead so both audiences are served.
  const workspaces = await listUserWorkspaces(user.id);
  const hasWorkspace = workspaces.length > 0;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <h1 className="text-center text-2xl font-semibold tracking-tight">
          {hasWorkspace ? "Create a new workspace" : `Welcome to ${brand.productName}`}
        </h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          {hasWorkspace
            ? "You'll switch into the new workspace once it's created."
            : "Bring your invoices, quotes, books, mileage, and business activity together in one place."}
        </p>
        {hasWorkspace ? (
          <p className="mt-4 text-center text-sm">
            <Link
              href="/dashboard"
              className="font-medium text-primary underline underline-offset-2"
            >
              Back to dashboard
            </Link>
          </p>
        ) : null}
        <div className="mt-6">
          <CreateWorkspaceForm />
        </div>
      </div>
    </div>
  );
}
