"use client";

import { ExternalLink, GitBranch, Lock, Search } from "lucide-react";
import { GitHubMark } from "@/components/github-mark";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { PixelLoader } from "@/components/pixel-loader";
import { LinkedRepository, type GitSyncInfo } from "./github-repository";
import { clearGitCache, mergeServerCache, readGitCache, useGitCache, writeGitCache, type GitHubStatus } from "./git-cache";
import { isValidRepoName, repoNameFromTitle } from "@/lib/github/names";
import type { ProjectRepositoryView } from "@/lib/types";
import { cn } from "@/lib/utils";

type Status = GitHubStatus;
type RepoOption = { fullName: string; private: boolean; defaultBranch: string; pushedAt: string | null };
type ApiError = Error & { code?: string };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      ...init,
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    });
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

/** GitHub connection, repository linking, and commits for one project. The token never reaches the browser. */
export function GitHubSection({
  projectId,
  projectTitle,
  refreshKey,
  canCommit,
  onFilesChanged,
  onSync,
}: {
  projectId: string;
  projectTitle: string;
  /** Changes after each build, so the last commit shown stays current. */
  refreshKey: number;
  canCommit: boolean;
  /** GitHub changes were written into the project; reload its files, messages, and preview. */
  onFilesChanged: () => void;
  /** Sync state of the linked repository, or null state when nothing is linked. */
  onSync: (info: GitSyncInfo) => void;
}) {
  const cached = useGitCache(projectId);
  const status = cached?.status ?? null;
  const setStatus = useCallback(
    (update: (current: Status | null) => Status | null) => {
      const next = update(readGitCache(projectId)?.status ?? null);
      if (next) writeGitCache(projectId, { status: next });
    },
    [projectId],
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  // Bumped when the user returns from changing repository access, so the repository list reloads.
  const [accessVersion, setAccessVersion] = useState(0);
  const bumpAccess = useCallback(() => setAccessVersion((current) => current + 1), []);

  // Reads Cognix's own database (not GitHub), so it's cheap. The saved status shows meanwhile.
  useEffect(() => {
    let cancelled = false;
    api<Status>(`/api/projects/${projectId}/github`)
      .then((next) => {
        if (cancelled) return;
        const previous = readGitCache(projectId)?.status;
        if (previous && previous.repository?.fullName !== next.repository?.fullName) clearGitCache(projectId);
        mergeServerCache(projectId, next.cache);
        writeGitCache(projectId, { status: next });
        setLoadError(null);
      })
      .catch((error: Error) => !cancelled && setLoadError(error.message));
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey, reload]);

  const returnTo = `/projects/${projectId}?tab=git`;
  const unlinked = status !== null && !status.repository;
  useEffect(() => {
    if (unlinked) onSync({ state: null, head: null, lastPushedAt: null });
  }, [unlinked, onSync]);

  async function disconnect() {
    if (!window.confirm("Disconnect GitHub? Cognix revokes its access on GitHub. Your repositories and commits stay, but Cognix can't commit until you reconnect.")) return;
    try {
      await api(`/api/github/connection`, { method: "DELETE" });
      toast.success("GitHub disconnected.");
      setReload((current) => current + 1);
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  return (
    <section aria-labelledby="github-heading" className="@container rounded-lg border border-white/10 bg-white/[0.02]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
        <h3 id="github-heading" className="flex items-center gap-2 text-[14px] font-semibold text-white">
          <GitHubMark className="size-4" aria-hidden="true" /> GitHub
        </h3>
        {status?.connection ? (
          <div className="flex items-center gap-2 text-[12px] text-white/55">
            {status.connection.avatarUrl ? (
              // GitHub avatars are served from GitHub's CDN.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={status.connection.avatarUrl} alt="" className="size-5 rounded-full" referrerPolicy="no-referrer" />
            ) : null}
            <span>
              Connected as <strong className="font-medium text-white/80">{status.connection.login}</strong>
            </span>
            <button type="button" onClick={() => void disconnect()} className="rounded px-1 font-medium text-white/60 hover:text-white">
              Disconnect
            </button>
          </div>
        ) : null}
      </div>

      <div className="p-4">
        {loadError && !status ? (
          <div className="text-[13px] text-white/60">
            <p>{loadError}</p>
            <button type="button" onClick={() => setReload((current) => current + 1)} className={cn(secondary, "mt-3")}>
              Try again
            </button>
          </div>
        ) : !status ? (
          <p className="flex items-center gap-2 text-[13px] text-white/50" role="status">
            <PixelLoader /> Checking GitHub…
          </p>
        ) : !status.configured ? (
          <p className="text-[13px] leading-5 text-white/55">
            GitHub isn&apos;t set up on this Cognix server yet. The server needs <code className="font-mono text-white/75">GITHUB_CLIENT_ID</code>,{" "}
            <code className="font-mono text-white/75">GITHUB_CLIENT_SECRET</code>, <code className="font-mono text-white/75">APP_BASE_URL</code>, and{" "}
            <code className="font-mono text-white/75">COGNIX_SECRETS_KEY</code>.
          </p>
        ) : !status.connection ? (
          <div>
            <p className="max-w-md text-[13px] leading-5 text-white/55">
              Connect GitHub to save this project to a repository. Cognix commits after each successful build, and you can commit any time.
              Your GitHub token stays encrypted on Cognix&apos;s server and is never shared with your app&apos;s sandbox.
            </p>
            <a href={`/api/github/connect?returnTo=${encodeURIComponent(returnTo)}`} className={cn(primary, "mt-4")}>
              <GitHubMark className="size-4" aria-hidden="true" /> Connect GitHub
            </a>
          </div>
        ) : status.repository ? (
          <LinkedRepository
            projectId={projectId}
            repository={status.repository}
            canCommit={canCommit}
            refreshKey={refreshKey}
            commitsAs={{ kind: status.commitIdentity ?? "user", name: status.botName ?? null }}
            onChange={(repository) => setStatus((current) => (current ? { ...current, repository } : current))}
            onReconnect={() => window.location.assign(`/api/github/connect?returnTo=${encodeURIComponent(returnTo)}`)}
            onFilesChanged={onFilesChanged}
            onSync={onSync}
            renderAppAccess={() => (
              <AppAccessActions onReconnect={() => window.location.assign(`/api/github/connect?returnTo=${encodeURIComponent(returnTo)}`)} />
            )}
          />
        ) : (
          <LinkRepository
            key={accessVersion}
            projectId={projectId}
            projectTitle={projectTitle}
            onLinked={(repository) => setStatus((current) => (current ? { ...current, repository } : current))}
          />
        )}
        {status?.configured && status.connection ? (
          <div className="mt-4 border-t border-white/[0.06] pt-3">
            <RepositoryAccessControl onChanged={bumpAccess} />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function LinkRepository({
  projectId,
  projectTitle,
  onLinked,
}: {
  projectId: string;
  projectTitle: string;
  onLinked: (repository: ProjectRepositoryView) => void;
}) {
  const [mode, setMode] = useState<"create" | "link">("create");
  const [name, setName] = useState(() => repoNameFromTitle(projectTitle));
  const [isPrivate, setIsPrivate] = useState(true);
  const [repos, setRepos] = useState<RepoOption[] | null>(null);
  const [reposError, setReposError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const nameId = useId();
  const nameValid = isValidRepoName(name);

  useEffect(() => {
    if (mode !== "link" || repos) return;
    let cancelled = false;
    api<{ repositories: RepoOption[] }>("/api/github/repos")
      .then((payload) => !cancelled && setRepos(payload.repositories))
      .catch((loadError: Error) => !cancelled && setReposError(loadError.message));
    return () => {
      cancelled = true;
    };
  }, [mode, repos]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = mode === "create" ? { mode, name, private: isPrivate } : { mode, fullName: selected };
      const payload = await api<{
        repository: ProjectRepositoryView;
        initialPush: { status: string; url?: string; error?: string } | null;
      }>(`/api/projects/${projectId}/github`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (payload.initialPush?.status === "committed") toast.success(`Linked ${payload.repository.fullName} and pushed the project.`);
      else if (payload.initialPush?.status === "error") toast.error(`Linked ${payload.repository.fullName}, but the first push failed: ${payload.initialPush.error}`);
      else if (payload.initialPush?.status === "diverged") toast.message(`Linked ${payload.repository.fullName}. It already had code, so Cognix pushed to cognix-sync.`);
      else toast.success(`Linked ${payload.repository.fullName}.`);
      onLinked(payload.repository);
    } catch (submitError) {
      const apiError = submitError as ApiError;
      setError({ message: apiError.message, code: apiError.code });
    } finally {
      setBusy(false);
    }
  }

  const filtered = (repos ?? []).filter((repo) => repo.fullName.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <div role="radiogroup" aria-label="Repository" className="inline-flex rounded-lg bg-white/[0.05] p-0.5">
        {(["create", "link"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={mode === option}
            onClick={() => {
              setMode(option);
              setError(null);
            }}
            className={cn(
              "h-7 rounded-md px-3 text-[12.5px] font-medium transition-colors [@media(pointer:coarse)]:h-11",
              mode === option ? "bg-white/[0.1] text-white" : "text-white/55 hover:text-white",
            )}
          >
            {option === "create" ? "Create a repository" : "Use an existing one"}
          </button>
        ))}
      </div>

      {mode === "create" ? (
        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor={nameId} className="text-[12px] font-medium text-white/75">
              Repository name
            </label>
            <input
              id={nameId}
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value.replace(/\s+/g, "-"))}
              aria-invalid={!nameValid}
              aria-describedby={`${nameId}-hint`}
              spellCheck={false}
              autoComplete="off"
              className={cn(input, "mt-1.5 font-mono", !nameValid && "border-red-400/60")}
            />
            <p id={`${nameId}-hint`} className={cn("mt-1 text-[11.5px]", nameValid ? "text-white/40" : "text-red-300")}>
              {nameValid ? "Created in your personal GitHub account." : "Use letters, numbers, hyphens, underscores, or periods."}
            </p>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-white/75">
            <input type="checkbox" checked={isPrivate} onChange={(event) => setIsPrivate(event.target.checked)} className="size-4 accent-white" />
            Private repository
          </label>
        </div>
      ) : (
        <div className="mt-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-white/35" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter repositories…"
              aria-label="Filter repositories"
              className={cn(input, "pl-8")}
            />
          </div>
          <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-white/[0.08]" role="radiogroup" aria-label="Your repositories">
            {reposError ? (
              <p className="p-3 text-[12.5px] text-white/55">
                {reposError}{" "}
                <button type="button" className="font-medium text-white/80 hover:text-white" onClick={() => { setReposError(null); setRepos(null); }}>
                  Try again
                </button>
              </p>
            ) : !repos ? (
              <p className="flex items-center gap-2 p-3 text-[12.5px] text-white/50" role="status">
                <PixelLoader /> Loading your repositories…
              </p>
            ) : filtered.length === 0 ? (
              <p className="p-3 text-[12.5px] text-white/50">
                {repos.length ? "No repositories match." : "No repositories you can push to. Create one instead."}
              </p>
            ) : (
              filtered.map((repo) => (
                <button
                  key={repo.fullName}
                  type="button"
                  role="radio"
                  aria-checked={selected === repo.fullName}
                  onClick={() => setSelected(repo.fullName)}
                  className={cn(
                    "flex min-h-9 w-full items-center gap-2 border-b border-white/[0.05] px-3 py-1.5 text-left last:border-b-0 [@media(pointer:coarse)]:min-h-11",
                    selected === repo.fullName ? "bg-white/[0.08] text-white" : "text-white/75 hover:bg-white/[0.04]",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{repo.fullName}</span>
                  {repo.private ? <Lock className="size-3 shrink-0 text-white/40" aria-label="Private" /> : null}
                </button>
              ))
            )}
          </div>
          <p className="mt-2 text-[11.5px] leading-5 text-white/40">
            Cognix commits the project&apos;s files on top of the repository&apos;s current branch. Files Cognix didn&apos;t create, like a README
            or CI config, are left alone. History is never rewritten.
          </p>
        </div>
      )}

      {error ? (
        <div role="alert" className="mt-3 rounded-md bg-red-500/10 px-3 py-2 text-[12.5px] leading-5 text-red-300">
          <p>{error.message}</p>
          {error.code === "app_access" ? (
            <AppAccessActions onReconnect={() => window.location.assign(`/api/github/connect?returnTo=${encodeURIComponent(`/projects/${projectId}?tab=git`)}`)} />
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex justify-end">
        <button type="submit" disabled={busy || (mode === "create" ? !nameValid : !selected)} className={primary}>
          {busy ? <PixelLoader className="text-black" /> : <GitBranch className="size-3.5" aria-hidden="true" />}
          {busy ? "Linking…" : mode === "create" ? "Create and link" : "Link repository"}
        </button>
      </div>
    </form>
  );
}

/** Recovery steps when the GitHub App installation is missing a permission or repository. */
function AppAccessActions({ onReconnect }: { onReconnect: () => void }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <a href="https://github.com/settings/installations" target="_blank" rel="noreferrer" className={secondary}>
        Open GitHub App settings <ExternalLink className="size-3" aria-hidden="true" />
      </a>
      <button type="button" onClick={onReconnect} className={secondary}>
        Reconnect GitHub
      </button>
    </div>
  );
}

type RepositoryAccess = { kind: "github_app" | "oauth_app"; manageUrl: string; selection: "all" | "selected" | null; account: string | null };

/**
 * Shows which repositories Cognix can reach and links to GitHub's page for changing it.
 * GitHub only allows that change on github.com, so this opens it and refreshes when the user comes back.
 */
function RepositoryAccessControl({ onChanged }: { onChanged: () => void }) {
  const [access, setAccess] = useState<RepositoryAccess | null>(null);
  const [failed, setFailed] = useState(false);
  const [awaitingReturn, setAwaitingReturn] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<{ access: RepositoryAccess }>("/api/github/access")
      .then((payload) => {
        if (cancelled) return;
        setAccess(payload.access);
        setFailed(false);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [reload]);

  // After changing access on GitHub, refresh both the setting and the repository list when the tab regains focus.
  useEffect(() => {
    if (!awaitingReturn) return;
    function refresh() {
      if (document.visibilityState !== "visible") return;
      setAwaitingReturn(false);
      setReload((current) => current + 1);
      onChanged();
    }
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [awaitingReturn, onChanged]);

  if (failed) {
    return (
      <p className="text-[12px] text-white/45">
        Couldn&apos;t check repository access.{" "}
        <button type="button" onClick={() => setReload((current) => current + 1)} className="font-medium text-white/75 hover:text-white">
          Try again
        </button>
      </p>
    );
  }
  if (!access) {
    return (
      <p className="flex items-center gap-2 text-[12px] text-white/45" role="status">
        <PixelLoader size="sm" /> Checking repository access…
      </p>
    );
  }

  const label =
    access.kind === "oauth_app"
      ? "All repositories you can access"
      : access.selection === "all"
        ? "All repositories"
        : access.selection === "selected"
          ? "Only selected repositories"
          : "Not installed on your account";
  const warn = access.kind === "github_app" && access.selection !== "all";
  // The install flow runs through Cognix and returns here, so it stays in this tab.
  const internal = access.manageUrl.startsWith("/");
  const href = internal ? `${access.manageUrl}&returnTo=${encodeURIComponent(window.location.pathname + "?tab=git")}` : access.manageUrl;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
      <span className="text-white/45">Repository access:</span>
      <span className={cn("font-medium", warn ? "text-amber-200/90" : "text-white/75")}>{label}</span>
      <a
        href={href}
        {...(internal ? {} : { target: "_blank", rel: "noreferrer", onClick: () => setAwaitingReturn(true) })}
        className="inline-flex items-center gap-1 rounded font-medium text-white/80 hover:text-white"
      >
        {access.selection === null && access.kind === "github_app" ? "Install" : "Change"}
        {internal ? null : <ExternalLink className="size-3" aria-hidden="true" />}
      </a>
      {warn ? (
        <span className="basis-full text-[11.5px] leading-5 text-white/40">
          {access.selection === "selected"
            ? "Cognix can only use the repositories you picked, and can't create new ones. Choose All repositories to let Cognix create them."
            : "This GitHub App is authorized but not installed, so it can't reach any repository. Select Install to add it to your account."}
        </span>
      ) : null}
    </div>
  );
}
