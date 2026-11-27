/**
 * Internal design-to-code playbooks the build and plan agents read with the `read_design_guide` tool.
 * Adapted from the MIT-licensed `design-to-code` skill suite for Cognix's internal Next.js workspace.
 * They are NEVER listed with user `/skills` or exposed in the public skills database. Import only from server code.
 */

export const DESIGN_GUIDE_TOPICS = [
  "core",
  "art-direction",
  "reference-forensics",
  "typography-and-fonts",
  "interface-craft",
  "motion",
  "verification",
] as const;

export type DesignGuideTopic = (typeof DESIGN_GUIDE_TOPICS)[number];

export const DESIGN_GUIDE_LABELS: Record<DesignGuideTopic, string> = {
  core: "design-to-code core",
  "art-direction": "art direction",
  "reference-forensics": "reference forensics",
  "typography-and-fonts": "typography & fonts",
  "interface-craft": "interface craft",
  motion: "motion",
  verification: "visual verification",
};

const CORE_GUIDE = `# Design-to-Code Core Workflow

Reconstruct a visual reference or art-direct an original interface, then implement it as real, maintainable, responsive, accessible frontend code.

- **IS:** visual-source selection, design forensics, deliberate art direction, semantic color & theme architecture, responsive implementation, SVG-only iconography, interaction fidelity, and structured verification.
- **IS NOT:** a screenshot pasted behind the page, a flattened image UI, an audit-only report when implementation was requested, or permission to redesign an authoritative reference into a preferred house style.

## 1. Dispatch before acting

Choose one **source mode** and one **surface track** before writing UI code:

### Source modes

| Mode | Select when | Source of truth |
|---|---|---|
| **Reference reconstruction** | A screenshot, Figma export, mockup, design image, or public URL defines the target | Observable reference evidence |
| **Greenfield art direction** | No precise visual composition exists and visual quality is central | Locked design brief & Design DNA |
| **Hybrid expansion** | A reference defines the visual language but omits requested sections, routes, states, or breakpoints | Reference invariants plus consistent new surfaces |
| **Variant exploration** | The user asks for options before choosing | Controlled alternatives with identical content and constraints |
| **Retrofit or repair** | The task is responsive repair, dark mode, component cleanup, or visual-regression correction | Existing implementation plus target evidence |
| **Semantic scaffold** | The user explicitly asks only for unstyled structure | Visible content and native semantics |

Never invent a substitute page concept in **Reference reconstruction** mode.

### Surface tracks

- **Marketing or brand:** Optimize hierarchy, storytelling, identity, proof, and one clear conversion path.
- **Product or operational:** Optimize task completion, scanability, stable controls, calm density, state coverage, and resilient data interaction.
- **Mixed product:** Treat public acquisition pages as marketing and authenticated work surfaces as product. Never blend campaign hero furniture into authenticated dashboards.

The reference and explicit user requirements always outrank track defaults.

## 2. Authority and evidence order

Resolve conflicts in this strict order:
1. Explicit user requirements and corrections.
2. Authorized supplied content and uploaded assets (\`/user-uploads/...\`).
3. Observable pixels and behavior in the authoritative reference.
4. Additional viewport, state, route, theme, or motion references.
5. Existing product design system, behavior, and repository conventions.
6. Mode and surface-track defaults.
7. The smallest reversible inference.

Mentally classify every material design decision as:
- **Observed:** directly visible or measured.
- **Inferred:** derived from relationships or conventions where evidence is absent.
- **Substituted:** intentionally replaced because of rights, missing assets, unavailable fonts, accessibility, or technical constraints.

Never present an inference or substitution as an exact match.

## 3. Inspect visual sources & project before coding

- Visually examine every attached image/screenshot at full detail before editing. Never rely on filenames or summaries alone.
- For a public reference URL, inspect it with \`fetch_url\` to gather structural/copy evidence without copying proprietary scripts, trackers, analytics, or copyrighted brand marks.
- Inspect the existing project's \`package.json\`, layout, globals/tokens CSS, font setup, shared components, and routes first, reusing established primitives where appropriate.
- Extract at minimum:
  - Viewport, canvas, fold, containers, gutters, columns, section boundaries, alignment anchors, overlaps, clipping, and z-order.
  - Font family, real weights/styles, size, line height, tracking, measure, line breaks, and fallback behavior.
  - Semantic color roles, gradients, borders, radii, shadows, texture, blur, opacity, material, and depth.
  - Image role, aspect ratio, crop, focal point, mask, frame, negative space, and responsive treatment.
  - Header, navigation, content hierarchy, controls, forms, cards, lists, footer, sticky regions, and visible states.
  - Motion trigger, duration, easing, delay, direction, interruption, and reduced-motion behavior.

## 4. Lock the fidelity contract before styling

Establish before writing deep component CSS:
- One-sentence visual thesis + interaction thesis.
- Canonical copy and content hierarchy (no lorem ipsum, Acme, John Doe, or fabricated testimonials/metrics).
- Semantic region and component map.
- Container, grid, breakpoint, and section-rhythm rules.
- Type scale, font plan, spacing grid, radii, borders, single depth strategy, and semantic color CSS variables.
- Asset plan (using stable \`/user-uploads/...\` paths for user-supplied media, crisp code-native SVGs for icons/illustrations/diagrams, and CSS atmosphere where appropriate).
- Responsive transformation per section (\`preserve\`, \`reflow\`, \`collapse\`, \`reorder\`, \`crop\`, \`simplify\`, or \`hide\`).

## 5. Enforce SVG-only iconography and zero emoji

Strict requirement for every generated website or app:
- Every designed interface icon MUST render as SVG. Prefer \`lucide-react\` (or the project's existing SVG icon set); when an icon is missing, create a crisp matching inline SVG component with a consistent \`viewBox\`, stroke weight, caps/joins, and \`currentColor\`.
- **Zero emojis** anywhere in authored website output — not in copy, navigation, buttons, headings, bullets, labels, badges, statuses, alerts, empty states, placeholders, cursors, metadata, or decoration.
- Never use Unicode pictographs/symbols, icon fonts, CSS pseudo-element glyphs, or PNG/JPG/WebP raster files as UI icons.
- If a reference image or supplied copy includes an emoji icon, replace it with the closest semantically accurate SVG icon or clear plain text.
- Hide decorative SVGs from screen readers (\`aria-hidden="true"\`) and give icon-only buttons an explicit accessible name (\`aria-label\`).

## 6. Implement from macro to micro

1. Establish routes, semantic landmarks, document order, background tokens, page shell, containers, grid, and major section geometry.
2. Build the header, first viewport, dominant visual anchor, content hierarchy, and primary action.
3. Configure fonts, per-role type metrics, content widths, and line wrapping.
4. Build repeated components and complete interactive states using accessible primitives.
5. Integrate uploaded/project assets with proper \`aspect-ratio\`, \`object-cover\`, and \`object-position\` focal points.
6. Refine surfaces, borders, concentric radii, depth, SVG icons, and subtle details.
7. Apply responsive recomposition, mobile platform baseline, interactions, and disciplined motion.
8. Verify with \`npm run build\`, \`read_preview_console\`, and \`inspect_preview\`, fixing root causes before local overrides.

## 7. Anti-rationalization & common failure rejection

Reject (unless explicitly requested by the user or authoritative reference):
- Screenshot-as-page, flattened text, coordinate-map positioning, or \`overflow: hidden\` hiding layout bugs.
- Nested cards, box-inside-box piles, giant rounded wrappers around every section, decorative pills, or interchangeable 3-card SaaS grids as the default impression.
- Default framework gray/indigo/purple-on-black glow styling, indiscriminate glassmorphism, or gradient text.
- Fake metrics, fabricated testimonials/ratings/partner logos, vague AI buzzwords ("elevate", "unleash", "revolutionize", "seamless"), emojis in UI, or dead controls (\`href="#"\`).
- Unlicensed fonts copied from third-party sites, \`transition: all\`, \`scale(0)\` entrances, \`ease-in\` UI transitions, animations on keyboard shortcuts, or fade-in-on-scroll on every section.
- White-label rule: never mention third-party infrastructure names in user-facing UI or chat copy.`;

const ART_DIRECTION_GUIDE = `# Art Direction Playbook

Use this playbook for greenfield builds, hybrid expansion, controlled variants, or whenever no authoritative screenshot/mockup exists and strong visual design is essential.

## 1. Source-mode guard

Do not use this playbook to overwrite a supplied screenshot, Figma export, or authoritative visual reference:
- **Reference reconstruction:** derive art direction strictly from observed visual evidence.
- **Greenfield art direction:** lock a deliberate, product-specific Direction Brief and Design DNA before coding.
- **Hybrid expansion:** invent only missing sections, routes, states, or breakpoints while strictly obeying the reference's locked color, typography, spacing, and surface invariants.

## 2. Direction brief (lock before coding)

Decide cleanly in working notes:
- Purpose, audience, primary routes, and desired primary user action.
- Canonical headings, supporting copy, labels, and primary CTA (specific to the domain — never generic SaaS fluff).
- Required sections, stateful components, media framing, proof, and conversion or workflow outcome.
- Target viewports including small-laptop (\`1280×720\` / \`1440×900\`), tablet (\`768px\`), and phone (\`390px\`).
- **One-sentence visual thesis** covering mood, material, color world, and energy.
- **One-sentence interaction thesis** describing how transitions feel and what they clarify.

## 3. Design DNA lock

Choose ONE coherent answer per axis — never mix competing aesthetics on the same surface:

### Theme and atmosphere
- Choose intentionally: warm light stone/paper, crisp editorial daylight, quiet slate neutral, bold architectural solid, or calibrated deep ink dark mode.
- Tint neutrals subtly toward the product's world (warm stone, cool mineral, deep forest slate, warm charcoal) rather than pure harsh \`#000000\` / \`#ffffff\` or generic Tailwind gray/indigo defaults.
- Choose tone: calm editorial, precise technical, warm craft studio, crisp financial, refined luxury, or focused operational utility.

### Color palette architecture
Define semantic CSS custom properties first in \`globals.css\`:
- \`--canvas\`: outer page ground.
- \`--surface\` & \`--surface-secondary\`: primary content surfaces.
- \`--surface-elevated\` & \`--surface-recessed\`: subtle elevation or inset wells.
- \`--text\`, \`--text-secondary\`, \`--text-muted\`: clear WCAG AA contrast hierarchy.
- \`--border\` & \`--border-strong\`: delicate tinted dividers rather than harsh flat gray lines.
- \`--accent\` & \`--accent-foreground\`: ONE unmistakable primary brand/action accent.
- \`--success\`, \`--warning\`, \`--danger\`, \`--info\`, \`--focus\`: semantic status and visible keyboard focus ring tokens.

### Typography character
- Grotesk, refined geometric sans, expressive display, compressed statement, editorial serif + clean sans, or rational Swiss system.
- Maximum **two** type families (+ optional monospace for code/IDs/metrics).
- Choose display/body contrast on ONE axis (serif vs sans, width, or weight), not all at once.

### Hero architecture (marketing/landing only)
Choose one deliberate pattern:
- Asymmetric split with clear visual anchor.
- Editorial offset with disciplined negative space.
- Type-led poster statement with tight measure and immediate proof.
- Image-led composition with restrained overlaid or adjacent copy.
- Full-bleed atmospheric plane (accounting for header height and \`100svh\`).
- Calm centered layout ONLY when genuinely suited to the thesis — never by default.

### Section grammar
Choose one dominant grammar and vary tempo inside it:
- Editorial alternation (varying alignment, density, media-to-text ratio, and background tone).
- Gallery-led cadence.
- Rational Swiss grid with hairlines and strong alignment axes.
- Asymmetric storytelling flow.
- Calm operational work surface (for apps/dashboards).

Never repeat identical 3-column card rows or cloned alternating split sections down an entire page.

### Signature system (lock one of each)
- One image grade and crop philosophy.
- One CTA family (shape, weight, hover/active response).
- One radius family (sharp architectural \`2–4px\`, crisp utility \`6–8px\`, soft modern \`10–14px\` — applied concentrically).
- One depth strategy (border-led, tonal/tint-led, soft shadow-led, or layered shadow-led).
- One SVG icon stroke/size family.
- One spacing cadence.
- One to three purposeful signature motifs (never a forced quota of marquees, glows, floating cards, or parallax).

## 4. Marketing vs Product direction

### Marketing or brand surfaces
- Treat the first viewport like a poster: one dominant focal anchor, unmistakable identity, concise 1–3 line headline, and one clear primary CTA visible above the fold on desktop and small laptop.
- Give each section ONE job: explain, prove, demonstrate, compare, or convert.
- Default to **cardless composition**: use typography, columns, hairlines, whitespace, and tonal bands before wrapping everything in boxes.
- Never fabricate customer logos, testimonials, ratings, awards, or fake urgency.
- Design mobile as its own composition with preserved identity and conversion intent, not a squished desktop stack.

### Product or operational surfaces
- Make the work surface, data, status, and actions louder than application chrome.
- Open directly on the core workflow — **no marketing hero, campaign slogans, testimonial strips, or decorative card mosaics inside authenticated workspaces**.
- Keep density calm, scan-friendly, and aligned to task frequency.
- Use color purposefully for primary action, selection, status, and risk — not decoration everywhere.
- Clearly separate global navigation, local navigation, view/filter controls, page actions, and item actions.
- Reserve cards for genuinely interactive, selectable, elevated, or distinct units.
- Pair happy paths with designed loading, empty, dense, error (with recovery action), and destructive confirmation states.

## 5. Anti-generic design rules

Unless the user or authoritative reference requires them, actively reject:
- Nested cards and box-inside-box hierarchy.
- Giant rounded wrappers around every page section.
- Decorative pills, fake status chips, or meaningless eyebrow buzzwords.
- Default blue-purple gradients, neon glow blobs, gradient text, and unstructured glassmorphism.
- Generic SaaS 3-card feature grids as the default first impression.
- Generic copy ("elevate", "unleash", "revolutionize", "next-gen", "seamless") when concrete domain language exists.
- Any emoji anywhere in authored interface UI.
- Delete aggressively: use hierarchy, proportion, contrast, alignment, crop, and whitespace before adding chrome.`;

const REFERENCE_FORENSICS_GUIDE = `# Reference Forensics Playbook

Use this playbook whenever the user attaches screenshots, mockups, Figma exports, design images, or references an existing website/UI to recreate or repair.

## 1. Reference inventory

Before touching code, catalog every supplied reference:
- Source (attached filename + \`/user-uploads/...\` path, or public URL).
- Scope classification: Full page / Page section / Single component / Embedded media / State sample / Brand style reference.
- Target route, probable CSS viewport width & aspect ratio, light/dark theme, visible state, and authority level (primary vs supporting).
- Record unknowns honestly rather than inventing certainty.
- Do not wrap a cropped component reference in invented page chrome, and do not rebuild internal UI inside an embedded screenshot/device mockup unless the user asked for it.

## 2. High-detail visual inspection checklist

Inspect every attached image carefully across all five forensic dimensions:

### A. Canvas, grid, and geometry
- Probable CSS viewport, visible fold, full-bleed vs contained regions, and max-width proportions.
- Outer page gutters, column counts, grid gaps, asymmetric splits, and recurring alignment axes.
- Section boundaries, approximate height ratios, vertical rhythm, and whitespace density.
- Sticky/fixed chrome, overlapping layers, clipping, masks, and z-order.

### B. Typography forensics
- Inspect distinguishing glyphs at full detail:
  - \`a\` and \`g\` (single-story vs double-story).
  - \`G\` spur, \`R\` leg, \`Q\` tail, \`t\` top, \`y\` tail, \`1\` flag, \`0\` shape.
  - Terminals (horizontal, angled, rounded), apertures (\`c\`, \`e\`, \`s\`), x-height vs cap-height, and stroke contrast.
- Classify first (neo-grotesk, geometric sans, humanist sans, grotesk with character, slab, transitional serif, editorial serif, didone, monospace, compressed display), then select exact or metric-compatible open-licensed candidates via \`read_design_guide({ topic: "typography-and-fonts" })\`.
- Extract relative scale (display vs heading vs body vs caption), weight range, line height, tracking, case, measure, and wrap points.
- Treat text as geometry: fix font family, size, tracking, and container width before adding forced \`<br>\` line breaks.

### C. Color, material, and depth
- Map colors to semantic roles rather than isolated random hex codes:
  - Canvas, primary surface, secondary surface, elevated surface, recessed well.
  - Primary text, secondary text, muted text, inverse text.
  - Borders, hairlines, dividers.
  - Primary accent, hover/active accent, secondary accent, status colors, focus rings.
- Note gradients, tint warmth/coolness, opacity, subtle texture, backdrop blur, border width/contrast, radius family, and depth strategy (border-led vs tonal vs soft/layered shadow).
- Distinguish true token changes from image compression or translucent overlays.

### D. Imagery and media framing
- Identify each image's role, aspect ratio, crop, focal point (\`object-position\`), negative space, framing/radius, inset outline, overlay scrim, and responsive treatment.
- If the user attached product imagery or brand assets meant for the page, reference their exact stable \`/user-uploads/...\` paths — never paste a full UI screenshot as a fake background.

### E. Components and interactive states
- Catalog header, navigation, hero/toolbar, lists, cards, forms, tables, modals/drawers, CTAs, and footer.
- Identify visible states (default, active, selected, open dropdown, validation, badges) and plan the unobserved states (hover, focus-visible, pressed, disabled, loading, empty, error) coherently in the same visual grammar.

## 3. Evidence discipline (Observed vs Inferred vs Substituted)

Track material decisions cleanly:
- **Observed:** directly visible or measured from the attached reference.
- **Inferred:** derived from layout relationships or track conventions where the reference is silent (e.g., mobile drawer inferred from desktop-only screenshot).
- **Substituted:** intentionally replaced due to font licensing, missing stock photos, accessibility contrast fixes, or Cognix's strict SVG-only / zero-emoji requirement (e.g., replacing an emoji in a mockup with a clean SVG icon).

For every substitution, preserve the visual role, proportion, and wrap behavior as closely as possible.

## 4. Convert evidence into a concrete fidelity contract

Before writing detailed styles, lock:
1. Target routes, viewports, and semantic HTML landmarks.
2. CSS variables for every observed semantic color, radius, shadow, container width, and spacing token.
3. Exact font families, weights, per-role line heights, and tracking values.
4. Per-section responsive transformations (\`preserve\`, \`reflow\`, \`collapse\`, \`reorder\`, \`crop\`, \`simplify\`, \`hide\`) so tablet and mobile stay cohesive instead of breaking.
5. Complete interactive behavior so every visible button, tab, filter, link, and form actually works.

## 5. Ambiguity resolution order

When a detail is partially obscured or absent:
1. Explicit user instructions.
2. Observed design invariants (grid, tokens, typography, depth strategy).
3. Layout and spacing relationships.
4. Component family and interaction meaning.
5. Mood, material, and craft level.
6. Clean, maintainable, reversible defaults.`;

const TYPOGRAPHY_AND_FONTS_GUIDE = `# Typography and Fonts Playbook

Type is the single highest-leverage element of visual quality: the right font pairing, weights, line height, tracking, and measure immediately elevate an interface; a wrong family or uniform tracking breaks spacing everywhere.

## 1. Licensing and sourcing order

Choose fonts in this strict priority order:
1. Fonts supplied by the user or already installed in the project.
2. Open-licensed families (SIL OFL / Apache) loaded cleanly via \`next/font/google\` or the \`geist\` npm package.
3. Metric-compatible open-licensed substitutions when recreating a design that uses a commercial font.
4. **Geist Serif / Geist Sans / Geist Mono** as the intentional fallback superfamily when no specific candidate fits (never leave an unstyled default browser serif or accidental framework default).

Never copy commercial font files from third-party websites or reference unverified remote CDNs. Always prefer \`next/font/google\` or \`geist/font/*\` so Next.js self-hosts \`woff2\` files with automatic metric-adjusted fallbacks and zero layout shift.

## 2. Commercial-to-open-licensed substitution table

When reconstructing a reference that uses a commercial/system font:

| Original family | Open-licensed starting candidates |
|---|---|
| Arial | \`Arimo\` (metric-compatible) |
| Helvetica / Neue Haas Grotesk | \`Inter\`, \`Inter Tight\`, \`Arimo\` |
| SF Pro | \`Inter\` (or \`Geist\`) |
| Times New Roman | \`Tinos\` (metric-compatible) |
| Georgia | \`Gelasio\` (metric-compatible) |
| Courier New | \`Cousine\` (metric-compatible) |
| Futura | \`Jost\` |
| Gotham | \`Montserrat\`, \`Plus Jakarta Sans\` |
| Garamond variants | \`EB Garamond\`, \`Cormorant Garamond\` |
| SF Mono / Menlo | \`JetBrains Mono\`, \`Geist Mono\` |

When substituting, prioritize matching **character width, x-height, and line wrap points** (adjusting \`letter-spacing\` or size slightly per role) rather than forcing brittle \`<br>\` tags.

## 3. Curated open-licensed font candidates by character

Pick from the visual thesis, not habit — maximum **2 families** (+ optional monospace):

| Character | Open-licensed candidates (\`next/font/google\` or \`geist\`) |
|---|---|
| Neutral / neo-grotesk product UI | \`Inter\`, \`Geist\` (\`geist/font/sans\`), \`Hanken_Grotesk\`, \`Public_Sans\` |
| Warm or geometric sans | \`Plus_Jakarta_Sans\`, \`DM_Sans\`, \`Manrope\`, \`Figtree\` |
| Grotesk with character | \`Space_Grotesk\`, \`Bricolage_Grotesque\`, \`Schibsted_Grotesk\` |
| Expressive display | \`Syne\`, \`Unbounded\`, \`Familjen_Grotesk\` |
| Compressed statement | \`Oswald\`, \`Bebas_Neue\`, \`Archivo\`, \`Big_Shoulders_Display\` |
| Editorial serif | \`GeistSerif\` (\`geist/font/serif\`), \`Fraunces\`, \`Newsreader\`, \`Instrument_Serif\`, \`Source_Serif_4\`, \`Playfair_Display\` |
| Classical serif | \`EB_Garamond\`, \`Cormorant_Garamond\`, \`Libre_Caslon_Text\`, \`Crimson_Pro\` |
| Monospace (code, IDs, tabular metrics) | \`JetBrains_Mono\`, \`GeistMono\` (\`geist/font/mono\`), \`IBM_Plex_Mono\`, \`Space_Mono\` |

### Geist superfamily fallback (when no specific font matches)
- Install \`geist\` (\`npm i geist\`) and import from \`geist/font/sans\`, \`geist/font/serif\`, or \`geist/font/mono\` in \`src/app/layout.tsx\`.
- Note: \`GeistSerif\` is provided by the \`geist\` package (\`geist/font/serif\`), NOT \`next/font/google\`.
- Keep superfamily cohesion: pair \`GeistSerif\` with \`GeistSans\` and \`GeistMono\` when using the Geist fallback.

## 4. Greenfield font selection rules

1. Choose the **body face first** — it carries reading, forms, tables, and dense UI. Require comfortable x-height, open apertures, and clean legibility at 14–16px.
2. Add a **display face** only when it strengthens the visual thesis. Create contrast on ONE axis (serif display + clean sans body, or expressive grotesk display + calm neutral body).
3. Match x-heights between paired families so mixed inline lines feel balanced.
4. Keep display faces at display/heading sizes (≥ 24px); never use expressive display fonts for dense body copy or small form labels.
5. Product and operational apps usually work best with ONE crisp sans family plus ONE monospace family for codes, IDs, timestamps, and numeric columns.
6. Never use three or more expressive families on one page.

## 5. Per-role type system (line height & tracking)

Tracking and line height MUST be set per role — one global \`letter-spacing\` is always wrong somewhere:

| Role | Line height | Tracking (\`letter-spacing\`) |
|---|---|---|
| Large display (≥ 48px) | \`0.95\` to \`1.1\` | \`-0.02em\` to \`-0.04em\` |
| Headings (24px to 48px) | \`1.1\` to \`1.25\` | \`-0.01em\` to \`-0.02em\` |
| Body copy | \`1.45\` to \`1.7\` | \`0\` |
| Dense product UI | \`1.3\` to \`1.45\` | \`0\` to \`0.01em\` |
| Small uppercase labels / eyebrows | \`1.2\` to \`1.4\` | \`0.02em\` to \`0.08em\` |

### Core typographic rules
- Line height tightens as font size grows; tracking tightens on large display text and opens on small uppercase labels.
- Build hierarchy with size, weight, and spacing together — emphasize with weight before arbitrarily ballooning size.
- Use \`clamp()\` with a \`rem\` component for fluid display headings (e.g. \`clamp(2.25rem, 4vw + 1rem, 4.25rem)\`) so user zoom/font-size preferences still scale.
- Cap prose reading measure near \`65ch\` (\`45ch–75ch\` range).
- Keep mobile body text ≥ \`16px\` and all form inputs ≥ \`16px\` to prevent automatic iOS Safari zoom.
- Always apply \`font-variant-numeric: tabular-nums\` (\`tabular-nums\`) on counters, prices, KPIs, timers, dates, and aligned table columns.
- Load **real font weights** for every weight used and set \`font-synthesis: none\` so browsers never smear faux bold or faux italic.
- Use \`text-wrap: balance\` on short headings and \`text-wrap: pretty\` on body paragraphs.
- Over photography or translucent surfaces, add an intentional scrim or raise text contrast and weight slightly instead of low-contrast gray.

## 6. Next.js font loading checklist

- Load fonts in the root \`layout.tsx\` via \`next/font/google\` or \`geist/font/*\`, attach CSS variables (\`--font-display\`, \`--font-sans\`, \`--font-mono\`) to \`<html>\`, and wire them in \`globals.css\` (\`@theme inline\` in Tailwind v4 or \`tailwind.config\`).
- Load only the exact weights/subsets needed (prefer variable fonts when using 3+ weights).
- Use \`display: "swap"\` so text renders immediately with metric-adjusted fallbacks.`;

const INTERFACE_CRAFT_GUIDE = `# Interface Craft Playbook

Use this playbook for nontrivial marketing or product interfaces, color/surface hierarchy, responsive recomposition, component architecture, dark mode, state coverage, and polish details.

## 1. Track calibration

### Marketing or brand surfaces
- Identity, value proposition, and primary CTA must be unmistakable in the first viewport.
- Give each section one job and one visual idea.
- Prefer open layouts, strong typography, media, hairlines, lists, and negative space before boxed cards.
- Keep one primary CTA language throughout; preserve craft all the way through the footer.

### Product or operational surfaces
- Make data, status, work canvas, and primary actions louder than chrome.
- Prefer concise utility labels over campaign slogans.
- Separate global navigation, local navigation, view/filter controls, page actions, and row/item actions.
- Never place marketing heroes, promotional fluff, or decorative card grids inside authenticated apps.
- Design loading, empty, dense, error (with recovery action), and destructive states alongside the happy path.

## 2. Color, surface, and depth system

Define semantic CSS variables — never scatter disconnected raw hex colors across components:
- \`--canvas\`, \`--surface\`, \`--surface-secondary\`, \`--surface-elevated\`, \`--surface-recessed\`.
- \`--text\`, \`--text-secondary\`, \`--text-muted\`.
- \`--border\`, \`--border-strong\`.
- \`--accent\`, \`--accent-hover\`, \`--accent-foreground\`.
- \`--success\`, \`--warning\`, \`--danger\`, \`--info\`, \`--focus\`.

### Lightest-sufficient grouping ladder
Before reaching for a bordered card, walk this ladder from lightest to heaviest:
1. **Whitespace and alignment** (default first choice).
2. **Divider or subtle tinted hairline border**.
3. **Recessed tonal well or subtle surface shift**.
4. **Card or elevated surface** — ONLY when the boundary communicates interactivity, selection, elevation, or a genuinely distinct content unit.

### Coherent depth & concentric radii
- Pick **ONE** primary depth strategy per view: border-led, tonal/tint-led, soft shadow-led, or layered shadow-led. Do not mix heavy drop shadows with thick hard gray borders.
- Preserve **concentric border geometry** for nested rounded surfaces: \`innerRadius = Math.max(0, outerRadius - padding)\` (for example, \`16px\` outer card with \`8px\` padding → \`8px\` inner button/panel). Keep outer container padding ≥ child gap.
- Use subtle inset outlines (\`ring-1 ring-inset ring-black/10\` or \`white/10\`) on photos/thumbnails for crisp edges without altering layout size.
- For translucent \`backdrop-filter\` surfaces: never stack translucent-on-translucent, raise text contrast/weight, and include solid fallbacks for \`@media (prefers-reduced-transparency: reduce)\` and \`@media (prefers-contrast: more)\`.

## 3. Strict SVG-only iconography & zero emoji

Hard release requirement on every build:
- Every interface icon MUST be SVG — use \`lucide-react\` (or existing project SVG set) first, or a crisp matching inline SVG component with consistent \`viewBox\`, stroke width, caps, joins, and \`currentColor\`.
- **Zero emojis** anywhere in authored UI: no emojis in headings, buttons, navigation, bullets, badges, status chips, toasts, alerts, empty states, placeholders, page titles, or decorative labels.
- Never use Unicode pictographs, icon fonts, CSS pseudo-element symbols, or PNG/JPG/WebP rasters as UI icons.
- Decorative SVGs get \`aria-hidden="true"\`; icon-only buttons get an explicit accessible label (\`aria-label\`) and ≥ 32px desktop / ≥ 44px touch hit target.
- Pair unfamiliar or destructive icons with visible text.
- Render user-submitted text safely as data (the zero-emoji rule governs authored interface chrome and copy).

## 4. Component construction & micro-polish

- Use semantic HTML: \`<a>\` / \`<Link>\` for navigation, \`<button>\` for actions; native controls and accessible primitives before hand-rolled ARIA.
- Keep external margins at call sites; reusable visual components should accept \`className\` overrides.
- Keep dimensions stable across state changes (hover, active, loading spinner, counts, validation errors) so buttons and rows never jump.
- Add tactile press feedback on interactive controls (\`:active { transform: scale(0.97); }\`).
- Keep avatars, icons, and logos at fixed size with \`shrink-0\` (\`flex-shrink: 0\`), and allow flex text children to wrap/truncate cleanly with \`min-w-0\`.
- Handle unbreakable strings (emails, URLs, tokens, long filenames) with \`overflow-wrap: anywhere\` or intentional truncation + full value visibility.
- Format numbers, currency, pluralization, and dates with \`Intl\` (\`Intl.NumberFormat\`, \`Intl.DateTimeFormat\`, \`Intl.PluralRules\`). Use relative time for recent events and switch to absolute dates after ~1 week.
- Prefer eased fade edges under sticky chrome rather than harsh stacked borders where appropriate.

## 5. Responsive recomposition & mobile platform baseline

Treat mobile as a deliberate composition — never a shrunken desktop:
- Review widths: Phone (\`390px\`), Tablet (\`768px\`), Small Laptop (\`1280px\`), Desktop (\`1440px\`), plus narrow (\`320px\`) and short-height views.
- Decide each section's narrow-screen transform explicitly: \`preserve\`, \`reflow\`, \`collapse\`, \`reorder\`, \`crop\`, \`simplify\`, or \`hide\`.
- Collapse sidebars and dense toolbars into accessible drawers/disclosures; wrap wide tables in horizontal scroll containers with sticky or clear key columns; allow tab bars to scroll horizontally when dense.
- Eliminate page-level horizontal overflow completely.

### Mobile platform CSS & metadata baseline
Include on mobile-facing layouts:
- Viewport metadata with \`viewport-fit=cover\` (NEVER \`user-scalable=no\` or \`maximum-scale=1\`) plus matching light/dark \`theme-color\` metadata.
- \`html { -webkit-tap-highlight-color: transparent; -webkit-text-size-adjust: 100%; }\`
- \`input, textarea, select { font-size: 16px; }\` (prevents iOS auto-zoom).
- \`button, a, [role="button"] { touch-action: manipulation; }\`
- Use \`100svh\` for heroes/first screens and \`100dvh\` for app shells/bottom-pinned drawers — avoid fragile \`100vh\`.
- Pad fixed headers, bottom bars, sheets, and toasts with \`env(safe-area-inset-*, 0px)\`.
- Gate hover styles behind \`@media (hover: hover) and (pointer: fine)\` so touch taps never get stuck in hover state.
- Use \`overscroll-behavior: contain\` on inner scroll regions (drawers, sidebars, chat lists).
- Keep \`user-select: none\` off body content so users can copy IDs, emails, and errors.

## 6. Complete state matrices

Build every applicable state cleanly:
- **Forms:** persistent visible labels, descriptions, correct \`type\`/\`inputMode\`/\`autoComplete\`, Enter submission, inline validation errors, double-submit lock while pending, preserve user inputs on failed submit (never clear!), clear success confirmation.
- **Dialogs & drawers:** accessible title/role, initial focus inside, Escape to close, explicit close button, backdrop scroll lock, focus restoration on close, reachable actions on short viewports.
- **Lists & tables:** skeleton/loading geometry matching final layout, purposeful empty state with primary action, filter/search no-results state with one-click reset, stale-request protection, error banner with retry button.
- **Destructive actions:** explicit confirmation for irreversible deletes, visible pending state without layout shift, clear feedback or rollback on error.

## 7. Dark mode

- Derive semantic dark tokens thoughtfully — never mechanically invert light colors.
- Step surfaces from deep tinted charcoal canvas → slightly lifted primary surface → subtle elevated surface with fine low-opacity light inset rings (\`rgba(255,255,255,0.08)\`) instead of muddy black drop shadows.
- Preserve AA contrast, focus ring visibility, status legibility, and brand character across both themes.`;

const MOTION_GUIDE = `# Motion Playbook

Use this playbook whenever an interface adds, matches, tunes, or removes transitions and animation. In reference reconstruction, observed reference motion outranks defaults.

## 1. Frequency & purpose gate (should it animate?)

Decide before writing a single transition — **not animating is often the superior choice**:

| Frequency | Decision |
|---|---|
| 100+ times/day (keyboard shortcuts, command palette, focus jumps, typing) | **No animation** |
| Tens of times/day (frequent list selection, tabs, compact toggles) | **Near-imperceptible or none** |
| Occasional (modals, drawers, popovers, dropdowns, toasts) | **Crisp, fast transition** |
| Rare / first-time (onboarding, empty-to-filled, hero accent, success beat) | **Measured delight** |

- **Never animate keyboard-initiated actions.**
- Name a one-word purpose before adding motion: **Feedback**, **Spatial consistency**, **State indication**, **Preventing a jarring jump**, **Explanation**, or **Delight** (rare tier only). If no purpose applies, omit it.

## 2. Choose the lightest tool

- Hover, press, color, opacity, or state toggles → **CSS transitions**.
- Entry on mount without JS overhead → **CSS \`@starting-style\`** (or \`data-state\` attributes).
- Smooth motion during busy hydration/navigation → **CSS animations or WAAPI** (compositor thread).
- Complex gestures, shared layout transitions, or spring exit choreography → motion library only when genuinely justified.

## 3. Properties, curves, and durations

### Properties (compositor-first)
- Animate **\`transform\`** and **\`opacity\`** by default. Never animate layout properties (\`width\`, \`height\`, \`top\`, \`left\`, \`margin\`, \`padding\`) except deliberate accordion height reveals.
- **Never use \`transition: all\`** — always list exact properties (e.g., \`transition: transform 180ms var(--ease-out), opacity 180ms var(--ease-out)\`).
- **Never animate from \`scale(0)\`** — enter from \`scale(0.95)\` (or \`0.92–0.97\`) + \`opacity: 0\`.

### Easing tokens
Built-in CSS \`ease-out\` is weak. Define crisp semantic easing tokens:
\`\`\`css
:root {
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
  --ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);
}
\`\`\`
- **Enter & exit:** \`var(--ease-out)\`.
- **Moving/morphing on screen:** \`var(--ease-in-out)\`.
- **Hover/color:** \`ease\`.
- **Never use \`ease-in\` for UI motion** — it feels sluggish on the first frames users watch most closely.

### Durations
- Button press feedback (\`:active\`): \`100–160ms\`.
- Tooltips & small popovers: \`125–200ms\`.
- Dropdowns & selects: \`150–250ms\`.
- Modals & drawers: \`200–350ms\`.
- Keep product UI transitions **under 300ms** and make exits slightly faster than entrances.

## 4. Interruption, origin, and recipes

- Use CSS transitions (not keyframes) for anything a user can trigger rapidly — transitions retarget smoothly mid-flight instead of snapping back.
- Never lock out clicks/input while an animation is running.
- Anchor \`transform-origin\` at the trigger for popovers, menus, and dropdowns; keep centered modals centered.
- Stagger small list reveals gently (\`30–60ms\` per item, capped) and never block interaction while playing.

\`\`\`css
/* Press feedback */
.btn { transition: transform 150ms var(--ease-out), background-color 150ms ease; }
.btn:active { transform: scale(0.97); }

/* Trigger-anchored popover */
.popover {
  transform-origin: var(--transform-origin, top center);
  transition: opacity 180ms var(--ease-out), transform 180ms var(--ease-out);
}
.popover[data-closed] { opacity: 0; transform: scale(0.95); }

/* Pointer-gated hover */
@media (hover: hover) and (pointer: fine) {
  .interactive-card:hover { transform: translateY(-2px); }
}

/* Gentler reduced-motion fallback (not broken or empty) */
@media (prefers-reduced-motion: reduce) {
  .popover, .modal, .drawer {
    transition: opacity 160ms ease;
    transform: none !important;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .glass-surface { background: var(--surface); backdrop-filter: none; }
}
\`\`\`

## 5. Restraint & never-ship checklist

Reject:
- Fade-in-on-scroll applied to every section on a page.
- Infinite looping pulses, glowing borders, or drifting background orbs on persistent UI.
- Charts redrawing from zero or numbers counting up on every mount.
- Content trapped at \`opacity: 0\` if JavaScript or an observer fails to trigger.
- Ungated \`:hover\` transforms on touch devices, \`transition: all\`, \`scale(0)\` entrances, \`ease-in\` UI transitions, or animations on keyboard actions.`;

const VERIFICATION_GUIDE = `# Visual & Production Verification Playbook

Do not declare a UI complete just because files saved or \`npm run dev\` booted. Verify architecture, responsiveness, copy, iconography, build cleanliness, and live preview health systematically.

## 1. Correction priority order (fix global root causes first)

When reviewing and fixing UI issues, resolve mismatches in this strict order:
1. Wrong route, missing core feature, broken data flow, or wrong theme/state.
2. Page shell, landmarks, container max-widths, gutters, and section rhythm.
3. Grid alignment, overlaps, sticky header offsets, and dominant image framing/aspect ratios.
4. Font families loaded cleanly, real weights, scale, measure (\`~65ch\`), per-role line height & tracking, and wrapping.
5. Spacing cadence and repeated gaps.
6. Semantic color tokens, contrast (WCAG AA), borders, concentric radii, and unified depth strategy.
7. SVG-only iconography audit (confirm ZERO emojis, ZERO Unicode pictographs, ZERO raster UI icons, proper \`aria-hidden\` and \`aria-label\`).
8. Interactive states (hover, focus-visible, active, disabled, loading, empty, error with recovery) and disciplined motion.

## 2. Worst-case content & layout stress check

Mentally and structurally audit components against realistic edge cases before finalizing:
- **Long names & locales:** \`Aleksandra Wiśniewska-Kowalczyk\`, short 2-letter names, missing avatars → ensure clean wrapping/fallback initials.
- **Unbreakable strings:** long emails, URLs, share tokens, UUIDs, filenames → apply \`min-w-0\` + \`overflow-wrap: anywhere\` or intentional \`truncate\`.
- **Numbers & counts:** \`0\`, \`1\` (singular pluralization), \`1,284\`, \`$1,000,000\`, negative values → use \`tabular-nums\` and \`Intl\` formatting.
- **Collections:** 0 items (purposeful empty state), 1 item, 100+ items (clean scrolling/pagination without blowing up layout).
- **Media:** missing image fallback, ultra-wide vs tall aspect ratios → explicit \`aspect-*\` container + \`object-cover\`.
- **Narrow & wide screens:** \`320px–390px\` phone (zero horizontal scroll, collapsed nav, 16px inputs, 44px touch targets), \`768px\` tablet, \`1280px–1440px\` desktop.

## 3. Cognix build & runtime verification gates

Before finishing every Build turn:
1. **SVG & zero-emoji grep check:** Verify generated JSX/TSX/CSS contains zero authored UI emojis, no dead \`href="#"\` links, no placeholder lorem ipsum/Acme text, and no leaked third-party infrastructure names.
2. **Production build gate:** Run \`npm run build\` until exit code \`0\`. Fix every TypeScript, ESLint, Next.js static/dynamic rendering, or font/CSS error completely.
3. **Live preview & console gate:** Ensure the dev server runs on \`0.0.0.0:3000\`, run \`read_preview_console\` (with \`probeRoutes\` covering key pages and API routes) and \`inspect_preview\` to verify HTTP 2xx/3xx responses, zero console/hydration errors, zero failed local assets, and working auth/data routes, then call \`get_preview_url\`.
4. **Honest evidence reporting:** Never claim pixel-by-pixel visual screenshot comparison when only HTML/HTTP/console inspection was executed. Report clearly what was verified and any documented substitutions (e.g., open-licensed font match or SVG replacement of a mockup emoji).`;

export const DESIGN_GUIDES: Record<DesignGuideTopic, string> = {
  core: CORE_GUIDE,
  "art-direction": ART_DIRECTION_GUIDE,
  "reference-forensics": REFERENCE_FORENSICS_GUIDE,
  "typography-and-fonts": TYPOGRAPHY_AND_FONTS_GUIDE,
  "interface-craft": INTERFACE_CRAFT_GUIDE,
  motion: MOTION_GUIDE,
  verification: VERIFICATION_GUIDE,
};
