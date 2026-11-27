import { z } from "zod";
import { CLOUD_FEATURES, type CloudFeature } from "../cloud-features";
import type { AgentQuestionRequest } from "../types";
import { CLOUD_GUIDES } from "./cloud-guides";
import { DESIGN_GUIDES, DESIGN_GUIDE_LABELS, DESIGN_GUIDE_TOPICS } from "./design-guides";

/**
 * Tools that talk to the user or to Cognix rather than the sandbox. `ask_user` and
 * `request_cognix_cloud` pause the build; the user's answer arrives as their next message.
 */
export const INTERACTIVE_TOOL_NAMES = [
  "ask_user",
  "request_cognix_cloud",
  "read_cloud_guide",
  "read_design_guide",
] as const;
const FEATURES = ["database", "storage", "auth", "email"] as const;

export const interactiveTools = [
  {
    type: "function" as const,
    function: {
      name: "ask_user",
      description:
        "Ask the user one or two short multiple-choice questions when a decision is critical and cannot be inferred, such as the app's name, who its users are, or which core features to include. The user can also type their own answer. The build pauses until they reply.",
      parameters: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            minItems: 1,
            maxItems: 2,
            items: {
              type: "object",
              properties: {
                question: { type: "string", description: "A short, plain question ending with a question mark." },
                type: { type: "string", enum: ["single", "multiple"], description: "single = pick one, multiple = pick any." },
                options: { type: "array", minItems: 2, maxItems: 5, items: { type: "string" }, description: "2-5 short answer options." },
              },
              required: ["question", "type", "options"],
              additionalProperties: false,
            },
          },
        },
        required: ["questions"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "request_cognix_cloud",
      description:
        "Request explicit user consent to turn on Cognix Cloud for this project. Mandatory before installing packages or writing code for any database, storage, authentication, or email feature while Cognix Cloud is off. Do not call mutating file or command tools in the same turn; the build pauses until the user approves or declines.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "One sentence, addressed to the user, explaining what needs Cognix Cloud." },
          features: { type: "array", minItems: 1, items: { type: "string", enum: [...FEATURES] } },
        },
        required: ["reason", "features"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_cloud_guide",
      description:
        "Read Cognix's internal implementation guide for a Cognix Cloud feature. Call it before implementing that feature. Only available when Cognix Cloud is on.",
      parameters: {
        type: "object",
        properties: { feature: { type: "string", enum: [...FEATURES] } },
        required: ["feature"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_design_guide",
      description:
        "Read Cognix's internal design-to-code playbook for art direction, image/screenshot reference forensics, semantic color & surface systems, typography & fonts, interface craft, motion, or visual verification. Always available in Build and Plan modes.",
      parameters: {
        type: "object",
        properties: { topic: { type: "string", enum: [...DESIGN_GUIDE_TOPICS] } },
        required: ["topic"],
        additionalProperties: false,
      },
    },
  },
];

export function isInteractiveTool(name: string): name is (typeof INTERACTIVE_TOOL_NAMES)[number] {
  return (INTERACTIVE_TOOL_NAMES as readonly string[]).includes(name);
}

const askSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string().trim().min(3).max(200),
        type: z.enum(["single", "multiple"]),
        options: z.array(z.string().trim().min(1).max(80)).min(2).max(5),
      }),
    )
    .min(1)
    .max(2),
});
const cloudRequestSchema = z.object({
  reason: z.string().trim().min(3).max(300),
  features: z.array(z.enum(FEATURES)).min(1).max(4),
});
const guideSchema = z.object({ feature: z.enum(FEATURES) });
const designGuideSchema = z.object({ topic: z.enum(DESIGN_GUIDE_TOPICS) });

export type InteractiveToolResult = {
  output: string;
  summary: string;
  /** Set when the build must pause for the user. */
  request?: AgentQuestionRequest;
};

export function runInteractiveTool(
  name: (typeof INTERACTIVE_TOOL_NAMES)[number],
  rawInput: unknown,
  context: { cloudEnabled: boolean; alreadyAsked: boolean },
): InteractiveToolResult {
  if (name === "read_design_guide") {
    const { topic } = designGuideSchema.parse(rawInput);
    return {
      output: DESIGN_GUIDES[topic],
      summary: `Read the ${DESIGN_GUIDE_LABELS[topic]} guide`,
    };
  }

  if (name === "read_cloud_guide") {
    const { feature } = guideSchema.parse(rawInput);
    if (!context.cloudEnabled) {
      return {
        output: "Cognix Cloud is off for this project. Call request_cognix_cloud first and wait for the user to turn it on.",
        summary: "Cognix Cloud is off",
      };
    }
    return { output: CLOUD_GUIDES[feature], summary: `Read the ${CLOUD_FEATURES[feature].label.toLowerCase()} guide` };
  }

  if (context.alreadyAsked) {
    return {
      output: "You already asked the user something in this turn. Stop now and wait for their reply.",
      summary: "Waiting for the user's answer",
    };
  }

  if (name === "request_cognix_cloud") {
    const input = cloudRequestSchema.parse(rawInput);
    if (context.cloudEnabled) {
      return {
        output: "Cognix Cloud is already on. Call read_cloud_guide for each feature you need and continue.",
        summary: "Cognix Cloud is already on",
      };
    }
    const features = [...new Set(input.features)] as CloudFeature[];
    return {
      output: "The user is being asked to turn on Cognix Cloud. Stop calling tools now and end your turn with one short sentence; their decision arrives as the next message.",
      summary: "Asked to turn on Cognix Cloud",
      request: { kind: "enable_cloud", reason: input.reason, features },
    };
  }

  const input = askSchema.parse(rawInput);
  return {
    output: "The questions are shown to the user. Stop calling tools now and end your turn with one short sentence; their answers arrive as the next message.",
    summary: input.questions.length === 1 ? "Asked the user a question" : "Asked the user 2 questions",
    request: { kind: "questions", questions: input.questions },
  };
}
