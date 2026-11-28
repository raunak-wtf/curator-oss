import { ZodError } from "zod";

function sanitizeServerMessage(raw: string): string {
  return raw
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "postgresql://[redacted]")
    .replace(/\b(?:sk|dodo|whsec|ghp|ghs)_[A-Za-z0-9_-]{12,}/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]{16,}/gi, "Bearer [redacted]");
}

export function errorResponse(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof ZodError) {
    return Response.json(
      { error: "Check the highlighted fields and try again.", details: error.flatten() },
      { status: 400 },
    );
  }
  const rawMessage = error instanceof Error ? error.message : "Something went wrong. Try again.";
  const message = sanitizeServerMessage(rawMessage || "Something went wrong. Try again.");
  // Errors that carry their own client status describe a request problem, not a server fault.
  if (error instanceof Error && "status" in error) {
    const status = Number((error as Error & { status: unknown }).status);
    if (Number.isInteger(status) && status >= 400 && status < 600) {
      return Response.json({ error: message }, { status });
    }
  }
  return Response.json({ error: message }, { status: 500 });
}

export function notFound(message = "This project was not found or you no longer have access.") {
  return Response.json({ error: message }, { status: 404 });
}
