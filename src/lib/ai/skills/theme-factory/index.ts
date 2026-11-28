import { renderInternalDesignSkill, type InternalDesignSkill } from "../internal-skill";

/**
 * First-party theme-token curation layer, adapted from Anthropic's theme-factory skill
 * (https://github.com/anthropics/skills): a theme is a curated palette + font pairing chosen
 * once, recorded as tokens, and applied consistently — extended with custom themes when
 * presets do not fit. Always active in Build mode; never exposed as a user slash-skill.
 */
export const THEME_FACTORY_SKILLS: readonly InternalDesignSkill[] = [
  {
    name: "theme-token-curation",
    description: "Curate one cohesive theme (palette + type + tokens) per product and apply it consistently everywhere.",
    instructions: [
      "Treat a theme as a deliberate unit: a small named palette (canvas, surfaces, text roles, border, one accent, status colors) plus its font pairing, chosen once for the product's world — then applied consistently across every route and component so the app feels like one system rather than per-page improvisation.",
      "Record the theme as semantic CSS custom properties in the global stylesheet (and the Tailwind theme config when present) and reuse those tokens; never scatter raw hex values through components. When a value the theme lacks is needed, extend the token set once instead of hardcoding another one-off.",
      "In existing projects, adopt and extend the established token system instead of introducing a parallel one; a restyle updates the tokens first and the components follow.",
      "When a fresh identity is needed, compose a custom theme like a curator: mood and domain first, then a palette and type pairing that would look wrong on a different product, verifying WCAG AA contrast for every text and control role before committing.",
    ],
  },
];

export function themeFactorySkillSection(): string {
  const skills = THEME_FACTORY_SKILLS.map((skill) => renderInternalDesignSkill("theme-skill", skill)).join("\n\n");
  return `### Theme curation skills\n\n${skills}`;
}
