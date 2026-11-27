"use client";

import {
  Check,
  Database,
  KeyRound,
  LogOut,
  Mail,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  TriangleAlert,
  UserCheck,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PixelLoader } from "@/components/pixel-loader";
import type { BetterAuthOverview } from "@/lib/cloud/better-auth";
import { cn, formatRelativeDate } from "@/lib/utils";

type AuthOverviewResponse = BetterAuthOverview & { neonApiConfigured: boolean };

const btnSecondary =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-[12.5px] font-medium text-white/80 hover:bg-white/[0.07] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9f94ff] disabled:cursor-not-allowed disabled:opacity-45 [@media(pointer:coarse)]:h-11";
const btnPrimary =
  "inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[12.5px] font-semibold text-black hover:bg-white/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9f94ff] disabled:cursor-not-allowed disabled:opacity-45 [@media(pointer:coarse)]:h-11";
const iconBtn =
  "grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9f94ff] disabled:opacity-40 [@media(pointer:coarse)]:size-11";

export function CloudAuthPanel({
  projectId,
  onAskAgent,
  onOpenSection,
  onSecretsChanged,
}: {
  projectId: string;
  onAskAgent: (prompt: string) => void;
  onOpenSection: (section: "database" | "email" | "secrets") => void;
  onSecretsChanged?: () => void;
}) {
  const [data, setData] = useState<AuthOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const fetchAuthOverview = useCallback(
    async (queryText = "") => {
      const qs = queryText.trim() ? `?search=${encodeURIComponent(queryText.trim())}` : "";
      const response = await fetch(`/api/projects/${projectId}/cloud/auth${qs}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not load authentication details.");
      return payload as AuthOverviewResponse;
    },
    [projectId],
  );

  const load = useCallback(
    async (queryText = "") => {
      setLoading(true);
      setError(null);
      try {
        setData(await fetchAuthOverview(queryText));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load authentication details.");
      } finally {
        setLoading(false);
      }
    },
    [fetchAuthOverview],
  );

  useEffect(() => {
    let active = true;
    fetchAuthOverview()
      .then((next) => {
        if (!active) return;
        setData(next);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not load authentication details.");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchAuthOverview]);

  async function postAction(label: string, body: Record<string, unknown>, successMsg?: string) {
    if (busy) return;
    setBusy(label);
    try {
      const response = await fetch(`/api/projects/${projectId}/cloud/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Authentication action failed.");
      if (payload.overview) setData(payload.overview as AuthOverviewResponse);
      if (successMsg) toast.success(successMsg);
      onSecretsChanged?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication action failed.");
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex min-h-[320px] items-center justify-center gap-2 text-[13px] text-white/50">
        <PixelLoader /> Loading Better Auth details…
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-lg border border-red-400/20 bg-red-500/[0.05] p-5">
        <p className="text-[13px] font-medium text-red-200">Authentication panel could not be loaded</p>
        <p className="mt-1 text-[12px] text-red-200/70">{error}</p>
        <button type="button" onClick={() => void load(search)} className={cn(btnSecondary, "mt-3")}>
          <RefreshCw className="size-3.5" aria-hidden="true" /> Try again
        </button>
      </div>
    );
  }

  if (!data) return null;

  const readyTablesCount = data.tables.filter((t) => t.present).length;

  return (
    <section aria-labelledby="cloud-auth-heading" className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="cloud-auth-heading" className="text-lg font-semibold tracking-tight text-white">
            Authentication · Better Auth
          </h2>
          <p className="mt-1 text-[13px] text-white/55">
            Email/password, verification, password reset, and OAuth sessions stored directly in your Neon PostgreSQL database.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load(search)}
          disabled={loading || Boolean(busy)}
          aria-label="Refresh authentication overview"
          title="Refresh authentication overview"
          className={iconBtn}
        >
          {loading ? <PixelLoader /> : <RefreshCw className="size-3.5" aria-hidden="true" />}
        </button>
      </header>

      {/* Metrics */}
      <div className="grid gap-2.5 @[560px]:grid-cols-4">
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
          <span className="text-[11px] font-medium text-white/45">Registered Users</span>
          <p className="mt-1 text-[16px] font-semibold tabular-nums text-white">{data.stats.totalUsers}</p>
          <span className="mt-0.5 block text-[11px] tabular-nums text-white/40">
            {data.stats.verifiedUsers} verified
          </span>
        </div>
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
          <span className="text-[11px] font-medium text-white/45">Active Sessions</span>
          <p className="mt-1 text-[16px] font-semibold tabular-nums text-white">{data.stats.activeSessions}</p>
          <span className="mt-0.5 block text-[11px] text-white/40">PostgreSQL session store</span>
        </div>
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
          <span className="text-[11px] font-medium text-white/45">Postgres Auth Tables</span>
          <p className="mt-1 text-[16px] font-semibold tabular-nums text-white">{readyTablesCount} / 4</p>
          <span className="mt-0.5 block truncate font-mono text-[11px] text-white/40">
            {data.tables.map((t) => `${t.role}${t.present ? "✓" : "·"}`).join(" ")}
          </span>
        </div>
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
          <span className="text-[11px] font-medium text-white/45">Auth Engine</span>
          <p className="mt-1 flex items-center gap-1.5 text-[13px] font-semibold text-white">
            <span
              className={cn(
                "size-2 rounded-full",
                data.codebase.packageInstalled && data.schemaReady ? "bg-emerald-400" : "bg-amber-400",
              )}
              aria-hidden="true"
            />
            {data.codebase.packageInstalled ? `better-auth ${data.codebase.packageVersion ?? ""}` : "Not installed yet"}
          </p>
          <span className="mt-0.5 block truncate font-mono text-[11px] text-white/40">
            {data.codebase.serverConfigPath ?? "lib/auth.ts pending"}
          </span>
        </div>
      </div>

      {/* Infrastructure & Codebase Readiness */}
      <div className="rounded-lg border border-white/10 bg-white/[0.02] divide-y divide-white/[0.06]">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <KeyRound className="size-4 text-white/60" aria-hidden="true" />
            <div>
              <p className="text-[13px] font-medium text-white">
                Signing Secret (<code className="font-mono text-[12px]">BETTER_AUTH_SECRET</code>)
              </p>
              <p className="text-[11.5px] text-white/45">Signs cookies, CSRF tokens, and password reset tokens.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data.secretSet ? (
              <span className="inline-flex items-center gap-1 text-[12px] text-emerald-300">
                <Check className="size-3.5" aria-hidden="true" /> Set
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[12px] text-amber-300">
                <TriangleAlert className="size-3.5" aria-hidden="true" /> Missing
              </span>
            )}
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => {
                if (!data.secretSet || window.confirm("Rotate BETTER_AUTH_SECRET? Existing user sessions will sign in again.")) {
                  void postAction("rotate", { action: "rotate_secret" }, "BETTER_AUTH_SECRET updated and synced.");
                }
              }}
              className={btnSecondary}
            >
              <RotateCcw className="size-3.5" aria-hidden="true" /> {data.secretSet ? "Rotate" : "Generate"}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Database className="size-4 text-white/60" aria-hidden="true" />
            <div>
              <p className="text-[13px] font-medium text-white">
                PostgreSQL Backing Store (<code className="font-mono text-[12px]">DATABASE_URL</code>)
              </p>
              <p className="text-[11.5px] text-white/45">
                {data.databaseSet
                  ? "Connected to PostgreSQL for user, session, account, and verification tables."
                  : "Provision Neon PostgreSQL so Better Auth can persist users and sessions."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {data.databaseSet ? (
              <button type="button" onClick={() => onOpenSection("database")} className={btnSecondary}>
                Open Database
              </button>
            ) : data.neonApiConfigured ? (
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void postAction("prov_db", { action: "provision_database" }, "Neon PostgreSQL provisioned.")}
                className={btnPrimary}
              >
                Provision Neon
              </button>
            ) : (
              <button type="button" onClick={() => onOpenSection("database")} className={btnSecondary}>
                Configure Neon
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Mail className="size-4 text-white/60" aria-hidden="true" />
            <div>
              <p className="text-[13px] font-medium text-white">Verification & Reset Emails (Resend)</p>
              <p className="text-[11.5px] text-white/45">
                {data.emailConfigured
                  ? `Sending from ${data.emailFrom ?? "Resend"}`
                  : "Connect Resend in Emails to deliver live verification and password-reset links."}
              </p>
            </div>
          </div>
          <button type="button" onClick={() => onOpenSection("email")} className={btnSecondary}>
            {data.emailConfigured ? "Manage Emails" : "Connect Resend"}
          </button>
        </div>

        <div className="px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-medium text-white">Detected Better Auth Configuration</p>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <span
                className={cn(
                  "rounded px-2 py-0.5 font-medium",
                  data.codebase.features.emailAndPassword ? "bg-emerald-400/15 text-emerald-300" : "bg-white/[0.06] text-white/45",
                )}
              >
                Email & Password
              </span>
              <span
                className={cn(
                  "rounded px-2 py-0.5 font-medium",
                  data.codebase.features.emailVerification ? "bg-emerald-400/15 text-emerald-300" : "bg-white/[0.06] text-white/45",
                )}
              >
                Email Verification
              </span>
              <span
                className={cn(
                  "rounded px-2 py-0.5 font-medium",
                  data.codebase.features.passwordReset ? "bg-emerald-400/15 text-emerald-300" : "bg-white/[0.06] text-white/45",
                )}
              >
                Password Reset
              </span>
              {data.codebase.features.socialProviders.map((prov) => (
                <span key={prov} className="rounded bg-sky-400/15 px-2 py-0.5 font-medium capitalize text-sky-300">
                  {prov}
                </span>
              ))}
              {data.codebase.features.plugins.map((plug) => (
                <span key={plug} className="rounded bg-purple-400/15 px-2 py-0.5 font-medium text-purple-300">
                  {plug}
                </span>
              ))}
            </div>
          </div>
          <p className="mt-1 font-mono text-[11.5px] text-white/45">
            Server: {data.codebase.serverConfigPath ?? "not created"} · Route:{" "}
            {data.codebase.routeHandlerPath ?? "not created"} · Client: {data.codebase.clientConfigPath ?? "not created"}
          </p>
        </div>
      </div>

      {/* Users Directory or Setup CTA */}
      {!data.schemaReady ? (
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-6 text-center">
          <ShieldCheck className="mx-auto size-6 text-white/50" aria-hidden="true" />
          <h3 className="mt-2.5 text-[14px] font-medium text-white">Better Auth tables are not in PostgreSQL yet</h3>
          <p className="mx-auto mt-1 max-w-md text-[12.5px] leading-5 text-white/50">
            Ask Curator to set up Better Auth with PostgreSQL (<code className="font-mono">user</code>,{" "}
            <code className="font-mono">session</code>, <code className="font-mono">account</code>, and{" "}
            <code className="font-mono">verification</code> tables), sign-in/sign-up screens, and protected routes.
          </p>
          {data.queryError ? <p className="mt-2 font-mono text-[11.5px] text-amber-300">{data.queryError}</p> : null}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() =>
                onAskAgent(
                  "Set up Better Auth with PostgreSQL (DATABASE_URL and BETTER_AUTH_SECRET), migrate the auth tables, and create sign-up, sign-in, password reset, and protected account views",
                )
              }
              className={btnPrimary}
            >
              <Sparkles className="size-3.5" aria-hidden="true" /> Set up Better Auth with AI
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-white/10 bg-white/[0.02]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] p-3.5">
            <h3 className="text-[13.5px] font-medium text-white">Users & Sessions</h3>
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                void load(search);
              }}
            >
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-white/40" aria-hidden="true" />
                <label htmlFor="auth-user-search" className="sr-only">
                  Search users by name or email
                </label>
                <input
                  id="auth-user-search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search email or name…"
                  className="h-8 w-52 rounded-lg border border-white/[0.12] bg-[#111111] pl-8 pr-2.5 text-[12.5px] text-white outline-none placeholder:text-white/35 focus-visible:border-white/35 [@media(pointer:coarse)]:h-11"
                />
              </div>
              <button type="submit" className={btnSecondary}>
                Filter
              </button>
            </form>
          </div>

          {data.users.length === 0 ? (
            <p className="p-6 text-center text-[12.5px] text-white/45">
              {search.trim() ? "No users matched your search." : "No accounts have signed up in this app yet."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12.5px]">
                <thead>
                  <tr className="border-b border-white/[0.08] bg-white/[0.02] text-white/55">
                    <th className="px-4 py-2.5 font-medium">User</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 font-medium">Providers</th>
                    <th className="px-4 py-2.5 font-medium">Sessions</th>
                    <th className="px-4 py-2.5 font-medium">Joined</th>
                    <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {data.users.map((user) => (
                    <tr key={user.id} className="hover:bg-white/[0.015]">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-white">{user.name || "Unnamed user"}</p>
                        <p className="font-mono text-[11.5px] text-white/50">{user.email}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium",
                            user.emailVerified
                              ? "bg-emerald-400/15 text-emerald-300"
                              : "bg-amber-400/15 text-amber-300",
                          )}
                        >
                          {user.emailVerified ? "Verified" : "Unverified"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-[11.5px] text-white/65">
                        {user.providers.length > 0 ? user.providers.join(", ") : "email"}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-[12px] tabular-nums text-white/75">
                        {user.activeSessions}
                      </td>
                      <td className="px-4 py-2.5 text-[11.5px] tabular-nums text-white/45">
                        {user.createdAt ? formatRelativeDate(user.createdAt) : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            disabled={Boolean(busy)}
                            aria-label={user.emailVerified ? `Mark ${user.email} unverified` : `Verify ${user.email}`}
                            title={user.emailVerified ? "Mark email unverified" : "Mark email verified"}
                            onClick={() =>
                              void postAction(
                                `ver-${user.id}`,
                                { action: "set_verified", userId: user.id, verified: !user.emailVerified },
                                user.emailVerified ? "Marked unverified." : "User email marked verified.",
                              )
                            }
                            className={iconBtn}
                          >
                            <UserCheck className="size-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(busy) || user.activeSessions === 0}
                            aria-label={`Revoke active sessions for ${user.email}`}
                            title="Revoke active sessions"
                            onClick={() =>
                              void postAction(
                                `rev-${user.id}`,
                                { action: "revoke_sessions", userId: user.id },
                                "Active sessions revoked.",
                              )
                            }
                            className={iconBtn}
                          >
                            <LogOut className="size-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(busy)}
                            aria-label={`Delete user ${user.email}`}
                            title={`Delete user ${user.email}`}
                            onClick={() => {
                              if (window.confirm(`Delete user "${user.email}" from PostgreSQL?`)) {
                                void postAction(`del-${user.id}`, { action: "delete_user", userId: user.id }, "User deleted.");
                              }
                            }}
                            className={iconBtn}
                          >
                            <Trash2 className="size-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
