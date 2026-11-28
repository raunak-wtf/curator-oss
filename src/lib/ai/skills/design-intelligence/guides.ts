import { DISTINCTIVE_IDENTITY_GUIDE } from "../frontend-design/guides";
import { DESIGN_CRITIQUE_GUIDE } from "../impeccable/guides";
import { CORE_DESIGN_GUIDES, CORE_DESIGN_GUIDE_LABELS, CORE_DESIGN_GUIDE_TOPICS } from "../design-to-code/guides";
import { DIRECTION_EXPLORATION_GUIDE } from "../oil-ui/guides";

/**
 * The full internal design playbook registry served by the `read_design_guide` tool.
 * Combines the design-to-code playbooks with the critique (Impeccable-inspired),
 * distinctive-identity & theme-curation (Anthropic-inspired), and direction-exploration
 * (Oil UI-inspired) playbooks.
 * Never exposed in the public skills database. Import only from server code.
 */

export const DESIGN_GUIDE_TOPICS = [
  ...CORE_DESIGN_GUIDE_TOPICS,
  "design-critique",
  "distinctive-identity",
  "direction-exploration",
] as const;

export type DesignGuideTopic = (typeof DESIGN_GUIDE_TOPICS)[number];

export const DESIGN_GUIDE_LABELS: Record<DesignGuideTopic, string> = {
  ...CORE_DESIGN_GUIDE_LABELS,
  "design-critique": "design critique & refinement",
  "distinctive-identity": "distinctive identity & themes",
  "direction-exploration": "direction exploration & review",
};

export const DESIGN_GUIDES: Record<DesignGuideTopic, string> = {
  ...CORE_DESIGN_GUIDES,
  "design-critique": DESIGN_CRITIQUE_GUIDE,
  "distinctive-identity": DISTINCTIVE_IDENTITY_GUIDE,
  "direction-exploration": DIRECTION_EXPLORATION_GUIDE,
};
