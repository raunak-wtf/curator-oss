export const BENCHMARK_SUITE_VERSION = "1.0.0";

export type BenchmarkCategory = "frontend" | "fullstack" | "edit" | "repair";

export type ExpectedCloudFeature = "database" | "auth" | "storage" | "email";

export interface BenchmarkSlaTargets {
  firstPreviewP50Ms: number;
  firstPreviewP95Ms: number;
  completionP50Ms: number;
  completionP95Ms: number;
  turnsP50: number;
  turnsP95: number;
  inputTokensP50: number;
  maxProductionBuilds: number;
}

export interface BenchmarkDefinition {
  id: string;
  title: string;
  category: BenchmarkCategory;
  prompt: string;
  expectedCloudFeatures: ExpectedCloudFeature[];
  requiredRoutes: string[];
  expectedInteractions: string[];
  sla: BenchmarkSlaTargets;
}

const FRONTEND_SLA: BenchmarkSlaTargets = {
  firstPreviewP50Ms: 90_000,
  firstPreviewP95Ms: 180_000,
  completionP50Ms: 240_000,
  completionP95Ms: 420_000,
  turnsP50: 12,
  turnsP95: 20,
  inputTokensP50: 500_000,
  maxProductionBuilds: 1,
};

const FULLSTACK_SLA: BenchmarkSlaTargets = {
  firstPreviewP50Ms: 120_000,
  firstPreviewP95Ms: 240_000,
  completionP50Ms: 360_000,
  completionP95Ms: 600_000,
  turnsP50: 18,
  turnsP95: 30,
  inputTokensP50: 900_000,
  maxProductionBuilds: 1,
};

export const BENCHMARK_SUITE: readonly BenchmarkDefinition[] = [
  {
    id: "marketing-site",
    title: "Marketing site for a design studio",
    category: "frontend",
    prompt:
      "Build a marketing site for a small design studio with a hero section, services grid, portfolio showcase, pricing table, testimonial slider, and a contact form. Use Geist, a restrained color palette, and responsive layouts.",
    expectedCloudFeatures: [],
    requiredRoutes: ["/", "/services", "/pricing", "/contact"],
    expectedInteractions: [
      "navigate between all pages via the header",
      "open and close the mobile navigation menu",
      "submit the contact form and see a confirmation state",
      "advance the testimonial slider",
    ],
    sla: FRONTEND_SLA,
  },
  {
    id: "crud-notes",
    title: "Notes app with create, edit, delete",
    category: "fullstack",
    prompt:
      "Build a notes app where a user can create, read, update, and delete notes. Notes have a title, body, and updated timestamp. Persist notes in a database and show an empty state when no notes exist.",
    expectedCloudFeatures: ["database"],
    requiredRoutes: ["/", "/notes", "/notes/new"],
    expectedInteractions: [
      "create a new note",
      "edit an existing note",
      "delete a note and see it removed from the list",
      "see the empty state after deleting the last note",
    ],
    sla: FULLSTACK_SLA,
  },
  {
    id: "auth-dashboard",
    title: "Dashboard behind sign in",
    category: "fullstack",
    prompt:
      "Build a dashboard app with email and password sign in. Unauthenticated visitors are redirected to the sign-in page. Signed-in users see a dashboard with account stats drawn from the database.",
    expectedCloudFeatures: ["database", "auth"],
    requiredRoutes: ["/", "/sign-in", "/dashboard"],
    expectedInteractions: [
      "sign up with a new account",
      "get redirected to sign-in when visiting /dashboard while signed out",
      "sign in and see the dashboard",
      "sign out and land back on the sign-in page",
    ],
    sla: FULLSTACK_SLA,
  },
  {
    id: "realtime-chat-storage",
    title: "Chat room with file attachments",
    category: "fullstack",
    prompt:
      "Build a chat room where signed-in users send messages in realtime and attach image files that are stored in object storage. Persist messages and channel membership in the database.",
    expectedCloudFeatures: ["database", "auth", "storage"],
    requiredRoutes: ["/", "/sign-in", "/chat"],
    expectedInteractions: [
      "sign in and join the chat room",
      "send a message and see it appear in the room",
      "upload an image attachment and see it rendered",
      "receive a message from another member without reloading",
    ],
    sla: FULLSTACK_SLA,
  },
  {
    id: "existing-project-edit",
    title: "Edit an existing project",
    category: "edit",
    prompt:
      "Open the existing marketing project and make three edits: change the hero headline to the provided copy, add a new testimonial to the slider, and reorder the services grid so Pricing is first. Do not regress any existing page.",
    expectedCloudFeatures: [],
    requiredRoutes: ["/", "/pricing"],
    expectedInteractions: [
      "see the updated hero headline",
      "advance the slider to the new testimonial",
      "see the reordered services grid",
    ],
    sla: FRONTEND_SLA,
  },
  {
    id: "screenshot-reconstruction",
    title: "Reconstruct a design from a screenshot",
    category: "frontend",
    prompt:
      "Reconstruct the attached screenshot as a responsive page. Match the layout, typography scale, spacing, and color palette as closely as possible. The result must not overflow horizontally on any viewport.",
    expectedCloudFeatures: [],
    requiredRoutes: ["/"],
    expectedInteractions: [
      "view the reconstructed page",
      "verify no horizontal overflow on mobile and desktop viewports",
    ],
    sla: FRONTEND_SLA,
  },
  {
    id: "runtime-error-repair",
    title: "Repair a runtime error",
    category: "repair",
    prompt:
      "The preview currently fails with a runtime error. Reproduce it, find the root cause, and fix it without breaking any other page. The browser console must be free of errors after the fix.",
    expectedCloudFeatures: [],
    requiredRoutes: ["/", "/items"],
    expectedInteractions: [
      "load the home page without an error overlay",
      "load /items without a console error",
      "add an item through the page form",
    ],
    sla: FRONTEND_SLA,
  },
];

export function listBenchmarks(): readonly BenchmarkDefinition[] {
  return BENCHMARK_SUITE;
}

export function getBenchmarkById(id: string): BenchmarkDefinition | undefined {
  return BENCHMARK_SUITE.find((benchmark) => benchmark.id === id);
}
