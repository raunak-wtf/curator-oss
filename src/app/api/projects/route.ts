import { z } from "zod";
import { generateProjectName } from "@/lib/ai/project-name";
import { requireViewer } from "@/lib/auth0";
import { githubErrorResponse } from "@/lib/github/http";
import { resolveSecuritySource } from "@/lib/github/security-source";
import { checkUserAgentEntitlement, createProject } from "@/lib/store";

const createSchema = z.object({
  prompt: z.string().trim().min(2).max(12_000),
  mode: z.enum(["build", "security"]).optional().default("build"),
  /** Security mode only: the `owner/name` of a repository to review. */
  repository: z.string().trim().max(200).optional(),
});

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
    const entitlement = await checkUserAgentEntitlement(viewer);
    if (!entitlement.allowed) {
      return Response.json(
        {
          error: entitlement.message ?? "An active Curator Pro subscription ($10/month) is required.",
          code: entitlement.reason === "credits_exhausted" ? "CREDITS_EXHAUSTED" : "SUBSCRIPTION_REQUIRED",
          billingUrl: "/billing",
        },
        { status: 402 },
      );
    }
    const body = createSchema.parse(await request.json());
    if (body.mode === "build" && body.prompt.length < 3) {
      return Response.json({ error: "Describe the app in a few more words." }, { status: 400 });
    }
    if (body.mode === "security") {
      // Confirms the user can read the repository before anything is created.
      const securitySource = body.repository ? await resolveSecuritySource(viewer.id, body.repository) : null;
      const project = await createProject(viewer, body.prompt, {
        mode: "security",
        securitySource,
        title: securitySource ? `Security review · ${securitySource.fullName}` : undefined,
      });
      return Response.json({ project }, { status: 201 });
    }
    const generatedName = await generateProjectName(body.prompt);
    const project = await createProject(viewer, body.prompt, { title: generatedName.title });
    return Response.json({ project }, { status: 201 });
  } catch (error) {
    return githubErrorResponse(error);
  }
}
