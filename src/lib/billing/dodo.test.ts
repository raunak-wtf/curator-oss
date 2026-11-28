import { Webhook } from "standardwebhooks";
import { describe, expect, it } from "vitest";
import { extractDodoEventDetails, verifyDodoWebhook } from "./dodo";
import {
  adminAdjustUserBilling,
  applyDodoSubscriptionEvent,
  checkUserAgentEntitlement,
  claimBillingWebhookEvent,
  ensureUser,
  getUserSubscription,
  recordCreditUsage,
} from "../store";
import type { Viewer } from "../types";

// Valid Standard Webhooks secret (`whsec_` + base64 24+ bytes)
const TEST_WEBHOOK_SECRET = `whsec_${Buffer.from("0123456789abcdef0123456789abcdef").toString("base64")}`;

describe("Dodo Payments webhooks & $10/month no-free-tier entitlement", () => {
  it("verifies valid Standard Webhooks signatures and rejects tampered payloads", () => {
    const payload = JSON.stringify({
      type: "subscription.active",
      timestamp: "2026-11-28T00:00:00Z",
      data: {
        subscription_id: "sub_test_123",
        product_id: "pdt_pro_10",
        customer: { customer_id: "cus_test_123", email: "buyer@example.com" },
        metadata: { user_id: "account|buyer1" },
        next_billing_date: "2026-12-28T00:00:00Z",
      },
    });
    const wh = new Webhook(TEST_WEBHOOK_SECRET);
    const now = new Date();
    const msgId = "msg_test_001";
    const signature = wh.sign(msgId, now, payload);

    const verified = verifyDodoWebhook(
      payload,
      {
        "webhook-id": msgId,
        "webhook-timestamp": String(Math.floor(now.getTime() / 1000)),
        "webhook-signature": signature,
      },
      TEST_WEBHOOK_SECRET,
    );
    expect(verified.eventId).toBe(msgId);
    expect(verified.eventType).toBe("subscription.active");

    const parsed = extractDodoEventDetails(verified.data);
    expect(parsed.userId).toBe("account|buyer1");
    expect(parsed.customerId).toBe("cus_test_123");
    expect(parsed.subscriptionId).toBe("sub_test_123");
    expect(parsed.customerEmail).toBe("buyer@example.com");

    expect(() =>
      verifyDodoWebhook(
        `${payload} tampered`,
        {
          "webhook-id": msgId,
          "webhook-timestamp": String(Math.floor(now.getTime() / 1000)),
          "webhook-signature": signature,
        },
        TEST_WEBHOOK_SECRET,
      ),
    ).toThrow();
  });

  it("enforces no free tier, activates on subscription.active, deducts credits, and rolls over on renewal", async () => {
    const userId = `test-user-${crypto.randomUUID()}`;
    const viewer: Viewer = {
      id: userId,
      email: `${userId}@example.com`,
      emailVerified: true,
      name: "Test Builder",
      authProvider: "google-oauth2",
      authProviderLabel: "Google",
      authMethod: "oauth",
      isAdmin: false,
    };
    await ensureUser(viewer);

    // 1. Unsubscribed user is blocked (no free tier)
    const beforeSub = await checkUserAgentEntitlement(viewer);
    expect(beforeSub.allowed).toBe(false);
    expect(beforeSub.reason).toBe("subscription_required");

    // 2. Webhook idempotency claim
    const evtId = `evt_${crypto.randomUUID()}`;
    expect(await claimBillingWebhookEvent(evtId, "subscription.active")).toBe(true);
    expect(await claimBillingWebhookEvent(evtId, "subscription.active")).toBe(false);

    // 3. Activate $10/month Curator Pro subscription -> grants 90.00 credits (9000 hundredths)
    const activated = await applyDodoSubscriptionEvent({
      userId,
      eventType: "subscription.active",
      customerId: `cus_${userId}`,
      subscriptionId: `sub_${userId}`,
      productId: "pdt_pro_10",
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    expect(activated.status).toBe("active");
    expect(activated.creditsBalanceHundredths).toBe(9000);

    const afterSub = await checkUserAgentEntitlement(viewer);
    expect(afterSub.allowed).toBe(true);

    // 4. Deduct 1.25 credits (125 hundredths) for an agent run
    await recordCreditUsage({
      userId,
      projectId: null,
      messageId: null,
      mode: "build",
      complexityTier: "standard",
      promptTokens: 20_000,
      completionTokens: 4_000,
      totalTokens: 24_000,
      turns: 3,
      toolCalls: 5,
      filesChanged: 3,
      commandsRun: 1,
      cloudActions: 0,
      durationMs: 12_000,
      creditsHundredths: 125,
      description: "Build run · 3 files · 5 actions",
    });

    const afterRun = await getUserSubscription(userId);
    expect(afterRun.creditsBalanceHundredths).toBe(8875);
    expect(afterRun.creditsUsedThisPeriodHundredths).toBe(125);

    // 5. Renewal rolls over unused credits up to 180.00 credit cap
    const renewed = await applyDodoSubscriptionEvent({
      userId,
      eventType: "subscription.renewed",
      customerId: `cus_${userId}`,
      subscriptionId: `sub_${userId}`,
      currentPeriodEnd: new Date(Date.now() + 60 * 86_400_000).toISOString(),
    });
    expect(renewed.creditsBalanceHundredths).toBe(17_875);
    expect(renewed.creditsUsedThisPeriodHundredths).toBe(0);

    // 6. Admin always passes entitlement check
    const adminCheck = await checkUserAgentEntitlement({ ...viewer, isAdmin: true });
    expect(adminCheck.allowed).toBe(true);

    // 7. Admin can change user plan, grant extra credits, or set exact balance
    await applyDodoSubscriptionEvent({
      userId,
      eventType: "subscription.expired",
      currentPeriodEnd: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    });
    expect((await checkUserAgentEntitlement(viewer)).allowed).toBe(false);

    const reactivated = await adminAdjustUserBilling({
      userId,
      setStatus: "active",
      grantCreditsHundredths: 2500, // +25 credits
      monthlyCreditsHundredths: 12_000,
    });
    expect(reactivated.status).toBe("active");
    expect(reactivated.monthlyCreditsHundredths).toBe(12_000);
    expect(reactivated.creditsBalanceHundredths).toBe(17_875 + 2500);
    expect((await checkUserAgentEntitlement(viewer)).allowed).toBe(true);

    const exact = await adminAdjustUserBilling({
      userId,
      setCreditsBalanceHundredths: 7500, // exact 75.00 credits
    });
    expect(exact.creditsBalanceHundredths).toBe(7500);
  });
});
