import OpenAI from "openai";
import { isRetryableModelError } from "./model-stream";

export const isCompletionConfigured = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL);

const COMPLETE_TIMEOUT_MS = 45_000;
const COMPLETE_BACKOFF_MS = [800, 2_000] as const;

/** Runs one non-streaming chat completion with timeout and transient error retries. */
export async function completeText(input: { system: string; user: string; temperature?: number }) {
  if (!isCompletionConfigured) {
    throw Object.assign(
      new Error("The AI model is not connected. Add OPENAI_API_KEY and OPENAI_MODEL, or write the skill with /new-skill."),
      { status: 503 },
    );
  }
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    defaultHeaders: { "User-Agent": "Cognix/1.0" },
    maxRetries: 0,
    timeout: COMPLETE_TIMEOUT_MS,
  });

  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await client.chat.completions.create(
        {
          model: process.env.OPENAI_MODEL!,
          temperature: input.temperature ?? 0.3,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.user },
          ],
        },
        { signal: AbortSignal.timeout(COMPLETE_TIMEOUT_MS) },
      );
      return response.choices[0]?.message?.content?.trim() ?? "";
    } catch (error) {
      lastError = error;
      if (attempt >= 3 || !isRetryableModelError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, COMPLETE_BACKOFF_MS[attempt - 1] ?? 2_000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Completion request failed.");
}
