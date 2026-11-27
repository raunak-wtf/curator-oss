"use client";

import {
  Check,
  Copy,
  Globe2,
  KeyRound,
  Mail,
  Megaphone,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Users,
  Webhook,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { PixelLoader } from "@/components/pixel-loader";
import { cn, formatRelativeDate } from "@/lib/utils";

type ResendDomainRecord = {
  record: string;
  name: string;
  type: string;
  ttl: string;
  status: string;
  value: string;
};

type ResendDomain = {
  id: string;
  name: string;
  status: string;
  created_at: string;
  region: string;
  records?: ResendDomainRecord[];
};

type ResendEmailItem = {
  id: string;
  to: string[];
  from: string;
  created_at: string;
  subject: string;
  last_event?: string;
};

type ResendAudience = { id: string; name: string; created_at: string };
type ResendContact = { id: string; email: string; first_name?: string; last_name?: string; unsubscribed: boolean; created_at: string };
type ResendBroadcast = { id: string; name?: string; subject?: string; status?: string; created_at: string };
type ResendWebhook = { id: string; endpoint: string; events?: string[]; status?: string; created_at: string };

type ResendState = {
  connected: boolean;
  restrictedKey: boolean;
  emailFrom: string | null;
  domains: ResendDomain[];
  emails: ResendEmailItem[];
  audiences: ResendAudience[];
  contacts: ResendContact[];
  broadcasts: ResendBroadcast[];
  webhooks: ResendWebhook[];
};

type EmailTab = "domains" | "emails" | "audiences" | "broadcasts" | "webhooks";

const btnSecondary =
  "inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-[12.5px] font-medium text-white/80 hover:bg-white/[0.07] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9f94ff] disabled:cursor-not-allowed disabled:opacity-45 [@media(pointer:coarse)]:h-11";
const btnPrimary =
  "inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[12.5px] font-semibold text-black hover:bg-white/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9f94ff] disabled:cursor-not-allowed disabled:opacity-45 [@media(pointer:coarse)]:h-11";
const iconBtn =
  "grid size-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-white/70 hover:bg-white/[0.08] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9f94ff] disabled:opacity-40 [@media(pointer:coarse)]:size-11";
const inputClass =
  "h-8 w-full rounded-lg border border-white/[0.12] bg-[#111111] px-2.5 text-[12.5px] text-white outline-none placeholder:text-white/35 focus-visible:border-white/35 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-[#9f94ff] [@media(pointer:coarse)]:h-11";

export function CloudEmailsPanel({
  projectId,
  onAskAgent,
  onSecretsChanged,
}: {
  projectId: string;
  onAskAgent: (prompt: string) => void;
  onSecretsChanged?: () => void;
}) {
  const [state, setState] = useState<ResendState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<EmailTab>("domains");

  // Connect form
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [fromInput, setFromInput] = useState("");

  // Domain detail / add
  const [newDomain, setNewDomain] = useState("");
  const [domainRegion, setDomainRegion] = useState<"us-east-1" | "eu-west-1" | "sa-east-1" | "ap-northeast-1">("us-east-1");
  const [expandedDomain, setExpandedDomain] = useState<ResendDomain | null>(null);

  // Test email
  const [testTo, setTestTo] = useState("");
  const [testSubject, setTestSubject] = useState("Test email from Cognix Cloud");
  const [testBody, setTestBody] = useState("Your Cognix Cloud Email integration is connected and ready.");

  // Audiences / Contacts / Broadcasts / Webhooks
  const [audienceName, setAudienceName] = useState("");
  const [selectedAudienceId, setSelectedAudienceId] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [broadcastSubject, setBroadcastSubject] = useState("");
  const [broadcastBody, setBroadcastBody] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");

  const fetchResendState = useCallback(
    async (audId?: string) => {
      const query = audId ? `?audienceId=${encodeURIComponent(audId)}` : "";
      const response = await fetch(`/api/projects/${projectId}/cloud/resend${query}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not load email service status.");
      return payload as ResendState;
    },
    [projectId],
  );

  const applyResendState = useCallback((next: ResendState) => {
    setState(next);
    setFromInput(next.emailFrom ?? "");
    setSelectedAudienceId((current) => current || next.audiences[0]?.id || "");
  }, []);

  const load = useCallback(
    async (audId?: string) => {
      setLoading(true);
      setError(null);
      try {
        applyResendState(await fetchResendState(audId));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load email service status.");
      } finally {
        setLoading(false);
      }
    },
    [applyResendState, fetchResendState],
  );

  useEffect(() => {
    let active = true;
    fetchResendState()
      .then((next) => {
        if (!active) return;
        applyResendState(next);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Could not load email service status.");
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applyResendState, fetchResendState]);

  async function postAction(label: string, body: Record<string, unknown>, successMsg?: string) {
    if (busy) return null;
    setBusy(label);
    try {
      const response = await fetch(`/api/projects/${projectId}/cloud/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Email request failed.");
      if (payload.state) {
        setState(payload.state as ResendState);
        setFromInput((payload.state as ResendState).emailFrom ?? "");
      }
      if (payload.domain) setExpandedDomain(payload.domain as ResendDomain);
      if (successMsg) toast.success(successMsg);
      onSecretsChanged?.();
      return payload;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Email request failed.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function disconnectResend() {
    if (!window.confirm("Disconnect your email API key from this project?")) return;
    setBusy("disconnect");
    try {
      const response = await fetch(`/api/projects/${projectId}/cloud/resend`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not disconnect email service.");
      toast.success("Email service disconnected.");
      onSecretsChanged?.();
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not disconnect email service.");
    } finally {
      setBusy(null);
    }
  }

  if (loading && !state) {
    return (
      <div className="flex min-h-[320px] items-center justify-center gap-2 text-[13px] text-white/50">
        <PixelLoader /> Loading Cloud Emails…
      </div>
    );
  }

  if (error && !state) {
    return (
      <div className="rounded-lg border border-red-400/20 bg-red-500/[0.05] p-5">
        <p className="text-[13px] font-medium text-red-200">Email settings could not be loaded</p>
        <p className="mt-1 text-[12px] text-red-200/70">{error}</p>
        <button type="button" onClick={() => void load()} className={cn(btnSecondary, "mt-3")}>
          <RefreshCw className="size-3.5" aria-hidden="true" /> Try again
        </button>
      </div>
    );
  }

  if (!state) return null;

  return (
    <section aria-labelledby="cloud-emails-heading" className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="cloud-emails-heading" className="text-lg font-semibold tracking-tight text-white">
            Cognix Cloud Emails
          </h2>
          <p className="mt-1 text-[13px] text-white/55">
            Connect your email API key to manage sending domains, transactional emails, audiences, broadcasts, and webhooks.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {state.connected ? (
            <button type="button" onClick={() => void disconnectResend()} disabled={Boolean(busy)} className={btnSecondary}>
              Disconnect
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => void load(selectedAudienceId)}
            disabled={loading || Boolean(busy)}
            aria-label="Refresh email status"
            title="Refresh email status"
            className={iconBtn}
          >
            {loading ? <PixelLoader /> : <RefreshCw className="size-3.5" aria-hidden="true" />}
          </button>
        </div>
      </header>

      {!state.connected ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!apiKeyInput.trim()) return;
            void postAction(
              "connect",
              { action: "connect", apiKey: apiKeyInput.trim(), ...(fromInput.trim() ? { emailFrom: fromInput.trim() } : {}) },
              "Email service connected and synced to .env.local.",
            ).then((res) => res && setApiKeyInput(""));
          }}
          className="rounded-lg border border-white/10 bg-white/[0.02] p-5 space-y-4"
        >
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-lg bg-white/[0.06] text-white/80">
              <KeyRound className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="text-[14px] font-medium text-white">Connect your Email API key</h3>
              <p className="text-[12px] text-white/50">
                Enter a full-access email API key so Cognix Cloud can manage sending domains, webhooks, audiences, and delivery logs.
              </p>
            </div>
          </div>

          <div className="grid gap-3 @[560px]:grid-cols-2">
            <div>
              <label htmlFor="resend-api-key" className="mb-1 block text-[12px] font-medium text-white/75">
                Email API Key
              </label>
              <input
                id="resend-api-key"
                type="password"
                required
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder="re_••••••••••••"
                autoComplete="off"
                className={cn(inputClass, "font-mono")}
              />
            </div>
            <div>
              <label htmlFor="resend-from-init" className="mb-1 block text-[12px] font-medium text-white/75">
                Default Sender (<code className="font-mono">EMAIL_FROM</code>)
              </label>
              <input
                id="resend-from-init"
                type="text"
                value={fromInput}
                onChange={(e) => setFromInput(e.target.value)}
                placeholder="Acme <hello@yourdomain.com>"
                className={inputClass}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button type="submit" disabled={!apiKeyInput.trim() || Boolean(busy)} className={btnPrimary}>
              {busy === "connect" ? <PixelLoader className="text-black" /> : <Check className="size-3.5" aria-hidden="true" />}
              {busy === "connect" ? "Verifying key…" : "Connect Email Service"}
            </button>
          </div>
        </form>
      ) : (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!fromInput.trim()) return;
              void postAction("set_from", { action: "set_from", emailFrom: fromInput.trim() }, "Default EMAIL_FROM saved.");
            }}
            className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-4"
          >
            <div className="min-w-60 flex-1">
              <label htmlFor="resend-email-from" className="mb-1 flex items-center gap-2 text-[12px] font-medium text-white">
                <span className="size-2 rounded-full bg-emerald-400" aria-hidden="true" />
                Connected · Default Sender (<code className="font-mono text-white/75">EMAIL_FROM</code>)
              </label>
              <input
                id="resend-email-from"
                value={fromInput}
                onChange={(e) => setFromInput(e.target.value)}
                placeholder="Acme <noreply@yourdomain.com>"
                className={inputClass}
              />
            </div>
            <div className="flex items-center gap-2">
              <button type="submit" disabled={!fromInput.trim() || Boolean(busy)} className={btnSecondary}>
                Save sender
              </button>
              <button
                type="button"
                onClick={() => onAskAgent("Wire Cognix Cloud transactional emails in lib/email.ts for account notifications and updates")}
                className={btnPrimary}
              >
                <Sparkles className="size-3.5" aria-hidden="true" /> Add email flows with AI
              </button>
            </div>
          </form>

          {state.restrictedKey ? (
            <p className="rounded-lg border border-amber-400/20 bg-amber-400/[0.05] p-3 text-[12px] text-amber-200/85">
              Your API key is restricted to sending emails only. Use a full-access key if you also want to manage domains, audiences, broadcasts, and webhooks here.
            </p>
          ) : null}

          <nav aria-label="Email features" className="flex gap-1 overflow-x-auto border-b border-white/[0.08] pb-2">
            {(
              [
                { id: "domains", label: `Domains (${state.domains.length})`, icon: Globe2 },
                { id: "emails", label: `Emails (${state.emails.length})`, icon: Mail },
                { id: "audiences", label: `Audiences (${state.audiences.length})`, icon: Users },
                { id: "broadcasts", label: `Broadcasts (${state.broadcasts.length})`, icon: Megaphone },
                { id: "webhooks", label: `Webhooks (${state.webhooks.length})`, icon: Webhook },
              ] as const
            ).map((item) => {
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12.5px] font-medium tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-[#9f94ff] [@media(pointer:coarse)]:h-11",
                    active ? "bg-white/[0.1] text-white" : "text-white/55 hover:bg-white/[0.05] hover:text-white",
                  )}
                >
                  <item.icon className="size-3.5" aria-hidden="true" />
                  {item.label}
                </button>
              );
            })}
          </nav>

          {tab === "domains" ? (
            <div className="space-y-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newDomain.trim()) return;
                  void postAction(
                    "add_domain",
                    { action: "create_domain", name: newDomain.trim(), region: domainRegion },
                    `Domain ${newDomain.trim()} added.`,
                  ).then((res) => res && setNewDomain(""));
                }}
                className="flex flex-wrap items-end gap-2.5 rounded-lg border border-white/10 bg-white/[0.02] p-4"
              >
                <div className="min-w-52 flex-1">
                  <label htmlFor="resend-domain-name" className="mb-1 block text-[12px] font-medium text-white/75">
                    Sending domain
                  </label>
                  <input
                    id="resend-domain-name"
                    value={newDomain}
                    onChange={(e) => setNewDomain(e.target.value)}
                    placeholder="mail.yourdomain.com"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="resend-domain-region" className="mb-1 block text-[12px] font-medium text-white/75">
                    Region
                  </label>
                  <select
                    id="resend-domain-region"
                    value={domainRegion}
                    onChange={(e) => setDomainRegion(e.target.value as typeof domainRegion)}
                    className={cn(inputClass, "w-40")}
                  >
                    <option value="us-east-1">US East (N. Virginia)</option>
                    <option value="eu-west-1">EU West (Ireland)</option>
                    <option value="sa-east-1">South America (São Paulo)</option>
                    <option value="ap-northeast-1">Asia Pacific (Tokyo)</option>
                  </select>
                </div>
                <button type="submit" disabled={!newDomain.trim() || Boolean(busy)} className={btnPrimary}>
                  <Plus className="size-3.5" aria-hidden="true" /> Add domain
                </button>
              </form>

              {state.domains.length === 0 ? (
                <p className="rounded-lg border border-white/10 bg-white/[0.02] p-5 text-center text-[12.5px] text-white/45">
                  No custom sending domains yet. Add one above to send from your own address.
                </p>
              ) : (
                <ul className="divide-y divide-white/[0.06] rounded-lg border border-white/10 bg-white/[0.02]">
                  {state.domains.map((dom) => {
                    const isExpanded = expandedDomain?.id === dom.id;
                    return (
                      <li key={dom.id} className="p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <strong className="font-mono text-[13px] text-white">{dom.name}</strong>
                              <span
                                className={cn(
                                  "rounded px-1.5 py-0.5 text-[10.5px] font-medium",
                                  dom.status === "verified"
                                    ? "bg-emerald-400/15 text-emerald-300"
                                    : "bg-amber-400/15 text-amber-300",
                                )}
                              >
                                {dom.status}
                              </span>
                              <span className="text-[11px] text-white/40">{dom.region}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void postAction(`dns-${dom.id}`, { action: "get_domain", domainId: dom.id })}
                              className={btnSecondary}
                            >
                              DNS records
                            </button>
                            {dom.status !== "verified" ? (
                              <button
                                type="button"
                                onClick={() =>
                                  void postAction(`ver-${dom.id}`, { action: "verify_domain", domainId: dom.id }, "Verification started.")
                                }
                                className={btnPrimary}
                              >
                                Verify DNS
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  const nextFrom = `noreply@${dom.name}`;
                                  setFromInput(nextFrom);
                                  void postAction("set_from", { action: "set_from", emailFrom: nextFrom }, `EMAIL_FROM set to ${nextFrom}.`);
                                }}
                                className={btnSecondary}
                              >
                                Use as sender
                              </button>
                            )}
                            <button
                              type="button"
                              aria-label={`Delete domain ${dom.name}`}
                              title={`Delete domain ${dom.name}`}
                              onClick={() => {
                                if (window.confirm(`Remove sending domain ${dom.name}?`)) {
                                  void postAction(`del-dom-${dom.id}`, { action: "delete_domain", domainId: dom.id }, "Domain removed.");
                                }
                              }}
                              className={iconBtn}
                            >
                              <Trash2 className="size-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </div>

                        {isExpanded && expandedDomain?.records?.length ? (
                          <div className="mt-3 overflow-x-auto rounded-lg border border-white/[0.08] bg-black/30">
                            <table className="w-full text-left text-[11.5px]">
                              <thead>
                                <tr className="border-b border-white/[0.08] text-white/50">
                                  <th className="px-3 py-2 font-medium">Type</th>
                                  <th className="px-3 py-2 font-medium">Name</th>
                                  <th className="px-3 py-2 font-medium">Value</th>
                                  <th className="px-3 py-2 font-medium">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-white/[0.06]">
                                {expandedDomain.records.map((rec, i) => (
                                  <tr key={`${rec.type}-${rec.name}-${i}`}>
                                    <td className="px-3 py-2 font-mono text-white/80">{rec.type}</td>
                                    <td className="px-3 py-2 font-mono text-white/90">{rec.name}</td>
                                    <td className="max-w-[240px] truncate px-3 py-2 font-mono text-white/65">
                                      <button
                                        type="button"
                                        onClick={() => {
                                          void navigator.clipboard.writeText(rec.value);
                                          toast.success("DNS value copied.");
                                        }}
                                        className="inline-flex items-center gap-1 hover:text-white"
                                        title="Copy record value"
                                      >
                                        <span className="truncate max-w-[200px]">{rec.value}</span>
                                        <Copy className="size-3 shrink-0" aria-hidden="true" />
                                      </button>
                                    </td>
                                    <td className="px-3 py-2 text-white/55">{rec.status}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : null}

          {tab === "emails" ? (
            <div className="space-y-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!testTo.trim()) return;
                  void postAction(
                    "send_test",
                    { action: "send_test_email", to: testTo.trim(), subject: testSubject, text: testBody },
                    `Test email sent to ${testTo.trim()}.`,
                  );
                }}
                className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3"
              >
                <h3 className="text-[13px] font-medium text-white">Send a test email</h3>
                <div className="grid gap-2.5 @[560px]:grid-cols-2">
                  <div>
                    <label htmlFor="test-email-to" className="mb-1 block text-[11.5px] text-white/60">
                      Recipient email
                    </label>
                    <input
                      id="test-email-to"
                      type="email"
                      required
                      value={testTo}
                      onChange={(e) => setTestTo(e.target.value)}
                      placeholder="you@example.com"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="test-email-subject" className="mb-1 block text-[11.5px] text-white/60">
                      Subject
                    </label>
                    <input
                      id="test-email-subject"
                      value={testSubject}
                      onChange={(e) => setTestSubject(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
                <textarea
                  rows={2}
                  aria-label="Test email message"
                  value={testBody}
                  onChange={(e) => setTestBody(e.target.value)}
                  className="w-full rounded-lg border border-white/[0.12] bg-[#111111] p-2.5 text-[12.5px] text-white outline-none focus-visible:border-white/35"
                />
                <div className="flex justify-end">
                  <button type="submit" disabled={!testTo.trim() || Boolean(busy)} className={btnPrimary}>
                    <Send className="size-3.5" aria-hidden="true" /> Send test
                  </button>
                </div>
              </form>

              {state.emails.length === 0 ? (
                <p className="rounded-lg border border-white/10 bg-white/[0.02] p-5 text-center text-[12.5px] text-white/45">
                  No recent emails recorded yet.
                </p>
              ) : (
                <ul className="divide-y divide-white/[0.06] rounded-lg border border-white/10 bg-white/[0.02]">
                  {state.emails.map((em) => (
                    <li key={em.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[12.5px]">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-white">{em.subject}</p>
                        <p className="mt-0.5 truncate text-[11.5px] tabular-nums text-white/45">
                          To: {(em.to ?? []).join(", ")} · {formatRelativeDate(em.created_at)}
                        </p>
                      </div>
                      {em.last_event ? (
                        <span className="rounded bg-white/[0.07] px-2 py-0.5 text-[11px] font-medium text-white/75">
                          {em.last_event}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {tab === "audiences" ? (
            <div className="space-y-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!audienceName.trim()) return;
                  void postAction(
                    "create_audience",
                    { action: "create_audience", name: audienceName.trim() },
                    `Audience "${audienceName.trim()}" created.`,
                  ).then((res) => res && setAudienceName(""));
                }}
                className="flex flex-wrap items-end gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-4"
              >
                <div className="min-w-52 flex-1">
                  <label htmlFor="audience-name" className="mb-1 block text-[12px] font-medium text-white/75">
                    Create audience
                  </label>
                  <input
                    id="audience-name"
                    value={audienceName}
                    onChange={(e) => setAudienceName(e.target.value)}
                    placeholder="Newsletter Subscribers"
                    className={inputClass}
                  />
                </div>
                <button type="submit" disabled={!audienceName.trim() || Boolean(busy)} className={btnPrimary}>
                  <Plus className="size-3.5" aria-hidden="true" /> Create
                </button>
              </form>

              {state.audiences.length > 0 ? (
                <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label htmlFor="select-audience" className="text-[12.5px] font-medium text-white">
                      Active Audience
                    </label>
                    <div className="flex items-center gap-2">
                      <select
                        id="select-audience"
                        value={selectedAudienceId}
                        onChange={(e) => {
                          setSelectedAudienceId(e.target.value);
                          void load(e.target.value);
                        }}
                        className={cn(inputClass, "w-52")}
                      >
                        {state.audiences.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                      {selectedAudienceId ? (
                        <button
                          type="button"
                          aria-label="Delete selected audience"
                          title="Delete selected audience"
                          onClick={() => {
                            if (window.confirm("Delete this audience and its contacts?")) {
                              void postAction("del_aud", { action: "delete_audience", audienceId: selectedAudienceId }, "Audience deleted.");
                            }
                          }}
                          className={iconBtn}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {selectedAudienceId ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!contactEmail.trim()) return;
                        void postAction(
                          "add_contact",
                          { action: "create_contact", audienceId: selectedAudienceId, email: contactEmail.trim() },
                          "Contact added.",
                        ).then((res) => res && setContactEmail(""));
                      }}
                      className="flex gap-2"
                    >
                      <label htmlFor="new-contact-email" className="sr-only">
                        Contact email
                      </label>
                      <input
                        id="new-contact-email"
                        type="email"
                        value={contactEmail}
                        onChange={(e) => setContactEmail(e.target.value)}
                        placeholder="subscriber@example.com"
                        className={inputClass}
                      />
                      <button type="submit" disabled={!contactEmail.trim() || Boolean(busy)} className={btnSecondary}>
                        Add contact
                      </button>
                    </form>
                  ) : null}

                  <ul className="divide-y divide-white/[0.06]">
                    {state.contacts.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-2 py-2 text-[12.5px]">
                        <div>
                          <span className="font-mono text-white">{c.email}</span>
                          {c.unsubscribed ? (
                            <span className="ml-2 text-[11px] text-amber-300">Unsubscribed</span>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          aria-label={`Remove contact ${c.email}`}
                          title={`Remove contact ${c.email}`}
                          onClick={() =>
                            void postAction(
                              `del-c-${c.id}`,
                              { action: "delete_contact", audienceId: selectedAudienceId, contactId: c.id },
                              "Contact removed.",
                            )
                          }
                          className={iconBtn}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "broadcasts" ? (
            <div className="space-y-4">
              {state.audiences.length === 0 ? (
                <p className="rounded-lg border border-white/10 bg-white/[0.02] p-5 text-center text-[12.5px] text-white/45">
                  Create an audience in the Audiences tab first before composing a broadcast.
                </p>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const audId = selectedAudienceId || state.audiences[0]?.id;
                    if (!audId || !broadcastSubject.trim() || !broadcastBody.trim()) return;
                    void postAction(
                      "create_bcast",
                      {
                        action: "create_broadcast",
                        audienceId: audId,
                        subject: broadcastSubject.trim(),
                        text: broadcastBody.trim(),
                      },
                      "Broadcast draft created.",
                    ).then((res) => {
                      if (res) {
                        setBroadcastSubject("");
                        setBroadcastBody("");
                      }
                    });
                  }}
                  className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3"
                >
                  <h3 className="text-[13px] font-medium text-white">Compose broadcast</h3>
                  <input
                    aria-label="Broadcast subject"
                    value={broadcastSubject}
                    onChange={(e) => setBroadcastSubject(e.target.value)}
                    placeholder="Product launch announcement"
                    className={inputClass}
                  />
                  <textarea
                    rows={3}
                    aria-label="Broadcast body"
                    value={broadcastBody}
                    onChange={(e) => setBroadcastBody(e.target.value)}
                    placeholder="Write your announcement…"
                    className="w-full rounded-lg border border-white/[0.12] bg-[#111111] p-2.5 text-[12.5px] text-white outline-none focus-visible:border-white/35"
                  />
                  <div className="flex justify-end">
                    <button type="submit" disabled={!broadcastSubject.trim() || !broadcastBody.trim() || Boolean(busy)} className={btnPrimary}>
                      Save draft
                    </button>
                  </div>
                </form>
              )}

              {state.broadcasts.length > 0 ? (
                <ul className="divide-y divide-white/[0.06] rounded-lg border border-white/10 bg-white/[0.02]">
                  {state.broadcasts.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[12.5px]">
                      <div>
                        <strong className="text-white">{b.subject || b.name || b.id}</strong>
                        <span className="ml-2 text-[11px] text-white/45">{b.status ?? "draft"}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {b.status !== "sent" ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm("Send this broadcast to the entire audience now?")) {
                                void postAction(`send-b-${b.id}`, { action: "send_broadcast", broadcastId: b.id }, "Broadcast sent.");
                              }
                            }}
                            className={btnPrimary}
                          >
                            Send now
                          </button>
                        ) : null}
                        <button
                          type="button"
                          aria-label={`Delete broadcast ${b.id}`}
                          title={`Delete broadcast ${b.id}`}
                          onClick={() =>
                            void postAction(`del-b-${b.id}`, { action: "delete_broadcast", broadcastId: b.id }, "Broadcast deleted.")
                          }
                          className={iconBtn}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {tab === "webhooks" ? (
            <div className="space-y-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!webhookUrl.trim()) return;
                  void postAction(
                    "create_wh",
                    {
                      action: "create_webhook",
                      endpoint: webhookUrl.trim(),
                      events: ["email.sent", "email.delivered", "email.bounced", "email.complained"],
                    },
                    "Webhook registered.",
                  ).then((res) => res && setWebhookUrl(""));
                }}
                className="flex flex-wrap items-end gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-4"
              >
                <div className="min-w-60 flex-1">
                  <label htmlFor="webhook-endpoint" className="mb-1 block text-[12px] font-medium text-white/75">
                    Webhook HTTPS endpoint
                  </label>
                  <input
                    id="webhook-endpoint"
                    type="url"
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="https://my-app.cognix.app/api/webhooks/email"
                    className={cn(inputClass, "font-mono")}
                  />
                </div>
                <button type="submit" disabled={!webhookUrl.trim() || Boolean(busy)} className={btnPrimary}>
                  <Plus className="size-3.5" aria-hidden="true" /> Add webhook
                </button>
              </form>

              {state.webhooks.length === 0 ? (
                <p className="rounded-lg border border-white/10 bg-white/[0.02] p-5 text-center text-[12.5px] text-white/45">
                  No email webhooks configured yet.
                </p>
              ) : (
                <ul className="divide-y divide-white/[0.06] rounded-lg border border-white/10 bg-white/[0.02]">
                  {state.webhooks.map((wh) => (
                    <li key={wh.id} className="flex items-center justify-between gap-2 px-4 py-3 text-[12.5px]">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-white">{wh.endpoint}</p>
                        <p className="mt-0.5 text-[11px] text-white/45">{(wh.events ?? []).join(", ")}</p>
                      </div>
                      <button
                        type="button"
                        aria-label={`Delete webhook ${wh.endpoint}`}
                        title={`Delete webhook ${wh.endpoint}`}
                        onClick={() =>
                          void postAction(`del-wh-${wh.id}`, { action: "delete_webhook", webhookId: wh.id }, "Webhook removed.")
                        }
                        className={iconBtn}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
