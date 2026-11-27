import { errorResponse } from "../http";
import { GitHubError } from "./client";

/** JSON error that keeps GitHub's machine-readable code, so the UI can offer the right recovery action. */
export function githubErrorResponse(error: unknown) {
  if (error instanceof GitHubError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  return errorResponse(error);
}
