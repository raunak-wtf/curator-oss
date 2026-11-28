import { z } from "zod";
import { requireViewer } from "@/lib/auth0";
import { syncProjectEnv } from "@/lib/daytona";
import { MAX_SECRETS_PER_PROJECT, validateSecretName, validateSecretValue } from "@/lib/env-files";
import { errorResponse, notFound } from "@/lib/http";
import { deleteSecret, getProject, listSecretNames, upsertSecret } from "@/lib/store";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();

    const secrets = await listSecretNames(project.id);
    return Response.json({ secrets });
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

    const { name, value } = z
      .object({
        name: z.string().trim(),
        value: z.string(),
      })
      .parse(await request.json());

    const nameError = validateSecretName(name);
    if (nameError) {
      return Response.json({ error: nameError }, { status: 400 });
    }
    const valueError = validateSecretValue(value);
    if (valueError) {
      return Response.json({ error: valueError }, { status: 400 });
    }

    const existing = await listSecretNames(project.id);
    if (!existing.some((item) => item.name === name) && existing.length >= MAX_SECRETS_PER_PROJECT) {
      return Response.json(
        { error: `Each project can store at most ${MAX_SECRETS_PER_PROJECT} secrets.` },
        { status: 400 },
      );
    }

    const secret = await upsertSecret(project.id, name, value, "user");
    await syncProjectEnv(project);

    return Response.json({ secret });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();

    const { searchParams } = new URL(request.url);
    const name = searchParams.get("name")?.trim() ?? "";

    const nameError = validateSecretName(name);
    if (nameError) {
      return Response.json({ error: nameError }, { status: 400 });
    }

    const success = await deleteSecret(project.id, name);
    if (success) {
      await syncProjectEnv(project);
    }

    return Response.json({ success });
  } catch (error) {
    return errorResponse(error);
  }
}
