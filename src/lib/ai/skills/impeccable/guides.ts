/**
 * Internal design critique & refinement playbook, read through the `read_design_guide` tool.
 * Method adapted from Impeccable by Paul Bakaus (https://impeccable.style) — reviewer-style
 * critique, focused refinement passes, and slop detection — combined with the look-and-fix
 * loop and Awwwards-weighted rubric of the MIT-licensed taste-skill (https://www.tasteskill.dev).
 * Never exposed in the public skills database. Import only from server code.
 */

export const DESIGN_CRITIQUE_GUIDE = `# Design Critique & Refinement Playbook

Use this playbook at the Critique and Refine stages of a standard or deep design pass, whenever a page feels generic, confusing, or hard to use, and before final QA on any nontrivial interface. A UI is not complete because it compiles — it is complete when it has been judged against its intent and the important issues fixed.

## 1. Render, then judge

Never critique from source code alone. Start or confirm the preview server, open the affected routes with \`inspect_preview\`, and read \`read_preview_console\` for runtime, hydration, or network errors. Then evaluate the rendered result — at 390 px (phone), 768 px (tablet), and 1440 px (desktop) — against the request and the locked design direction, not against mood alone.

## 2. Review rubric

Score each area 0–4 (0 broken, 1 poor, 2 acceptable, 3 good, 4 excellent) and record the reasons, not just the number:

| Area | Weight | What to check |
|---|---|---|
| Design | 40% | Visual hierarchy, composition, spacing rhythm, typography discipline, color roles, depth consistency |
| Usability | 30% | Primary-action clarity, task completion, state coverage (loading/empty/error/dense), recovery, keyboard operability |
| Creativity | 20% | Distinctiveness, subject fit, one memorable moment instead of trend stacking |
| Content | 10% | Concrete domain copy, real assets, claims with proof, no filler and no fabricated proof |

Any area under 2.5 names the refinement pass to run first.

## 3. Prioritize like a reviewer

Order findings by impact and fix in this order:
1. **Broken or unusable:** dead controls, errors, overflow, broken images, contrast failures.
2. **Misleading hierarchy and copy:** what the eye hits first vs. what matters; buttons that do not say what happens; totals hidden below payment actions.
3. **Inconsistency and drift:** values that diverge from the token system, mixed radii/depth/icon styles, route-to-route variation.
4. **Polish:** spacing rhythm, alignment niceties, motion refinement.

Report strengths to preserve first, so refinement does not flatten what already works.

## 4. Focused refinement passes

Run the narrowest pass that fixes the finding:

| Pass | Run it when | It does |
|---|---|---|
| \`typeset\` | Reading is hard | Fix scale, line height, tracking, measure, weights, per-role metrics |
| \`layout\` | Grouping or flow is wrong | Reorder grouping, alignment, proximity, grid membership |
| \`colorize\` | Actions or states are unclear | Reassign semantic color roles, contrast, accent discipline |
| \`quieter\` | The page shouts | Remove competing borders, shadows, badges, gradients |
| \`bolder\` | The page is forgettable | Give the key section presence while keeping the design true |
| \`distill\` | Clutter hides the point | Remove decoration and content that does not serve the task |
| \`clarify\` | Outcomes are confusing | Explain what happened and what to do next (errors, empty states) |
| \`harden\` | Edge states break | Design loading, empty, dense, error, and recovery states |
| \`polish\` | Nearly there | Finish focus rings, press feedback, truncation, tabular numerals |
| \`delight\` | The flow earns it | Add one measured, purposeful moment where surprise helps |

## 5. Slop detector checklist

Treat each as a finding, not a preference: gradient text; grey low-contrast body copy; text overflowing or clipped by its container; horizontal overflow at 320–390 px; identical card grids and one-radius-everywhere; the same soft shadow under every surface; ALL-CAPS tracked eyebrows on every heading; 'A · B · C' middle-dot meta strings; 'WORD — fragment' labels; '→' appended to links; monospace outside code; emoji or Unicode pictograph icons; fade-in on every section; counting-up numbers on every mount; lorem ipsum, Acme, John Doe, invented testimonials, ratings, or metrics; dead \`href="#"\` links.

## 6. Fix, re-verify, and report

Fix the top findings in code, then re-probe the affected routes and the console. In a deep pass, repeat critique → refine at most 3 rounds and stop when the important issues are resolved. Report: what was fixed, what remains open, and precisely what could not be verified without a real browser (never claim screenshot-level review when only HTML/HTTP inspection ran). When shared components or tokens were refined, check the other routes that use them before finishing.`;
