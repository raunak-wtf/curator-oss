/**
 * Internal distinctive-identity & theme-curation playbook, read through the `read_design_guide`
 * tool. Adapted from Anthropic's frontend-design and theme-factory skills
 * (https://github.com/anthropics/skills). Never exposed in the public skills database.
 * Import only from server code.
 */

export const DISTINCTIVE_IDENTITY_GUIDE = `# Distinctive Identity & Theme Curation Playbook

Use this playbook for greenfield art direction, redesigns, restyles, and any build at risk of reading as templated. The goal: every project gets a visual identity that could not be mistaken for a template or for another product.

## 1. Ground the direction in the subject

Distinctive choices come from the subject's industry, materials, audience, and vernacular — a toy for 8–11 year olds, a financial analyst dashboard, and a neighborhood bakery cannot share a visual language. Before designing, name three things: the subject, the audience, and the design's primary job. When the brief leaves an axis free, invest that freedom in subject-specific choices rather than a familiar default. Where the brief pins a direction, follow it exactly — the brief's own words always win, including when it asks for one of the looks below.

## 2. The generic-AI look clusters

Every cluster below is legitimate when the brief asks for it; each is a defect when it appears by default:

1. Warm cream (≈ \`#F4F1EA\`) with a high-contrast serif display and a terracotta / warm-clay accent (≈ \`#D97757\`).
2. Near-black canvas with a single bright acid-green or vermilion accent.
3. Broadsheet layout: hairline rules, zero border-radius, dense newspaper-like columns.
4. The SaaS card kit: content chopped into identical rounded cards, one radius on everything regardless of hierarchy, the same soft grey shadow (\`rgba(0,0,0,.1)\`) under each, gradient washes as decoration.
5. Template chrome whatever the subject: a tracked-out ALL-CAPS eyebrow above every heading; meta strings joined with middle dots ('A · B · C'); labels built as 'WORD — fragment' with a spaced em dash; tinted near-black (\`#0B0B0B\`, \`#111\`) standing in for black; a monospace face for small data labels; a '→' appended to link and button text.
6. The default hero: a big number, a small label, supporting stats, and a gradient accent.

Audit the plan: mentally run the same brief for a different client — if substantial parts of the plan survive unchanged, redesign those parts.

## 3. Two-pass design planning

**Pass one — draft a compact design plan:** 4–6 named palette hex values, the typefaces and their roles, a layout concept (one-sentence prose and quick ASCII wireframes to compare, including alignment guidance), and the principles that make this page unique.
**Pass two — review the plan against the brief before building:** strike anything that reads like the generic default, state what changed and why, then build to the revised plan. While writing CSS, watch selector specificity — a type-based selector (like \`.section\`) easily cancels an element-based one (like \`.cta\`), especially padding and margin between sections.

## 4. Boldness discipline

Spend boldness in one place. One element carries the memorable moment; everything around it stays quiet and disciplined. Take the mirror test before finishing: remove one decorative accessory that does not serve the brief. A single orchestrated moment — one page-load sequence or one reveal — lands better than scattered effects; fade-and-slide entrances on every section and hover transitions on every card are the generic default to avoid. Motion that answers a person's action (opening, expanding, confirming) is welcome when it shows what changed.

## 5. Theme curation and tokens

Treat a theme as a curated unit: a named palette plus font pairing, chosen once for the product's world, recorded as semantic CSS custom properties (\`--canvas\`, \`--surface\`, \`--surface-elevated\`, \`--text\`, \`--text-muted\`, \`--border\`, \`--accent\`, \`--success\`, \`--warning\`, \`--danger\`, \`--focus\`) plus its type roles, and applied consistently across every route and component.

- In existing projects, reuse and extend the established token system; a restyle updates the tokens first and the components follow. Never run a parallel second system.
- When curating a fresh theme, choose mood and domain first; make the palette and type hard to reuse for a different product without looking wrong; verify WCAG AA contrast for every text and control role before committing.
- Keep a short design-notes record in the project (tokens, type pairing, motifs tried and rejected) so future turns stay consistent instead of drifting.

## 6. Copy is design content

Words appear in a design for one reason: to make the product easier to understand and use. Name things by what users understand ('notifications', not 'webhook config'). A CTA says exactly what happens when used. One action keeps the same name through the whole flow — the button that says 'Publish' produces a toast that says 'Published'. Active voice, sentence case, no filler. Errors never apologize and are never vague: they explain what went wrong and how to fix it, in the interface's voice. An empty screen is an invitation to act. Specific and legible beats clever.`;
