"use client";

import { ArrowDownToLine, CloudUpload, ExternalLink, FileDiff, GitCommitHorizontal, RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { GitHubMark } from "@/components/github-mark";
import { PixelLoader } from "@/components/pixel-loader";
import type { Message, RepositoryCommit } from "@/lib/types";
import { cn, formatRelativeDate } from "@/lib/utils";
import { fetchShared, isFresh, readGitCache, useGitCache, writeGitCache } from "./git-cache";
import type { GitSyncInfo } from "./github-repository";

export type BuildCheckpoint = {
  message: Message;
  summary: string;
  fileCount: number;
  canRestore: boolean;
  restored: boolean;
};

type PushState = "pushed" | "pending" | "local";

/** Whether a checkpoint is on GitHub: from its own commit record, otherwise from the repository's sync state. */
function pushStateFor(message: Message, sync: GitSyncInfo, linked: boolean): { state: PushState; url?: string; branch?: string } {
  if (!linked) return { state: "local" };
  const github = message.metadata.github as { status?: string; url?: string; branch?: string } | undefined;
  const fromGitHub = message.metadata.githubSync as { url?: string } | undefined;
  if (fromGitHub) return { state: "pushed", url: fromGitHub.url };
  if (github?.status === "committed") return { state: "pushed", url: github.url };
  if (github?.status === "diverged") return { state: "pending", url: github.url, branch: github.branch };
  // Without a record: anything older than the last push is on GitHub; newer changes wait while files are unpushed.
  if (sync.lastPushedAt && message.createdAt <= sync.lastPushedAt) return { state: "pushed" };
  if (sync.state === "in_sync" || sync.state === "remote_ahead") return { state: "pushed" };
  return { state: "pending" };
}

type Entry =
  | { kind: "checkpoint"; date: string; build: BuildCheckpoint }
  | { kind: "commit"; date: string; commit: RepositoryCommit };

export function GitHistory({
  projectId,
  builds,
  sync,
  refreshKey,
  restoringMessageId,
  isBuilding,
  relativeNow,
  onSelect,
  onRestore,
}: {
  projectId: string;
  builds: BuildCheckpoint[];
  sync: GitSyncInfo & { linked: boolean };
  refreshKey: number;
  restoringMessageId: string | null;
  isBuilding: boolean;
  relativeNow: number;
  onSelect: (message: Message) => void;
  onRestore: (message: Message) => void;
}) {
  const cached = useGitCache(projectId);
  const commits = cached?.commits ?? null;
  const commitsFetchedAt = cached?.commitsFetchedAt ?? null;
  const [commitsError, setCommitsError] = useState<string | null>(null);
  const [loadingCommits, setLoadingCommits] = useState(false);
  const [reload, setReload] = useState(0);
  const [filter, setFilter] = useState<"all" | "checkpoints" | "commits">("all");
  const loadedFor = useRef<string | null>(null);

  // Saved commits show right away. GitHub is asked again only when they're out of date:
  // older than the cache window, behind the branch head, after a build, or when the user reloads.
  useEffect(() => {
    if (!sync.linked) return;
    const key = `${refreshKey}:${reload}`;
    const forced = loadedFor.current !== null && loadedFor.current !== key;
    loadedFor.current = key;
    const saved = readGitCache(projectId);
    const atHead = !sync.head || saved?.commits?.[0]?.sha === sync.head;
    if (!forced && saved?.commits && isFresh(saved.commitsFetchedAt) && atHead) return;
    let cancelled = false;
    setLoadingCommits(true);
    fetchShared(`/api/projects/${projectId}/github/commits`)
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error ?? "Couldn't load commits from GitHub.");
        return payload as { commits: RepositoryCommit[]; fetchedAt?: string };
      })
      .then((payload) => {
        if (cancelled) return;
        writeGitCache(projectId, { commits: payload.commits, commitsFetchedAt: payload.fetchedAt ?? new Date().toISOString() });
        setCommitsError(null);
      })
      .catch((error: Error) => !cancelled && setCommitsError(error.message))
      .finally(() => !cancelled && setLoadingCommits(false));
    return () => {
      cancelled = true;
    };
  }, [projectId, sync.linked, sync.head, refreshKey, reload, commitsFetchedAt]);

  const shownCommits = sync.linked ? commits ?? [] : [];
  const entries: Entry[] = [
    ...builds.map((build) => ({ kind: "checkpoint" as const, date: build.message.createdAt, build })),
    ...shownCommits.map((commit) => ({ kind: "commit" as const, date: commit.date, commit })),
  ]
    .filter((entry) => filter === "all" || (filter === "checkpoints" ? entry.kind === "checkpoint" : entry.kind === "commit"))
    .sort((a, b) => b.date.localeCompare(a.date));

  const pendingCount = builds.filter((build) => pushStateFor(build.message, sync, sync.linked).state === "pending").length;

  return (
    <section aria-labelledby="git-history-heading" className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 id="git-history-heading" className="text-[14px] font-semibold text-white">
            History
          </h3>
          <p className="mt-1 text-[12.5px] text-white/45">
            {sync.linked
              ? "Cognix checkpoints and GitHub commits from both sides of the sync."
              : "Every build that changes files. Review its diff or restore the files to before it ran."}
          </p>
        </div>
        {sync.linked ? (
          <div className="flex items-center gap-1">
            <div role="radiogroup" aria-label="Show" className="inline-flex rounded-lg bg-white/[0.05] p-0.5">
              {(["all", "checkpoints", "commits"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={filter === option}
                  onClick={() => setFilter(option)}
                  className={cn(
                    "h-7 rounded-md px-2.5 text-[12px] font-medium capitalize [@media(pointer:coarse)]:h-11",
                    filter === option ? "bg-white/[0.1] text-white" : "text-white/55 hover:text-white",
                  )}
                >
                  {option}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setReload((current) => current + 1)}
              disabled={loadingCommits}
              aria-label={loadingCommits ? "Loading commits" : "Reload commits"}
              title={commitsFetchedAt ? `Commits fetched ${formatRelativeDate(commitsFetchedAt, relativeNow)}. Reload` : "Reload commits"}
              className="grid size-8 place-items-center rounded-lg text-white/55 hover:bg-white/[0.07] hover:text-white disabled:opacity-60 [@media(pointer:coarse)]:size-11"
            >
              {loadingCommits ? <PixelLoader size="sm" /> : <RefreshCw className="size-3.5" />}
            </button>
          </div>
        ) : null}
      </div>

      {pendingCount > 0 ? (
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-sky-400/[0.06] px-3 py-2 text-[12px] text-sky-200/90">
          <CloudUpload className="size-3.5 shrink-0" aria-hidden="true" />
          {pendingCount} {pendingCount === 1 ? "checkpoint is" : "checkpoints are"} saved in Cognix and waiting to push to GitHub.
        </p>
      ) : null}

      {sync.linked && commitsError ? (
        <p className="mt-3 text-[12px] text-white/50">
          {commitsError}{" "}
          <button type="button" onClick={() => setReload((current) => current + 1)} className="font-medium text-white/80 hover:text-white">
            Try again
          </button>
        </p>
      ) : null}
      {sync.linked && !commits && !commitsError ? (
        <p className="mt-3 flex items-center gap-2 text-[12px] text-white/45" role="status">
          <PixelLoader size="sm" /> Loading commits from GitHub…
        </p>
      ) : null}

      {entries.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-white/10 px-6 py-10 text-center">
          <GitCommitHorizontal className="mx-auto size-5 text-white/30" aria-hidden="true" />
          <p className="mt-2 text-[13px] font-medium text-white/75">Nothing here yet</p>
          <p className="mt-1 text-[12px] text-white/45">Each build that changes files adds a checkpoint here.</p>
        </div>
      ) : (
        <ol className="mt-3 space-y-2">
          {entries.map((entry) =>
            entry.kind === "checkpoint" ? (
              <CheckpointRow
                key={`c-${entry.build.message.id}`}
                build={entry.build}
                push={pushStateFor(entry.build.message, sync, sync.linked)}
                restoring={restoringMessageId === entry.build.message.id}
                disabled={Boolean(restoringMessageId) || isBuilding}
                relativeNow={relativeNow}
                onSelect={onSelect}
                onRestore={onRestore}
              />
            ) : (
              <CommitRow key={`g-${entry.commit.sha}`} commit={entry.commit} relativeNow={relativeNow} />
            ),
          )}
        </ol>
      )}
    </section>
  );
}

function PushBadge({ push }: { push: { state: PushState; url?: string; branch?: string } }) {
  if (push.state === "local") return null;
  if (push.state === "pushed") {
    const label = (
      <>
        <GitHubMark className="size-2.5" /> Pushed
      </>
    );
    return push.url ? (
      <a href={push.url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-400/10 px-1.5 py-px text-[10.5px] font-medium text-emerald-300 hover:bg-emerald-400/15">
        {label}
      </a>
    ) : (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-400/10 px-1.5 py-px text-[10.5px] font-medium text-emerald-300">{label}</span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-400/10 px-1.5 py-px text-[10.5px] font-medium text-sky-300">
      <CloudUpload className="size-2.5" aria-hidden="true" /> {push.branch ? `On ${push.branch}` : "Waiting to push"}
    </span>
  );
}

function CheckpointRow({
  build,
  push,
  restoring,
  disabled,
  relativeNow,
  onSelect,
  onRestore,
}: {
  build: BuildCheckpoint;
  push: { state: PushState; url?: string; branch?: string };
  restoring: boolean;
  disabled: boolean;
  relativeNow: number;
  onSelect: (message: Message) => void;
  onRestore: (message: Message) => void;
}) {
  const fromGitHub = Boolean(build.message.metadata.githubSync);
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3">
      {fromGitHub ? (
        <ArrowDownToLine className="size-4 shrink-0 text-white/40" aria-label="Synced from GitHub" />
      ) : (
        <GitCommitHorizontal className="size-4 shrink-0 text-white/40" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-white">
          <span className="truncate">{build.summary}</span>
          <span className="shrink-0 rounded-full bg-white/[0.07] px-1.5 py-px text-[10.5px] font-medium text-white/55">Checkpoint</span>
          <PushBadge push={push} />
          {build.restored ? <span className="shrink-0 rounded-full bg-white/[0.07] px-1.5 py-px text-[10.5px] font-medium text-white/55">Restored</span> : null}
        </p>
        <p className="mt-0.5 text-[11.5px] tabular-nums text-white/40">
          {build.fileCount} {build.fileCount === 1 ? "file" : "files"} ·{" "}
          <time dateTime={build.message.createdAt}>{formatRelativeDate(build.message.createdAt, relativeNow)}</time>
        </p>
      </div>
      <button
        type="button"
        onClick={() => onSelect(build.message)}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-[12px] font-medium text-white/75 hover:bg-white/[0.06] hover:text-white [@media(pointer:coarse)]:h-11"
      >
        <FileDiff className="size-3.5" aria-hidden="true" /> Review diff
      </button>
      {build.canRestore ? (
        <button
          type="button"
          onClick={() => onRestore(build.message)}
          disabled={disabled}
          title="Revert the files changed by this build"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-400/25 px-2.5 text-[12px] font-medium text-amber-200 hover:bg-amber-400/10 disabled:cursor-not-allowed disabled:opacity-40 [@media(pointer:coarse)]:h-11"
        >
          {restoring ? <PixelLoader /> : <RotateCcw className="size-3.5" aria-hidden="true" />}
          {restoring ? "Restoring…" : "Restore"}
        </button>
      ) : null}
    </li>
  );
}

function CommitRow({ commit, relativeNow }: { commit: RepositoryCommit; relativeNow: number }) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-white/[0.06] px-4 py-2.5">
      {commit.avatarUrl ? (
        // GitHub avatars come from GitHub's CDN.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={commit.avatarUrl} alt="" className="size-5 shrink-0 rounded-full" referrerPolicy="no-referrer" />
      ) : (
        <GitHubMark className="size-4 shrink-0 text-white/40" />
      )}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-white/85">
          <span className="truncate">{commit.title}</span>
          <span
            className={cn(
              "shrink-0 rounded-full px-1.5 py-px text-[10.5px] font-medium",
              commit.source === "cognix" ? "bg-violet-400/10 text-violet-200" : "bg-white/[0.07] text-white/60",
            )}
          >
            {commit.source === "cognix" ? "From Cognix" : "From GitHub"}
          </span>
          {commit.source === "github" && !commit.inCognix ? (
            <span className="shrink-0 rounded-full bg-sky-400/10 px-1.5 py-px text-[10.5px] font-medium text-sky-300">Not in Cognix yet</span>
          ) : null}
        </p>
        <p className="mt-0.5 text-[11.5px] tabular-nums text-white/40">
          {commit.author} · <time dateTime={commit.date}>{formatRelativeDate(commit.date, relativeNow)}</time>
        </p>
      </div>
      <a
        href={commit.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 font-mono text-[12px] text-white/60 hover:bg-white/[0.06] hover:text-white [@media(pointer:coarse)]:h-11"
        aria-label={`Open commit ${commit.shortSha} on GitHub`}
      >
        {commit.shortSha} <ExternalLink className="size-3" aria-hidden="true" />
      </a>
    </li>
  );
}
