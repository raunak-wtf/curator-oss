"use client";

import { Check, ChevronDown, Copy, ExternalLink, GitBranch, GitCommitHorizontal, Plus, RefreshCw, Unlink } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { PixelLoader } from "@/components/pixel-loader";
import { isValidBranchName } from "@/lib/github/names";
import type { GitSyncStatus, ProjectRepositoryView } from "@/lib/types";
import { cn, formatRelativeDate } from "@/lib/utils";
import { fetchShared, isFresh, readGitCache, useGitCache, writeGitCache } from "./git-cache";

type ApiError = Error & { code?: string };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined });
  } catch {
    throw Object.assign(new Error("Cognix couldn't reach the server. Check your connection and try again."), { code: "network" });
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error ?? "Something went wrong. Try again."), { code: payload.code as string | undefined });
  return payload as T;
}

const button =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 [@media(pointer:coarse)]:h-11";
const secondary = `${button} border border-white/10 text-white/80 hover:bg-white/[0.06] hover:text-white`;
const primary = `${button} bg-white font-semibold text-black hover:bg-white/85`;
const input =
  "h-9 w-full rounded-lg border border-white/[0.12] bg-[#101010] px-3 text-[13px] text-white outline-none placeholder:text-white/30 focus:border-white/35 [@media(pointer:coarse)]:h-11";

const STATE_COPY: Record<GitSyncStatus["state"], { label: string; dot: string; detail: (status: GitSyncStatus) => string }> = {
  in_sync: { label: "In sync", dot: "bg-emerald-400", detail: () => "Cognix and GitHub are on the same commit." },
  local_ahead: {
    label: "Waiting to push",
    dot: "bg-sky-400",
    detail: (status) =>
      `${status.localChanges} ${status.localChanges === 1 ? "file" : "files"} saved as checkpoints in Cognix but not on GitHub yet. Cognix pushes them automatically.`,
  },
  remote_ahead: {
    label: "GitHub has new commits",
    dot: "bg-sky-400",
    detail: (status) => `${status.remoteCommits || "New"} ${status.remoteCommits === 1 ? "commit" : "commits"} on ${status.branch} that Cognix doesn't have yet. They sync automatically before the next build.`,
  },
  diverged: {
    label: "Cognix and GitHub have diverged",
    dot: "bg-amber-400",
    detail: (status) =>
      `Both changed ${status.branch} since the last sync. Cognix left ${status.branch} as is and pushed its work to cognix-sync. Merge it with a pull request, or use GitHub's version.`,
  },
};

type Busy = null | "check" | "pull" | "replace" | "push";

export type GitSyncInfo = { state: GitSyncStatus["state"] | null; head: string | null; lastPushedAt: string | null };

/** Sync status, branch picker, and clone URLs for a linked repository. Only the agent changes code and pushes. */
export function LinkedRepository({
  projectId,
  repository,
  canCommit,
  refreshKey,
  commitsAs,
  onChange,
  onReconnect,
  onFilesChanged,
  onSync,
  renderAppAccess,
}: {
  projectId: string;
  repository: ProjectRepositoryView;
  canCommit: boolean;
  refreshKey: number;
  /** Who GitHub shows as the commit author. */
  commitsAs: { kind: "bot" | "user"; name: string | null };
  onChange: (repository: ProjectRepositoryView | null) => void;
  onReconnect: () => void;
  /** Files in the project changed (pull or branch switch); the workspace reloads its file list and preview. */
  onFilesChanged: () => void;
  /** Sync state changed; used to mark checkpoints as pushed or waiting. */
  onSync: (info: GitSyncInfo) => void;
  renderAppAccess: () => React.ReactNode;
}) {
  const cached = useGitCache(projectId);
  const sync = cached?.sync ?? null;
  const setSync = useCallback((next: GitSyncStatus) => writeGitCache(projectId, { sync: next }), [projectId]);
  // Only a sync status fetched in this session can trigger an automatic push.
  const [freshHead, setFreshHead] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [checkVersion, setCheckVersion] = useState(0);
  const checkedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!canCommit) return;
    // The first check reuses the saved status while it's current. Later changes (a build, a branch switch, Re-check) always ask GitHub.
    const key = `${refreshKey}:${checkVersion}:${repository.defaultBranch}`;
    const forced = checkedFor.current !== null && checkedFor.current !== key;
    checkedFor.current = key;
    const saved = readGitCache(projectId)?.sync;
    if (!forced && saved && saved.branch === repository.defaultBranch && isFresh(saved.checkedAt)) return;
    let cancelled = false;
    setBusy((current) => current ?? "check");
    fetchShared(`/api/projects/${projectId}/github/sync`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error(payload.error ?? "Something went wrong. Try again."), { code: payload.code as string | undefined });
        return payload as { sync: GitSyncStatus };
      })
      .then((payload) => {
        if (cancelled) return;
        setSync(payload.sync);
        setFreshHead(`${payload.sync.head}:${payload.sync.checkedAt}`);
        setError(null);
      })
      .catch((loadError: ApiError) => !cancelled && setError({ message: loadError.message, code: loadError.code }))
      .finally(() => !cancelled && setBusy((current) => (current === "check" ? null : current)));
    return () => {
      cancelled = true;
    };
  }, [projectId, canCommit, refreshKey, checkVersion, repository.defaultBranch, setSync]);

  function fail(caught: unknown) {
    const apiError = caught as ApiError;
    setError({ message: apiError.message, code: apiError.code });
  }

  // Report the sync state up, so the history can mark checkpoints as pushed or waiting.
  useEffect(() => {
    onSync({ state: sync?.state ?? null, head: sync?.head ?? null, lastPushedAt: repository.lastPushedAt });
  }, [onSync, sync?.state, sync?.head, repository.lastPushedAt]);

  // Changes the agent made that aren't on GitHub yet (a failed push, or a restore) are pushed automatically.
  const autoPushed = useRef(new Set<string>());
  const pushPending = useCallback(async () => {
    setBusy("push");
    setError(null);
    try {
      const result = await api<{ status: string; filesChanged?: number; branch?: string; repository: ProjectRepositoryView; sync: GitSyncStatus }>(
        `/api/projects/${projectId}/github/sync`,
        { method: "POST", body: JSON.stringify({ action: "push" }) },
      );
      onChange(result.repository);
      setSync(result.sync);
      if (result.status === "committed") toast.success(`Pushed ${result.filesChanged} pending ${result.filesChanged === 1 ? "file" : "files"} to GitHub.`);
      else if (result.status === "diverged") toast.message(`GitHub had changes too, so Cognix pushed to ${result.branch}.`);
    } catch (caught) {
      const apiError = caught as ApiError;
      setError({ message: apiError.message, code: apiError.code });
    } finally {
      setBusy(null);
    }
  }, [onChange, projectId, setSync]);

  useEffect(() => {
    if (!sync || sync.state !== "local_ahead" || !canCommit || busy) return;
    if (freshHead !== `${sync.head}:${sync.checkedAt}`) return;
    const key = `${sync.head}:${sync.localChanges}`;
    if (autoPushed.current.has(key)) return;
    autoPushed.current.add(key);
    void pushPending();
  }, [sync, canCommit, busy, pushPending, freshHead]);

  async function pull(discardLocal = false) {
    if (busy) return;
    if (discardLocal && !window.confirm("Replace Cognix's version with GitHub's? Cognix's unpushed changes are saved as a checkpoint you can restore.")) return;
    setBusy(discardLocal ? "replace" : "pull");
    setError(null);
    try {
      const result = await api<{ status: "pulled" | "unchanged"; filesChanged: number; repository: ProjectRepositoryView; sync: GitSyncStatus }>(
        `/api/projects/${projectId}/github/sync`,
        { method: "POST", body: JSON.stringify({ discardLocal }) },
      );
      onChange(result.repository);
      setSync(result.sync);
      if (result.status === "pulled") {
        toast.success(`Synced ${result.filesChanged} ${result.filesChanged === 1 ? "file" : "files"} from GitHub.`);
        onFilesChanged();
      } else toast.message("Already up to date with GitHub.");
    } catch (caught) {
      fail(caught);
    } finally {
      setBusy(null);
    }
  }

  async function unlink() {
    if (!window.confirm(`Disconnect ${repository.fullName}? Sync stops. The repository and its history stay on GitHub, and the project stays in Cognix.`)) return;
    try {
      await api(`/api/projects/${projectId}/github`, { method: "DELETE" });
      toast.success("Repository disconnected.");
      onChange(null);
    } catch (caught) {
      toast.error((caught as Error).message);
    }
  }

  const state = sync ? STATE_COPY[sync.state] : null;
  const shortSha = repository.lastCommitSha?.slice(0, 7);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2">
            <span className="truncate font-mono text-[13.5px] text-white">{repository.fullName}</span>
            <span className="shrink-0 rounded-full bg-emerald-400/10 px-1.5 py-px text-[10.5px] font-medium text-emerald-300">Connected</span>
          </p>
          <p className="mt-1 text-[12px] tabular-nums text-white/45">
            {repository.private ? "Private" : "Public"}
            {shortSha && repository.lastCommitUrl ? (
              <>
                {" "}
                · Last push{" "}
                <a href={repository.lastCommitUrl} target="_blank" rel="noreferrer" className="font-mono text-white/70 hover:text-white">
                  {shortSha}
                </a>{" "}
                {repository.lastPushedAt ? (
                  <time dateTime={repository.lastPushedAt} suppressHydrationWarning>
                    {formatRelativeDate(repository.lastPushedAt)}
                  </time>
                ) : null}
              </>
            ) : (
              " · No pushes from Cognix yet"
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={repository.htmlUrl} target="_blank" rel="noreferrer" className={secondary}>
            View on GitHub <ExternalLink className="size-3" aria-hidden="true" />
          </a>
          <button type="button" onClick={() => void unlink()} className={secondary}>
            <Unlink className="size-3.5" aria-hidden="true" /> Disconnect
          </button>
        </div>
      </div>

      {/* Sync status */}
      <div className="mt-4 rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-[13px] font-medium text-white" role="status">
            {busy === "check" && !sync ? (
              <>
                <PixelLoader /> Comparing with GitHub…
              </>
            ) : state ? (
              <>
                <span className={cn("size-2 rounded-full", state.dot)} aria-hidden="true" /> {state.label}
              </>
            ) : !canCommit ? (
              "Build the app to start syncing"
            ) : (
              "Sync status unavailable"
            )}
          </p>
          <div className="flex items-center gap-2">
            {sync ? (
              <span className="text-[11px] tabular-nums text-white/35">
                Checked <time dateTime={sync.checkedAt}>{formatRelativeDate(sync.checkedAt)}</time>
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setCheckVersion((current) => current + 1)}
              disabled={Boolean(busy) || !canCommit}
              aria-label="Re-check sync status"
              title="Re-check"
              className="grid size-8 place-items-center rounded-lg text-white/55 hover:bg-white/[0.07] hover:text-white disabled:opacity-40 [@media(pointer:coarse)]:size-11"
            >
              {busy === "check" ? <PixelLoader /> : <RefreshCw className="size-3.5" />}
            </button>
          </div>
        </div>
        {sync && state ? <p className="mt-1 text-[12px] leading-5 text-white/50">{state.detail(sync)}</p> : null}

        {sync?.state === "local_ahead" ? (
          <div className="mt-3">
            <button type="button" onClick={() => void pushPending()} disabled={Boolean(busy)} className={secondary}>
              {busy === "push" ? <PixelLoader /> : null}
              {busy === "push" ? "Pushing pending changes…" : "Retry push"}
            </button>
          </div>
        ) : null}
        {sync?.state === "remote_ahead" ? (
          <div className="mt-3">
            <button type="button" onClick={() => void pull()} disabled={Boolean(busy)} className={primary}>
              {busy === "pull" ? <PixelLoader className="text-black" /> : null}
              {busy === "pull" ? "Syncing…" : "Sync from GitHub now"}
            </button>
          </div>
        ) : null}
        {sync?.state === "diverged" ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={`${repository.htmlUrl}/compare/${encodeURIComponent(repository.defaultBranch)}...cognix-sync?expand=1`}
              target="_blank"
              rel="noreferrer"
              className={primary}
            >
              Open pull request <ExternalLink className="size-3" aria-hidden="true" />
            </a>
            <button type="button" onClick={() => void pull(true)} disabled={Boolean(busy)} className={secondary}>
              {busy === "replace" ? <PixelLoader /> : null} Use GitHub&apos;s version
            </button>
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid gap-4 @[560px]:grid-cols-2">
        <BranchPicker
          projectId={projectId}
          active={repository.defaultBranch}
          disabled={Boolean(busy) || !canCommit}
          onSwitched={(next) => {
            onChange(next);
            setCheckVersion((current) => current + 1);
            onFilesChanged();
          }}
          onCreated={(next) => {
            onChange(next);
            setCheckVersion((current) => current + 1);
          }}
        />
        <CloneUrls fullName={repository.fullName} />
      </div>

      <p className="mt-4 flex items-start gap-2 rounded-lg bg-white/[0.03] px-3 py-2.5 text-[12px] leading-5 text-white/55">
        <GitCommitHorizontal className="mt-0.5 size-3.5 shrink-0 text-white/40" aria-hidden="true" />
        <span>
          Cognix&apos;s agent pushes its work to <span className="font-mono text-white/75">{repository.defaultBranch}</span> automatically when each task finishes.{" "}
          {commitsAs.kind === "bot" ? (
            <>Commits appear as <strong className="font-medium text-white/80">{commitsAs.name ?? "the Cognix app"}</strong>, with you as co-author.</>
          ) : (
            <>Commits appear under your GitHub account.</>
          )}
        </span>
      </p>

      {error ? (
        <div role="alert" className="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-[12.5px] leading-5 text-red-300">
          <p>{error.message}</p>
          {error.code === "local_changes" ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => void pull(true)} className={secondary}>
                Use GitHub&apos;s version
              </button>
            </div>
          ) : error.code === "app_access" ? (
            renderAppAccess()
          ) : error.code === "token_revoked" || error.code === "not_connected" ? (
            <button type="button" onClick={onReconnect} className={cn(secondary, "mt-2")}>
              Reconnect GitHub
            </button>
          ) : (
            <button type="button" onClick={() => setCheckVersion((current) => current + 1)} className={cn(secondary, "mt-2")}>
              Try again
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function BranchPicker({
  projectId,
  active,
  disabled,
  onSwitched,
  onCreated,
}: {
  projectId: string;
  active: string;
  disabled: boolean;
  onSwitched: (repository: ProjectRepositoryView) => void;
  onCreated: (repository: ProjectRepositoryView) => void;
}) {
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<{ name: string; protected: boolean }[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [working, setWorking] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const nameId = useId();

  const load = useCallback(() => {
    setLoadError(null);
    api<{ branches: { name: string; protected: boolean }[] }>(`/api/projects/${projectId}/github/branches`)
      .then((payload) => setBranches(payload.branches))
      .catch((error: Error) => setLoadError(error.message));
  }, [projectId]);

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  async function switchTo(name: string) {
    if (name === active || working) return;
    if (!window.confirm(`Switch to ${name}? Cognix replaces the project's files with that branch and syncs it from now on.`)) return;
    setWorking(name);
    try {
      const result = await api<{ repository: ProjectRepositoryView; filesChanged: number }>(`/api/projects/${projectId}/github/branches`, {
        method: "PUT",
        body: JSON.stringify({ name }),
      });
      toast.success(`Switched to ${name}.`);
      setOpen(false);
      onSwitched(result.repository);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setWorking(null);
    }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!isValidBranchName(name) || working) return;
    if (branches?.some((branch) => branch.name === name)) return;
    setWorking(name);
    try {
      const result = await api<{ repository: ProjectRepositoryView }>(`/api/projects/${projectId}/github/branches`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      toast.success(`Created ${name} from ${active} and switched to it.`);
      setOpen(false);
      setCreating(false);
      setNewName("");
      setBranches(null);
      onCreated(result.repository);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setWorking(null);
    }
  }

  const trimmed = newName.trim();
  const duplicate = Boolean(trimmed && branches?.some((branch) => branch.name === trimmed));
  const nameError = trimmed && !isValidBranchName(trimmed) ? "Use letters, numbers, and . _ - /, without spaces." : duplicate ? "That branch already exists." : null;
  const filtered = (branches ?? []).filter((branch) => branch.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div ref={containerRef} className="relative">
      <p className="text-[12px] font-medium text-white/75">Branch</p>
      <button
        type="button"
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen((current) => !current);
          if (!branches) load();
        }}
        className={cn(input, "mt-1.5 flex items-center gap-2 text-left disabled:opacity-50")}
      >
        <GitBranch className="size-3.5 shrink-0 text-white/50" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{active}</span>
        <ChevronDown className="size-3.5 shrink-0 text-white/40" aria-hidden="true" />
      </button>
      <p className="mt-1 text-[11.5px] text-white/40">Cognix edits and syncs this branch.</p>

      {open ? (
        <div
          role="dialog"
          aria-label="Choose a branch"
          onKeyDown={(event) => event.key === "Escape" && setOpen(false)}
          className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-white/10 bg-[#252525] shadow-2xl"
        >
          {creating ? (
            <form onSubmit={(event) => void create(event)} className="p-3">
              <label htmlFor={nameId} className="text-[12px] font-medium text-white/75">
                New branch name
              </label>
              <input
                id={nameId}
                autoFocus
                value={newName}
                onChange={(event) => setNewName(event.target.value.replace(/\s+/g, "-"))}
                placeholder="feature/new-page"
                spellCheck={false}
                aria-invalid={Boolean(nameError)}
                className={cn(input, "mt-1.5 font-mono", nameError && "border-red-400/60")}
              />
              <p className={cn("mt-1 text-[11.5px]", nameError ? "text-red-300" : "text-white/40")}>
                {nameError ?? <>Source: <span className="font-mono">{active}</span></>}
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setCreating(false)} className={secondary}>
                  Cancel
                </button>
                <button type="submit" disabled={!trimmed || Boolean(nameError) || Boolean(working)} className={primary}>
                  {working ? <PixelLoader className="text-black" /> : null} Create branch
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="p-2">
                <input
                  type="search"
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find a branch…"
                  aria-label="Find a branch"
                  className={input}
                />
              </div>
              <ul className="max-h-56 overflow-y-auto px-1 pb-1">
                {loadError ? (
                  <li className="px-2.5 py-2 text-[12.5px] text-white/55">
                    {loadError}{" "}
                    <button type="button" onClick={load} className="font-medium text-white/80 hover:text-white">
                      Try again
                    </button>
                  </li>
                ) : !branches ? (
                  <li className="flex items-center gap-2 px-2.5 py-2 text-[12.5px] text-white/50" role="status">
                    <PixelLoader /> Loading branches…
                  </li>
                ) : filtered.length === 0 ? (
                  <li className="px-2.5 py-2 text-[12.5px] text-white/50">No branches match.</li>
                ) : (
                  filtered.map((branch) => (
                    <li key={branch.name}>
                      <button
                        type="button"
                        onClick={() => void switchTo(branch.name)}
                        disabled={Boolean(working)}
                        className="flex min-h-8 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-white/80 hover:bg-white/[0.06] disabled:opacity-50 [@media(pointer:coarse)]:min-h-11"
                      >
                        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{branch.name}</span>
                        {working === branch.name ? <PixelLoader /> : branch.name === active ? <Check className="size-3.5 text-emerald-300" aria-label="Active" /> : null}
                      </button>
                    </li>
                  ))
                )}
              </ul>
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex h-10 w-full items-center gap-2 border-t border-white/[0.06] px-3 text-[12.5px] font-medium text-white/80 hover:bg-white/[0.05] hover:text-white [@media(pointer:coarse)]:h-11"
              >
                <Plus className="size-3.5" aria-hidden="true" /> Create branch
              </button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function CloneUrls({ fullName }: { fullName: string }) {
  const options = {
    HTTPS: `https://github.com/${fullName}.git`,
    SSH: `git@github.com:${fullName}.git`,
    "GitHub CLI": `gh repo clone ${fullName}`,
  } as const;
  const [kind, setKind] = useState<keyof typeof options>("HTTPS");
  const [copied, setCopied] = useState(false);
  const value = options[kind];

  return (
    <div>
      <p className="text-[12px] font-medium text-white/75">Clone</p>
      <div role="radiogroup" aria-label="Clone URL type" className="mt-1.5 inline-flex rounded-md bg-white/[0.05] p-0.5">
        {(Object.keys(options) as (keyof typeof options)[]).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={kind === option}
            onClick={() => {
              setKind(option);
              setCopied(false);
            }}
            className={cn(
              "h-6 rounded px-2 text-[11.5px] font-medium [@media(pointer:coarse)]:h-11",
              kind === option ? "bg-white/[0.1] text-white" : "text-white/50 hover:text-white",
            )}
          >
            {option}
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex h-9 items-center rounded-lg border border-white/[0.12] bg-[#101010] [@media(pointer:coarse)]:h-11">
        <code className="min-w-0 flex-1 truncate px-3 font-mono text-[12px] text-white/75" title={value}>
          {value}
        </code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(value);
            setCopied(true);
            toast.success("Copied.");
          }}
          aria-label={`Copy ${kind} clone URL`}
          className="grid size-8 shrink-0 place-items-center rounded-md text-white/55 hover:bg-white/[0.07] hover:text-white [@media(pointer:coarse)]:size-11"
        >
          {copied ? <Check className="size-3.5 text-emerald-300" /> : <Copy className="size-3.5" />}
        </button>
      </div>
    </div>
  );
}
