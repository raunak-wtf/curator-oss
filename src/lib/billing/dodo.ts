import DodoPayments from "dodopayments";
import { Webhook } from "standardwebhooks";
import { PRO_PLAN_CODE } from "../credits";
import { sanitizeRelativePath } from "../preview-access";
import type { Viewer } from "../types";

export type DodoEnvironment = "test_mode" | "live_mode";

export function getDodoEnvironment(): DodoEnvironment {
  const raw = process.env.DODO_PAYMENTS_ENVIRONMENT?.trim().toLowerCase();
  if (raw === "live_mode" || raw === "live" || raw === "production") return "live_mode";
  if (raw === "test_mode" || raw === "test" || raw === "sandbox") return "test_mode";
  return process.env.NODE_ENV === "production" ? "live_mode" : "test_mode";
}

export function getDodoProductId(): string | null {
  const id = process.env.DODO_PAYMENTS_PRODUCT_ID?.trim();
  return id || null;
}

export function isDodoConfigured(): boolean {
  return Boolean(process.env.DODO_PAYMENTS_API_KEY?.trim() && getDodoProductId());
}

export function isDodoWebhookConfigured(): boolean {
  return Boolean(process.env.DODO_PAYMENTS_WEBHOOK_KEY?.trim());
}

function createDodoClient(): DodoPayments {
  const apiKey = process.env.DODO_PAYMENTS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Dodo Payments is not configured on this server (missing DODO_PAYMENTS_API_KEY).");
  }
  return new DodoPayments({
    bearerToken: apiKey,
    environment: getDodoEnvironment(),
    webhookKey: process.env.DODO_PAYMENTS_WEBHOOK_KEY?.trim() || undefined,
  });
}

export function resolveBillingBaseUrl(requestOrigin?: string): string {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (requestOrigin) return requestOrigin.replace(/\/+$/, "");
  return "http://localhost:3000";
}

export async function createProCheckoutSession(input: {
  viewer: Viewer;
  requestOrigin?: string;
  returnPath?: string;
}): Promise<{ checkoutUrl: string; sessionId: string }> {
  const productId = getDodoProductId();
  if (!productId) {
    throw new Error("Dodo Payments product is not configured (missing DODO_PAYMENTS_PRODUCT_ID).");
  }
  const client = createDodoClient();
  const baseUrl = resolveBillingBaseUrl(input.requestOrigin);
  const safePath = input.returnPath ? sanitizeRelativePath(input.returnPath) : "/billing";
  const normalizedPath = safePath === "/" && input.returnPath && input.returnPath.trim() !== "/" ? "/billing" : safePath;
  const separator = normalizedPath.includes("?") ? "&" : "?";
  const returnUrl = `${baseUrl}${normalizedPath}${separator}checkout=success`;
  const cancelUrl = `${baseUrl}/billing?checkout=cancelled`;

  const session = await client.checkoutSessions.create({
    product_cart: [{ product_id: productId, quantity: 1 }],
    customer: {
      email: input.viewer.email,
      name: input.viewer.name || input.viewer.email,
    },
    return_url: returnUrl,
    cancel_url: cancelUrl,
    customization: {
      theme: "dark",
    },
    feature_flags: {
      allow_customer_editing_email: false,
      redirect_immediately: true,
    },
    metadata: {
      user_id: input.viewer.id,
      user_email: input.viewer.email,
      plan_code: PRO_PLAN_CODE,
    },
  });

  if (!session.checkout_url) {
    throw new Error("Dodo Payments did not return a checkout URL.");
  }

  return {
    checkoutUrl: session.checkout_url,
    sessionId: session.session_id,
  };
}

export async function createCustomerPortalUrl(input: {
  customerId: string;
  requestOrigin?: string;
}): Promise<string> {
  const client = createDodoClient();
  const baseUrl = resolveBillingBaseUrl(input.requestOrigin);
  const portal = await client.customers.customerPortal.create(input.customerId, {
    return_url: `${baseUrl}/billing`,
    send_email: false,
  });
  return portal.link;
}

export type VerifiedDodoWebhook = {
  eventId: string;
  eventType: string;
  timestamp: string | null;
  data: Record<string, unknown>;
};

/**
 * Cryptographically verifies a Dodo Payments webhook using the Standard Webhooks spec
 * (`webhook-id`, `webhook-timestamp`, `webhook-signature`).
 */
export function verifyDodoWebhook(
  rawBody: string,
  headers: {
    "webhook-id": string | null;
    "webhook-timestamp": string | null;
    "webhook-signature": string | null;
  },
  secretOverride?: string,
): VerifiedDodoWebhook {
  const secret = (secretOverride ?? process.env.DODO_PAYMENTS_WEBHOOK_KEY ?? "").trim();
  if (!secret) {
    throw new Error("DODO_PAYMENTS_WEBHOOK_KEY is not configured.");
  }

  const webhookId = headers["webhook-id"]?.trim() ?? "";
  const webhookTimestamp = headers["webhook-timestamp"]?.trim() ?? "";
  const webhookSignature = headers["webhook-signature"]?.trim() ?? "";

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    throw new Error("Missing required Standard Webhooks headers.");
  }

  const verifier = new Webhook(secret);
  const verified = verifier.verify(rawBody, {
    "webhook-id": webhookId,
    "webhook-timestamp": webhookTimestamp,
    "webhook-signature": webhookSignature,
  }) as Record<string, unknown>;

  const eventType = typeof verified.type === "string" ? verified.type : "";
  const data = verified.data && typeof verified.data === "object" ? (verified.data as Record<string, unknown>) : {};
  const timestamp = typeof verified.timestamp === "string" ? verified.timestamp : null;

  if (!eventType) {
    throw new Error("Webhook payload missing event type.");
  }

  return {
    eventId: webhookId,
    eventType,
    timestamp,
    data,
  };
}

export type ParsedDodoSubscriptionPayload = {
  userId: string | null;
  customerEmail: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  productId: string | null;
  paymentId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean | null;
};

function readString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  return null;
}

function readIsoDate(obj: Record<string, unknown>, ...keys: string[]): string | null {
  const raw = readString(obj, ...keys);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function extractDodoEventDetails(
  data: Record<string, unknown>,
  eventType = "",
): ParsedDodoSubscriptionPayload {
  const metadata =
    data.metadata && typeof data.metadata === "object" ? (data.metadata as Record<string, unknown>) : {};
  const customer =
    data.customer && typeof data.customer === "object" ? (data.customer as Record<string, unknown>) : {};

  const isPaymentEvent = eventType.startsWith("payment.");
  const isSubscriptionEvent = !eventType || eventType.startsWith("subscription.");

  const userId = readString(metadata, "user_id", "userId");
  const customerEmail =
    readString(customer, "email") ??
    readString(metadata, "user_email", "email") ??
    readString(data, "customer_email");
  const customerId = readString(customer, "customer_id", "id") ?? readString(data, "customer_id");
  const subscriptionId = isSubscriptionEvent
    ? readString(data, "subscription_id", "id")
    : readString(data, "subscription_id");
  const productId = readString(data, "product_id");
  const paymentId = isPaymentEvent
    ? readString(data, "payment_id", "id")
    : readString(data, "payment_id");
  const currentPeriodStart = readIsoDate(data, "previous_billing_date", "created_at", "current_period_start");
  const currentPeriodEnd = readIsoDate(data, "next_billing_date", "expires_at", "current_period_end");
  const cancelAtPeriodEnd =
    typeof data.cancel_at_next_billing_date === "boolean"
      ? data.cancel_at_next_billing_date
      : typeof data.cancel_at_period_end === "boolean"
        ? data.cancel_at_period_end
        : null;

  return {
    userId,
    customerEmail,
    customerId,
    subscriptionId,
    productId,
    paymentId,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd,
  };
}
