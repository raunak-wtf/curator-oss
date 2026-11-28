import { requireViewer } from "@/lib/auth0";
import { createCustomerPortalUrl, isDodoConfigured } from "@/lib/billing/dodo";
import { errorResponse } from "@/lib/http";
import { getUserSubscription } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
    if (!isDodoConfigured()) {
      return Response.json(
        { error: "Dodo Payments is not configured on this server." },
        { status: 503 },
      );
    }

    const subscription = await getUserSubscription(viewer.id);
    if (!subscription.dodoCustomerId) {
      return Response.json(
        { error: "No billing customer profile found yet. Subscribe to Curator Pro first." },
        { status: 404 },
      );
    }

    const origin = new URL(request.url).origin;
    const portalUrl = await createCustomerPortalUrl({
      customerId: subscription.dodoCustomerId,
      requestOrigin: origin,
    });

    return Response.json({ portalUrl });
  } catch (error) {
    return errorResponse(error);
  }
}
