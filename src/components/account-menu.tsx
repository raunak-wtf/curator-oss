import { ChevronDown, CreditCard, LogOut, Shield } from "lucide-react";
import Link from "next/link";
import type { Viewer } from "@/lib/types";
import { UserAvatar } from "./user-avatar";

export function AccountMenu({ viewer }: { viewer: Viewer }) {
  return (
    <details className="account-menu">
      <summary>
        <UserAvatar viewer={viewer} className="size-8" />
        <span className="min-w-0 flex-1 text-left">
          <strong>{viewer.name}</strong>
          <small>{viewer.email}</small>
        </span>
        <ChevronDown className="size-3.5 text-white/35" aria-hidden="true" />
      </summary>
      <div className="account-popover">
        <div className="flex items-center gap-3 border-b border-white/8 p-3">
          <UserAvatar viewer={viewer} className="size-9" />
          <div className="min-w-0">
            <p className="truncate text-[12px] font-medium text-white">{viewer.name}</p>
            <p className="mt-0.5 truncate text-[10px] text-white/42">{viewer.email}</p>
          </div>
        </div>
        <Link href="/billing" className="account-action">
          <CreditCard className="size-3.5" /> Billing &amp; credits
        </Link>
        {viewer.isAdmin ? (
          <Link href="/admin" className="account-action">
            <Shield className="size-3.5" /> Admin panel
          </Link>
        ) : null}
        <a href="/auth/logout" className="account-action">
          <LogOut className="size-3.5" /> Sign out
        </a>
      </div>
    </details>
  );
}
