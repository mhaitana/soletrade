import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/application/auth/session";

// Auth-scoped page - never statically prerendered.

import { listUserWorkspaces } from "@/server/foundation/workspaces/index";
import { tryAdminContext } from "@/server/application/auth/admin-context";
import { Logo } from "@/components/logo";
import { CreateWorkspaceForm } from "@/application/onboarding/create-workspace-form";
import { brand } from "@/config/brand";
import { parseSignupIntent } from "@/lib/domain/billing/signup-intent";
import { getPromotionPreview, promotionLabel } from "@/server/foundation/billing/promotions";

export const metadata = { title: "Create your workspace" };

export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{
    modules?: string | string[];
    interval?: string | string[];
    promo?: string | string[];
    coupon?: string | string[];
  }>;
}) {
  const user = await requireUser();
  const adminCtx = await tryAdminContext();
  if (adminCtx && adminCtx.roles.includes("super_admin")) {
    redirect("/admin");
  }
  // Brand-new users land here with zero workspaces (via /auth/callback →
  // /dashboard → requireWorkspaceContext); existing users arrive via the
  // WorkspaceSwitcher's "Create workspace" link to add another. We no longer
  // redirect the latter - the page branches its copy instead so both audiences
  // are served.
  const workspaces = await listUserWorkspaces(user.id);
  const hasWorkspace = workspaces.length > 0;
  const sp = await searchParams;
  const hasSignupIntent = Boolean(sp.modules || sp.interval || sp.promo || sp.coupon);
  const intent = hasSignupIntent ? parseSignupIntent(sp) : undefined;
  const promotion = intent?.promotionCode
    ? await getPromotionPreview(intent.promotionCode).catch(() => null)
    : null;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-start px-4 py-8 sm:justify-center sm:py-12">
      <div className="w-full min-w-0 max-w-md">
        <div className="mb-6 flex justify-center sm:mb-8">
          <Logo />
        </div>
        <h1 className="text-center text-2xl font-semibold tracking-tight">
          {hasWorkspace
            ? "Create a new workspace"
            : intent
              ? "One last detail"
              : `Welcome to ${brand.productName}`}
        </h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          {hasWorkspace
            ? "You'll switch into the new workspace once it's created."
            : intent
              ? "Name your workspace, then review your selected modules in secure checkout."
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
          <CreateWorkspaceForm
            intent={intent ? { ...intent, promotionCode: promotion?.code } : undefined}
            promotionLabel={promotion ? promotionLabel(promotion) : undefined}
          />
        </div>
      </div>
    </div>
  );
}
