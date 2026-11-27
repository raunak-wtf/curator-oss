import { isCloudFeature } from "./cloud-features";
import type { AgentQuestionRequest, Message, PullRequestProposal } from "./types";

/** Reads a saved question request from an assistant message, ignoring malformed data. */
export function questionRequestFor(message: Message): AgentQuestionRequest | null {
  const value = message.metadata.questions as Partial<AgentQuestionRequest> | undefined;
  if (!value || typeof value !== "object") return null;
  if (value.kind === "enable_cloud") {
    const features = Array.isArray(value.features) ? value.features.filter(isCloudFeature) : [];
    return typeof value.reason === "string" && features.length ? { kind: "enable_cloud", reason: value.reason, features } : null;
  }
  if (value.kind === "pull_request") {
    const proposal = (value as { proposal?: Partial<PullRequestProposal> }).proposal;
    if (
      proposal &&
      typeof proposal.title === "string" &&
      typeof proposal.body === "string" &&
      typeof proposal.branch === "string" &&
      typeof proposal.commitMessage === "string"
    ) {
      return { kind: "pull_request", proposal: { title: proposal.title, body: proposal.body, branch: proposal.branch, commitMessage: proposal.commitMessage } };
    }
    return null;
  }
  if (value.kind === "questions" && Array.isArray(value.questions)) {
    const questions = value.questions.filter(
      (item) =>
        item &&
        typeof item.question === "string" &&
        (item.type === "single" || item.type === "multiple") &&
        Array.isArray(item.options) &&
        item.options.every((option) => typeof option === "string"),
    );
    return questions.length ? { kind: "questions", questions } : null;
  }
  return null;
}

/** Turns the user's answers into their next prompt for the agent. */
export function formatAnswers(request: Extract<AgentQuestionRequest, { kind: "questions" }>, answers: string[][]) {
  const lines = request.questions.map((question, index) => {
    const answer = answers[index];
    return `- ${question.question}\n  ${answer?.length ? answer.join(", ") : "(skipped, use your best judgment)"}`;
  });
  return `Here are my answers:\n\n${lines.join("\n")}`;
}

export const CLOUD_ENABLED_PROMPT =
  "I approved and turned on Cognix Cloud. Continue the build using the Cognix Cloud stack (Managed Neon PostgreSQL with Drizzle, Better Auth, Resend, and Cognix Cloud Storage as needed).";
export const CLOUD_DECLINED_PROMPT =
  "Don't turn on Cognix Cloud for now. Continue without a database, file storage, sign-in, or email, and tell me what that leaves out.";
