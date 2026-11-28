"use client";

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import type { SidebarBillingBadge } from "@/components/home-sidebar";
import { LOW_CREDITS_THRESHOLD_HUNDREDTHS, formatCredits } from "@/lib/credits";
import { cn } from "@/lib/utils";

type LowCreditsBannerProps = {
  billing: SidebarBillingBadge | null | undefined;
  isAdmin?: boolean;
  className?: string;
};

/**
 * Shown directly above the prompt composer whenever the user has fewer than 3.00 credits remaining.
 */
export function LowCreditsBanner({ billing, isAdmin = false, className }: LowCreditsBannerProps) {
  if (!billing) return null;
  if (billing.creditsBalanceHundredths >= LOW_CREDITS_THRESHOLD_HUNDREDTHS) return null;

  const isEmpty = billing.creditsBalanceHundredths <= 0;
  const needsSubscription = billing.status !== "active" && !isAdmin;

  return (
    <div
      role="status"
      className={cn(
        "flex items-center justify-between gap-2.5 rounded-xl border px-3 py-2 text-[12px]",
        isEmpty
          ? "border-red-500/30 bg-red-500/[0.09] text-red-200"
          : "border-amber-500/30 bg-amber-500/[0.09] text-amber-200",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <AlertTriangle
          className={cn("size-3.5 shrink-0", isEmpty ? "text-red-300" : "text-amber-300")}
          aria-hidden="true"
        />
        <span className="truncate">
          {needsSubscription ? (
            <>
              <strong className="font-semibold">No active plan</strong> — Subscribe to Curator Pro ($10/mo · 90 credits) to build.
            </>
          ) : isEmpty ? (
            <>
              <strong className="font-semibold">Out of credits</strong> (
              <span className="tabular-nums">0 / {formatCredits(billing.monthlyCreditsHundredths)}</span>)
              {isAdmin ? " · Admin bypass active" : "."}
            </>
          ) : (
            <>
              <strong className="font-semibold">Low credits:</strong>{" "}
              <span className="tabular-nums">
                {formatCredits(billing.creditsBalanceHundredths)} / {formatCredits(billing.monthlyCreditsHundredths)}
              </span>{" "}
              remaining.
            </>
          )}
        </span>
      </div>
      <Link
        href="/billing"
        className={cn(
          "shrink-0 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors",
          isEmpty
            ? "border-red-400/35 bg-red-500/15 text-red-100 hover:bg-red-500/25"
            : "border-amber-400/35 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25",
        )}
      >
        {needsSubscription ? "Subscribe" : "Billing"}
      </Link>
    </div>
  );
}
