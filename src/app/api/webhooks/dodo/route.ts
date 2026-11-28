import {
  extractDodoEventDetails,
  getDodoProductId,
  isDodoWebhookConfigured,
  verifyDodoWebhook,
} from "@/lib/billing/dodo";
import {
  applyDodoSubscriptionEvent,
  claimBillingWebhookEvent,
  releaseBillingWebhookEvent,
  resolveUserIdForBilling,
} from "@/lib/store";

export const runtime = "nodejs";

const HANDLED_EVENTS = new Set([
  "subscription.active",
  "subscription.renewed",
  "subscription.updated",
  "subscription.plan_changed",
  "subscription.on_hold",
  "subscription.past_due",
  "subscription.cancelled",
  "subscription.expired",
  "subscription.failed",
  "payment.succeeded",
  "payment.failed",
]);

export async function POST(request: Request) {
  if (!isDodoWebhookConfigured()) {
    return Response.json(
      { error: "DODO_PAYMENTS_WEBHOOK_KEY is not configured." },
      { status: 500 },
    );
  }

  const rawBody = await request.text();
  let verified;
  try {
    verified = verifyDodoWebhook(rawBody, {
      "webhook-id": request.headers.get("webhook-id"),
      "webhook-timestamp": request.headers.get("webhook-timestamp"),
      "webhook-signature": request.headers.get("webhook-signature"),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid webhook signature.";
    return Response.json({ error: message }, { status: 401 });
  }

  if (!HANDLED_EVENTS.has(verified.eventType)) {
    return Response.json({ received: true, ignored: true, eventType: verified.eventType });
  }

  const details = extractDodoEventDetails(verified.data, verified.eventType);
  const configuredProductId = getDodoProductId();
  if (
    configuredProductId &&
    details.productId &&
    verified.eventType.startsWith("subscription.") &&
    details.productId !== configuredProductId
  ) {
    return Response.json({ received: true, ignoredProduct: true, eventType: verified.eventType });
  }

  const userId = await resolveUserIdForBilling({
    userId: details.userId,
    dodoSubscriptionId: details.subscriptionId,
    dodoCustomerId: details.customerId,
    email: details.customerEmail,
  });

  if (!userId) {
    // Return 503 without claiming the event ID so Dodo retries once the user finishes first sign-in.
    return Response.json(
      { error: "Target user account not found yet; retry later.", eventType: verified.eventType },
      { status: 503 },
    );
  }

  const claimed = await claimBillingWebhookEvent(verified.eventId, verified.eventType);
  if (!claimed) {
    return Response.json({ received: true, duplicate: true });
  }

  try {
    await applyDodoSubscriptionEvent({
      userId,
      eventType: verified.eventType,
      customerId: details.customerId,
      subscriptionId: details.subscriptionId,
      productId: details.productId,
      paymentId: details.paymentId,
      currentPeriodStart: details.currentPeriodStart,
      currentPeriodEnd: details.currentPeriodEnd,
      cancelAtPeriodEnd: details.cancelAtPeriodEnd,
    });
  } catch (error) {
    await releaseBillingWebhookEvent(verified.eventId).catch(() => undefined);
    throw error;
  }

  return Response.json({ received: true, eventType: verified.eventType });
}
