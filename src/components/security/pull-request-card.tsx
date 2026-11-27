"use client";

import { ExternalLink, GitPullRequest } from "lucide-react";
import { useId, useState } from "react";
import { PixelLoader } from "@/components/pixel-loader";
import type { PullRequestProposal } from "@/lib/types";
import { cn } from "@/lib/utils";

type Decision = { status: "opened"; url: string; number: number | null } | { status: "declined" } | null;

export function pullRequestDecisionFor(metadata: Record<string, unknown>): Decision {
  const value = metadata.pullRequestDecision as { status?: string; url?: unknown; number?: unknown } | undefined;
  if (value?.status === "opened" && typeof value.url === "string") return { status: "opened", url: value.url, number: typeof value.number === "number" ? value.number : null };
  if (value?.status === "declined") return { status: "declined" };
  return null;
}

const field =
  "w-full rounded-lg border border-white/[0.12] bg-[#181818] px-2.5 text-[12.5px] text-white outline-none placeholder:text-white/30 focus:border-white/35";

/**
 * The agent's pull request proposal. Nothing reaches GitHub until the user approves it here; they can edit the
 * title, branch, description, and commit message first.
 */
export function PullRequestCard({
  projectId,
  messageId,
  proposal,
  repository,
  baseBranch,
  decision,
  canAct,
  onDone,
}: {
  projectId: string;
  messageId: string;
  proposal: PullRequestProposal;
  repository: string | null;
  baseBranch: string | null;
  decision: Decision;
  /** False while the agent is running. */
  canAct: boolean;
  onDone: (result: Decision) => void;
}) {
  const [title, setTitle] = useState(proposal.title);
  const [branch, setBranch] = useState(proposal.branch);
  const [body, setBody] = useState(proposal.body);
  const [commitMessage, setCommitMessage] = useState(proposal.commitMessage);
  const [busy, setBusy] = useState<null | "approve" | "decline">(null);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  if (decision?.status === "opened") {
    return (
      <a
        href={decision.url}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-400/25 bg-emerald-400/[0.06] px-3 text-[12.5px] font-medium text-emerald-200 hover:bg-emerald-400/10 [@media(pointer:coarse)]:h-11"
      >
        <GitPullRequest className="size-3.5" aria-hidden="true" />
        {decision.number ? `Pull request #${decision.number} opened` : "Pull request opened"}
        <ExternalLink className="size-3" aria-hidden="true" />
      </a>
    );
  }
  if (decision?.status === "declined") {
    return <p className="mt-3 text-[12px] text-white/40">You declined this pull request.</p>;
  }

  async function answer(next: "approve" | "decline") {
    setBusy(next);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/security/pull-request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next === "approve" ? { messageId, decision: next, title, body, branch, commitMessage } : { messageId, decision: next }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "The pull request couldn't be opened.");
      onDone(
        next === "approve"
          ? { status: "opened", url: payload.pullRequest?.url ?? payload.url, number: payload.pullRequest?.number ?? null }
          : { status: "declined" },
      );
    } catch (answerError) {
      setError(answerError instanceof Error ? answerError.message : "The pull request couldn't be opened.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="mt-3 w-full max-w-[520px] overflow-hidden rounded-xl border border-white/10 bg-[#232323] shadow-[0_12px_32px_rgba(0,0,0,.35)]"
    >
      <div className="space-y-3 px-4 pb-3 pt-3.5">
        <div>
          <p id={`${id}-title`} className="flex items-center gap-2 text-[14px] font-medium text-white">
            <GitPullRequest className="size-4 text-white/60" aria-hidden="true" /> Open a pull request?
          </p>
          <p className="mt-1 text-[12px] leading-5 text-white/50">
            Cognix commits the changes to a new branch{repository ? ` in ${repository}` : ""} and opens a pull request
            {baseBranch ? <> into <code className="font-mono text-white/70">{baseBranch}</code></> : null}, as you. Edit anything first.
          </p>
        </div>
        <label className="block">
          <span className="text-[11.5px] font-medium text-white/55">Title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} className={cn(field, "mt-1 h-9 [@media(pointer:coarse)]:h-11")} />
        </label>
        <label className="block">
          <span className="text-[11.5px] font-medium text-white/55">New branch</span>
          <input value={branch} onChange={(event) => setBranch(event.target.value.replace(/\s+/g, "-"))} maxLength={200} spellCheck={false} className={cn(field, "mt-1 h-9 font-mono [@media(pointer:coarse)]:h-11")} />
        </label>
        <details className="group">
          <summary className="cursor-pointer select-none text-[12px] font-medium text-white/60 hover:text-white">Description and commit message</summary>
          <label className="mt-2 block">
            <span className="text-[11.5px] font-medium text-white/55">Description</span>
            <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={6} className={cn(field, "mt-1 resize-y py-2 leading-5")} />
          </label>
          <label className="mt-2 block">
            <span className="text-[11.5px] font-medium text-white/55">Commit message</span>
            <textarea value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} rows={5} spellCheck={false} className={cn(field, "mt-1 resize-y py-2 font-mono leading-5")} />
          </label>
        </details>
        {error ? (
          <p role="alert" className="rounded-md bg-red-500/10 px-2.5 py-1.5 text-[12px] leading-5 text-red-300">
            {error} Change the branch name or try again.
          </p>
        ) : null}
      </div>
      <div className="flex items-center justify-end gap-1.5 border-t border-white/[0.06] px-3 py-2">
        <button
          type="button"
          disabled={Boolean(busy) || !canAct}
          onClick={() => void answer("decline")}
          className="inline-flex h-7 items-center rounded-full px-3 text-[12.5px] font-semibold text-white/70 hover:bg-white/[0.07] hover:text-white disabled:opacity-40 [@media(pointer:coarse)]:h-11"
        >
          {busy === "decline" ? "Declining…" : "Not now"}
        </button>
        <button
          type="button"
          disabled={Boolean(busy) || !canAct || !title.trim() || !branch.trim() || commitMessage.trim().length < 3}
          onClick={() => void answer("approve")}
          className="inline-flex h-7 items-center gap-1.5 rounded-full bg-white px-3 text-[12.5px] font-semibold text-black hover:bg-white/85 disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:h-11"
        >
          {busy === "approve" ? <PixelLoader className="text-black" /> : null}
          {busy === "approve" ? "Opening…" : "Open pull request"}
        </button>
      </div>
    </section>
  );
}
