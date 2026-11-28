import { renderInternalDesignSkill, type InternalDesignSkill } from "../internal-skill";

/**
 * First-party taste layer — the PRIMARY design intelligence of Cognix's Build mode.
 * Concepts adapted from the MIT-licensed taste-skill by Leonxlnx
 * (https://github.com/Leonxlnx/taste-skill, https://www.tasteskill.dev): business-kind
 * classification, inventory-driven planning, copy-first builds, disciplined composition,
 * real assets over invented placeholders, and the look-and-fix verification loop.
 *
 * These skills are deliberately separate from user slash-skills: they are always on in
 * Build mode, never consume a user's skill allowance, and never enter the Security-mode prompt.
 */
export const TASTE_SKILLS = [
  {
    name: "product-art-direction",
    description: "Choose a deliberate, product-specific visual direction before styling.",
    instructions: [
      "Infer the product type, audience, primary job, emotional tone, and information density from the request and current app. Do not ask the user to choose routine visual details.",
      "Choose one coherent visual idea and carry it through hierarchy, composition, typography, color, spacing, imagery, and motion. A calm finance tool, playful consumer app, editorial site, luxury storefront, and developer utility should not share the same visual language.",
      "Match structure to the surface: marketing pages need a clear value proposition, proof, and primary action; product apps should open on the core workflow; editorial pages need strong reading rhythm; stores should foreground products and purchase confidence. Do not put a landing-page hero inside every application.",
      "Establish the content hierarchy before decoration: make the primary task and action unmistakable, then supporting context, then secondary actions. Use progressive disclosure instead of showing every control at once.",
      "The user's explicit direction, brand assets, visual references, and the verified design language of an existing app take precedence over these defaults. On a focused follow-up, preserve that language and change only the requested surface; apply broad art direction only to a new build or an explicit redesign.",
    ],
  },
  {
    name: "content-first-planning",
    description: "Plan every page from real content and claims, so sections come from the argument instead of a template.",
    instructions: [
      "Before building a new page or app, inventory what only this product has — real names, facts, numbers, constraints, materials — and derive the page from it: an h1 naming what is sold and for whom, one hard fact on the first screen, sections that each prove one claim, buttons as a verb plus an object.",
      "Classify the work before art-directing it: a marketing page is read and scrolled; an app screen (dashboard, inbox, editor, settings) is worked in. Choose visual presence for pages and calm density for app screens — never blend campaign hero furniture into authenticated work surfaces.",
      "For greenfield builds, state the one-sentence idea before styling: something specific to this subject becomes the device the composition serves. If the idea would survive unchanged on the nearest competitor's page, the direction is still generic.",
      "Use real assets in preference order: user-uploaded media first, then fitting licensed or open-collection imagery with credit, then purposeful diagrams, or type and color alone. Never present stock imagery, invented testimonials, fake ratings, or borrowed logos as the client's own.",
    ],
  },
  {
    name: "visual-composition",
    description: "Turn the chosen direction into a consistent, distinctive interface system.",
    instructions: [
      "Create or reuse a small token system for canvas, surfaces, text, muted text, borders, accent, focus, semantic colors, spacing, radii, and shadows. Prefer CSS variables and reusable primitives over scattered one-off values, while preserving an existing system when one exists.",
      "Use a restrained neutral foundation, one intentional principal accent, and semantic colors. Check contrast. Gradients may create subtle background atmosphere or artwork, never gradient text or a substitute for hierarchy.",
      "Build hierarchy with typography, proportion, alignment, and whitespace. Limit type roles and weights, keep body copy readable, use tabular numerals for changing values, and give long-form text a comfortable measure. Add a display face only when it strengthens the product direction and the project can load it reliably.",
      "Use proximity and whitespace before adding borders or containers. Avoid card-within-card layouts, wrapping every section in a rounded rectangle, repetitive equal-card grids, broad pills, and shadows on every surface. Vary composition when the content calls for emphasis or rhythm.",
      "Use concrete, domain-specific copy and believable content. Do not default to Acme, John Doe, lorem ipsum, vague phrases such as 'Elevate your workflow', decorative metrics, or invented testimonials, ratings, customers, and partner logos presented as fact.",
      "Use meaningful product imagery, uploaded assets, or restrained abstract artwork when imagery adds information or emotion. Keep icon style and sizing consistent; use an installed icon set instead of improvised SVG decoration.",
      "Avoid generic AI-site motifs unless the request calls for them: purple-on-black palettes, gradient blobs behind centered copy, excessive glassmorphism, arbitrary floating badges, enormous empty hero areas, interchangeable three-feature rows, fake charts, and ornamental animation. Polish one recognizable idea instead of combining every trend.",
    ],
  },
  {
    name: "interaction-and-production-polish",
    description: "Finish responsive behavior, interaction states, accessibility, and release details.",
    instructions: [
      "Every visible primary control, link, tab, filter, and form must perform its advertised action. Remove dead controls and placeholder navigation; do not use '#' as a destination. For complex widgets, prefer an accessible primitive already in the project and native controls where they suffice.",
      "Design the states the real flow needs: default, hover, focus-visible, pressed, selected, disabled, pending, success, empty, dense, and recoverable error. Use skeletons only when they match the eventual geometry, preserve context during loading, and make every error explain the next action.",
      "Forms need persistent labels, useful descriptions, correct input types and autocomplete, inline validation, clear required and optional states, pending submission feedback, and a success outcome. Do not clear entered values after a failed submission.",
      "Build mobile first from 320 px upward and use content-driven breakpoints rather than device detection. Review against these widths: Phone: 390 px reference; Tablet: 768 px reference; Desktop: use 1440 px as the reference. Use about 16 px on phones, 24 px on tablets, and 24-32 px on desktops for page gutters, with responsive grid and flex layouts.",
      "On phones, favor one clear column, collapse persistent navigation, stack actions before they squeeze, and prevent page-level horizontal overflow or scrolling. On tablets, use one or two intentional columns and compact rails or drawers. On desktop, persistent 240-280 px navigation and denser toolbars are acceptable when the product benefits, but every action must remain available without hover.",
      "Keep media intrinsically sized or aspect-ratio constrained, tables readable through scrolling or a deliberate stacked view, dialogs within the dynamic viewport, long content wrapping, and fixed controls clear of safe areas and the on-screen keyboard. Avoid fragile 100vh mobile shells.",
      "Make every flow keyboard operable with semantic HTML, visible focus rings, accessible names for icon-only controls, and status cues that do not rely on color alone. Use at least 44 px touch targets on coarse pointers and 32 px on desktop; keep mobile input text at least 16 px. Respect reduced motion and animate transform or opacity only when motion helps comprehension.",
      "For a new public page, add useful title and description metadata and intentional social artwork when assets exist. Keep client-side JavaScript and third-party dependencies proportionate, optimize image loading, and avoid layout shift.",
      "Before finishing, inspect the affected routes and verify the production build; check responsive structure, overflow, long and dense content, missing assets, dead destinations, placeholder copy, and all loading, empty, success, and error paths.",
    ],
  },
] as const satisfies readonly InternalDesignSkill[];

export function tasteSkillSection(): string {
  const skills = TASTE_SKILLS.map((skill) => renderInternalDesignSkill("taste-skill", skill)).join("\n\n");
  return `### Taste skills — primary art-direction layer\n\n${skills}`;
}
