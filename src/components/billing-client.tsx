"use client";

import {
  AlertCircle,
  ArrowLeft,
  Check,
  CreditCard,
  ExternalLink,
  RefreshCw,
  Shield,
  Sparkles,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PixelLoader } from "@/components/pixel-loader";
import { formatCredits, formatCurrencyCents } from "@/lib/credits";
import type { BillingSummary, SubscriptionStatus, Viewer } from "@/lib/types";
import { cn } from "@/lib/utils";

type BillingClientProps = {
  viewer: Viewer;
  initialSummary: BillingSummary;
  checkoutStatus: "success" | "cancelled" | null;
};

const STATUS_META: Record<SubscriptionStatus, { label: string; badgeClass: string }> = {
  active: { label: "Active", badgeClass: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
  inactive: { label: "No active plan", badgeClass: "border-white/15 bg-white/[0.05] text-white/70" },
  on_hold: { label: "Payment on hold", badgeClass: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  cancelled: { label: "Cancels at period end", badgeClass: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  expired: { label: "Expired", badgeClass: "border-red-500/30 bg-red-500/10 text-red-300" },
  failed: { label: "Payment failed", badgeClass: "border-red-500/30 bg-red-500/10 text-red-300" },
};

const TIER_BADGE: Record<string, string> = {
  light: "border-sky-500/25 bg-sky-500/10 text-sky-300",
  standard: "border-indigo-500/25 bg-indigo-500/10 text-indigo-300",
  heavy: "border-amber-500/25 bg-amber-500/10 text-amber-300",
  extended: "border-rose-500/25 bg-rose-500/10 text-rose-300",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "—";
  return new Date(parsed).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return "—";
  return new Date(parsed).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function BillingClient({ viewer, initialSummary, checkoutStatus }: BillingClientProps) {
  const [summary, setSummary] = useState<BillingSummary>(initialSummary);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const refreshStatus = useCallback(async (silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const response = await fetch("/api/billing/status", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not load billing status.");
      setSummary(payload as BillingSummary);
      setErrorBanner(null);
    } catch (error) {
      if (!silent) {
        const msg = error instanceof Error ? error.message : "Could not refresh billing status.";
        setErrorBanner(msg);
      }
    } finally {
      if (!silent) setIsRefreshing(false);
    }
  }, []);

  // Poll briefly after returning from Dodo Payments checkout while webhook confirms subscription activation.
  useEffect(() => {
    if (checkoutStatus !== "success" || summary.subscription.status === "active") return;
    let attempts = 0;
    const interval = window.setInterval(() => {
      attempts += 1;
      void refreshStatus(true);
      if (attempts >= 8) window.clearInterval(interval);
    }, 2_500);
    return () => window.clearInterval(interval);
  }, [checkoutStatus, refreshStatus, summary.subscription.status]);

  async function startCheckout() {
    if (isCheckingOut) return;
    setIsCheckingOut(true);
    setErrorBanner(null);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnPath: "/billing" }),
      });
      const payload = await response.json();
      if (!response.ok || typeof payload.checkoutUrl !== "string") {
        throw new Error(payload.error ?? "Could not start checkout. Try again.");
      }
      window.location.href = payload.checkoutUrl;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Could not start checkout. Try again.";
      setErrorBanner(msg);
      toast.error(msg);
      setIsCheckingOut(false);
    }
  }

  async function openCustomerPortal() {
    if (isOpeningPortal) return;
    setIsOpeningPortal(true);
    setErrorBanner(null);
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const payload = await response.json();
      if (!response.ok || typeof payload.portalUrl !== "string") {
        throw new Error(payload.error ?? "Could not open the billing portal. Try again.");
      }
      window.location.href = payload.portalUrl;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Could not open the billing portal. Try again.";
      setErrorBanner(msg);
      toast.error(msg);
      setIsOpeningPortal(false);
    }
  }

  const sub = summary.subscription;
  const statusInfo = STATUS_META[sub.status] ?? STATUS_META.inactive;
  const monthlyAllowance = Math.max(1, sub.monthlyCreditsHundredths);
  const creditPercent = Math.min(100, Math.round((sub.creditsBalanceHundredths / monthlyAllowance) * 100));

  return (
    <div className="min-h-dvh bg-[#141414] text-white">
      <header className="sticky top-0 z-20 border-b border-white/[0.08] bg-[#141414]/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-[13px] font-medium text-white/80 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              Back to Cognix
            </Link>
            <h1 className="text-[15px] font-semibold tracking-[-0.02em] text-white">Billing &amp; Usage</h1>
          </div>
          <div className="flex items-center gap-2">
            {viewer.isAdmin ? (
              <Link
                href="/admin"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-indigo-400/25 bg-indigo-500/10 px-2.5 text-[12px] font-medium text-indigo-200 transition-colors hover:bg-indigo-500/20"
              >
                <Shield className="size-3.5" aria-hidden="true" />
                Admin
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => void refreshStatus(false)}
              disabled={isRefreshing}
              className="inline-flex size-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white [@media(pointer:coarse)]:size-11"
              title="Refresh billing status"
              aria-label="Refresh billing status"
            >
              <RefreshCw className={cn("size-3.5", isRefreshing && "animate-spin")} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        {checkoutStatus === "success" ? (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-[13px] text-emerald-200"
          >
            <span>
              {sub.status === "active"
                ? "Your Curator Pro subscription is active and your 90 monthly credits are ready."
                : "Payment received. Finalizing your Curator Pro subscription and loading your credits…"}
            </span>
            <Link
              href="/"
              className="inline-flex h-8 items-center rounded-lg bg-emerald-500/20 px-3 text-[12px] font-semibold text-emerald-100 transition-colors hover:bg-emerald-500/30"
            >
              Start building
            </Link>
          </div>
        ) : null}

        {checkoutStatus === "cancelled" ? (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-200"
          >
            <span>Checkout was cancelled. Subscribe to Curator Pro ($10/month) anytime to unlock building.</span>
            <button
              type="button"
              onClick={() => void startCheckout()}
              className="inline-flex h-8 items-center rounded-lg bg-amber-500/20 px-3 text-[12px] font-semibold text-amber-100 transition-colors hover:bg-amber-500/30"
            >
              Resume checkout
            </button>
          </div>
        ) : null}

        {errorBanner ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-200"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
              <span>{errorBanner}</span>
            </div>
            <button
              type="button"
              onClick={() => void refreshStatus(false)}
              className="inline-flex h-8 items-center rounded-lg border border-red-400/30 px-3 text-[12px] font-medium text-red-100 hover:bg-red-500/20"
            >
              Try again
            </button>
          </div>
        ) : null}

        {/* Plan & Credit Balance Grid */}
        <section className="grid gap-4 lg:grid-cols-5" aria-label="Subscription and credit summary">
          {/* Single $10/month Plan Card */}
          <div className="flex flex-col justify-between rounded-xl border border-white/[0.1] bg-[#1c1c1c] p-5 lg:col-span-3">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex size-8 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-300">
                    <Sparkles className="size-4" aria-hidden="true" />
                  </span>
                  <div>
                    <h2 className="text-[16px] font-semibold text-white">{summary.planName}</h2>
                    <p className="text-[12px] text-white/50">Single paid plan · No free tier</p>
                  </div>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                    statusInfo.badgeClass,
                  )}
                >
                  {statusInfo.label}
                </span>
              </div>

              <div className="mt-5 flex items-baseline gap-1.5">
                <span className="text-[32px] font-semibold tracking-[-0.03em] text-white tabular-nums">
                  {formatCurrencyCents(summary.priceCents, summary.currency)}
                </span>
                <span className="text-[13px] text-white/50">/ month</span>
              </div>

              <ul className="mt-4 space-y-2 text-[13px] text-white/75">
                <li className="flex items-center gap-2">
                  <Check className="size-4 shrink-0 text-emerald-400" aria-hidden="true" />
                  <span>
                    <strong className="font-medium text-white tabular-nums">
                      {formatCredits(summary.monthlyCreditsHundredths)} credits / month
                    </strong>{" "}
                    with automatic unused rollover (up to 180 credits)
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-4 shrink-0 text-emerald-400" aria-hidden="true" />
                  <span>Effort-based metering — quick edits cost fractions of a credit (~0.50)</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-4 shrink-0 text-emerald-400" aria-hidden="true" />
                  <span>Full-stack web apps with Cloud Database, Auth, Storage &amp; live publishing</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-4 shrink-0 text-emerald-400" aria-hidden="true" />
                  <span>Secure checkout and self-service billing powered by Dodo Payments</span>
                </li>
              </ul>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-2.5 border-t border-white/[0.08] pt-4">
              {sub.status !== "active" || sub.cancelAtPeriodEnd ? (
                <button
                  type="button"
                  onClick={() => void startCheckout()}
                  disabled={isCheckingOut || !summary.dodoConfigured}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-white px-4 text-[13px] font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-50"
                >
                  {isCheckingOut ? (
                    <>
                      <PixelLoader className="text-black" />
                      Redirecting to checkout…
                    </>
                  ) : (
                    <>
                      <CreditCard className="size-4" aria-hidden="true" />
                      Subscribe for $10/month
                    </>
                  )}
                </button>
              ) : null}

              {sub.dodoCustomerId ? (
                <button
                  type="button"
                  onClick={() => void openCustomerPortal()}
                  disabled={isOpeningPortal || !summary.dodoConfigured}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.04] px-4 text-[13px] font-medium text-white transition-colors hover:bg-white/[0.09] disabled:opacity-50"
                >
                  {isOpeningPortal ? "Opening portal…" : "Manage subscription"}
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}

              {!summary.dodoConfigured ? (
                <span className="text-[12px] text-amber-300/90">
                  Dodo Payments keys are not configured yet on this server.
                </span>
              ) : null}

              {summary.isAdminBypass ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-2.5 py-1 text-[11px] font-medium text-indigo-200">
                  <Shield className="size-3" aria-hidden="true" />
                  Admin bypass active
                </span>
              ) : null}
            </div>
          </div>

          {/* Credit Balance Meter Card */}
          <div className="flex flex-col justify-between rounded-xl border border-white/[0.1] bg-[#1c1c1c] p-5 lg:col-span-2">
            <div>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[14px] font-semibold text-white">Credit balance</h2>
                <Zap className="size-4 text-indigo-300" aria-hidden="true" />
              </div>

              <div className="mt-4 flex items-baseline gap-1.5">
                <span className="text-[30px] font-semibold tracking-[-0.03em] text-white tabular-nums">
                  {formatCredits(sub.creditsBalanceHundredths)}
                </span>
                <span className="text-[13px] text-white/45 tabular-nums">
                  / {formatCredits(sub.monthlyCreditsHundredths)} monthly credits
                </span>
              </div>

              <div
                className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/[0.08]"
                role="progressbar"
                aria-valuenow={creditPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Remaining monthly credits"
              >
                <div
                  className="h-full w-full origin-left rounded-full bg-indigo-400 transition-transform duration-300 motion-reduce:transition-none"
                  style={{ transform: `scaleX(${creditPercent / 100})` }}
                />
              </div>

              <dl className="mt-5 space-y-2.5 text-[12px]">
                <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
                  <dt className="text-white/50">Used this billing cycle</dt>
                  <dd className="font-medium text-white tabular-nums">
                    {formatCredits(sub.creditsUsedThisPeriodHundredths)} credits
                  </dd>
                </div>
                <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
                  <dt className="text-white/50">Lifetime credits used</dt>
                  <dd className="font-medium text-white tabular-nums">
                    {formatCredits(sub.lifetimeCreditsUsedHundredths)} credits
                  </dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-white/50">{sub.cancelAtPeriodEnd ? "Access ends" : "Next renewal"}</dt>
                  <dd className="font-medium text-white tabular-nums">{formatDate(sub.currentPeriodEnd)}</dd>
                </div>
              </dl>
            </div>

            <p className="mt-4 text-[11px] leading-relaxed text-white/45">
              Account: <span className="text-white/70">{viewer.email}</span>
              {viewer.authProviderLabel ? ` · Signed in via ${viewer.authProviderLabel}` : ""}
            </p>
          </div>
        </section>

        {/* How Credits Are Calculated (Lovable-style effort-based model) */}
        <section className="rounded-xl border border-white/[0.08] bg-[#1c1c1c] p-5" aria-labelledby="credits-model-heading">
          <h2 id="credits-model-heading" className="text-[14px] font-semibold text-white">
            How agent credits are calculated
          </h2>
          <p className="mt-1 text-[13px] text-white/55">
            Instead of charging a flat fee per prompt, Cognix meters credits dynamically based on the actual effort the AI agent performs.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-white/[0.07] bg-[#161616] p-3.5">
              <p className="text-[12px] font-medium text-sky-300">Light edit</p>
              <p className="mt-1 text-[18px] font-semibold text-white tabular-nums">~0.25 – 0.75</p>
              <p className="mt-1 text-[11px] text-white/50">Text tweaks, styling updates, small component fixes.</p>
            </div>
            <div className="rounded-lg border border-white/[0.07] bg-[#161616] p-3.5">
              <p className="text-[12px] font-medium text-indigo-300">Plan mode</p>
              <p className="mt-1 text-[18px] font-semibold text-white tabular-nums">1.00 + research</p>
              <p className="mt-1 text-[11px] text-white/50">1 base credit plus read-only codebase investigation effort.</p>
            </div>
            <div className="rounded-lg border border-white/[0.07] bg-[#161616] p-3.5">
              <p className="text-[12px] font-medium text-amber-300">Standard feature</p>
              <p className="mt-1 text-[18px] font-semibold text-white tabular-nums">~0.85 – 1.75</p>
              <p className="mt-1 text-[11px] text-white/50">Multi-file UI sections, API routes, and build checks.</p>
            </div>
            <div className="rounded-lg border border-white/[0.07] bg-[#161616] p-3.5">
              <p className="text-[12px] font-medium text-rose-300">Full-stack build</p>
              <p className="mt-1 text-[18px] font-semibold text-white tabular-nums">~1.80 – 4.50+</p>
              <p className="mt-1 text-[11px] text-white/50">Database schema, auth, storage, and multi-turn verification.</p>
            </div>
          </div>
        </section>

        {/* Recent Usage History */}
        <section className="rounded-xl border border-white/[0.08] bg-[#1c1c1c]" aria-labelledby="usage-history-heading">
          <div className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3.5">
            <div>
              <h2 id="usage-history-heading" className="text-[14px] font-semibold text-white">
                Recent credit usage
              </h2>
              <p className="text-[12px] text-white/45">Every agent run is metered transparently by tokens, turns, and actions.</p>
            </div>
            <span className="text-[12px] text-white/45 tabular-nums">{summary.recentUsage.length} runs</span>
          </div>

          {summary.recentUsage.length === 0 ? (
            <div className="px-5 py-10 text-center text-[13px] text-white/50">
              No agent runs recorded yet. Start building an app to see your credit breakdown here.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-[12px]">
                <thead>
                  <tr className="border-b border-white/[0.07] text-white/45">
                    <th className="px-5 py-2.5 font-medium">Project / Run</th>
                    <th className="px-3 py-2.5 font-medium">Mode</th>
                    <th className="px-3 py-2.5 font-medium">Effort</th>
                    <th className="px-3 py-2.5 text-right font-medium">Tokens</th>
                    <th className="px-3 py-2.5 text-right font-medium">Actions</th>
                    <th className="px-3 py-2.5 text-right font-medium">Credits</th>
                    <th className="px-5 py-2.5 text-right font-medium">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {summary.recentUsage.map((event) => (
                    <tr key={event.id} className="hover:bg-white/[0.02]">
                      <td className="px-5 py-3">
                        <div className="font-medium text-white">{event.projectTitle ?? "Deleted project"}</div>
                        <div className="text-[11px] text-white/45">{event.description}</div>
                      </td>
                      <td className="px-3 py-3 capitalize text-white/75">{event.mode}</td>
                      <td className="px-3 py-3">
                        <span
                          className={cn(
                            "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize",
                            TIER_BADGE[event.complexityTier] ?? TIER_BADGE.standard,
                          )}
                        >
                          {event.complexityTier}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right text-white/70 tabular-nums">
                        {event.totalTokens.toLocaleString("en-US")}
                      </td>
                      <td className="px-3 py-3 text-right text-white/70 tabular-nums">
                        {event.toolCalls} · {event.turns}t
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-white tabular-nums">
                        -{formatCredits(event.creditsHundredths)}
                      </td>
                      <td className="px-5 py-3 text-right text-white/45 tabular-nums">
                        {formatDateTime(event.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
