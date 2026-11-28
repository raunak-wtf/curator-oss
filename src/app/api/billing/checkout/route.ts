import { z } from "zod";
import { requireViewer } from "@/lib/auth0";
import { createProCheckoutSession, isDodoConfigured } from "@/lib/billing/dodo";
import { errorResponse } from "@/lib/http";
import { getUserSubscription, hasActiveSubscriptionAccess } from "@/lib/store";

export const runtime = "nodejs";

const bodySchema = z
  .object({
    returnPath: z.string().trim().max(300).optional(),
  })
  .optional();

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
    if (!isDodoConfigured()) {
      return Response.json(
        {
          error:
            "Billing checkout is not configured on this server yet. Add DODO_PAYMENTS_API_KEY and DODO_PAYMENTS_PRODUCT_ID to enable $10/month subscriptions.",
        },
        { status: 503 },
      );
    }

    const existing = await getUserSubscription(viewer.id);
    if (hasActiveSubscriptionAccess(existing) && !existing.cancelAtPeriodEnd) {
      return Response.json(
        { error: "Your Curator Pro subscription is already active. Use Manage billing to update your plan or payment method." },
        { status: 409 },
      );
    }

    const rawBody = await request.json().catch(() => undefined);
    const parsed = bodySchema.parse(rawBody);
    const origin = new URL(request.url).origin;
    const session = await createProCheckoutSession({
      viewer,
      requestOrigin: origin,
      returnPath: parsed?.returnPath,
    });

    return Response.json({
      checkoutUrl: session.checkoutUrl,
      sessionId: session.sessionId,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
