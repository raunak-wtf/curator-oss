import { z } from "zod";
import { GitHubError } from "../github/client";
import { commitProjectToGitHub } from "../github/sync";
import type { GitHubCommitInfo, Project } from "../types";

export const GITHUB_TOOL_NAME = "commit_to_github";

export const githubTool = {
  type: "function" as const,
  function: {
    name: GITHUB_TOOL_NAME,
    description:
      "Commit the project's current files to its linked GitHub repository and push to the default branch. Cognix runs the commit on its server; the sandbox has no GitHub credentials. Use it after the production build passes, with a clear commit message.",
    parameters: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "Conventional-commit message describing the actual edits, e.g. 'feat(feed): add infinite scroll to posts', then a blank line and 2-5 bullets naming the key files changed. First line under 72 characters.",
        },
      },
      required: ["message"],
      additionalProperties: false,
    },
  },
};

const inputSchema = z.object({ message: z.string().trim().min(3).max(2_000) });

/** Commits for the agent. The agent can never commit over changes made outside Cognix. */
export async function runGitHubCommit(project: Project, rawInput: unknown): Promise<{ output: string; summary: string; info: GitHubCommitInfo }> {
  const { message } = inputSchema.parse(rawInput);
  try {
    const result = await commitProjectToGitHub({ project, ownerId: project.ownerId, message });
    if (result.status === "unchanged") {
      return { output: "Nothing to commit: GitHub already has these files.", summary: "GitHub is up to date", info: { status: "unchanged" } };
    }
    if (result.status === "diverged") {
      return {
        output: `GitHub and Cognix have both changed ${result.repository.defaultBranch}. Cognix's version was pushed to the ${result.branch} branch instead (${result.url}). Tell the user to merge it on GitHub with a pull request, or choose Use GitHub's version in Git Control.`,
        summary: `Pushed to ${result.branch}: branches diverged`,
        info: { status: "diverged", branch: result.branch, url: result.url },
      };
    }
    return {
      output: `Committed ${result.filesChanged} file changes to ${result.repository.fullName}@${result.repository.defaultBranch}: ${result.url}`,
      summary: `Committed to ${result.repository.fullName}`,
      info: { status: "committed", sha: result.sha, url: result.url, filesChanged: result.filesChanged },
    };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "The commit failed.";
    const code = error instanceof GitHubError ? error.code : "unavailable";
    return {
      output: `Commit failed (${code}): ${messageText} Do not retry in a loop. Tell the user what happened and how to fix it in the Git Control tab.`,
      summary: "GitHub commit needs attention",
      info: { status: "error", message: messageText, code },
    };
  }
}
