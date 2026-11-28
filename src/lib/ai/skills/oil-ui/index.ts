import { renderInternalDesignSkill, type InternalDesignSkill } from "../internal-skill";

/**
 * First-party direction-exploration layer, adapted from the MIT-licensed Oil UI skill
 * by oil-oil (https://github.com/oil-oil/oil-ui, https://ui.oiloil.org): the visual
 * north star, concrete-anchor direction derivation, genuinely-different direction
 * comparison, first screens matched to the page's real job, and the subtraction pass.
 * Always active in Build mode; never exposed as a user slash-skill.
 */
export const OIL_UI_SKILLS: readonly InternalDesignSkill[] = [
  {
    name: "visual-north-star-and-direction-exploration",
    description: "Set a one-sentence visual north star, derive directions from concrete anchors, and make compared directions genuinely different.",
    instructions: [
      "State a one-sentence visual north star before composing a new page, and make every type, color, spacing, imagery, and motion choice lean toward it. Translate vague brief words ('clean', 'premium', 'modern') into a concrete tone — lively or calm, polished or raw, dense or airy — and visible decisions, never template defaults.",
      "Derive each direction from something concrete — a material, a setting, an object, or the visual language of another craft — never from adjectives alone. For a new product, study two or three distinctive peers and decide what to keep and what to break from.",
      "Match the first screen to the page's real job: persuasion pages (brand, launch, campaign) get a choreographed opening settled before the copy; work, browse, and shop pages open directly on the first row of content or the work surface — compressed header, no hero slogans, no explainer paragraphs.",
      "When asked to explore or compare visual directions, make the variants genuinely different: any two may share at most one trait among layout, typography, color, and key imagery. Squint at the light/dark shapes side by side and rework any two that read alike. Recommend one direction by default and build side-by-side comparison variants only when the user is choosing.",
      "Restraint means keeping the strongest choices and deleting elements that contribute nothing — never averaging styles into the middle. Where project design notes contradict each other or the code, surface the conflict instead of silently satisfying both.",
    ],
  },
];

export function oilUiSkillSection(): string {
  const skills = OIL_UI_SKILLS.map((skill) => renderInternalDesignSkill("direction-skill", skill)).join("\n\n");
  return `### Direction exploration skills\n\n${skills}`;
}
