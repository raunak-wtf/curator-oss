import { z } from "zod";
import { isValidBranchName } from "../github/names";
import type { AgentApprovalItem, AgentQuestionRequest } from "../types";

export const PULL_REQUEST_TOOL_NAME = "propose_pull_request";

/**
 * The agent can't push. It can only propose a pull request; the user sees it in the chat, can edit it,
 * and Cognix opens it with the user's own GitHub token only after they approve.
 */
export const pullRequestTool = {
  type: "function" as const,
  function: {
    name: PULL_REQUEST_TOOL_NAME,
    description:
      "Propose a GitHub pull request with the changes you made in this project. Nothing is pushed until the user approves it in the chat; Cognix then commits your changes to a new branch with your commit message and opens the pull request. Call it once your fixes are complete and verified, then stop and wait.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Pull request title under 72 characters, e.g. 'fix(auth): check session ownership before deleting posts'." },
        body: {
          type: "string",
          description: "Markdown body: a summary, a 'Changes' list naming each edited file and what changed, a 'Security impact' section, and how you verified it.",
        },
        branch: { type: "string", description: "New branch name, e.g. 'cognix/fix-idor-posts'. Must not exist yet." },
        commit_message: {
          type: "string",
          description: "Detailed conventional-commit message: a subject under 72 characters, a blank line, then bullets for each change and why.",
        },
      },
      required: ["title", "body", "branch", "commit_message"],
      additionalProperties: false,
    },
  },
};

const proposalSchema = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().max(20_000).default(""),
  branch: z.string().trim().min(1).max(200),
  commit_message: z.string().trim().min(3).max(5_000),
});

export function runPullRequestProposal(rawInput: unknown, alreadyAsked: boolean): { output: string; summary: string; request?: AgentQuestionRequest } {
  if (alreadyAsked) {
    return { output: "You already asked the user something in this turn. Stop now and wait for their reply.", summary: "Waiting for the user's answer" };
  }
  const input = proposalSchema.parse(rawInput);
  const branch = input.branch.replace(/\s+/g, "-");
  if (!isValidBranchName(branch)) {
    return { output: `"${input.branch}" isn't a valid branch name. Use letters, numbers, dots, dashes, underscores, or slashes, then propose again.`, summary: "Needs attention: invalid branch name" };
  }
  return {
    output: "The pull request is shown to the user for approval. Stop calling tools now and end your turn with one short sentence; Cognix opens it if they approve.",
    summary: `Proposed a pull request: ${input.title}`,
    request: { kind: "pull_request", proposal: { title: input.title, body: input.body, branch, commitMessage: input.commit_message } },
  };
}

/** Tools that change files or run code. In Request review mode each call waits for the user's approval. */
export const APPROVAL_TOOLS = new Set(["write_file", "edit_file", "move_file", "delete_file", "run_command"]);

const MAX_DETAIL = 4_000;

function clip(value: string) {
  return value.length > MAX_DETAIL ? `${value.slice(0, MAX_DETAIL)}\n…` : value;
}

/** What the approval card shows for one pending tool call. */
export function describeApproval(callId: string, tool: string, rawInput: unknown): AgentApprovalItem {
  const input = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
  const text = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : "");
  if (tool === "run_command") {
    return { callId, tool, kind: "command", title: `Run ${text("command").split("\n")[0].slice(0, 120) || "a command"}`, detail: clip(text("command")) };
  }
  if (tool === "write_file") {
    return { callId, tool, kind: "edit", title: `Write ${text("path") || "a file"}`, detail: clip(text("content")) };
  }
  if (tool === "edit_file") {
    const before = text("old_string") || text("oldText") || text("search");
    const after = text("new_string") || text("newText") || text("replace");
    const detail = before || after
      ? `${before.split("\n").map((line) => `- ${line}`).join("\n")}\n${after.split("\n").map((line) => `+ ${line}`).join("\n")}`
      : JSON.stringify(input, null, 2);
    return { callId, tool, kind: "edit", title: `Edit ${text("path") || "a file"}`, detail: clip(detail) };
  }
  if (tool === "move_file") {
    const from = text("from") || text("source") || text("path");
    const to = text("to") || text("destination");
    return { callId, tool, kind: "edit", title: `Move ${from} to ${to}`, detail: `${from} → ${to}` };
  }
  return { callId, tool, kind: "edit", title: `Delete ${text("path") || "a file"}`, detail: text("path") };
}
