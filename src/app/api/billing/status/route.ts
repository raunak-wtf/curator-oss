import { requireViewer } from "@/lib/auth0";
import { isDodoConfigured } from "@/lib/billing/dodo";
import {
  PRO_MONTHLY_CREDITS_HUNDREDTHS,
  PRO_PLAN_CURRENCY,
  PRO_PLAN_NAME,
  PRO_PLAN_PRICE_CENTS,
} from "@/lib/credits";
import { errorResponse } from "@/lib/http";
import {
  getUserSubscription,
  hasActiveSubscriptionAccess,
  listUserCreditUsage,
} from "@/lib/store";
import type { BillingSummary } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const viewer = await requireViewer();
    const [subscription, recentUsage] = await Promise.all([
      getUserSubscription(viewer.id),
      listUserCreditUsage(viewer.id, 30),
    ]);

    const summary: BillingSummary = {
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

    return Response.json(summary, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
