import OpenAI from "openai";

export const isCompletionConfigured = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL);

/** Runs one non-streaming chat completion and returns its text. Used for small tasks outside the build agent. */
export async function completeText(input: { system: string; user: string; temperature?: number }) {
  if (!isCompletionConfigured) {
    throw Object.assign(new Error("The AI model is not connected. Add OPENAI_API_KEY and OPENAI_MODEL, or write the skill with /new-skill."), {
      status: 503,
    });
  }
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    defaultHeaders: { "User-Agent": "Cognix/1.0" },
  });
  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL!,
    temperature: input.temperature ?? 0.3,
    messages: [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ],
  });
  return response.choices[0]?.message?.content?.trim() ?? "";
}
