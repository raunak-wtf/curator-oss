"use client";

import { ChevronDown, CreditCard, LogIn, LogOut, PanelLeft, Plus, Search, Shield, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { RemixDialog } from "@/components/remix-dialog";
import { DeleteChatDialog, SidebarChatRow } from "@/components/sidebar-chat-row";
import { UserAvatar } from "@/components/user-avatar";
import { LOW_CREDITS_THRESHOLD_HUNDREDTHS, PRO_MONTHLY_CREDITS_HUNDREDTHS, formatCredits } from "@/lib/credits";
import type { Project, SubscriptionStatus, Viewer } from "@/lib/types";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "cognix:sidebar";
const DESKTOP_QUERY = "(min-width: 48rem)";

// Desktop expanded/collapsed preference, persisted in localStorage and shared across tabs.
// `null` means the person has not chosen yet, so each page can use its own default.
const listeners = new Set<() => void>();
let memoryOpen: boolean | null = null;

function readOpen(fallback: boolean) {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === null ? (memoryOpen ?? fallback) : stored !== "collapsed";
  } catch {
    return memoryOpen ?? fallback;
  }
}

function writeOpen(open: boolean) {
  memoryOpen = open;
  try {
    window.localStorage.setItem(STORAGE_KEY, open ? "expanded" : "collapsed");
  } catch {
    // Storage can be unavailable (private mode); the in-memory value still applies.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

const iconButton =
  "flex size-8 shrink-0 items-center justify-center rounded-lg text-white/55 transition-colors hover:bg-white/[0.07] hover:text-white [@media(pointer:coarse)]:size-11";

const navRow =
  "flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors [@media(pointer:coarse)]:h-11";

export type SidebarBillingBadge = {
  status: SubscriptionStatus;
  hasActiveAccess: boolean;
  creditsBalanceHundredths: number;
  monthlyCreditsHundredths: number;
};

type HomeSidebarProps = {
  viewer: Viewer | null;
  projects: Project[];
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
  onNewChat: () => void;
  /** Expanded state used until the person opens or closes the sidebar themselves. */
  defaultOpen?: boolean;
  /** The project open on this page, highlighted in the list. */
  activeProjectId?: string;
  /** Compact credit / plan indicator shown at the bottom of the sidebar. */
  billing?: SidebarBillingBadge | null;
};

export function HomeSidebar({
  viewer,
  projects,
  mobileOpen,
  onMobileOpenChange,
  onNewChat,
  defaultOpen = true,
  activeProjectId,
  billing = null,
}: HomeSidebarProps) {
  const router = useRouter();
  const open = useSyncExternalStore(subscribe, () => readOpen(defaultOpen), () => defaultOpen);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  // Optimistic edits shown until the refreshed server list catches up.
  const [renamed, setRenamed] = useState<Record<string, string>>({});
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);
  const [remixing, setRemixing] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const accountRef = useRef<HTMLDetailsElement>(null);
  const collapseRef = useRef<HTMLButtonElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const chats = useMemo(
    () =>
      projects
        .filter((project) => !removed.has(project.id))
        .map((project) => (renamed[project.id] ? { ...project, title: renamed[project.id] } : project)),
    [projects, removed, renamed],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? chats.filter((project) => project.title.toLowerCase().includes(needle)) : chats;
  }, [chats, query]);

  async function renameChat(project: Project, title: string) {
    setRenamed((current) => ({ ...current, [project.id]: title }));
    try {
      const response = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Could not rename the chat.");
      }
      router.refresh();
    } catch (error) {
      setRenamed((current) => {
        const next = { ...current };
        delete next[project.id];
        return next;
      });
      const message = error instanceof Error ? error.message : "Could not rename the chat.";
      toast.error(`${message} Open the menu and rename it again.`);
    }
  }

  function requestDelete(project: Project) {
    setDeleteError(null);
    setPendingDelete(project);
  }

  function cancelDelete() {
    if (deleting) return;
    setPendingDelete(null);
    setDeleteError(null);
  }

  async function confirmDelete() {
    const project = pendingDelete;
    if (!project || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      // A 404 means it is already gone, which is the outcome the user asked for.
      if (!response.ok && response.status !== 404) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? "Could not delete the chat. Try again.");
      }
      setRemoved((current) => new Set(current).add(project.id));
      setPendingDelete(null);
      toast.success(`Deleted “${project.title}”.`);
      // The page for a deleted project no longer exists, so leave it.
      if (project.id === activeProjectId) router.push("/");
      else router.refresh();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Could not delete the chat. Try again.");
    } finally {
      setDeleting(false);
    }
  }

  useEffect(() => {
    if (mobileOpen) collapseRef.current?.focus();
  }, [mobileOpen]);

  useEffect(() => {
    function closeAccountMenu(event: PointerEvent) {
      const menu = accountRef.current;
      if (menu?.open && !menu.contains(event.target as Node)) menu.open = false;
    }
    document.addEventListener("pointerdown", closeAccountMenu);
    return () => document.removeEventListener("pointerdown", closeAccountMenu);
  }, []);

  function isDesktop() {
    return window.matchMedia(DESKTOP_QUERY).matches;
  }

  function closePanel() {
    if (isDesktop()) {
      writeOpen(false);
      requestAnimationFrame(() => expandRef.current?.focus());
    } else {
      onMobileOpenChange(false);
    }
  }

  function expand(withSearch = false) {
    if (withSearch) setSearching(true);
    writeOpen(true);
    requestAnimationFrame(() => (withSearch ? searchRef.current : collapseRef.current)?.focus());
  }

  function toggleSearch() {
    if (searching) {
      closeSearch();
      return;
    }
    setSearching(true);
    requestAnimationFrame(() => searchRef.current?.focus());
  }

  function startNewChat() {
    onMobileOpenChange(false);
    onNewChat();
  }

  function closeSearch() {
    setSearching(false);
    setQuery("");
  }

  return (
    <>
      {/* Collapsed desktop rail */}
      <nav
        aria-label="Sidebar"
        className={cn(
          "relative z-20 hidden w-12 shrink-0 flex-col items-center justify-between border-r border-white/[0.06] bg-[#1c1c1c] py-3",
          !open && "md:flex",
        )}
      >
        <div className="flex flex-col items-center gap-1">
          <button
            ref={expandRef}
            type="button"
            onClick={() => expand()}
            className={cn(iconButton, "mb-2")}
            title="Open sidebar"
            aria-label="Open sidebar"
          >
            <Image src="/cognix-logo-192.png" alt="" width={20} height={20} className="size-5 rounded object-contain" />
          </button>
          <button type="button" onClick={startNewChat} className={iconButton} title="New chat" aria-label="New chat">
            <Plus className="size-4" />
          </button>
          <button type="button" onClick={() => expand(true)} className={iconButton} title="Search chats" aria-label="Search chats">
            <Search className="size-4" />
          </button>
        </div>
        {viewer ? (
          <button type="button" onClick={() => expand()} className={iconButton} title={viewer.name} aria-label={`Open sidebar for ${viewer.name}`}>
            <UserAvatar viewer={viewer} className="size-7 rounded-full" />
          </button>
        ) : (
          <a href="/auth/login" className={iconButton} title="Sign in" aria-label="Sign in">
            <LogIn className="size-4" />
          </a>
        )}
      </nav>

      {/* Mobile backdrop */}
      {mobileOpen ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Close sidebar"
          onClick={() => onMobileOpenChange(false)}
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
        />
      ) : null}

      {/* Expanded panel: static on desktop, drawer on mobile */}
      <aside
        aria-label="Sidebar"
        onKeyDown={(event) => {
          if (event.key === "Escape" && mobileOpen) onMobileOpenChange(false);
        }}
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[272px] shrink-0 flex-col border-r border-white/[0.06] bg-[#1c1c1c] transition-[transform,visibility] duration-200 ease-out motion-reduce:transition-none",
          "md:static md:z-20 md:w-[232px] md:translate-x-0 md:visible",
          mobileOpen ? "max-md:visible max-md:translate-x-0" : "max-md:invisible max-md:-translate-x-full",
          !open && "md:hidden",
        )}
      >
        <div className="flex h-12 shrink-0 items-center gap-1 px-2 pt-1">
          {viewer ? (
            <details
              ref={accountRef}
              className="relative min-w-0 flex-1"
              onKeyDown={(event) => {
                if (event.key === "Escape" && accountRef.current?.open) {
                  event.stopPropagation();
                  accountRef.current.open = false;
                  accountRef.current.querySelector("summary")?.focus();
                }
              }}
            >
              <summary className="flex h-8 cursor-pointer list-none items-center gap-2 rounded-lg px-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-white/[0.07] [@media(pointer:coarse)]:h-11 [&::-webkit-details-marker]:hidden">
                <UserAvatar viewer={viewer} className="size-6 rounded-full" />
                <span className="truncate">{viewer.name}</span>
                <ChevronDown className="size-3.5 shrink-0 text-white/40" aria-hidden="true" />
              </summary>
              <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-xl border border-white/10 bg-[#252525] p-1.5 shadow-2xl">
                <p className="truncate px-2 py-1.5 text-[12px] text-white/45">{viewer.email}</p>
                {billing ? (() => {
                  const monthly = Math.max(1, billing.monthlyCreditsHundredths || PRO_MONTHLY_CREDITS_HUNDREDTHS);
                  const pct = Math.min(100, Math.round((billing.creditsBalanceHundredths / monthly) * 100));
                  const isEmpty = billing.creditsBalanceHundredths <= 0;
                  const isLow = billing.creditsBalanceHundredths < LOW_CREDITS_THRESHOLD_HUNDREDTHS;
                  return (
                    <Link
                      href="/billing"
                      className="mx-1 mb-1.5 block rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-2 transition-colors hover:bg-white/[0.07]"
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-medium text-white/85">
                          {billing.status === "active" ? "Curator Pro" : "Credits"}
                        </span>
                        <span
                          className={cn(
                            "font-semibold tabular-nums",
                            isEmpty ? "text-red-300" : isLow ? "text-amber-300" : "text-white",
                          )}
                        >
                          {formatCredits(billing.creditsBalanceHundredths)} / {formatCredits(monthly)}
                        </span>
                      </div>
                      <div
                        className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.09]"
                        role="progressbar"
                        aria-valuenow={pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label="Remaining credits"
                      >
                        <div
                          className={cn(
                            "h-full w-full origin-left rounded-full transition-transform duration-300 motion-reduce:transition-none",
                            isEmpty ? "bg-red-400" : isLow ? "bg-amber-400" : "bg-indigo-400",
                          )}
                          style={{ transform: `scaleX(${pct / 100})` }}
                        />
                      </div>
                      {isLow ? (
                        <p className={cn("mt-1 text-[10px]", isEmpty ? "text-red-300/90" : "text-amber-300/90")}>
                          {isEmpty
                            ? billing.status === "active"
                              ? "No credits left this cycle"
                              : "Subscribe for 90 monthly credits"
                            : "Running low on credits"}
                        </p>
                      ) : null}
                    </Link>
                  );
                })() : null}
                <Link href="/billing" className={cn(navRow, "text-white/80 hover:bg-white/[0.07] hover:text-white")}>
                  <CreditCard className="size-4" aria-hidden="true" />
                  Billing &amp; credits
                </Link>
                {viewer.isAdmin ? (
                  <Link href="/admin" className={cn(navRow, "text-indigo-200 hover:bg-indigo-500/15 hover:text-white")}>
                    <Shield className="size-4" aria-hidden="true" />
                    Admin panel
                  </Link>
                ) : null}
                <a href="/auth/logout" className={cn(navRow, "text-white/80 hover:bg-white/[0.07] hover:text-white")}>
                  <LogOut className="size-4" aria-hidden="true" />
                  Sign out
                </a>
              </div>
            </details>
          ) : (
            <Link href="/" className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 text-[14px] font-semibold text-white" aria-label="Cognix home">
              <Image src="/cognix-logo-192.png" alt="" width={20} height={20} className="size-5 rounded object-contain" />
              Cognix
            </Link>
          )}
          <button
            type="button"
            onClick={toggleSearch}
            className={cn(iconButton, searching && "bg-white/[0.07] text-white")}
            title="Search chats"
            aria-label="Search chats"
            aria-pressed={searching}
          >
            <Search className="size-4" />
          </button>
          <button ref={collapseRef} type="button" onClick={closePanel} className={iconButton} title="Close sidebar" aria-label="Close sidebar">
            <PanelLeft className="size-4" />
          </button>
        </div>

        <div className="px-2 pt-1.5">
          <button type="button" onClick={startNewChat} className={cn(navRow, "bg-white/[0.06] text-white hover:bg-white/[0.09]")}>
            <Plus className="size-4" aria-hidden="true" />
            New chat
          </button>
        </div>

        {searching ? (
          <div className="relative px-2 pt-2">
            <Search className="pointer-events-none absolute left-4.5 top-1/2 mt-1 size-3.5 -translate-y-1/2 text-white/35" aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  closeSearch();
                }
              }}
              placeholder="Search chats…"
              aria-label="Search chats"
              className="h-8 w-full rounded-lg border border-white/10 bg-white/[0.04] pl-8 pr-2.5 text-[13px] text-white placeholder:text-white/35 outline-none focus:border-white/25 [@media(pointer:coarse)]:h-11"
            />
          </div>
        ) : null}

        <div className="mt-5 flex min-h-0 flex-1 flex-col">
          <h2 className="px-4 pb-1.5 text-[12px] font-medium text-white/45">Chats</h2>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {!viewer ? (
              <div className="px-2.5 py-2 text-[12px] leading-5 text-white/45">
                <p>Sign in to see your chats.</p>
                <a href="/auth/login" className="mt-1 inline-flex font-medium text-white/80 hover:text-white">
                  Sign in
                </a>
              </div>
            ) : chats.length === 0 ? (
              <div className="px-2.5 py-2 text-[12px] leading-5 text-white/45">
                <p>No chats yet. Describe an app to start one.</p>
                <button type="button" onClick={startNewChat} className="mt-1 font-medium text-white/80 hover:text-white">
                  Start a chat
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-2.5 py-2 text-[12px] leading-5 text-white/45">
                <p className="break-words">No chats match “{query.trim()}”.</p>
                <button type="button" onClick={closeSearch} className="mt-1 font-medium text-white/80 hover:text-white">
                  Clear search
                </button>
              </div>
            ) : (
              <ul className="space-y-0.5">
                {filtered.map((project) => (
                  <SidebarChatRow
                    key={project.id}
                    project={project}
                    active={project.id === activeProjectId}
                    onRename={renameChat}
                    onDelete={requestDelete}
                    onRemix={setRemixing}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>

        {viewer ? (
          <div className="shrink-0 space-y-1 border-t border-white/[0.06] p-2">
            <Link
              href="/billing"
              className="block rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-2 transition-colors hover:bg-white/[0.07]"
            >
              <div className="flex items-center justify-between gap-2 text-[12px]">
                <span className="flex items-center gap-1.5 font-medium text-white">
                  <Sparkles className="size-3.5 text-indigo-300" aria-hidden="true" />
                  {billing?.status === "active"
                    ? "Curator Pro"
                    : viewer.isAdmin
                      ? "Admin access"
                      : "Subscribe · $10/mo"}
                </span>
                {billing ? (
                  <span
                    className={cn(
                      "text-[11px] font-medium tabular-nums",
                      billing.creditsBalanceHundredths < LOW_CREDITS_THRESHOLD_HUNDREDTHS
                        ? "text-amber-300"
                        : "text-white/60",
                    )}
                  >
                    {formatCredits(billing.creditsBalanceHundredths)} cr
                  </span>
                ) : null}
              </div>
              {billing && billing.status === "active" ? (
                <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/[0.08]">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      billing.creditsBalanceHundredths <= 0
                        ? "bg-red-400"
                        : billing.creditsBalanceHundredths < LOW_CREDITS_THRESHOLD_HUNDREDTHS
                          ? "bg-amber-400"
                          : "bg-indigo-400",
                    )}
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          (billing.creditsBalanceHundredths / Math.max(1, billing.monthlyCreditsHundredths)) * 100,
                        ),
                      )}%`,
                    }}
                  />
                </div>
              ) : (
                <p className="mt-0.5 text-[11px] text-white/45">
                  {viewer.isAdmin ? "Manage billing & usage" : "90 monthly credits · No free tier"}
                </p>
              )}
            </Link>
            {viewer.isAdmin ? (
              <Link
                href="/admin"
                className={cn(navRow, "text-indigo-200/90 hover:bg-indigo-500/15 hover:text-white")}
              >
                <Shield className="size-3.5" aria-hidden="true" />
                Admin panel
              </Link>
            ) : null}
          </div>
        ) : null}
      </aside>

      {remixing ? (
        <RemixDialog
          key={remixing.id}
          open
          projectId={remixing.id}
          projectTitle={remixing.title}
          canIncludeHistory
          onClose={() => setRemixing(null)}
        />
      ) : null}
      <DeleteChatDialog
        project={pendingDelete}
        deleting={deleting}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={cancelDelete}
      />
    </>
  );
}

export function SidebarMobileTrigger({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={cn(iconButton, "md:hidden")} title="Open sidebar" aria-label="Open sidebar">
      <PanelLeft className="size-4" />
    </button>
  );
}
