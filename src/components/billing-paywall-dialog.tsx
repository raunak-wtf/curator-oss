"use client";

import { Check, CreditCard, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PixelLoader } from "@/components/pixel-loader";

type BillingPaywallDialogProps = {
  open: boolean;
  reason: "subscription_required" | "credits_exhausted";
  message?: string;
  returnPath?: string;
  onClose: () => void;
};

export function BillingPaywallDialog({
  open,
  reason,
  message,
  returnPath = "/billing",
  onClose,
}: BillingPaywallDialogProps) {
  const [startingCheckout, setStartingCheckout] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  async function handleSubscribe() {
    if (startingCheckout) return;
    setStartingCheckout(true);
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnPath }),
      });
      const payload = await response.json();
      if (!response.ok || typeof payload.checkoutUrl !== "string") {
        throw new Error(payload.error ?? "Could not start checkout.");
      }
      window.location.href = payload.checkoutUrl;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start checkout.");
      setStartingCheckout(false);
    }
  }

  const isExhausted = reason === "credits_exhausted";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="billing-paywall-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-white/15 bg-[#1d1d1d] p-5 text-white shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex size-9 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-300">
              <Sparkles className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h2 id="billing-paywall-title" className="text-[15px] font-semibold text-white">
                {isExhausted ? "Monthly credits reached" : "Subscribe to Curator Pro"}
              </h2>
              <p className="text-[12px] text-white/50">Single plan · $10/month · No free tier</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-8 items-center justify-center rounded-lg text-white/55 hover:bg-white/[0.08] hover:text-white [@media(pointer:coarse)]:size-11"
            aria-label="Close"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <p className="mt-3 text-[13px] leading-relaxed text-white/75">
          {message ??
            (isExhausted
              ? "You have used all available credits for this billing cycle. View your usage history or manage your renewal in Billing."
              : "Unlock AI full-stack app building with Curator Pro for $10/month.")}
        </p>

        {!isExhausted ? (
          <div className="mt-4 rounded-lg border border-white/[0.08] bg-[#151515] p-3.5">
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] font-semibold text-white">Curator Pro</span>
              <span className="text-[18px] font-semibold text-white tabular-nums">
                $10<span className="text-[12px] font-normal text-white/45">/month</span>
              </span>
            </div>
            <ul className="mt-2.5 space-y-1.5 text-[12px] text-white/70">
              <li className="flex items-center gap-2">
                <Check className="size-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
                <span>90 monthly credits (effort-based, unused credits roll over)</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="size-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
                <span>Full-stack Next.js apps with Cloud DB, Auth &amp; Storage</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="size-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
                <span>Live previews, custom domains &amp; GitHub sync</span>
              </li>
            </ul>
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <Link
            href="/billing"
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-lg border border-white/15 px-3.5 text-[12px] font-medium text-white/80 hover:bg-white/[0.07] hover:text-white"
          >
            View billing &amp; usage
          </Link>
          {!isExhausted ? (
            <button
              type="button"
              onClick={() => void handleSubscribe()}
              disabled={startingCheckout}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-white px-4 text-[12px] font-semibold text-black hover:bg-white/90 disabled:opacity-50"
            >
              {startingCheckout ? (
                <>
                  <PixelLoader className="text-black" />
                  Redirecting…
                </>
              ) : (
                <>
                  <CreditCard className="size-3.5" aria-hidden="true" />
                  Subscribe — $10/mo
                </>
              )}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
