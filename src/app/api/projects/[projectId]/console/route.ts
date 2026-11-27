import { requireViewer } from "@/lib/auth0";
import { clearSandboxRuntimeLogs, readSandboxRuntimeLogs } from "@/lib/daytona";
import { errorResponse, notFound } from "@/lib/http";
import {
  extractServerErrorsFromLog,
  previewConsoleBatchSchema,
} from "@/lib/preview-console";
import {
  appendProjectConsoleLogs,
  clearProjectConsoleLogs,
  getProject,
  listProjectConsoleLogs,
} from "@/lib/store";

type Context = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";
export const maxDuration = 60;

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();

    const url = new URL(request.url);
    const wake = url.searchParams.get("wake") === "1";

    const [persisted, runtimeLogs] = await Promise.all([
      listProjectConsoleLogs(project.id, 200),
      project.mode === "security"
        ? Promise.resolve({
            serverLogs: "",
            previewHealthy: false,
            previewStatus: "000",
            sandboxRunning: false,
          })
        : readSandboxRuntimeLogs(project, { maxLines: 160, skipWake: !wake }),
    ]);

    let entries = persisted;
    if (runtimeLogs.serverLogs) {
      const serverErrors = extractServerErrorsFromLog(runtimeLogs.serverLogs);
      if (serverErrors.length > 0) {
        const knownFingerprints = new Set(persisted.map((item) => item.fingerprint));
        const freshServerErrors = serverErrors.filter((item) => {
          // Only append newly discovered server errors so polling GET remains idempotent
          for (const existing of persisted) {
            if (existing.source === "server" && existing.message === item.message) return false;
          }
          return knownFingerprints.size >= 0;
        });
        if (freshServerErrors.length > 0) {
          entries = await appendProjectConsoleLogs(project.id, freshServerErrors);
        }
      }
    }

    return Response.json(
      {
        entries,
        serverLogs: runtimeLogs.serverLogs,
        previewHealthy: runtimeLogs.previewHealthy,
        previewStatus: runtimeLogs.previewStatus,
        sandboxRunning: runtimeLogs.sandboxRunning,
      },
      { headers: noStore },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();

    const parsed = previewConsoleBatchSchema.parse(await request.json());
    const entries = await appendProjectConsoleLogs(project.id, parsed.entries);
    return Response.json({ entries }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();

    await Promise.all([
      clearProjectConsoleLogs(project.id),
      clearSandboxRuntimeLogs(project),
    ]);
    return Response.json({ cleared: true }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
