import { z } from "zod";
import { requireViewer } from "@/lib/auth0";
import { githubErrorResponse } from "@/lib/github/http";
import { resolveSecuritySource } from "@/lib/github/security-source";
import { errorResponse } from "@/lib/http";
import { createProject, ensureUser, listProjects } from "@/lib/store";

export async function GET() {
  try {
    const viewer = await requireViewer();
    await ensureUser(viewer);
    return Response.json({ projects: await listProjects(viewer.id) });
  } catch (error) {
    return errorResponse(error);
  }
}

const createSchema = z.object({
  prompt: z.string().trim().min(2).max(12_000),
  mode: z.enum(["build", "security"]).optional().default("build"),
  /** Security mode only: the `owner/name` of a repository to review. */
  repository: z.string().trim().max(200).optional(),
});

export async function POST(request: Request) {
  try {
    const viewer = await requireViewer();
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
    const project = await createProject(viewer, body.prompt);
    return Response.json({ project }, { status: 201 });
  } catch (error) {
    return githubErrorResponse(error);
  }
}
