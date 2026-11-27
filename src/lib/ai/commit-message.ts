import type { FileChangeSnapshot } from "../types";
import { completeText, isCompletionConfigured } from "./complete";

export type CommitChange = { path: string; kind: "added" | "modified" | "deleted"; added?: number; removed?: number };

const SUBJECT_MAX = 72;

/** Line counts per file, from the before/after snapshots the agent's file tools record. */
export function changesFromSnapshots(paths: string[], snapshots: FileChangeSnapshot[]): CommitChange[] {
  const byPath = new Map(snapshots.map((snapshot) => [snapshot.path, snapshot]));
  return paths.map((path) => {
    const snapshot = byPath.get(path);
    if (!snapshot) return { path, kind: "modified" };
    const before = snapshot.before === null ? [] : snapshot.before.split("\n");
    const after = snapshot.after === null ? [] : snapshot.after.split("\n");
    const kind = snapshot.before === null ? "added" : snapshot.after === null ? "deleted" : "modified";
    // A cheap line-set difference; exact diff counts aren't needed for a message.
    const beforeSet = new Set(before);
    const afterSet = new Set(after);
    return {
      path,
      kind,
      added: after.filter((line) => !beforeSet.has(line)).length,
      removed: before.filter((line) => !afterSet.has(line)).length,
    };
  });
}

function fallbackMessage(changes: CommitChange[]) {
  const names = changes.slice(0, 3).map((change) => change.path.split("/").at(-1));
  const verb = changes.every((change) => change.kind === "added") ? "Add" : changes.every((change) => change.kind === "deleted") ? "Remove" : "Update";
  const subject = `${verb} ${names.join(", ")}${changes.length > 3 ? ` and ${changes.length - 3} more` : ""}`;
  const body = changes.slice(0, 20).map((change) => `- ${change.kind} ${change.path}`).join("\n");
  return `${subject.slice(0, SUBJECT_MAX)}\n\n${body}`;
}

/** Keeps a model-written message in Git's shape: one subject line, a blank line, then the body. */
function normalize(text: string) {
  const cleaned = text
    .replace(/^\s*```[\w-]*\n?|\n?```\s*$/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
  const [first = "", ...rest] = cleaned.split("\n");
  const subject = first.replace(/^(subject|commit message)\s*:\s*/i, "").replace(/^["'`]|["'`]$/g, "").replace(/\.$/, "").trim();
  if (!subject) return null;
  const body = rest.join("\n").trim();
  const shortSubject = subject.length > SUBJECT_MAX ? `${subject.slice(0, SUBJECT_MAX - 1).trimEnd()}…` : subject;
  return (body ? `${shortSubject}\n\n${body}` : shortSubject).slice(0, 2_000);
}

const SYSTEM = `You write Git commit messages for changes an AI coding agent made to a web app.

Format:
- Line 1: a conventional-commit subject such as "feat(feed): add infinite scroll to posts" or "fix(auth): redirect after sign-in". Imperative mood, lowercase after the type, at most ${SUBJECT_MAX} characters, no trailing period.
- Line 2: blank.
- Then 2-5 short bullets ("- ") describing what changed and why, naming the important files or components.

Types: feat, fix, style, refactor, perf, docs, test, chore, build.
Describe the actual changes in the file list, not the process. Never mention AI, agents, Cognix, or tools. Never include secrets or URLs.
Return only the commit message.`;

/** A commit message based on what changed, written by the model, with a deterministic fallback. */
export async function writeCommitMessage(input: { request?: string; summary?: string; changes: CommitChange[] }) {
  if (!input.changes.length) return "chore: sync project files";
  if (!isCompletionConfigured) return fallbackMessage(input.changes);
  const files = input.changes
    .slice(0, 60)
    .map((change) => `${change.kind.padEnd(8)} ${change.path}${change.added !== undefined ? ` (+${change.added} -${change.removed ?? 0})` : ""}`)
    .join("\n");
  const user = [
    input.request ? `User request:\n${input.request.slice(0, 1_500)}` : null,
    input.summary ? `Agent's summary of the work:\n${input.summary.slice(0, 3_000)}` : null,
    `Changed files (${input.changes.length}):\n${files}${input.changes.length > 60 ? `\n…and ${input.changes.length - 60} more` : ""}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  try {
    return normalize(await completeText({ system: SYSTEM, user, temperature: 0.2 })) ?? fallbackMessage(input.changes);
  } catch {
    return fallbackMessage(input.changes);
  }
}
