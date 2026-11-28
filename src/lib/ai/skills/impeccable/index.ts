import { renderInternalDesignSkill, type InternalDesignSkill } from "../internal-skill";

/**
 * First-party critique & refinement vocabulary, adapted from the critique method of
 * Impeccable by Paul Bakaus (https://impeccable.style, https://github.com/pbakaus/impeccable):
 * reviewer-style critique, focused refinement passes, slop detection, and fix-not-report loops.
 * Always active in Build mode; never exposed as a user slash-skill.
 */
export const IMPECCABLE_SKILLS: readonly InternalDesignSkill[] = [
  {
    name: "critique-and-refinement-loop",
    description: "Judge the rendered UI like a design reviewer, then fix the highest-impact problems instead of reporting them.",
    instructions: [
      "After implementing a nontrivial UI change, critique the rendered result before declaring it complete: re-read the intent, preview the affected routes, and judge hierarchy (what does the eye hit first?), alignment and spacing rhythm, contrast and color roles, typography discipline, state coverage, and whether the page feels specific to this product or generic.",
      "Prioritize findings like a reviewer: name strengths to preserve, then order issues by user impact — broken or unusable first, misleading hierarchy or copy second, inconsistency and polish last. In a deep pass, fix the top 3 issues rather than re-styling every working surface.",
      "Run focused refinement passes instead of blanket redesigns: `typeset` (readability, scale, measure, per-role metrics), `layout` (grouping, alignment, flow), `colorize` (action/state/color clarity), `quieter` (reduce noise), `bolder` (presence for the key section), `distill` (remove clutter), `clarify` (explain what happened and what to do next), `harden` (loading, empty, dense, error states), `polish` (finishing details), `delight` (one measured moment where it helps).",
      "Treat slop tells as defects to fix, not style preferences: gradient text, low-contrast grey body copy, overflowing or clipped text, every-section fade-ins, identical card grids, template chrome applied regardless of content, and drift away from the project's established tokens.",
      "Fix the code, then re-verify: after each refinement round, re-check the affected routes and the preview console. Stop when the important issues are resolved and state honestly what was verified and what could not be checked in a real browser.",
    ],
  },
];

export function impeccableSkillSection(): string {
  const skills = IMPECCABLE_SKILLS.map((skill) => renderInternalDesignSkill("critique-skill", skill)).join("\n\n");
  return `### Critique & refinement skills\n\n${skills}`;
}
