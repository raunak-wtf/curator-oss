import { redirect } from "next/navigation";
import { BillingClient } from "@/components/billing-client";
import { getViewer } from "@/lib/auth0";
import { isDodoConfigured } from "@/lib/billing/dodo";
import {
  PRO_MONTHLY_CREDITS_HUNDREDTHS,
  PRO_PLAN_CURRENCY,
  PRO_PLAN_NAME,
  PRO_PLAN_PRICE_CENTS,
} from "@/lib/credits";
import {
  ensureUser,
  getUserSubscription,
  hasActiveSubscriptionAccess,
  listUserCreditUsage,
} from "@/lib/store";
import type { BillingSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ checkout?: string }>;
};

export default async function BillingPage({ searchParams }: Props) {
  const viewer = await getViewer();
  if (!viewer) {
    redirect(`/auth/login?returnTo=${encodeURIComponent("/billing")}`);
  }

  await ensureUser(viewer);
  const [subscription, recentUsage, query] = await Promise.all([
    getUserSubscription(viewer.id),
    listUserCreditUsage(viewer.id, 30),
    searchParams,
  ]);

  const initialSummary: BillingSummary = {
    planName: PRO_PLAN_NAME,
    priceCents: PRO_PLAN_PRICE_CENTS,
    currency: PRO_PLAN_CURRENCY,
    monthlyCreditsHundredths: PRO_MONTHLY_CREDITS_HUNDREDTHS,
    hasActiveAccess: Boolean(viewer.isAdmin) || hasActiveSubscriptionAccess(subscription),
    isAdminBypass: Boolean(viewer.isAdmin),
    dodoConfigured: isDodoConfigured(),
    subscription,
    recentUsage,
  };

  return (
    <BillingClient
      viewer={viewer}
      initialSummary={initialSummary}
      checkoutStatus={query.checkout === "success" || query.checkout === "cancelled" ? query.checkout : null}
    />
  );
}
