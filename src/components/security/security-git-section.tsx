"use client";

import { ExternalLink, GitBranch, GitPullRequest, RefreshCw, Sparkles, UploadCloud } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { GitHubMark } from "@/components/github-mark";
import { PixelLoader } from "@/components/pixel-loader";
import { isValidBranchName } from "@/lib/github/names";
import type { SecuritySource } from "@/lib/types";
import { cn, formatRelativeDate } from "@/lib/utils";

type Change = { path: string; kind: "added" | "modified" | "deleted"; added: number | null; removed: number | null };
type LoadState = { kind: "loading" } | { kind: "ready"; source: SecuritySource; changes: Change[] } | { kind: "error"; message: string };
type PushResult = { url: string; branch: string; sha: string; filesChanged: number; pullRequest: { number: number; url: string } | null };

const button =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 [@media(pointer:coarse)]:h-11";
const secondary = `${button} border border-white/10 text-white/80 hover:bg-white/[0.06] hover:text-white`;
const primary = `${button} bg-white font-semibold text-black hover:bg-white/85`;
const field =
  "w-full rounded-lg border border-white/[0.12] bg-[#101010] px-3 text-[13px] text-white outline-none placeholder:text-white/30 focus:border-white/35";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? "Something went wrong. Try again.");
  return payload as T;
}

/**
 * Security mode Git Control: the agent's changes, a commit message the agent writes, and a manual
 * commit-and-push with the user's own GitHub account. The agent itself can never push.
 */
export function SecurityGitSection({
  projectId,
  source,
  refreshKey,
  canCommit,
  onPushed,
}: {
  projectId: string;
  source: SecuritySource | null;
  /** Changes after each agent run, so the change list reloads. */
  refreshKey: number;
  canCommit: boolean;
  onPushed: () => void;
}) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reload, setReload] = useState(0);
  const [message, setMessage] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [target, setTarget] = useState<"current" | "new">("new");
  const [branch, setBranch] = useState(() => `cognix/security-fixes-${new Date().toISOString().slice(0, 10)}`);
  const [openPr, setOpenPr] = useState(true);
  const [prTitle, setPrTitle] = useState("");
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PushResult | null>(null);
  const id = useId();

  useEffect(() => {
    if (!source?.importedSha) return;
    let cancelled = false;
    api<{ source: SecuritySource; changes: Change[] }>(`/api/projects/${projectId}/security/changes`)
      .then((payload) => !cancelled && setState({ kind: "ready", source: payload.source, changes: payload.changes }))
      .catch((loadError: Error) => !cancelled && setState({ kind: "error", message: loadError.message }));
    return () => {
      cancelled = true;
    };
  }, [projectId, source?.importedSha, refreshKey, reload]);

  const changes = state.kind === "ready" ? state.changes : [];
  const current = state.kind === "ready" ? state.source : source;

  const draft = useCallback(async () => {
    setDrafting(true);
    setError(null);
    try {
      const payload = await api<{ message: string }>(`/api/projects/${projectId}/security/commit-message`, { method: "POST" });
      setMessage(payload.message);
      setPrTitle((existing) => existing || payload.message.split("\n")[0]);
    } catch (draftError) {
      setError(draftError instanceof Error ? `${draftError.message} Write the message yourself, or try again.` : "The agent couldn't write a message.");
    } finally {
      setDrafting(false);
    }
  }, [projectId]);

  // The agent writes the commit message as soon as there is something to commit; later drafts are on request.
  const hasChanges = changes.length > 0;
  const [autoDrafted, setAutoDrafted] = useState(false);
  if (hasChanges && !autoDrafted && !message && !drafting) {
    setAutoDrafted(true);
    queueMicrotask(() => void draft());
  }

  async function push() {
    if (!current) return;
    const branchName = target === "current" ? current.branch : branch.trim();
    setPushing(true);
    setError(null);
    try {
      const payload = await api<PushResult>(`/api/projects/${projectId}/security/push`, {
        method: "POST",
        body: JSON.stringify({
          message,
          branch: branchName,
          createBranch: target === "new",
          ...(target === "new" && openPr ? { pullRequest: { title: prTitle.trim() || message.split("\n")[0], body: message } } : {}),
        }),
      });
      setResult(payload);
      setMessage("");
      setPrTitle("");
      toast.success(payload.pullRequest ? `Pushed and opened pull request #${payload.pullRequest.number}.` : `Pushed ${payload.filesChanged} files to ${payload.branch}.`);
      setReload((value) => value + 1);
      onPushed();
    } catch (pushError) {
      setError(pushError instanceof Error ? pushError.message : "The push failed. Try again.");
    } finally {
      setPushing(false);
    }
  }

  if (!source) {
    return (
      <section className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-[13px] text-white/55">
        No repository is attached to this security project. Start a new review from Security mode and choose one.
      </section>
    );
  }

  const baseBranch = current?.baseBranch ?? current?.branch ?? "main";
  const branchValid = target === "current" || isValidBranchName(branch.trim());
  const pushingToBase = target === "current" && current?.branch === baseBranch;
  const canPush = canCommit && hasChanges && message.trim().length >= 3 && branchValid && !pushing && !drafting;

  return (
    <section aria-labelledby={`${id}-heading`} className="rounded-lg border border-white/10 bg-white/[0.02]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
        <h3 id={`${id}-heading`} className="flex items-center gap-2 text-[14px] font-semibold text-white">
          <GitHubMark className="size-4" aria-hidden="true" /> Repository
        </h3>
        <a
          href={`https://github.com/${source.fullName}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-mono text-[12.5px] text-white/70 hover:text-white"
        >
          {source.fullName} <ExternalLink className="size-3" aria-hidden="true" />
        </a>
      </div>

      <div className="space-y-4 p-4">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] tabular-nums text-white/45">
          <GitBranch className="size-3.5" aria-hidden="true" />
          <span>
            Working on <code className="font-mono text-white/75">{current?.branch}</code>
          </span>
          {current?.importedSha ? (
            <>
              <span>at</span>
              <a href={`https://github.com/${source.fullName}/commit/${current.importedSha}`} target="_blank" rel="noreferrer" className="font-mono text-white/70 hover:text-white">
                {current.importedSha.slice(0, 7)}
              </a>
            </>
          ) : null}
          {current?.importedAt ? <time dateTime={current.importedAt}>· {formatRelativeDate(current.importedAt)}</time> : null}
        </p>
        <p className="rounded-lg bg-white/[0.03] px-3 py-2.5 text-[12px] leading-5 text-white/55">
          The agent can&apos;t commit or push. You review its changes here, then commit and push them with your GitHub account.
        </p>

        {!source.importedSha ? (
          <p className="text-[13px] text-white/55">Send the agent a message to import the repository. Its changes will show up here.</p>
        ) : state.kind === "loading" ? (
          <p className="flex items-center gap-2 text-[13px] text-white/50" role="status">
            <PixelLoader /> Checking for changes…
          </p>
        ) : state.kind === "error" ? (
          <div className="text-[13px] text-white/60" role="alert">
            <p>{state.message}</p>
            <button type="button" onClick={() => setReload((value) => value + 1)} className={cn(secondary, "mt-2")}>
              Try again
            </button>
          </div>
        ) : (
          <>
            <div>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12.5px] font-medium text-white/80">
                  {changes.length ? `${changes.length} ${changes.length === 1 ? "file" : "files"} changed` : "No changes to commit"}
                </p>
                <button
                  type="button"
                  onClick={() => setReload((value) => value + 1)}
                  aria-label="Check for changes again"
                  title="Check for changes again"
                  className="grid size-8 place-items-center rounded-lg text-white/55 hover:bg-white/[0.07] hover:text-white [@media(pointer:coarse)]:size-11"
                >
                  <RefreshCw className="size-3.5" />
                </button>
              </div>
              {changes.length ? (
                <ul className="mt-1.5 max-h-48 divide-y divide-white/[0.05] overflow-y-auto rounded-lg border border-white/[0.08]">
                  {changes.map((change) => (
                    <li key={change.path} className="flex items-center gap-2 px-3 py-1.5 text-[12px]">
                      <span
                        className={cn(
                          "w-4 shrink-0 text-center font-mono font-semibold",
                          change.kind === "added" ? "text-emerald-300" : change.kind === "deleted" ? "text-rose-300" : "text-amber-200",
                        )}
                        aria-label={change.kind}
                      >
                        {change.kind === "added" ? "A" : change.kind === "deleted" ? "D" : "M"}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-white/75" title={change.path}>{change.path}</span>
                      <span className="shrink-0 font-mono tabular-nums">
                        {change.added ? <span className="text-emerald-300">+{change.added}</span> : null}
                        {change.removed ? <span className="ml-1 text-rose-300">−{change.removed}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-[12px] text-white/40">Ask the agent to fix something, and its edits appear here.</p>
              )}
            </div>

            {changes.length ? (
              <>
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor={`${id}-message`} className="text-[12.5px] font-medium text-white/80">
                      Commit message
                    </label>
                    <button type="button" onClick={() => void draft()} disabled={drafting} className={cn(secondary, "h-7 px-2.5")}>
                      {drafting ? <PixelLoader /> : <Sparkles className="size-3.5" aria-hidden="true" />}
                      {drafting ? "Writing…" : message ? "Rewrite" : "Write with agent"}
                    </button>
                  </div>
                  <textarea
                    id={`${id}-message`}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    rows={7}
                    spellCheck={false}
                    placeholder={drafting ? "The agent is writing the commit message…" : "fix(auth): …"}
                    className={cn(field, "mt-1.5 resize-y py-2 font-mono text-[12.5px] leading-5")}
                  />
                </div>

                <fieldset>
                  <legend className="text-[12.5px] font-medium text-white/80">Push to</legend>
                  <div className="mt-1.5 space-y-1.5">
                    <label className="flex min-h-8 items-center gap-2 text-[12.5px] text-white/75">
                      <input type="radio" name={`${id}-target`} checked={target === "new"} onChange={() => setTarget("new")} className="size-4 accent-white" />
                      A new branch
                    </label>
                    {target === "new" ? (
                      <div className="ml-6 space-y-2">
                        <input
                          value={branch}
                          onChange={(event) => setBranch(event.target.value.replace(/\s+/g, "-"))}
                          aria-label="New branch name"
                          aria-invalid={!branchValid}
                          spellCheck={false}
                          className={cn(field, "h-9 font-mono [@media(pointer:coarse)]:h-11", !branchValid && "border-red-400/60")}
                        />
                        <label className="flex items-center gap-2 text-[12.5px] text-white/75">
                          <input type="checkbox" checked={openPr} onChange={(event) => setOpenPr(event.target.checked)} className="size-4 accent-white" />
                          Open a pull request into <code className="font-mono">{baseBranch}</code>
                        </label>
                        {openPr ? (
                          <input
                            value={prTitle}
                            onChange={(event) => setPrTitle(event.target.value)}
                            placeholder="Pull request title"
                            aria-label="Pull request title"
                            maxLength={200}
                            className={cn(field, "h-9 [@media(pointer:coarse)]:h-11")}
                          />
                        ) : null}
                      </div>
                    ) : null}
                    <label className="flex min-h-8 items-center gap-2 text-[12.5px] text-white/75">
                      <input type="radio" name={`${id}-target`} checked={target === "current"} onChange={() => setTarget("current")} className="size-4 accent-white" />
                      <span>
                        Straight to <code className="font-mono">{current?.branch}</code>
                      </span>
                    </label>
                    {pushingToBase ? (
                      <p className="ml-6 text-[11.5px] leading-5 text-amber-200/80">This commits directly to the default branch. A pull request lets others review it first.</p>
                    ) : null}
                  </div>
                </fieldset>

                {error ? (
                  <p role="alert" className="rounded-md bg-red-500/10 px-3 py-2 text-[12.5px] leading-5 text-red-300">
                    {error}
                  </p>
                ) : null}

                <div className="flex justify-end">
                  <button type="button" onClick={() => void push()} disabled={!canPush} className={primary}>
                    {pushing ? <PixelLoader className="text-black" /> : target === "new" && openPr ? <GitPullRequest className="size-3.5" aria-hidden="true" /> : <UploadCloud className="size-3.5" aria-hidden="true" />}
                    {pushing ? "Pushing…" : target === "new" && openPr ? "Commit, push, and open PR" : "Commit and push"}
                  </button>
                </div>
                {!canCommit ? <p className="text-right text-[11.5px] text-white/40">Wait for the agent to finish first.</p> : null}
              </>
            ) : null}

            {result ? (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-emerald-400/[0.06] px-3 py-2 text-[12.5px] text-emerald-200" role="status">
                Pushed {result.filesChanged} {result.filesChanged === 1 ? "file" : "files"} to <code className="font-mono">{result.branch}</code>.
                <a href={result.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono hover:text-white">
                  {result.sha.slice(0, 7)} <ExternalLink className="size-3" aria-hidden="true" />
                </a>
                {result.pullRequest ? (
                  <a href={result.pullRequest.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium hover:text-white">
                    Pull request #{result.pullRequest.number} <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                ) : null}
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
