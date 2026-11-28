export type FrontendDesignDepth = "none" | "lightweight" | "deep";

export type FrontendSurfaceKind =
  | "marketing"
  | "workspace"
  | "commerce"
  | "content"
  | "utility";

export type FrontendProductFamily =
  | "finance"
  | "health"
  | "creative"
  | "developer"
  | "commerce"
  | "community"
  | "productivity"
  | "general";

export type FrontendDesignBlueprint = {
  depth: Exclude<FrontendDesignDepth, "none">;
  surface: FrontendSurfaceKind;
  family: FrontendProductFamily;
  direction: string;
  composition: string;
  colorSystem: string;
  typography: string;
  requiredStates: string;
  responsiveIntent: string;
  guideTopics: readonly string[];
};

const FRONTEND_TERMS = /\b(?:app|application|website|site|page|screen|frontend|front-end|ui|ux|dashboard|landing|homepage|home page|portfolio|store|shop|checkout|editor|inbox|chat|notes|calendar|settings|profile|navigation|navbar|sidebar|form|button|card|table|modal|responsive|mobile|tablet|desktop|theme|style|layout|component|visual|design)\b/i;
const BACKEND_ONLY_TERMS = /\b(?:api|webhook|cron|migration|database|schema|query|server action|backend|worker|queue|cache|authentication middleware|rate limit)\b/i;
const LIGHTWEIGHT_TERMS = /\b(?:copy|label|wording|typo|color|colour|font size|spacing|padding|margin|icon|alignment|border|radius)\b/i;
const DEEP_TERMS = /\b(?:build|create|make|redesign|rebuild|recreate|landing|homepage|dashboard|portfolio|store|shop|application|website|design system|screenshot|mockup|reference|responsive)\b/i;

export function classifyFrontendDesignWork(input: {
  prompt: string;
  isNewProject: boolean;
  hasVisualReference?: boolean;
}): FrontendDesignDepth {
  const prompt = input.prompt.trim();
  if (input.isNewProject || input.hasVisualReference) return "deep";
  if (!FRONTEND_TERMS.test(prompt)) return BACKEND_ONLY_TERMS.test(prompt) ? "none" : "none";
  if (DEEP_TERMS.test(prompt)) return "deep";
  return LIGHTWEIGHT_TERMS.test(prompt) ? "lightweight" : "lightweight";
}

function inferSurface(prompt: string): FrontendSurfaceKind {
  if (/\b(?:landing|homepage|marketing|pricing|waitlist|launch|product page)\b/i.test(prompt)) return "marketing";
  if (/\b(?:store|shop|commerce|catalog|product detail|cart|checkout|marketplace)\b/i.test(prompt)) return "commerce";
  if (/\b(?:blog|magazine|news|docs|documentation|knowledge base|article|portfolio)\b/i.test(prompt)) return "content";
  if (/\b(?:dashboard|workspace|admin|inbox|editor|chat|notes|calendar|crm|settings|analytics|project management)\b/i.test(prompt)) return "workspace";
  return "utility";
}

function inferFamily(prompt: string): FrontendProductFamily {
  if (/\b(?:finance|fintech|bank|budget|invoice|accounting|trading|portfolio tracker)\b/i.test(prompt)) return "finance";
  if (/\b(?:health|medical|wellness|fitness|clinic|patient|therapy)\b/i.test(prompt)) return "health";
  if (/\b(?:design|creative|studio|agency|photography|music|fashion|portfolio)\b/i.test(prompt)) return "creative";
  if (/\b(?:developer|code|api|devtool|terminal|deployment|monitoring|infrastructure)\b/i.test(prompt)) return "developer";
  if (/\b(?:store|shop|commerce|catalog|product|cart|checkout|marketplace)\b/i.test(prompt)) return "commerce";
  if (/\b(?:social|community|chat|messaging|forum|network|creator)\b/i.test(prompt)) return "community";
  if (/\b(?:task|notes|calendar|project|productivity|crm|workspace|dashboard|admin)\b/i.test(prompt)) return "productivity";
  return "general";
}

const FAMILY_DIRECTION: Record<FrontendProductFamily, Pick<FrontendDesignBlueprint, "direction" | "colorSystem" | "typography">> = {
  finance: {
    direction: "A precise financial ledger: calm density, strong numeric hierarchy, restrained emphasis, and trustworthy surfaces.",
    colorSystem: "Use cool ink-tinted neutrals, one confident blue or emerald action color, and explicit success/warning/danger roles; avoid decorative gradients.",
    typography: "Use Geist Sans for interface clarity and Geist Mono with tabular numerals for balances, dates, and metrics.",
  },
  health: {
    direction: "A calm clinical studio: reassuring whitespace, human language, soft structure, and unambiguous next actions.",
    colorSystem: "Use mineral-tinted neutrals with one accessible teal or blue action color and quiet semantic status colors.",
    typography: "Use a warm, highly legible sans hierarchy; keep body measure comfortable and labels direct.",
  },
  creative: {
    direction: "An editorial working studio: expressive composition, disciplined typography, selective imagery, and visible craft without ornamental clutter.",
    colorSystem: "Use warm paper or charcoal neutrals with one vivid, project-specific accent derived from the content or supplied assets.",
    typography: "Use one expressive display voice only where it earns attention, paired with a restrained interface sans; never exceed two families plus mono.",
  },
  developer: {
    direction: "A focused technical instrument: compact hierarchy, high information fidelity, crisp states, and purposeful monospace details.",
    colorSystem: "Use graphite or slate neutrals with one electric action color and high-contrast code/status roles.",
    typography: "Use Geist Sans for controls and Geist Mono for code, identifiers, logs, and tabular data.",
  },
  commerce: {
    direction: "A tactile editorial storefront: product-first imagery, decisive purchasing hierarchy, and quiet chrome that lets merchandise lead.",
    colorSystem: "Use warm ivory and near-black foundations with one product-derived accent; keep promotions and status colors semantic.",
    typography: "Use a confident display treatment for merchandising and a clean sans for prices, variants, forms, and checkout.",
  },
  community: {
    direction: "A lively shared table: people and conversation first, friendly rhythm, strong presence states, and fast repeated actions.",
    colorSystem: "Use warm or softly tinted neutrals with one energetic accessible accent and distinct online/unread/error states.",
    typography: "Use an approachable sans with clear name/message contrast and tabular time metadata.",
  },
  productivity: {
    direction: "A quiet, capable workbench: content-first density, predictable navigation, progressive disclosure, and minimal visual friction.",
    colorSystem: "Use lightly tinted neutrals, one calm action color, and restrained tonal wells before adding borders or cards.",
    typography: "Use Geist Sans with compact but readable hierarchy; reserve Geist Mono and tabular numerals for metadata and counts.",
  },
  general: {
    direction: "A crafted domain-specific interface: one clear visual idea, real content hierarchy, and the lightest surface treatment that communicates structure.",
    colorSystem: "Choose tinted neutrals that fit the subject, one accessible primary accent, and explicit semantic status/focus roles; no random gradients.",
    typography: "Use a purposeful two-level type system with Geist as the reliable interface foundation and no more than one complementary display face.",
  },
};

function compositionForSurface(surface: FrontendSurfaceKind): string {
  switch (surface) {
    case "marketing":
      return "Open with a specific value proposition and one dominant visual anchor, then sequence evidence, product understanding, and a decisive action; do not repeat generic card grids.";
    case "workspace":
      return "Open directly on the work: persistent navigation, a legible primary canvas, contextual actions, and dense information that reflows rather than merely stacking.";
    case "commerce":
      return "Lead with products and decision-making information: imagery, price, variants, availability, trust, and purchase action; keep navigation and filters efficient.";
    case "content":
      return "Prioritize reading rhythm, information scent, useful navigation, intentional measure, and expressive but disciplined editorial hierarchy.";
    default:
      return "Make the primary task obvious in the first viewport, minimize chrome, and expose advanced controls only when they become relevant.";
  }
}

export function createFrontendDesignBlueprint(input: {
  prompt: string;
  isNewProject: boolean;
  hasVisualReference?: boolean;
}): FrontendDesignBlueprint | null {
  const depth = classifyFrontendDesignWork(input);
  if (depth === "none") return null;
  const surface = inferSurface(input.prompt);
  const family = inferFamily(input.prompt);
  const familyDirection = FAMILY_DIRECTION[family];
  const deepTopics = input.hasVisualReference
    ? ["core", "reference-forensics", "typography-and-fonts", "verification"]
    : ["core", "art-direction", "interface-craft", "design-critique", "verification"];

  return {
    depth,
    surface,
    family,
    ...familyDirection,
    composition: compositionForSurface(surface),
    requiredStates: "Implement real loading, empty, error-with-recovery, success, disabled, hover, pressed, and focus-visible states where the flow needs them.",
    responsiveIntent: "Compose deliberately at 390px, 768px, and 1440px: preserve priority, change navigation and density intentionally, and prevent overflow instead of only stacking columns.",
    guideTopics: depth === "deep" ? deepTopics : ["interface-craft", "verification"],
  };
}

export function renderFrontendDesignBlueprint(blueprint: FrontendDesignBlueprint | null): string {
  if (!blueprint) return "";
  return [
    "<frontend_design_blueprint>",
    `Depth: ${blueprint.depth}; surface: ${blueprint.surface}; product family: ${blueprint.family}.`,
    `Visual north star: ${blueprint.direction}`,
    `Composition: ${blueprint.composition}`,
    `Color: ${blueprint.colorSystem}`,
    `Typography: ${blueprint.typography}`,
    `States: ${blueprint.requiredStates}`,
    `Responsive: ${blueprint.responsiveIntent}`,
    `Relevant internal guides: ${blueprint.guideTopics.join(", ")}. Read only the guides needed for this task.`,
    "Treat this as a starting constraint inferred from the request, not a replacement for explicit user direction, supplied references, brand assets, or an existing project's verified design system.",
    "</frontend_design_blueprint>",
  ].join("\n");
}
