import type { Skill, SkillDraft } from "@/lib/types";

export type FieldErrors = Partial<Record<"name" | "description" | "body", string>>;

export class SkillApiError extends Error {
  constructor(
    message: string,
    readonly fieldErrors: FieldErrors = {},
    readonly status = 0,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init: RequestInit, fallback: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: init.body ? { "Content-Type": "application/json", ...init.headers } : init.headers,
    });
  } catch {
    throw new SkillApiError("Cognix could not reach the server. Check your connection and try again.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new SkillApiError("Your session ended. Sign in again to use skills.", {}, 401);
    const details = payload?.details?.fieldErrors as Record<string, string[] | undefined> | undefined;
    const fieldErrors: FieldErrors = {};
    for (const key of ["name", "description", "body"] as const) {
      const message = details?.[key]?.[0];
      if (message) fieldErrors[key] = message;
    }
    throw new SkillApiError(payload?.error ?? fallback, fieldErrors, response.status);
  }
  return payload as T;
}

export const skillApi = {
  list: () => request<{ skills: Skill[] }>("/api/skills", { cache: "no-store" }, "Could not load your skills.").then((p) => p.skills),
  generate: (description: string) =>
    request<{ draft: SkillDraft }>(
      "/api/skills/generate",
      { method: "POST", body: JSON.stringify({ request: description }) },
      "The AI could not write that skill. Try again.",
    ).then((p) => p.draft),
  import: (url: string) =>
    request<{ draft: SkillDraft }>(
      "/api/skills/import",
      { method: "POST", body: JSON.stringify({ url }) },
      "Could not install that skill. Check the link and try again.",
    ).then((p) => p.draft),
  create: (draft: SkillDraft) =>
    request<{ skill: Skill }>("/api/skills", { method: "POST", body: JSON.stringify(draft) }, "Could not save the skill.").then(
      (p) => p.skill,
    ),
  update: (id: string, fields: Pick<SkillDraft, "name" | "description" | "body">) =>
    request<{ skill: Skill }>(
      `/api/skills/${id}`,
      { method: "PATCH", body: JSON.stringify(fields) },
      "Could not save the skill.",
    ).then((p) => p.skill),
  remove: (id: string) =>
    request<{ deleted: true }>(`/api/skills/${id}`, { method: "DELETE" }, "Could not delete the skill. Try again."),
};
