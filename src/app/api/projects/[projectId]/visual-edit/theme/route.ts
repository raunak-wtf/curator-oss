import { z } from "zod";
import { requireViewer } from "@/lib/auth0";
import { getProjectFsRoot, getSandbox, rebuildAndRestartPreview } from "@/lib/daytona";
import { extractThemeTokens, findThemeStylesheet, updateThemeTokensInCss } from "@/lib/direct-visual-edit";
import { errorResponse, notFound } from "@/lib/http";
import { getProject, listProjectFiles, upsertProjectFile } from "@/lib/store";

export const runtime = "nodejs";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();

    const files = await listProjectFiles(project.id);
    const sheet = findThemeStylesheet(files);
    if (!sheet) {
      return Response.json({ path: null, tokens: [] }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json(
      { path: sheet.path, tokens: extractThemeTokens(sheet.content) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();

    const body = z
      .object({
        tokens: z
          .array(
            z.object({
              name: z.string().regex(/^--[a-zA-Z0-9-_]+$/).max(80),
              value: z.string().min(1).max(120),
              scope: z.enum(["root", "dark", "theme"]).optional(),
            }),
          )
          .min(1)
          .max(40),
      })
      .parse(await request.json());

    const files = await listProjectFiles(project.id);
    const sheet = findThemeStylesheet(files);
    if (!sheet) {
      return Response.json({ error: "No stylesheet (`globals.css`) was found in this project yet." }, { status: 404 });
    }

    const updatedCss = updateThemeTokensInCss(sheet.content, body.tokens);
    if (project.sandboxId) {
      const sandbox = await getSandbox(project);
      if (sandbox) {
        const fsRoot = getProjectFsRoot();
        await sandbox.fs.uploadFile(Buffer.from(updatedCss, "utf8"), `${fsRoot}/${sheet.path}`);
        void rebuildAndRestartPreview(project).catch(() => undefined);
      }
    }
    const saved = await upsertProjectFile(project.id, sheet.path, updatedCss);

    return Response.json({
      path: sheet.path,
      file: saved,
      tokens: extractThemeTokens(updatedCss),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
