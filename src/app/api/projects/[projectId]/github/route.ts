import { z } from "zod";
import { requireViewer } from "@/lib/auth0";
import { GitHubError } from "@/lib/github/client";
import { isValidRepoName, parseRepoFullName } from "@/lib/github/names";
import { githubErrorResponse } from "@/lib/github/http";
import { isGitHubConfigured, githubAppSlug } from "@/lib/github/oauth";
import { forgetInstallationToken, isBotCommitConfigured } from "@/lib/github/app-auth";
import { commitProjectToGitHub, createAndLinkRepository, linkExistingRepository, repositoryView } from "@/lib/github/sync";
import { notFound } from "@/lib/http";
import { getGitHubConnection, getProject, getProjectRepository, getRepositoryCache, unlinkProjectRepository } from "@/lib/store";

type Context = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";
export const maxDuration = 300;

const linkSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("create"),
    name: z.string().trim().refine(isValidRepoName, "Use up to 100 letters, numbers, hyphens, underscores, or periods."),
    private: z.boolean().default(true),
  }),
  z.object({
    mode: z.literal("link"),
    fullName: z.string().trim().transform((value, ctx) => {
      const parsed = parseRepoFullName(value);
      if (!parsed) ctx.addIssue({ code: "custom", message: "Use the owner/repository format." });
      return parsed ?? "";
    }),
  }),
]);

async function load(context: Context) {
  const viewer = await requireViewer();
  const { projectId } = await context.params;
  const project = await getProject(projectId, viewer.id);
  return { viewer, project };
}

export async function GET(_request: Request, context: Context) {
  try {
    const { viewer, project } = await load(context);
    if (!project) return notFound();
    const [connection, repository, cache] = await Promise.all([
      getGitHubConnection(viewer.id),
      getProjectRepository(project.id, viewer.id),
      getRepositoryCache(project.id, viewer.id),
    ]);
    return Response.json({
      configured: isGitHubConfigured(),
      connection: connection ? { login: connection.login, avatarUrl: connection.avatarUrl, connectedAt: connection.createdAt } : null,
      repository: repository ? repositoryView(repository) : null,
      // Saved Git details from the last fetch, so Git Control shows them without waiting on GitHub.
      cache: repository ? cache : null,
      commitIdentity: isBotCommitConfigured() ? "bot" : "user",
      botName: isBotCommitConfigured() && githubAppSlug() ? `${githubAppSlug()}[bot]` : null,
    });
  } catch (error) {
    return githubErrorResponse(error);
  }
}

/** Creates a new repository or links an existing one. */
export async function POST(request: Request, context: Context) {
  try {
    const { viewer, project } = await load(context);
    if (!project) return notFound();
    const input = linkSchema.parse(await request.json());
    const repository = input.mode === "create"
      ? await createAndLinkRepository(project, viewer.id, { name: input.name, private: input.private })
      : await linkExistingRepository(project, viewer.id, input.fullName);

    // Push the complete project right away, so the repository has the code from the start.
    let initialPush: { status: string; url?: string; error?: string; code?: string } | null = null;
    if (project.sandboxId) {
      try {
        const result = await commitProjectToGitHub({
          project,
          ownerId: viewer.id,
          message: `chore: import ${project.title} from Curator\n\nFirst sync of the complete project source.`,
        });
        initialPush = { status: result.status, url: "url" in result ? result.url : undefined };
        return Response.json({ repository: result.repository, initialPush, sync: result.sync }, { status: 201 });
      } catch (error) {
        initialPush = {
          status: "error",
          error: error instanceof Error ? error.message : "The first push failed.",
          code: error instanceof GitHubError ? error.code : "unavailable",
        };
      }
    }
    return Response.json({ repository: repositoryView(repository), initialPush }, { status: 201 });
  } catch (error) {
    return githubErrorResponse(error);
  }
}

/** Unlinks the repository from the project. The repository itself stays on GitHub. */
export async function DELETE(_request: Request, context: Context) {
  try {
    const { viewer, project } = await load(context);
    if (!project) return notFound();
    const repository = await getProjectRepository(project.id, viewer.id);
    await unlinkProjectRepository(project.id, viewer.id);
    if (repository) forgetInstallationToken(repository.fullName);
    return Response.json({ unlinked: true });
  } catch (error) {
    return githubErrorResponse(error);
  }
}
