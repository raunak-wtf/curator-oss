import { isCloudFeature, type CloudFeature } from "./cloud-features";
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
  "I approved and turned on Cognix Cloud. Continue the build using the Cognix Cloud stack (Managed Neon PostgreSQL with Drizzle, Better Auth, Resend, and Cognix Cloud Storage as needed), run the production build, and update the preview.";
export const CLOUD_DECLINED_PROMPT =
  "Don't turn on Cognix Cloud for now. Continue without a database, file storage, sign-in, or email, and tell me what that leaves out.";

/**
 * Builds the prompt automatically sent to the coding agent when the user turns on Cognix Cloud
 * from the Cloud panel so the agent inspects the app and wires Cognix Cloud into it right away.
 */
export function cloudWireUpPromptFor(feature?: CloudFeature): string {
  switch (feature) {
    case "database":
      return "I turned on Cognix Cloud from the Database tab. Inspect the current app, call read_cloud_guide for database, and wire up Managed Neon PostgreSQL with Drizzle ORM (`DATABASE_URL`) so the app's data persists in Postgres instead of mock, local, or legacy storage—creating and applying the schema and server queries/actions—then run the production build and update the preview.";
    case "storage":
      return "I turned on Cognix Cloud from the Storage tab. Inspect the current app, call read_cloud_guide for storage, and wire up Cognix Cloud Storage (`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_CDN_URL`) using `@aws-sdk/client-s3` (`forcePathStyle: true`) for file and media uploads and delivery—plus Managed Neon PostgreSQL with Drizzle ORM if upload metadata needs persistence—then run the production build and update the preview.";
    case "email":
      return "I turned on Cognix Cloud from the Emails tab. Inspect the current app, call read_cloud_guide for email, and wire up transactional email support with Resend (`RESEND_API_KEY` and `EMAIL_FROM`, degrading gracefully if `RESEND_API_KEY` is not set yet) into the app's email flows, then run the production build and update the preview.";
    case "auth":
      return "I turned on Cognix Cloud from the Authentication tab. Inspect the current app, call read_cloud_guide for auth, database, and email, and wire up Better Auth backed by Managed Neon PostgreSQL (`DATABASE_URL` and `BETTER_AUTH_SECRET`)—including the auth schema tables in Postgres, `/api/auth/[...all]` route handler, sign-in and sign-up UI, and protected user state—then run the production build and update the preview.";
    default:
      return "I turned on Cognix Cloud for this project. Inspect the current app and wire up Cognix Cloud wherever the app needs backend capabilities—migrating any mock, local, in-memory, or legacy code to Managed Neon PostgreSQL with Drizzle ORM, Better Auth, Cognix Cloud Storage, and Resend as appropriate (calling read_cloud_guide for each feature you wire)—then run the production build and update the preview.";
  }
}
