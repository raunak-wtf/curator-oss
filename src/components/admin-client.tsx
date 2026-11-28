"use client";

import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Coins,
  CreditCard,
  KeyRound,
  RefreshCw,
  Search,
  Shield,
  SlidersHorizontal,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { formatCredits, formatCurrencyCents } from "@/lib/credits";
import type {
  AdminOverviewStats,
  AdminUserSummary,
  AuthMethod,
  CreditUsageEvent,
  SubscriptionStatus,
  Viewer,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type AdminData = {
  stats: AdminOverviewStats;
  users: AdminUserSummary[];
  recentUsage: CreditUsageEvent[];
};

type AdminClientProps = {
  viewer: Viewer;
  initialData: AdminData;
};

const SUB_BADGE: Record<SubscriptionStatus, { label: string; className: string }> = {
  active: { label: "Active · $10/mo", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
  inactive: { label: "Inactive", className: "border-white/15 bg-white/[0.05] text-white/55" },
  on_hold: { label: "On hold", className: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  cancelled: { label: "Cancelled", className: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  expired: { label: "Expired", className: "border-red-500/30 bg-red-500/10 text-red-300" },
  failed: { label: "Failed", className: "border-red-500/30 bg-red-500/10 text-red-300" },
};

const METHOD_BADGE: Record<AuthMethod, string> = {
  password: "border-sky-500/25 bg-sky-500/10 text-sky-300",
  oauth: "border-violet-500/25 bg-violet-500/10 text-violet-300",
  passwordless: "border-teal-500/25 bg-teal-500/10 text-teal-300",
  sso: "border-amber-500/25 bg-amber-500/10 text-amber-300",
};

function formatShortDate(iso: string): string {
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

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString("en-US");
}

function initialsFor(name: string | null, email: string): string {
  const source = (name || email).trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export function AdminClient({ viewer, initialData }: AdminClientProps) {
  const [data, setData] = useState<AdminData>(initialData);
  const [activeTab, setActiveTab] = useState<"users" | "usage">("users");
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [methodFilter, setMethodFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUserSummary | null>(null);
  const [creditMode, setCreditMode] = useState<"add" | "set">("add");
  const [creditAmount, setCreditAmount] = useState("90");
  const [monthlyAllowance, setMonthlyAllowance] = useState("90");
  const [nextStatus, setNextStatus] = useState<SubscriptionStatus>("active");
  const [isSavingAdjust, setIsSavingAdjust] = useState(false);

  useEffect(() => {
    if (!selectedUser) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSavingAdjust) setSelectedUser(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isSavingAdjust, selectedUser]);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/overview", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not load admin data.");
      setData(payload as AdminData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load admin data.");
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const filteredUsers = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return data.users.filter((user) => {
      if (providerFilter !== "all" && user.authProvider !== providerFilter) return false;
      if (methodFilter !== "all" && user.authMethod !== methodFilter) return false;
      if (statusFilter !== "all" && user.subscriptionStatus !== statusFilter) return false;
      if (needle) {
        const haystack = `${user.name ?? ""} ${user.email} ${user.authProviderLabel} ${user.id}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [data.users, methodFilter, providerFilter, search, statusFilter]);

  function openAdjustModal(user: AdminUserSummary) {
    setSelectedUser(user);
    setCreditMode("add");
    setCreditAmount(user.subscriptionStatus === "active" ? "0" : "90");
    setMonthlyAllowance(String(user.monthlyCreditsHundredths / 100));
    setNextStatus(user.subscriptionStatus);
  }

  async function saveAdjustment(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedUser || isSavingAdjust) return;
    const parsedCredits = Number.parseFloat(creditAmount);
    const parsedMonthly = Number.parseFloat(monthlyAllowance);
    if (!Number.isFinite(parsedCredits)) {
      toast.error("Enter a valid credit number.");
      return;
    }
    if (creditMode === "add" && (parsedCredits < -10_000 || parsedCredits > 10_000)) {
      toast.error("Enter a credit adjustment between -10,000 and 10,000.");
      return;
    }
    if (creditMode === "set" && (parsedCredits < 0 || parsedCredits > 100_000)) {
      toast.error("Enter a target balance between 0 and 100,000.");
      return;
    }
    if (!Number.isFinite(parsedMonthly) || parsedMonthly < 1 || parsedMonthly > 100_000) {
      toast.error("Enter a monthly credit allowance between 1 and 100,000.");
      return;
    }

    setIsSavingAdjust(true);
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(selectedUser.id)}/billing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(creditMode === "set" ? { setCreditsBalance: parsedCredits } : { grantCredits: parsedCredits }),
          monthlyCredits: parsedMonthly,
          setStatus: nextStatus,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not update user plan and credits.");
      toast.success(`Updated plan & credits for ${selectedUser.email}.`);
      setSelectedUser(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update user plan and credits.");
    } finally {
      setIsSavingAdjust(false);
    }
  }

  const previewBalanceHundredths = useMemo(() => {
    if (!selectedUser) return 0;
    const parsed = Number.parseFloat(creditAmount);
    if (!Number.isFinite(parsed)) return selectedUser.creditsBalanceHundredths;
    const hundredths = Math.round(parsed * 100);
    return creditMode === "set"
      ? Math.max(0, hundredths)
      : Math.max(0, selectedUser.creditsBalanceHundredths + hundredths);
  }, [creditAmount, creditMode, selectedUser]);

  const { stats } = data;
  const hasFilters = Boolean(search.trim() || providerFilter !== "all" || methodFilter !== "all" || statusFilter !== "all");

  return (
    <div className="min-h-dvh bg-[#141414] text-white">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-white/[0.08] bg-[#141414]/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-[13px] font-medium text-white/80 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              Cognix
            </Link>
            <div className="flex items-center gap-2">
              <Shield className="size-4 text-indigo-300" aria-hidden="true" />
              <h1 className="text-[15px] font-semibold tracking-[-0.02em] text-white">Admin Panel</h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden text-[12px] text-white/45 sm:inline">{viewer.email}</span>
            <Link
              href="/billing"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-[12px] font-medium text-white/80 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <CreditCard className="size-3.5" aria-hidden="true" />
              Billing
            </Link>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={isRefreshing}
              className="inline-flex size-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-white/75 transition-colors hover:bg-white/[0.08] hover:text-white [@media(pointer:coarse)]:size-11"
              title="Refresh admin metrics"
              aria-label="Refresh admin metrics"
            >
              <RefreshCw className={cn("size-3.5", isRefreshing && "animate-spin")} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-6">
        {error ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-[13px] text-red-200"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              className="inline-flex h-8 items-center rounded-lg border border-red-400/30 px-3 text-[12px] font-medium text-red-100 hover:bg-red-500/20"
            >
              Retry
            </button>
          </div>
        ) : null}

        {/* KPI Cards */}
        <section className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4" aria-label="Platform overview metrics">
          <div className="rounded-xl border border-white/[0.08] bg-[#1c1c1c] p-4">
            <div className="flex items-center justify-between text-[12px] text-white/50">
              <span>Total users</span>
              <Users className="size-4 text-white/40" aria-hidden="true" />
            </div>
            <p className="mt-2 text-[28px] font-semibold tracking-[-0.03em] text-white tabular-nums">
              {stats.totalUsers.toLocaleString("en-US")}
            </p>
            <p className="mt-1 text-[11px] text-white/45 tabular-nums">
              +{stats.newUsersLast7Days} last 7d · +{stats.newUsersLast30Days} last 30d
            </p>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-[#1c1c1c] p-4">
            <div className="flex items-center justify-between text-[12px] text-white/50">
              <span>Active subscribers ($10/mo)</span>
              <CreditCard className="size-4 text-emerald-400/75" aria-hidden="true" />
            </div>
            <p className="mt-2 text-[28px] font-semibold tracking-[-0.03em] text-white tabular-nums">
              {stats.activeSubscribers.toLocaleString("en-US")}
            </p>
            <p className="mt-1 text-[11px] text-emerald-300/80 tabular-nums">
              Est. MRR: {formatCurrencyCents(stats.estimatedMrrCents)}
            </p>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-[#1c1c1c] p-4">
            <div className="flex items-center justify-between text-[12px] text-white/50">
              <span>Credits consumed</span>
              <Coins className="size-4 text-indigo-300/75" aria-hidden="true" />
            </div>
            <p className="mt-2 text-[28px] font-semibold tracking-[-0.03em] text-white tabular-nums">
              {formatCredits(stats.totalCreditsUsedHundredths)}
            </p>
            <p className="mt-1 text-[11px] text-white/45 tabular-nums">
              {formatCompactNumber(stats.totalTokens)} total tokens
            </p>
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-[#1c1c1c] p-4">
            <div className="flex items-center justify-between text-[12px] text-white/50">
              <span>Agent runs &amp; projects</span>
              <Activity className="size-4 text-sky-300/75" aria-hidden="true" />
            </div>
            <p className="mt-2 text-[28px] font-semibold tracking-[-0.03em] text-white tabular-nums">
              {stats.totalAgentRuns.toLocaleString("en-US")}
            </p>
            <p className="mt-1 text-[11px] text-white/45 tabular-nums">
              {stats.totalProjects.toLocaleString("en-US")} projects created
            </p>
          </div>
        </section>

        {/* Sign-in Provider Breakdown */}
        <section className="grid gap-4 lg:grid-cols-2" aria-label="Sign-in provider analytics">
          <div className="rounded-xl border border-white/[0.08] bg-[#1c1c1c] p-4">
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-[13px] font-semibold text-white">
                <KeyRound className="size-3.5 text-white/55" aria-hidden="true" />
                Sign-in providers
              </h2>
              <span className="text-[11px] text-white/45">From Auth0 identity</span>
            </div>
            {stats.providerBreakdown.length === 0 ? (
              <p className="mt-4 text-[12px] text-white/45">No user sign-ins recorded yet.</p>
            ) : (
              <div className="mt-3.5 space-y-2.5">
                {stats.providerBreakdown.map((item) => (
                  <div key={item.provider} className="space-y-1">
                    <div className="flex items-center justify-between text-[12px]">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white">{item.label}</span>
                        <span
                          className={cn(
                            "rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                            METHOD_BADGE[item.method],
                          )}
                        >
                          {item.method === "password" ? "Email / Password" : item.method}
                        </span>
                      </div>
                      <span className="text-white/70 tabular-nums">
                        {item.count.toLocaleString("en-US")} ({item.percentage}%)
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]">
                      <div
                        className="h-full rounded-full bg-indigo-400/85"
                        style={{ width: `${Math.max(item.percentage, item.count > 0 ? 4 : 0)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-white/[0.08] bg-[#1c1c1c] p-4">
            <h2 className="text-[13px] font-semibold text-white">Authentication method split</h2>
            <p className="mt-0.5 text-[12px] text-white/45">Email &amp; Password vs OAuth social sign-ins</p>
            {stats.methodBreakdown.length === 0 ? (
              <p className="mt-4 text-[12px] text-white/45">No authentication data yet.</p>
            ) : (
              <div className="mt-3.5 grid gap-2.5 sm:grid-cols-2">
                {stats.methodBreakdown.map((item) => (
                  <div
                    key={item.method}
                    className="rounded-lg border border-white/[0.07] bg-[#161616] px-3.5 py-3"
                  >
                    <p className="text-[11px] font-medium text-white/55">{item.label}</p>
                    <div className="mt-1 flex items-baseline justify-between">
                      <span className="text-[20px] font-semibold text-white tabular-nums">
                        {item.count.toLocaleString("en-US")}
                      </span>
                      <span className="text-[12px] text-white/50 tabular-nums">{item.percentage}%</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Tabs: Users / Recent Platform Usage */}
        <section className="rounded-xl border border-white/[0.08] bg-[#1c1c1c]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
            <div role="tablist" aria-label="Admin sections" className="inline-flex rounded-lg bg-white/[0.04] p-0.5">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "users"}
                onClick={() => setActiveTab("users")}
                className={cn(
                  "h-8 rounded-md px-3 text-[12px] font-medium tabular-nums transition-colors",
                  activeTab === "users" ? "bg-white/[0.12] text-white" : "text-white/55 hover:text-white",
                )}
              >
                Users ({data.users.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "usage"}
                onClick={() => setActiveTab("usage")}
                className={cn(
                  "h-8 rounded-md px-3 text-[12px] font-medium tabular-nums transition-colors",
                  activeTab === "usage" ? "bg-white/[0.12] text-white" : "text-white/55 hover:text-white",
                )}
              >
                Usage ledger ({data.recentUsage.length})
              </button>
            </div>

            {activeTab === "users" ? (
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-white/40"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search email or name…"
                    aria-label="Search users"
                    className="h-8 w-52 rounded-lg border border-white/10 bg-[#151515] pl-8 pr-2.5 text-[12px] text-white placeholder:text-white/35 outline-none focus:border-white/25"
                  />
                </div>

                <select
                  aria-label="Filter by sign-in method"
                  value={methodFilter}
                  onChange={(e) => setMethodFilter(e.target.value)}
                  className="h-8 rounded-lg border border-white/10 bg-[#151515] px-2.5 text-[12px] text-white outline-none focus:border-white/25"
                >
                  <option value="all">All methods</option>
                  <option value="password">Email &amp; Password</option>
                  <option value="oauth">OAuth</option>
                  <option value="passwordless">Passwordless</option>
                  <option value="sso">Enterprise SSO</option>
                </select>

                <select
                  aria-label="Filter by provider"
                  value={providerFilter}
                  onChange={(e) => setProviderFilter(e.target.value)}
                  className="h-8 rounded-lg border border-white/10 bg-[#151515] px-2.5 text-[12px] text-white outline-none focus:border-white/25"
                >
                  <option value="all">All providers</option>
                  {stats.providerBreakdown.map((p) => (
                    <option key={p.provider} value={p.provider}>
                      {p.label} ({p.count})
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Filter by subscription status"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="h-8 rounded-lg border border-white/10 bg-[#151515] px-2.5 text-[12px] text-white outline-none focus:border-white/25"
                >
                  <option value="all">All plans</option>
                  <option value="active">Active ($10/mo)</option>
                  <option value="inactive">Inactive</option>
                  <option value="on_hold">On hold</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="expired">Expired</option>
                  <option value="failed">Failed</option>
                </select>

                {hasFilters ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch("");
                      setProviderFilter("all");
                      setMethodFilter("all");
                      setStatusFilter("all");
                    }}
                    className="h-8 rounded-lg px-2 text-[12px] text-white/60 hover:bg-white/[0.06] hover:text-white"
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>

          {activeTab === "users" ? (
            filteredUsers.length === 0 ? (
              <div className="px-5 py-12 text-center text-[13px] text-white/50">
                {data.users.length === 0
                  ? "No users have signed in yet."
                  : "No users match the current search or filters."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-[12px]">
                  <thead>
                    <tr className="border-b border-white/[0.07] text-white/45">
                      <th className="px-4 py-2.5 font-medium">User</th>
                      <th className="px-3 py-2.5 font-medium">Email</th>
                      <th className="px-3 py-2.5 font-medium">Sign-in provider</th>
                      <th className="px-3 py-2.5 font-medium">Subscription</th>
                      <th className="px-3 py-2.5 text-right font-medium">Projects</th>
                      <th className="px-3 py-2.5 text-right font-medium">Runs</th>
                      <th className="px-3 py-2.5 text-right font-medium">Credits (Bal / Used)</th>
                      <th className="px-3 py-2.5 text-right font-medium">Tokens</th>
                      <th className="px-3 py-2.5 text-right font-medium">Joined / Seen</th>
                      <th className="px-4 py-2.5 text-right font-medium">Manage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {filteredUsers.map((user) => {
                      const subInfo = SUB_BADGE[user.subscriptionStatus] ?? SUB_BADGE.inactive;
                      return (
                        <tr key={user.id} className="hover:bg-white/[0.02]">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              {user.avatarUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={user.avatarUrl}
                                  alt=""
                                  className="size-7 shrink-0 rounded-full border border-white/15 object-cover"
                                />
                              ) : (
                                <span className="user-avatar user-avatar-fallback size-7">
                                  {initialsFor(user.name, user.email)}
                                </span>
                              )}
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="truncate font-medium text-white">
                                    {user.name || user.email.split("@")[0]}
                                  </span>
                                  {user.isAdmin ? (
                                    <span className="rounded-full border border-indigo-400/30 bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-medium text-indigo-200">
                                      Admin
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-white/80">{user.email}</td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-medium text-white/90">{user.authProviderLabel}</span>
                              <span
                                className={cn(
                                  "rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                                  METHOD_BADGE[user.authMethod],
                                )}
                              >
                                {user.authMethod === "password" ? "Password" : user.authMethod.toUpperCase()}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <span
                              className={cn(
                                "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium",
                                subInfo.className,
                              )}
                            >
                              {subInfo.label}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right text-white/80 tabular-nums">{user.projectCount}</td>
                          <td className="px-3 py-3 text-right text-white/80 tabular-nums">{user.agentRunCount}</td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            <span className="font-medium text-white">
                              {formatCredits(user.creditsBalanceHundredths)}
                            </span>
                            <span className="text-white/40">
                              {" "}
                              / {formatCredits(user.lifetimeCreditsUsedHundredths)}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right text-white/70 tabular-nums">
                            {formatCompactNumber(user.totalTokens)}
                          </td>
                          <td className="px-3 py-3 text-right text-[11px] text-white/50 tabular-nums">
                            <div>{formatShortDate(user.createdAt)}</div>
                            <div className="text-white/35">Seen {formatDateTime(user.lastSeenAt)}</div>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => openAdjustModal(user)}
                              className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-[11px] font-medium text-white/80 transition-colors hover:bg-white/[0.1] hover:text-white"
                            >
                              <SlidersHorizontal className="size-3" aria-hidden="true" />
                              Plan &amp; Credits
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : data.recentUsage.length === 0 ? (
            <div className="px-5 py-12 text-center text-[13px] text-white/50">
              No agent credit usage events have been recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-[12px]">
                <thead>
                  <tr className="border-b border-white/[0.07] text-white/45">
                    <th className="px-4 py-2.5 font-medium">User</th>
                    <th className="px-3 py-2.5 font-medium">Project &amp; Breakdown</th>
                    <th className="px-3 py-2.5 font-medium">Mode / Tier</th>
                    <th className="px-3 py-2.5 text-right font-medium">Tokens</th>
                    <th className="px-3 py-2.5 text-right font-medium">Turns / Tools</th>
                    <th className="px-3 py-2.5 text-right font-medium">Credits</th>
                    <th className="px-4 py-2.5 text-right font-medium">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {data.recentUsage.map((ev) => (
                    <tr key={ev.id} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-3">
                        <div className="font-medium text-white">{ev.userName || ev.userEmail || ev.userId}</div>
                        {ev.userEmail ? <div className="text-[11px] text-white/45">{ev.userEmail}</div> : null}
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-medium text-white/90">{ev.projectTitle ?? "Deleted project"}</div>
                        <div className="text-[11px] text-white/45">{ev.description}</div>
                      </td>
                      <td className="px-3 py-3 capitalize text-white/75">
                        {ev.mode} · <span className="text-white/55">{ev.complexityTier}</span>
                      </td>
                      <td className="px-3 py-3 text-right text-white/75 tabular-nums">
                        {ev.totalTokens.toLocaleString("en-US")}
                      </td>
                      <td className="px-3 py-3 text-right text-white/70 tabular-nums">
                        {ev.turns}t · {ev.toolCalls} tools
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-white tabular-nums">
                        -{formatCredits(ev.creditsHundredths)}
                      </td>
                      <td className="px-4 py-3 text-right text-white/45 tabular-nums">
                        {formatDateTime(ev.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* Admin Credit / Subscription Adjustment Dialog */}
      {selectedUser ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="adjust-billing-title"
        >
          <div className="w-full max-w-md rounded-xl border border-white/15 bg-[#1e1e1e] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="adjust-billing-title" className="text-[15px] font-semibold text-white">
                  Adjust user billing &amp; credits
                </h2>
                <p className="mt-0.5 text-[12px] text-white/55">{selectedUser.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedUser(null)}
                className="inline-flex size-8 items-center justify-center rounded-lg text-white/55 hover:bg-white/[0.08] hover:text-white [@media(pointer:coarse)]:size-11"
                aria-label="Close dialog"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>

            <form onSubmit={(e) => void saveAdjustment(e)} className="mt-4 space-y-4">
              <div className="rounded-lg border border-white/[0.08] bg-[#151515] p-3 text-[12px]">
                <div className="flex justify-between">
                  <span className="text-white/50">Current balance</span>
                  <span className="font-semibold text-white tabular-nums">
                    {formatCredits(selectedUser.creditsBalanceHundredths)} credits
                  </span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span className="text-white/50">New balance preview</span>
                  <span className="font-semibold text-emerald-300 tabular-nums">
                    {formatCredits(previewBalanceHundredths)} credits
                  </span>
                </div>
                <div className="mt-1 flex justify-between">
                  <span className="text-white/50">Sign-in provider</span>
                  <span className="text-white/80">{selectedUser.authProviderLabel}</span>
                </div>
              </div>

              <label className="block space-y-1.5">
                <span className="text-[12px] font-medium text-white/80">Plan / subscription status</span>
                <select
                  value={nextStatus}
                  onChange={(e) => {
                    const chosen = e.target.value as SubscriptionStatus;
                    setNextStatus(chosen);
                    if (
                      chosen === "active" &&
                      selectedUser.subscriptionStatus !== "active" &&
                      selectedUser.creditsBalanceHundredths === 0 &&
                      creditMode === "add" &&
                      creditAmount === "0"
                    ) {
                      setCreditAmount("90");
                    }
                  }}
                  className="h-9 w-full rounded-lg border border-white/15 bg-[#151515] px-3 text-[13px] text-white outline-none focus:border-white/30"
                >
                  <option value="active">Curator Pro — Active ($10/mo · 90 cr)</option>
                  <option value="inactive">No active plan (Inactive)</option>
                  <option value="on_hold">On hold</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="expired">Expired</option>
                  <option value="failed">Failed</option>
                </select>
              </label>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-medium text-white/80">Credits</span>
                  <div className="inline-flex rounded-lg bg-white/[0.05] p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => {
                        setCreditMode("add");
                        setCreditAmount("90");
                      }}
                      className={cn(
                        "rounded-md px-2 py-1 font-medium transition-colors",
                        creditMode === "add" ? "bg-white/[0.14] text-white" : "text-white/55 hover:text-white",
                      )}
                    >
                      Add / deduct
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCreditMode("set");
                        setCreditAmount(String(selectedUser.creditsBalanceHundredths / 100));
                      }}
                      className={cn(
                        "rounded-md px-2 py-1 font-medium transition-colors",
                        creditMode === "set" ? "bg-white/[0.14] text-white" : "text-white/55 hover:text-white",
                      )}
                    >
                      Set exact
                    </button>
                  </div>
                </div>

                <input
                  type="number"
                  step="0.5"
                  min={creditMode === "set" ? "0" : "-10000"}
                  max={creditMode === "set" ? "100000" : "10000"}
                  value={creditAmount}
                  onChange={(e) => setCreditAmount(e.target.value)}
                  aria-label={creditMode === "set" ? "Exact credit balance" : "Credits to add or deduct"}
                  className="h-9 w-full rounded-lg border border-white/15 bg-[#151515] px-3 text-[13px] text-white tabular-nums outline-none focus:border-white/30"
                />

                {creditMode === "add" ? (
                  <div className="flex flex-wrap gap-1.5">
                    {([10, 30, 90, 180, 300, -10] as const).map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setCreditAmount(String(preset))}
                        className={cn(
                          "h-7 rounded-md border px-2 text-[11px] font-medium tabular-nums transition-colors",
                          creditAmount === String(preset)
                            ? "border-indigo-400/50 bg-indigo-500/20 text-indigo-200"
                            : "border-white/10 bg-white/[0.04] text-white/70 hover:bg-white/[0.09] hover:text-white",
                        )}
                      >
                        {preset > 0 ? `+${preset}` : preset}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <label className="block space-y-1.5">
                <span className="text-[12px] font-medium text-white/80">Monthly credit allowance</span>
                <input
                  type="number"
                  step="1"
                  min="1"
                  max="100000"
                  value={monthlyAllowance}
                  onChange={(e) => setMonthlyAllowance(e.target.value)}
                  className="h-9 w-full rounded-lg border border-white/15 bg-[#151515] px-3 text-[13px] text-white tabular-nums outline-none focus:border-white/30"
                />
              </label>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedUser(null)}
                  className="h-9 rounded-lg border border-white/15 px-3.5 text-[12px] font-medium text-white/75 hover:bg-white/[0.06] hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingAdjust}
                  className="h-9 rounded-lg bg-white px-4 text-[12px] font-semibold text-black hover:bg-white/90 disabled:opacity-50"
                >
                  {isSavingAdjust ? "Saving…" : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
