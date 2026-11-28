import { renderInternalDesignSkill, type InternalDesignSkill } from "../internal-skill";

/**
 * First-party distinctive-identity rules, adapted from Anthropic's frontend-design skill
 * (https://github.com/anthropics/skills): subject-grounded direction, anti-generic-AI tells,
 * two-pass design planning, boldness discipline, and copy-as-design-content.
 * Always active in Build mode; never exposed as a user slash-skill.
 */
export const FRONTEND_DESIGN_SKILLS: readonly InternalDesignSkill[] = [
  {
    name: "distinctive-visual-identity",
    description: "Give every project a visual identity that could not be mistaken for a template or another product.",
    instructions: [
      "Ground the visual direction in the subject matter: its industry, materials, audience, and vernacular are where distinctive choices come from. A children's toy, a financial analyst dashboard, and a neighborhood bakery must not share a look. Where the brief leaves an axis free, invest that freedom in subject-specific choices — not in a familiar default.",
      "Recognize and avoid the generic AI-design tells unless the brief explicitly asks for them: warm cream + high-contrast serif + terracotta accent; near-black with one acid-green or vermilion accent; broadsheet hairline-everything; the SaaS card kit (identical rounded cards, one radius everywhere, same soft grey shadow, gradient washes); tracked ALL-CAPS eyebrows on every heading; 'A · B · C' middle-dot meta strings; 'WORD — fragment' labels; monospace small data labels; '→' appended to links and buttons.",
      "Work in two passes on greenfield work: draft a compact design plan (4–6 named palette hexes, type roles, layout concept, principles), review it against the brief for anything you would produce for any similar page, revise that part with a stated reason, and only then build.",
      "Spend boldness in one place: one element carries the memorable moment while everything around it stays quiet and disciplined. Before finishing, remove one decorative accessory that does not serve the brief.",
      "Treat copy as design content: CTAs say exactly what happens ('Save changes', not 'Submit'), one action keeps one name across the whole flow, active voice, errors explain what went wrong and how to fix it, empty states invite the next action. Never let templated filler copy make the product feel generic.",
    ],
  },
];

export function frontendDesignSkillSection(): string {
  const skills = FRONTEND_DESIGN_SKILLS.map((skill) => renderInternalDesignSkill("identity-skill", skill)).join("\n\n");
  return `### Distinctive identity skills\n\n${skills}`;
}
