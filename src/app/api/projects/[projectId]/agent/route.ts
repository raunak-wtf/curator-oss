import { z } from "zod";
import { requireViewer } from "@/lib/auth0";
import { runAgent } from "@/lib/ai/runner";
import { errorResponse, notFound } from "@/lib/http";
import { SKILLS_PER_PROMPT, skillReferences } from "@/lib/skills";
import {
  createMessage,
  getAttachment,
  getProject,
  getSkillsByNames,
  listMessages,
  refundReservedCredits,
  reserveUserAgentCredits,
  updateProject,
} from "@/lib/store";
import type { AgentEvent, Attachment } from "@/lib/types";
import { visualSelectionsSchema } from "@/lib/visual-edit";

export const runtime = "nodejs";
export const maxDuration = 900;

declare global {
  var __cognixActiveProjectAgentRuns: Map<string, number> | undefined;
}

const activeProjectRuns =
  globalThis.__cognixActiveProjectAgentRuns ??
  (globalThis.__cognixActiveProjectAgentRuns = new Map<string, number>());

const RUN_LOCK_MAX_AGE_MS = 16 * 60_000;

type Context = { params: Promise<{ projectId: string }> };

function agentErrorMessage(error: unknown) {
  const status = typeof error === "object" && error && "status" in error ? Number(error.status) : undefined;
  if (status === 401) return "The AI model provider rejected the configured API key. Check the server model configuration and try again.";
  if (status === 403) return "The model provider blocked the request. Check the endpoint access policy and try again.";
  if (status === 429) return "The model provider rate limit was reached after automatic retries. Wait a moment, then click Retry or Continue.";
  const message = error instanceof Error ? error.message : "";
  if (
    error instanceof Error &&
    (error.name === "ModelStreamTimeoutError" || /stream stalled|did not start responding|exceeded .* turn limit|502|503|504|524/i.test(message))
  ) {
    return "The AI model connection timed out after multiple automatic retries. Your completed file changes are saved — click Retry or send \"Continue\" to pick up right where it paused.";
  }
  if (/development server did not start|dependency installation failed|trying to use TypeScript/i.test(message)) {
    return "The generated preview could not start, but your files were saved. Ask Cognix to repair the preview and it will inspect the existing app and continue.";
  }
  if (/controller is already closed/i.test(message)) {
    return "The browser disconnected while Cognix was responding. Your saved files are intact; send the next instruction to continue.";
  }
  return message || "The build paused unexpectedly. Try again.";
}

export async function POST(request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();

    const existingStartedAt = activeProjectRuns.get(project.id);
    if (existingStartedAt && Date.now() - existingStartedAt < RUN_LOCK_MAX_AGE_MS) {
      return Response.json(
        { error: "A build is already running for this project. Wait for it to finish before sending another prompt." },
        { status: 409 },
      );
    }

    const body = z
      .object({
        prompt: z.string().trim().min(1).max(40_000),
        attachmentIds: z
          .array(z.string().uuid())
          .max(10)
          .optional()
          .default([]),
        visualSelections: visualSelectionsSchema.optional().default([]),
        /** Security mode: "review" makes file changes and commands wait for the user's approval. */
        approvalMode: z.enum(["auto", "review"]).optional().default("auto"),
        /** Build mode: "plan" inspects read-only and returns an implementation plan without modifying files. */
        chatMode: z.enum(["build", "plan"]).optional().default("build"),
      })
      .parse(await request.json());

    const desiredHoldHundredths = project.mode !== "security" && body.chatMode === "plan" ? 100 : 50;
    const reservation = await reserveUserAgentCredits(viewer, desiredHoldHundredths);
    if (!reservation.allowed) {
      return Response.json(
        {
          error: reservation.message,
          code: reservation.reason === "credits_exhausted" ? "CREDITS_EXHAUSTED" : "SUBSCRIPTION_REQUIRED",
          billingUrl: "/billing",
        },
        { status: 402 },
      );
    }

    let reservedHundredths = reservation.reservedHundredths;
    activeProjectRuns.set(project.id, Date.now());

    let history;
    let skills;
    let resolvedAttachments: Attachment[];
    try {
      history = await listMessages(project.id);
      skills = await getSkillsByNames(viewer.id, skillReferences(body.prompt).slice(0, SKILLS_PER_PROMPT));
      const requestedAttachmentIds = [...new Set(body.attachmentIds)];
      resolvedAttachments = (
        await Promise.all(requestedAttachmentIds.map((id) => getAttachment(id, viewer.id)))
      ).filter((attachment): attachment is Attachment => attachment?.projectId === project.id);
      if (resolvedAttachments.length !== requestedAttachmentIds.length) {
        activeProjectRuns.delete(project.id);
        await refundReservedCredits(viewer.id, reservedHundredths).catch(() => undefined);
        return Response.json(
          { error: "One or more attachments are unavailable. Remove them, upload again, and resend the prompt." },
          { status: 400 },
        );
      }
      await createMessage(project.id, "user", body.prompt, {
        attachmentIds: resolvedAttachments.map((item) => item.id),
        attachments: resolvedAttachments.map((item) => ({
          id: item.id,
          name: item.name,
          contentType: item.contentType,
          size: item.size,
        })),
        visualSelections: body.visualSelections,
        ...(project.mode !== "security" && body.chatMode === "plan" ? { chatMode: "plan" } : {}),
      });
    } catch (prepError) {
      activeProjectRuns.delete(project.id);
      await refundReservedCredits(viewer.id, reservedHundredths).catch(() => undefined);
      reservedHundredths = 0;
      throw prepError;
    }

    const encoder = new TextEncoder();
    let streamOpen = true;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    const stream = new ReadableStream({
      start(controller) {
        const emit = (event: AgentEvent) => {
          if (!streamOpen) return;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            streamOpen = false;
          }
        };

        heartbeat = setInterval(() => {
          emit({ type: "heartbeat", at: new Date().toISOString() });
        }, 10_000);

        void runAgent({
          project,
          prompt: body.prompt,
          history,
          attachments: resolvedAttachments,
          visualSelections: body.visualSelections,
          skills,
          approvalMode: body.approvalMode,
          chatMode: body.chatMode,
          reservedCreditsHundredths: reservedHundredths,
          emit,
        })
          .catch(async (error) => {
            const message = agentErrorMessage(error);
            await Promise.allSettled([
              updateProject(project.id, viewer.id, { status: project.publishedAt ? "published" : "error" }),
              createMessage(project.id, "assistant", message, { error: true }),
            ]);
            emit({ type: "error", message });
          })
          .finally(() => {
            activeProjectRuns.delete(project.id);
            if (heartbeat) {
              clearInterval(heartbeat);
              heartbeat = null;
            }
            if (!streamOpen) return;
            streamOpen = false;
            try {
              controller.close();
            } catch {
              // The browser may have disconnected while the sandbox kept building.
            }
          });
      },
      cancel() {
        streamOpen = false;
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
