"use client";

import { FilePen, TerminalSquare } from "lucide-react";
import { useState } from "react";
import { AgentQuestionCard } from "@/components/agent-question-card";
import type { AgentApprovalDecision, AgentApprovalRequest } from "@/lib/types";
import { cn } from "@/lib/utils";

const ALLOW = "Allow";
const ALLOW_REST = "Allow, and don't ask again this run";
const DENY = "Deny";

function Detail({ kind, detail }: { kind: "edit" | "command"; detail: string }) {
  if (!detail) return null;
  return (
    <pre
      className={cn(
        "max-h-48 overflow-auto whitespace-pre rounded-lg border border-white/[0.08] bg-black/40 px-3 py-2 font-mono text-[11.5px] leading-[1.6] text-white/75",
        kind === "command" && "text-sky-200/90",
      )}
    >
      {kind === "edit"
        ? detail.split("\n").map((line, index) => (
            <span
              key={index}
              className={cn("block", line.startsWith("+ ") && "text-emerald-300", line.startsWith("- ") && "text-rose-300")}
            >
              {line || " "}
            </span>
          ))
        : detail}
    </pre>
  );
}

/**
 * Request review mode: the agent waits here before changing files or running commands.
 * One action per step. Each can be allowed, denied, or denied with a note telling the agent what to do instead.
 * Skipping an action denies it.
 */
export function ApprovalCard({
  projectId,
  approval,
  onSent,
}: {
  projectId: string;
  approval: AgentApprovalRequest;
  onSent: () => void;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function send(answers: string[][]) {
    setState("sending");
    setError(null);
    let allowRestOfRun = false;
    const decisions: AgentApprovalDecision[] = approval.items.map((item, index) => {
      const answer = answers[index] ?? [];
      const choice = answer.find((value) => value === ALLOW || value === ALLOW_REST || value === DENY);
      const note = answer.find((value) => value !== ALLOW && value !== ALLOW_REST && value !== DENY);
      if (choice === ALLOW_REST) allowRestOfRun = true;
      if (choice === ALLOW || choice === ALLOW_REST) return { callId: item.callId, decision: "allow" };
      return { callId: item.callId, decision: "deny", ...(note ? { note } : {}) };
    });
    try {
      const response = await fetch(`/api/projects/${projectId}/agent/approvals/${approval.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions, allowRestOfRun }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Your answer wasn't saved.");
      setState("sent");
      onSent();
    } catch (sendError) {
      setState("error");
      setError(sendError instanceof Error ? sendError.message : "Your answer wasn't saved.");
    }
  }

  if (state === "sent") {
    return (
      <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2.5 py-1 text-[12px] font-medium text-emerald-300" role="status">
        Answer sent. The agent is continuing.
      </p>
    );
  }

  const count = approval.items.length;
  return (
    <div>
      <AgentQuestionCard
        key={approval.id}
        wide
        dismissible={false}
        disabled={state === "sending"}
        intro={
          <span className="inline-flex items-center gap-1.5">
            {approval.items.every((item) => item.kind === "command") ? <TerminalSquare className="size-3.5" aria-hidden="true" /> : <FilePen className="size-3.5" aria-hidden="true" />}
            {count === 1 ? "The agent wants to do this. Allow it?" : `The agent wants to take ${count} actions. Review each one.`}
          </span>
        }
        questions={approval.items.map((item) => ({
          question: item.title,
          type: "single" as const,
          options: [ALLOW, ALLOW_REST, DENY],
          detail: <Detail kind={item.kind} detail={item.detail} />,
        }))}
        labels={{ skip: "Deny", send: state === "sending" ? "Sending…" : "Send", customPlaceholder: "Deny, and tell the agent what to do instead…" }}
        onSubmit={(answers) => void send(answers)}
      />
      {state === "error" && error ? (
        <p role="alert" className="mt-2 max-w-[520px] rounded-md bg-red-500/10 px-2.5 py-1.5 text-[12px] leading-5 text-red-300">
          {error} Answer again, or send the agent a message to continue.
        </p>
      ) : null}
    </div>
  );
}
