import { renderInternalDesignSkill, type InternalDesignSkill } from "../internal-skill";

/**
 * First-party internal `design-to-code` intelligence (modeled after `cloud-skills.ts`).
 * Adapted from the MIT-licensed `design-to-code` skill by Atharvsinh-codez
 * (https://github.com/Atharvsinh-codez/skills) for Cognix's internal Next.js workspace.
 * These skills are NEVER exposed in the public `/skills` menu or database `skills` table—
 * they run automatically inside Cognix's Build and Plan prompts so the agent consistently picks
 * cohesive color palettes, design systems, typography, responsive layouts, and executes
 * high-fidelity image/design-to-code builds on its own.
 */
export const DESIGN_TO_CODE_SKILLS: readonly InternalDesignSkill[] = [
  {
    name: "design-to-code-dispatch-and-forensics",
    description: "Automatically choose source mode, surface track, visual forensics, and internal design playbooks before coding UI.",
    instructions: [
      "Before writing UI code, silently dispatch into one **source mode** (`Reference reconstruction` when screenshots/mockups/designs are provided; `Greenfield art direction` for new visual apps; `Hybrid expansion` when extending a reference with new sections/routes/breakpoints; `Retrofit or repair` for targeted UI fixes) and one **surface track** (`Marketing or brand`, `Product or operational`, or `Mixed product`—never blend marketing hero furniture into authenticated dashboards).",
      "Resolve design conflicts in strict authority order: explicit user requirements → supplied assets/copy (`/user-uploads/...`) → observable pixels/behavior in attached references → existing app design system → surface-track defaults. Distinguish **Observed**, **Inferred**, and **Substituted** choices—never silently invent a new layout when an authoritative reference image was supplied.",
      "Whenever the user attaches a screenshot, Figma export, mockup, or design image, visually inspect it at full detail before coding: extract viewport/fold, container max-widths, gutters, column grid, section rhythm, typography classification & glyph cues, semantic color roles, image crop/focal points, and interactive states. Never paste a screenshot behind the page or build a flattened image UI.",
      "Call `read_design_guide` automatically on demand per the playbook routing (never ask the user to invoke a skill); on complex interfaces read `verification` before final QA.",
    ],
  },
  {
    name: "color-theme-and-surface-system",
    description: "Build cohesive semantic color palettes, tinted neutrals, disciplined surface hierarchy, and true dark mode.",
    instructions: [
      "Lock a semantic CSS custom-property token system in `globals.css` before styling components: `--canvas`, `--surface`, `--surface-secondary`, `--surface-elevated`, `--surface-recessed`, `--text`, `--text-secondary`, `--text-muted`, `--border`, `--border-strong`, `--accent`, `--accent-foreground`, `--success`, `--warning`, `--danger`, `--info`, and `--focus`.",
      "Pick a distinctive, domain-matched color world with tinted near-black and near-white neutrals (such as warm stone + deep forest ink, cool mineral slate + cobalt, crisp paper + terracotta, or calibrated charcoal + amber) instead of harsh `#000`/`#fff` extremes or generic Tailwind gray/indigo/purple-on-black glow templates. Maintain WCAG 2.2 AA contrast on every text and control role.",
      "Apply the **lightest-sufficient grouping ladder** before adding boxes: (1) whitespace and alignment → (2) subtle tinted divider/hairline → (3) recessed tonal well → (4) card or elevated surface ONLY when the unit is genuinely independent, selectable, interactive, or elevated. Reject nested card-in-card piles and giant rounded wrappers around ordinary sections.",
      "Commit to ONE coherent depth strategy per view (border-led, tonal/tint-led, soft shadow-led, or layered shadow-led) and preserve **concentric border radii** (`innerRadius = Math.max(0, outerRadius - padding)`) with outer container padding at least equal to child gaps.",
      "For dark mode, derive semantic surface steps and crisp low-opacity inset rings rather than mechanically inverting light colors, and set matching light/dark `theme-color` metadata.",
    ],
  },
  {
    name: "typography-svg-and-motion-craft",
    description: "Pair open-licensed fonts with per-role metrics, enforce strict SVG-only iconography (zero emojis), mobile platform polish, and purposeful motion.",
    instructions: [
      "Choose fonts intentionally from the visual thesis (max 2 families + optional monospace, picking the **body face first**). Use open-licensed families loaded cleanly via `next/font/google` (e.g., `Inter`, `Plus_Jakarta_Sans`, `DM_Sans`, `Manrope`, `Hanken_Grotesk`, `Bricolage_Grotesque`, `Space_Grotesk`, `Fraunces`, `Newsreader`, `Instrument_Serif`, `Source_Serif_4`, `JetBrains_Mono`) or install `geist` (`geist/font/sans`, `geist/font/serif`, `geist/font/mono`) as the default superfamily fallback. Never copy unlicensed fonts from external sites.",
      "Set size-specific line height and tracking per role (Display ≥48px: `0.95–1.1` / `-0.02em to -0.04em`; Headings 24–48px: `1.1–1.25` / `-0.01em to -0.02em`; Body: `1.45–1.7` / `0`; Dense UI: `1.3–1.45`; Small uppercase: `1.2–1.4` / `0.02em to 0.08em`). Load real weights (`font-synthesis: none`), cap prose around `65ch`, use `clamp()` with `rem` for fluid display sizes, apply `tabular-nums` to numbers/metrics/prices, and use `text-wrap: balance` on headings / `text-wrap: pretty` on prose.",
      "**Strict SVG-only iconography & zero emojis**: Every UI icon must render as SVG—prefer `lucide-react` (or matching crisp inline SVG with consistent `viewBox`, stroke weight, `currentColor`, and `aria-hidden=\"true\"` on decorative icons; explicit `aria-label` on icon-only controls). NEVER put emojis, Unicode pictographs, icon fonts, or raster images as icons anywhere in authored UI copy, headings, navigation, bullets, buttons, badges, statuses, alerts, empty states, placeholders, or metadata (replace any emoji in a reference mockup with a crisp SVG icon or plain text).",
      "Ship a solid mobile & responsive baseline: explicit section transforms (`preserve`/`reflow`/`collapse`/`reorder`/`crop`/`simplify`), zero horizontal overflow, `100svh` for heroes / `100dvh` for app shells (avoid fragile `100vh`), `env(safe-area-inset-*)` on fixed bars, `16px` minimum input font size, `touch-action: manipulation`, `-webkit-tap-highlight-color: transparent`, `overscroll-behavior: contain` on inner drawers/lists, `min-w-0` on flexible text children, and `shrink-0` on icons/avatars.",
      "Apply disciplined motion: never animate keyboard-initiated or 100+/day actions, name a clear purpose for every animation, animate `transform` and `opacity` only (never `transition: all` or `scale(0)` entrances—start from `scale(0.95)` + `opacity: 0`), use strong custom `ease-out` (`cubic-bezier(0.23, 1, 0.32, 1)`) and never `ease-in`, keep product UI transitions `< 300ms` with exits faster than entrances, anchor `transform-origin` at popover triggers, add `:active` press feedback (`scale(0.97)`), gate `:hover` behind `@media (hover: hover) and (pointer: fine)`, and ship gentler `@media (prefers-reduced-motion: reduce)` and `@media (prefers-reduced-transparency: reduce)` fallbacks.",
    ],
  },
];

export function designToCodeSection(options: { hasImageAttachments?: boolean } = {}): string {
  const blocks = DESIGN_TO_CODE_SKILLS.map((skill) => renderInternalDesignSkill("design-skill", skill)).join("\n\n");
  const imagePriority = options.hasImageAttachments
    ? `\n<image_to_code_priority>\nThis turn includes one or more visual image attachments. Treat them as primary visual design evidence: inspect every attached image closely, call \`read_design_guide({ topic: "reference-forensics" })\` (plus \`typography-and-fonts\` and \`interface-craft\` as needed) before writing UI code, extract the observed layout grid, color tokens, typography scale, surfaces, and states, and rebuild the interface faithfully in real responsive semantic code (replacing any emojis with crisp SVG icons).\n</image_to_code_priority>\n`
    : "";
  return `### Design-to-code reconstruction skills\n\n${blocks}${imagePriority}`;
}
