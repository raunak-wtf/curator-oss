/**
 * Internal direction exploration & review playbook, read through the `read_design_guide`
 * tool. Adapted from the MIT-licensed Oil UI skill by oil-oil
 * (https://github.com/oil-oil/oil-ui, https://ui.oiloil.org): visual north star,
 * direction cards from concrete anchors, honest direction comparison, independent
 * review, and lightweight UX walkthroughs. Never exposed in the public skills
 * database. Import only from server code.
 */

export const DIRECTION_EXPLORATION_GUIDE = `# Direction Exploration & Review Playbook

Use this playbook when the user asks to explore or compare visual directions, wants a more distinctive first version or is unconvinced by the first direction, names products to benchmark against, or when a new interface or whole-page redesign needs a deeper review before delivery.

## 1. The visual north star

Before composing anything, write one sentence that states what this interface must feel like at a glance. Every composition, typography, color, spacing, imagery, and motion decision then leans toward that sentence; anything that points away from it gets cut. Translate vague brief words — 'clean', 'premium', 'modern', 'bold' — into a concrete tone (lively or calm, polished or raw, dense or airy) and from there into visible choices: typefaces, whitespace ratio, color proportion, imagery treatment. Judge visual quality and task completion separately: a page can be beautiful and still fail its job, and vice versa.

## 2. Direction cards from concrete anchors

Never pitch a direction as an adjective ('minimalist'). Each direction starts from something concrete — a material (fluted glass, terracotta, wet moss), a setting, an object, or the visual language of another craft (letterpress, archival photography, flight instruments) — plus the tone and the first-screen composition. For a new product, first name the product category, find two or three peers with genuinely distinctive styles, study why their choices work for their audience, and decide explicitly what to keep and what to break from. Do not copy a peer's signature effect; take the reasoning, not the artifact.

## 3. First screens by the page's real job

- **Persuasion surfaces** (brand, launch, campaign, exhibition): the opening screen is choreographed — choose its skeleton deliberately (asymmetric split, type-led statement, image-led composition, full-bleed atmosphere) and settle it before writing the copy.
- **Work, browse, or shop surfaces** (dashboards, tools, catalogs, feeds): screen one starts with the content or the work surface itself. Compress the header to one row, let the first row of real content appear whole inside the first viewport, and drop hero slogans and page-explainer paragraphs. The interface proves its purpose by being immediately usable.
- **Strong-interaction surfaces** (games, canvases, hands-on tools): inventory the interactive objects and their states first; the first screen shows the object being played with, not a poster about it.

## 4. Comparing directions honestly

When comparing directions (only on request, or when the user is explicitly choosing):
- Make variants genuinely different: between any two, at most one trait may be shared among layout, typography, color, and key imagery.
- Apply the squint test: blur your eyes and compare the light/dark shape masses side by side; if two variants read as the same page, rework one of them.
- Deliver variants as real previewable routes (or \`ask_user\` options with one-line descriptions of what each direction trades away) rather than prose descriptions. Name each direction after its anchor.
- Recommend one direction by default with a stated reason; comparison costs the user time, so build it only when they are actually choosing.

## 5. Independent review before delivery

For a new interface or a whole-page redesign (after the direction is chosen), run one review round with fresh eyes after your own screenshot self-check: re-read only the original request, then judge only what the rendered page shows — ignore build history, sunk effort, and what the code was supposed to do. Report what a first-time visitor would notice, fix the reported issues, and deliver with the remaining gaps listed. For a localized change, self-check the changed spot and its neighbors instead. Small style tweaks (a copy edit, a color swap, removing a named element) get no review round at all.

## 6. Lightweight UX walkthrough

When the page has a primary flow, walk it once as a first-time user: infer the goal from the page alone, attempt the main path end to end, and check the states it passes through (first load, submit, success, failure). Do not script the walkthrough with expected steps — the point is to catch what the page fails to communicate on its own. Fix what the walkthrough exposes, then verify functionally rather than re-reviewing.

## 7. Honest capability boundaries

State plainly what could not be verified: never claim visual verification when rendered output was not inspected, and never claim interaction passed without a running preview. If required functionality is unfinished, list it truthfully in the delivery note instead of papering over it.`;
