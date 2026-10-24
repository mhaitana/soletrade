import { Logo } from "@/shared/components/logo";
import { SignupForm } from "./signup-form";
import { brand } from "@/config/brand";
import { getPromotionPreview, promotionLabel } from "@/platform/billing/promotions";
import { parseSignupIntent } from "@/platform/billing/signup-intent";

export const metadata = { title: "Create your account" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{
    checkEmail?: string | string[];
    modules?: string | string[];
    interval?: string | string[];
    promo?: string | string[];
    coupon?: string | string[];
  }>;
}) {
  const sp = await searchParams;
  const initialCheckEmail = sp.checkEmail === "1";
  const intent = parseSignupIntent(sp);
  const requestedPromotion = Boolean(intent.promotionCode);
  const promotion = intent.promotionCode
    ? await getPromotionPreview(intent.promotionCode).catch(() => null)
    : null;

  return (
    <div className="mx-auto w-full max-w-5xl min-w-0 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-col items-center border-b border-border px-5 py-5 text-center sm:px-10 sm:py-7">
        <Logo href={null} className="text-lg" />
        <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-brand-blue sm:mt-5">
          Build your workspace
        </p>
        <h1 className="mt-2 max-w-xl text-balance text-xl font-semibold tracking-tight sm:text-3xl">
          Start with exactly what your business needs
        </h1>
        <p className="mt-2 max-w-xl text-balance text-sm leading-6 text-muted-foreground">
          Create your {brand.productName} account and choose your tools together. Add or remove
          modules whenever your business changes.
        </p>
      </div>
      <SignupForm
        intent={{ ...intent, promotionCode: promotion?.code }}
        promotion={
          promotion
            ? {
                code: promotion.code,
                label: promotionLabel(promotion),
                discountType: promotion.discountType,
                percentOff: promotion.percentOff,
                amountOffCents: promotion.amountOffCents,
              }
            : undefined
        }
        promotionUnavailable={requestedPromotion && !promotion}
        initialCheckEmail={initialCheckEmail}
      />
    </div>
  );
}
