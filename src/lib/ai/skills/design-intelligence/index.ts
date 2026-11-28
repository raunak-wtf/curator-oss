import { designToCodeSection } from "../design-to-code";
import { frontendDesignSkillSection } from "../frontend-design";
import { impeccableSkillSection } from "../impeccable";
import { tasteSkillSection } from "../taste-skill";
import { themeFactorySkillSection } from "../theme-factory";

/**
 * Cognix's native Design Intelligence System — the single entry point the Build and Plan
 * prompts use for all automatic design guidance. It composes five internal sources, each in
 * its own module:
 *
 *   - taste-skill/        primary art-direction layer (adapted from MIT-licensed tasteskill.dev)
 *   - design-to-code/     reference reconstruction + visual forensics (Atharvsinh-codez/skills, MIT)
 *   - impeccable/         critique & refinement loop (impeccable.style method)
 *   - frontend-design/    distinctive identity + anti-generic tells (Anthropic skills)
 *   - theme-factory/      theme-token curation (Anthropic skills)
 *
 * Deep playbooks load on demand through `read_design_guide` (registry in ./guides) so only a
 * compact always-on layer rides in every model call. Never exposed as user slash-skills.
 */

export function designIntelligenceContext(options: { hasImageAttachments?: boolean } = {}): string {
  return `## Built-in design intelligence system

Cognix's native design system is always active in Build mode. It engages automatically whenever you create, edit, restyle, or improve any frontend surface — pages, layouts, components, styles, copy, or assets. The user never activates or configures it. It layers five internal sources: the taste art-direction layer (primary), design-to-code reconstruction, critique & refinement, distinctive identity, and theme-token curation.

### Proportionality — scale the workflow to the change

- **Lightweight pass** for small, focused work (a copy tweak, a single-component fix, a small style change): inspect the touched component and its token context, make the smallest coherent change that obeys the established system, and run the usual build and preview verification. Do not open design workflows, re-theme, or redesign working surfaces for localized requests.
- **Standard pass** for a new page, section, or multi-component feature: run the eight stages below, reading only the playbooks the task needs.
- **Deep pass** for a new app, a full redesign or restyle, or image-to-code work: run all eight stages, read \`core\` plus the routed playbooks at the Design and Critique stages, inspect every attached reference image at full detail, and critique at 390 / 768 / 1440 px before finishing.

### The eight stages

1. **Understand** — read the request and the real files (layout, tokens, shared components, routes). Classify the surface: marketing page vs. app screen; for greenfield work, the business kind (software, hardware/tech, physical product, service, place) so the visual language fits its audience.
2. **Plan** — content first: real copy, claims, and the one primary action before any layout or decoration.
3. **Design** — lock the direction before styling: a one-sentence visual thesis, semantic color tokens, a type pairing (max 2 families + mono), spacing/radius/depth strategy, and a motion stance.
4. **Implement** — build macro to micro: landmarks and shell first, then components, real content, SVG-only icons, complete states.
5. **Preview** — run the app and probe the important routes with \`inspect_preview\` and \`read_preview_console\`.
6. **Critique** — judge the rendered result against the intent (hierarchy, alignment, contrast, spacing, overflow, genericness, dead controls, missing states) at phone, tablet, and desktop widths.
7. **Refine** — fix the highest-impact problems (top 3 in a deep pass), then re-preview. Fix issues instead of reporting them.
8. **Verify** — pass the production build, re-check the preview and console, sanity-check responsive behavior, and report honestly what was and was not verified.

### Playbook routing (\`read_design_guide\`; never exposed to users)

\`core\` any nontrivial UI build · \`reference-forensics\` + \`typography-and-fonts\` attached screenshots/mockups and site recreations · \`art-direction\` + \`distinctive-identity\` new apps, redesigns, and themes · \`interface-craft\` nontrivial components, states, dark mode · \`motion\` any animation · \`design-critique\` critique and refinement passes · \`verification\` final QA.

${tasteSkillSection()}

${designToCodeSection(options)}

${impeccableSkillSection()}

${frontendDesignSkillSection()}

${themeFactorySkillSection()}

`;
}

export function planDesignIntelligenceContext(options: { hasImageAttachments?: boolean } = {}): string {
  const imageNote = options.hasImageAttachments
    ? " Visual image attachments are present this turn: inspect them at full detail and call `read_design_guide({ topic: \"reference-forensics\" })` so your plan captures exact observed layout geometry, semantic color roles, typography, responsive transforms, and SVG icon substitutions."
    : "";

  return `## Built-in design intelligence (planning)

- Design plans automatically follow Cognix's native design intelligence system: classify the surface (marketing page vs. app screen) and business kind, plan content-first with real copy and claims, lock a domain-appropriate semantic color token palette (tinted neutrals + one clear accent + status/focus roles), a purposeful typography pairing (max 2 open-licensed families + optional mono, Geist superfamily fallback), lightest-sufficient surface hierarchy (whitespace → divider → tonal well → card), responsive recomposition across 390px / 768px / 1440px, strict **SVG-only iconography with zero emojis**, and purposeful \`< 300ms\` compositor-only motion.
- Plans must preserve an existing project's established design system and extend its tokens rather than replacing them, and should include a critique step (what to verify visually once built) proportionate to the change.
- You may call \`read_design_guide\` (\`core\`, \`art-direction\`, \`reference-forensics\`, \`typography-and-fonts\`, \`interface-craft\`, \`motion\`, \`design-critique\`, \`distinctive-identity\`, \`verification\`) in Plan mode to align design details before writing the plan.${imageNote}

`;
}
