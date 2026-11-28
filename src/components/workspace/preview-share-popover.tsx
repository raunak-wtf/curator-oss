"use client";

import {
  Check,
  Clock,
  Copy,
  Globe2,
  KeyRound,
  Lock,
  MailPlus,
  Rocket,
  Share2,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { PreviewAccessState } from "@/lib/types";
import { cn } from "@/lib/utils";

type PreviewSharePopoverProps = {
  projectId: string;
  previewUrl: string | null;
  isPublished: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenPublish: () => void;
};

function formatTimeRemaining(expiresAt: string | null): string | null {
  if (!expiresAt) return null;
  const diffMs = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return "Expired";
  const hours = Math.floor(diffMs / 3_600_000);
  const mins = Math.floor((diffMs % 3_600_000) / 60_000);
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours > 0 ? `${days}d ${remHours}h left` : `${days}d left`;
  }
  if (hours > 0) return `${hours}h ${mins}m left`;
  return `${Math.max(1, mins)}m left`;
}

function buildShareHref(previewUrl: string | null, shareKey: string): string {
  if (!previewUrl) return `/auth?key=${encodeURIComponent(shareKey)}`;
  try {
    const url = new URL(previewUrl);
    url.pathname = "/auth";
    url.search = `?key=${encodeURIComponent(shareKey)}`;
    url.hash = "";
    return url.toString();
  } catch {
    return `${previewUrl.replace(/\/+$/, "")}/auth?key=${encodeURIComponent(shareKey)}`;
  }
}

export function PreviewSharePopover({
  projectId,
  previewUrl,
  isPublished,
  open,
  onOpenChange,
  onOpenPublish,
}: PreviewSharePopoverProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [access, setAccess] = useState<PreviewAccessState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const loading = open && !access && !loadFailed;
  const [section, setSection] = useState<"public" | "private">("public");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteExpiryHours, setInviteExpiryHours] = useState<string>("24");
  const [passcodeInput, setPasscodeInput] = useState("");
  const [showPasscodeBox, setShowPasscodeBox] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/preview/access`, { cache: "no-store" });
        const payload = await res.json();
        if (!cancelled && res.ok && payload.access) {
          setAccess(payload.access as PreviewAccessState);
          setLoadFailed(false);
        } else if (!cancelled && !res.ok) {
          setLoadFailed(true);
        }
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onOpenChange(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onOpenChange(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onOpenChange, open]);

  async function copyText(text: string, id: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(id);
      toast.success(label);
      window.setTimeout(() => setCopiedKey((cur) => (cur === id ? null : cur)), 1800);
    } catch {
      toast.error("Could not copy to clipboard.");
    }
  }

  async function togglePublicPreview(enable: boolean, hours = 24) {
    if (saving) return;
    setSaving(true);
    try {
      const nextMode = enable ? "public" : access && access.shares.length > 0 ? "private" : "owner";
      const res = await fetch(`/api/projects/${projectId}/preview/access`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: nextMode,
          ...(enable ? { publicDurationHours: hours } : { passcode: null }),
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Could not update preview access.");
      setAccess(payload.access as PreviewAccessState);
      toast.success(
        enable
          ? `Preview is public for ${hours} hours.`
          : "Public preview disabled. Only authorized users can view it.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update preview access.");
    } finally {
      setSaving(false);
    }
  }

  async function savePasscode(passcode: string | null) {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/preview/access`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Could not update passcode.");
      setAccess(payload.access as PreviewAccessState);
      setPasscodeInput("");
      setShowPasscodeBox(false);
      toast.success(passcode ? "Preview passcode enabled." : "Preview passcode removed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update passcode.");
    } finally {
      setSaving(false);
    }
  }

  async function addPrivateInvite(e: React.FormEvent) {
    e.preventDefault();
    const clean = inviteEmail.trim();
    if (!clean || saving) return;
    setSaving(true);
    try {
      const hours = inviteExpiryHours === "never" ? null : Number(inviteExpiryHours);
      const res = await fetch(`/api/projects/${projectId}/preview/access`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: clean,
          expiresInHours: hours,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Could not create private invite.");
      setAccess(payload.access as PreviewAccessState);
      setInviteEmail("");
      const link = typeof payload.shareUrl === "string"
        ? payload.shareUrl
        : buildShareHref(previewUrl, payload.share.shareKey);
      await copyText(link, payload.share.id, `Invite link copied for ${clean}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create private invite.");
    } finally {
      setSaving(false);
    }
  }

  async function revokeInvite(shareId: string, email: string) {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/projects/${projectId}/preview/access?shareId=${encodeURIComponent(shareId)}`,
        { method: "DELETE" },
      );
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Could not revoke invite.");
      setAccess(payload.access as PreviewAccessState);
      toast.success(`Revoked preview access for ${email}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not revoke invite.");
    } finally {
      setSaving(false);
    }
  }

  async function lockToOwnerOnly() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/preview/access`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revokeAll: true }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Could not reset preview access.");
      setAccess(payload.access as PreviewAccessState);
      toast.success("Preview locked to owner only. All guest links revoked.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reset preview access.");
    } finally {
      setSaving(false);
    }
  }

  const publicActive = Boolean(access?.publicActive);
  const shareCount = access?.shares.length ?? 0;
  const remainingLabel = formatTimeRemaining(access?.publicExpiresAt ?? null);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={!previewUrl}
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Share preview and manage access"
        title={previewUrl ? "Share preview & manage access" : "Build the app to share the preview"}
        className={cn(
          "visual-edit-button gap-1.5 px-2.5",
          open && "is-active",
          publicActive && !open && "border-emerald-500/35 bg-emerald-500/10 text-emerald-200 hover:border-emerald-400/50",
          !publicActive && shareCount > 0 && !open && "border-indigo-400/35 bg-indigo-500/10 text-indigo-200",
        )}
      >
        {publicActive ? (
          <Globe2 className="size-3.5" aria-hidden="true" />
        ) : shareCount > 0 ? (
          <Users className="size-3.5" aria-hidden="true" />
        ) : (
          <Share2 className="size-3.5" aria-hidden="true" />
        )}
        <span className="hidden sm:inline text-[11px] font-medium">Share</span>
        {publicActive ? (
          <span className="hidden md:inline rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9.5px] font-semibold text-emerald-200 leading-none">
            24h
          </span>
        ) : shareCount > 0 ? (
          <span className="rounded-full bg-indigo-500/25 px-1.5 py-0.5 text-[9.5px] font-semibold text-indigo-100 tabular-nums leading-none">
            {shareCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Preview access and sharing"
          className="absolute right-0 top-full z-50 mt-2 w-[360px] max-w-[calc(100vw-24px)] rounded-xl border border-white/[0.12] bg-[#1e1e1e] p-3.5 text-white shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="size-4 text-indigo-300" aria-hidden="true" />
                <h3 className="text-[13px] font-semibold text-white">Preview access</h3>
              </div>
              <p className="mt-0.5 text-[11px] text-white/50">
                {publicActive
                  ? `Public preview active (${remainingLabel ?? "24h limit"}).`
                  : shareCount > 0
                    ? `Private — only you and ${shareCount} invited ${shareCount === 1 ? "person" : "people"}.`
                    : "Owner only — nobody else can view this preview."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="grid size-7 place-items-center rounded-md text-white/50 hover:bg-white/[0.08] hover:text-white"
              aria-label="Close share menu"
            >
              <X className="size-3.5" />
            </button>
          </div>

          {/* Mode Tabs */}
          <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-white/[0.05] p-0.5 text-[11.5px]">
            <button
              type="button"
              onClick={() => setSection("public")}
              className={cn(
                "flex h-7 items-center justify-center gap-1.5 rounded-md font-medium transition-colors",
                section === "public" ? "bg-white/[0.12] text-white" : "text-white/55 hover:text-white",
              )}
            >
              <Globe2 className="size-3.5" aria-hidden="true" />
              Public (24h)
            </button>
            <button
              type="button"
              onClick={() => setSection("private")}
              className={cn(
                "flex h-7 items-center justify-center gap-1.5 rounded-md font-medium transition-colors",
                section === "private" ? "bg-white/[0.12] text-white" : "text-white/55 hover:text-white",
              )}
            >
              <Lock className="size-3.5" aria-hidden="true" />
              Private Access
              {shareCount > 0 ? (
                <span className="rounded-full bg-white/[0.14] px-1.5 text-[10px] tabular-nums">{shareCount}</span>
              ) : null}
            </button>
          </div>

          {loading && !access ? (
            <p className="py-6 text-center text-[12px] text-white/50">Loading access settings…</p>
          ) : section === "public" ? (
            <div className="mt-3 space-y-3">
              {/* Public 24h Toggle */}
              <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.08] bg-[#161616] p-3">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-white">Make preview public</p>
                  <p className="mt-0.5 text-[11px] text-white/50">
                    Anyone with the link can view for 24 hours.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={publicActive}
                  disabled={saving}
                  onClick={() => void togglePublicPreview(!publicActive, 24)}
                  className={cn(
                    "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
                    publicActive ? "bg-emerald-500" : "bg-white/[0.16]",
                  )}
                >
                  <span
                    className={cn(
                      "inline-block size-4 rounded-full bg-white transition-transform",
                      publicActive ? "translate-x-6" : "translate-x-1",
                    )}
                  />
                </button>
              </div>

              {publicActive && previewUrl ? (
                <div className="space-y-2.5 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] p-3">
                  <div className="flex items-center justify-between text-[11px] text-emerald-200">
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Clock className="size-3" aria-hidden="true" />
                      {remainingLabel ?? "24h limit"}
                    </span>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void togglePublicPreview(true, 24)}
                      className="font-medium text-emerald-100 underline decoration-emerald-300/40 underline-offset-2 hover:text-white"
                    >
                      Reset 24h timer
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      readOnly
                      value={previewUrl}
                      aria-label="Public preview URL"
                      className="h-8 min-w-0 flex-1 rounded-md border border-white/10 bg-[#141414] px-2 font-mono text-[11px] text-white/85 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void copyText(previewUrl, "public", "Public preview link copied.")}
                      className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-white px-2.5 text-[11px] font-semibold text-black hover:bg-white/90"
                    >
                      {copiedKey === "public" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                      Copy
                    </button>
                  </div>

                  {/* Optional Passcode Protection */}
                  <div className="border-t border-white/[0.08] pt-2">
                    {access?.hasPasscode && !showPasscodeBox ? (
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="inline-flex items-center gap-1.5 text-white/80">
                          <KeyRound className="size-3 text-indigo-300" aria-hidden="true" />
                          Passcode lock enabled
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setShowPasscodeBox(true)}
                            className="text-white/70 hover:text-white"
                          >
                            Change
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void savePasscode(null)}
                            className="text-rose-300 hover:text-rose-200"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ) : showPasscodeBox ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="password"
                          value={passcodeInput}
                          onChange={(e) => setPasscodeInput(e.target.value)}
                          placeholder="Set a passcode…"
                          aria-label="Preview passcode"
                          className="h-8 min-w-0 flex-1 rounded-md border border-white/15 bg-[#141414] px-2 text-[12px] text-white outline-none focus:border-white/30"
                        />
                        <button
                          type="button"
                          disabled={saving || !passcodeInput.trim()}
                          onClick={() => void savePasscode(passcodeInput.trim())}
                          className="h-8 rounded-md bg-white/15 px-2.5 text-[11px] font-medium text-white hover:bg-white/25 disabled:opacity-40"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowPasscodeBox(false);
                            setPasscodeInput("");
                          }}
                          className="h-8 rounded-md px-1.5 text-[11px] text-white/55 hover:text-white"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowPasscodeBox(true)}
                        className="inline-flex items-center gap-1.5 text-[11px] text-white/65 hover:text-white"
                      >
                        <KeyRound className="size-3" aria-hidden="true" />
                        Add optional passcode protection
                      </button>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {/* Invite by Email Form */}
              <form onSubmit={(e) => void addPrivateInvite(e)} className="space-y-2 rounded-lg border border-white/[0.08] bg-[#161616] p-3">
                <label className="block text-[11.5px] font-medium text-white/85">
                  Share privately with an email
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="teammate@company.com"
                    aria-label="Recipient email address"
                    className="h-8 min-w-0 flex-1 rounded-md border border-white/15 bg-[#121212] px-2.5 text-[12px] text-white placeholder:text-white/35 outline-none focus:border-white/30"
                  />
                  <select
                    aria-label="Invite expiry"
                    value={inviteExpiryHours}
                    onChange={(e) => setInviteExpiryHours(e.target.value)}
                    className="h-8 rounded-md border border-white/15 bg-[#121212] px-1.5 text-[11px] text-white/85 outline-none"
                  >
                    <option value="24">24h</option>
                    <option value="168">7d</option>
                    <option value="never">No expiry</option>
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={saving || !inviteEmail.trim()}
                  className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-white text-[12px] font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-45"
                >
                  <MailPlus className="size-3.5" aria-hidden="true" />
                  {saving ? "Generating link…" : "Add email & copy /auth link"}
                </button>
                <p className="text-[10.5px] leading-relaxed text-white/45">
                  Generates a unique <code className="text-white/70">/auth?key=…</code> link. They must sign in to Curator with this exact email.
                </p>
              </form>

              {/* Active Private Invites List */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-white/50">
                  <span>Invited reviewers ({shareCount})</span>
                  {shareCount > 0 ? (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void lockToOwnerOnly()}
                      className="text-rose-300/85 hover:text-rose-200"
                    >
                      Revoke all
                    </button>
                  ) : null}
                </div>

                {shareCount === 0 ? (
                  <p className="rounded-lg border border-dashed border-white/[0.08] py-3 text-center text-[11px] text-white/40">
                    No private invites yet. Only you can view this preview.
                  </p>
                ) : (
                  <ul className="max-h-44 space-y-1.5 overflow-y-auto pr-0.5">
                    {access?.shares.map((share) => {
                      const shareUrl = buildShareHref(previewUrl, share.shareKey);
                      const expLabel = formatTimeRemaining(share.expiresAt);
                      return (
                        <li
                          key={share.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.08] bg-[#161616] px-2.5 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-medium text-white">{share.email}</p>
                            <p className="text-[10px] text-white/45 tabular-nums">
                              {share.accessCount} {share.accessCount === 1 ? "view" : "views"}
                              {expLabel ? ` · ${expLabel}` : " · No expiry"}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => void copyText(shareUrl, share.id, `Copied private link for ${share.email}`)}
                              className="inline-flex h-7 items-center gap-1 rounded-md border border-white/10 bg-white/[0.05] px-2 text-[10.5px] font-medium text-white/85 hover:bg-white/[0.1]"
                              title="Copy /auth?key=… link"
                            >
                              {copiedKey === share.id ? <Check className="size-3 text-emerald-300" /> : <Copy className="size-3" />}
                              Copy
                            </button>
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => void revokeInvite(share.id, share.email)}
                              className="grid size-7 place-items-center rounded-md text-white/45 hover:bg-rose-500/15 hover:text-rose-300"
                              title={`Revoke ${share.email}`}
                              aria-label={`Revoke access for ${share.email}`}
                            >
                              <Trash2 className="size-3" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* Footer: Always-on requires Publish */}
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/[0.08] pt-2.5 text-[11px] text-white/50">
            <span className="leading-snug">
              Preview turns off when you close Curator. {isPublished ? "Your published site stays live." : "Publish to keep it running."}
            </span>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onOpenPublish();
              }}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-white/15 bg-white/[0.06] px-2.5 text-[11px] font-medium text-white hover:bg-white/[0.12]"
            >
              <Rocket className="size-3" aria-hidden="true" />
              {isPublished ? "Manage" : "Publish"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
