/**
 * Shared shape for Cognix's first-party internal design skills.
 * These skills are never exposed in the public `/skills` menu or the database `skills`
 * table — they run automatically inside Cognix's Build and Plan prompts.
 */
export type InternalDesignSkill = {
  name: string;
  description: string;
  instructions: readonly string[];
};

export function renderInternalDesignSkill(tag: string, skill: InternalDesignSkill): string {
  return `<${tag} name="${skill.name}">\nDescription: ${skill.description}\n\n${skill.instructions.map((line) => `- ${line}`).join("\n")}\n</${tag}>`;
}
