import { z } from "zod";
import { requireViewer } from "@/lib/auth0";
import {
  cancelResendEmail,
  createResendAudience,
  createResendBroadcast,
  createResendContact,
  createResendDomain,
  createResendWebhook,
  deleteResendAudience,
  deleteResendBroadcast,
  deleteResendContact,
  deleteResendDomain,
  deleteResendWebhook,
  getResendDomain,
  listResendApiKeys,
  listResendAudiences,
  listResendBroadcasts,
  listResendContacts,
  listResendDomains,
  listResendEmails,
  listResendWebhooks,
  sendResendBroadcast,
  sendResendEmail,
  updateResendContact,
  updateResendDomain,
  validateResendApiKeyFormat,
  verifyResendApiKey,
  verifyResendDomain,
} from "@/lib/cloud/resend";
import { syncProjectEnv } from "@/lib/daytona";
import { errorResponse, notFound } from "@/lib/http";
import { deleteSecret, getDecryptedSecrets, getProject, upsertSecret } from "@/lib/store";

type Context = { params: Promise<{ projectId: string }> };

export const runtime = "nodejs";
export const maxDuration = 45;

const noStore = { "Cache-Control": "no-store" };

const resendActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("connect"),
    apiKey: z.string().trim().min(1).max(200),
    emailFrom: z.string().trim().max(320).optional(),
  }),
  z.object({
    action: z.literal("set_from"),
    emailFrom: z.string().trim().min(3).max(320),
  }),
  z.object({
    action: z.literal("get_domain"),
    domainId: z.string().trim().min(1).max(120),
  }),
  z.object({
    action: z.literal("create_domain"),
    name: z.string().trim().min(3).max(253),
    region: z.enum(["us-east-1", "eu-west-1", "sa-east-1", "ap-northeast-1"]).optional(),
  }),
  z.object({
    action: z.literal("verify_domain"),
    domainId: z.string().trim().min(1).max(120),
  }),
  z.object({
    action: z.literal("update_domain"),
    domainId: z.string().trim().min(1).max(120),
    openTracking: z.boolean().optional(),
    clickTracking: z.boolean().optional(),
    tls: z.enum(["opportunistic", "enforced"]).optional(),
  }),
  z.object({
    action: z.literal("delete_domain"),
    domainId: z.string().trim().min(1).max(120),
  }),
  z.object({
    action: z.literal("send_test_email"),
    to: z.string().trim().email().max(320),
    from: z.string().trim().max(320).optional(),
    subject: z.string().trim().min(1).max(200),
    text: z.string().trim().min(1).max(20_000),
  }),
  z.object({
    action: z.literal("cancel_email"),
    emailId: z.string().trim().min(1).max(120),
  }),
  z.object({
    action: z.literal("create_audience"),
    name: z.string().trim().min(1).max(120),
  }),
  z.object({
    action: z.literal("delete_audience"),
    audienceId: z.string().trim().min(1).max(120),
  }),
  z.object({
    action: z.literal("create_contact"),
    audienceId: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(320),
    firstName: z.string().trim().max(120).optional(),
    lastName: z.string().trim().max(120).optional(),
  }),
  z.object({
    action: z.literal("update_contact"),
    audienceId: z.string().trim().min(1).max(120),
    contactId: z.string().trim().min(1).max(120),
    unsubscribed: z.boolean(),
  }),
  z.object({
    action: z.literal("delete_contact"),
    audienceId: z.string().trim().min(1).max(120),
    contactId: z.string().trim().min(1).max(120),
  }),
  z.object({
    action: z.literal("create_broadcast"),
    audienceId: z.string().trim().min(1).max(120),
    name: z.string().trim().max(120).optional(),
    from: z.string().trim().max(320).optional(),
    subject: z.string().trim().min(1).max(300),
    text: z.string().trim().min(1).max(50_000),
  }),
  z.object({
    action: z.literal("send_broadcast"),
    broadcastId: z.string().trim().min(1).max(120),
  }),
  z.object({
    action: z.literal("delete_broadcast"),
    broadcastId: z.string().trim().min(1).max(120),
  }),
  z.object({
    action: z.literal("create_webhook"),
    endpoint: z.string().trim().url().max(1000),
    events: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  }),
  z.object({
    action: z.literal("delete_webhook"),
    webhookId: z.string().trim().min(1).max(120),
  }),
]);

async function loadResendState(apiKey: string | undefined, emailFrom: string | null, audienceId?: string | null) {
  if (!apiKey) {
    return {
      connected: false,
      restrictedKey: false,
      emailFrom,
      domains: [],
      emails: [],
      audiences: [],
      contacts: [],
      broadcasts: [],
      webhooks: [],
      apiKeys: [],
    };
  }

  let restrictedKey = false;
  const domains = await listResendDomains(apiKey).catch((error) => {
    restrictedKey = true;
    if (error && typeof error === "object" && "status" in error && Number(error.status) === 401) {
      return [];
    }
    return [];
  });

  const [emails, audiences, broadcasts, webhooks, apiKeys] = restrictedKey
    ? [[], [], [], [], []]
    : await Promise.all([
        listResendEmails(apiKey).catch(() => []),
        listResendAudiences(apiKey).catch(() => []),
        listResendBroadcasts(apiKey).catch(() => []),
        listResendWebhooks(apiKey).catch(() => []),
        listResendApiKeys(apiKey).catch(() => []),
      ]);

  const targetAudience = audienceId || audiences[0]?.id;
  const contacts =
    !restrictedKey && targetAudience ? await listResendContacts(apiKey, targetAudience).catch(() => []) : [];

  return {
    connected: true,
    restrictedKey,
    emailFrom,
    domains,
    emails: emails.slice(0, 25),
    audiences,
    contacts,
    broadcasts: broadcasts.slice(0, 20),
    webhooks,
    apiKeys,
  };
}

export async function GET(request: Request, context: Context) {
  try {
    const viewer = await requireViewer();
    const { projectId } = await context.params;
    const project = await getProject(projectId, viewer.id);
    if (!project) return notFound();

    const url = new URL(request.url);
    const audienceId = url.searchParams.get("audienceId");
    const secrets = await getDecryptedSecrets(project.id);
    const state = await loadResendState(secrets.RESEND_API_KEY?.trim(), secrets.EMAIL_FROM?.trim() || null, audienceId);
    return Response.json(state, { headers: noStore });
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

    const body = resendActionSchema.parse(await request.json());

    if (body.action === "connect") {
      const cleanKey = validateResendApiKeyFormat(body.apiKey);
      const verified = await verifyResendApiKey(cleanKey);
      await upsertSecret(project.id, "RESEND_API_KEY", cleanKey, "user");

      const secrets = await getDecryptedSecrets(project.id);
      let emailFrom = body.emailFrom?.trim() || secrets.EMAIL_FROM?.trim() || "";
      if (!emailFrom) {
        const verifiedDomain = verified.domains.find((d) => d.status === "verified");
        emailFrom = verifiedDomain ? `noreply@${verifiedDomain.name}` : "onboarding@resend.dev";
      }
      await upsertSecret(project.id, "EMAIL_FROM", emailFrom, "user");
      if (project.sandboxId) await syncProjectEnv(project).catch(() => undefined);

      const state = await loadResendState(cleanKey, emailFrom);
      return Response.json({ ok: true, state }, { headers: noStore });
    }

    const secrets = await getDecryptedSecrets(project.id);
    const apiKey = secrets.RESEND_API_KEY?.trim();
    const currentFrom = secrets.EMAIL_FROM?.trim() || null;

    if (body.action === "set_from") {
      await upsertSecret(project.id, "EMAIL_FROM", body.emailFrom, "user");
      if (project.sandboxId) await syncProjectEnv(project).catch(() => undefined);
      return Response.json({ ok: true, emailFrom: body.emailFrom }, { headers: noStore });
    }

    if (!apiKey) {
      return Response.json(
        { error: "Connect your email API key first." },
        { status: 409, headers: noStore },
      );
    }

    switch (body.action) {
      case "get_domain": {
        const domain = await getResendDomain(apiKey, body.domainId);
        return Response.json({ ok: true, domain }, { headers: noStore });
      }
      case "create_domain": {
        const domain = await createResendDomain(apiKey, { name: body.name, region: body.region });
        const detail = await getResendDomain(apiKey, domain.id).catch(() => domain);
        return Response.json({ ok: true, domain: detail, state: await loadResendState(apiKey, currentFrom) }, { headers: noStore });
      }
      case "verify_domain": {
        await verifyResendDomain(apiKey, body.domainId);
        const domain = await getResendDomain(apiKey, body.domainId).catch(() => null);
        return Response.json({ ok: true, domain, state: await loadResendState(apiKey, currentFrom) }, { headers: noStore });
      }
      case "update_domain": {
        await updateResendDomain(apiKey, body.domainId, {
          openTracking: body.openTracking,
          clickTracking: body.clickTracking,
          tls: body.tls,
        });
        const domain = await getResendDomain(apiKey, body.domainId).catch(() => null);
        return Response.json({ ok: true, domain, state: await loadResendState(apiKey, currentFrom) }, { headers: noStore });
      }
      case "delete_domain": {
        await deleteResendDomain(apiKey, body.domainId);
        return Response.json({ ok: true, state: await loadResendState(apiKey, currentFrom) }, { headers: noStore });
      }
      case "send_test_email": {
        const from = body.from || currentFrom || "onboarding@resend.dev";
        const sent = await sendResendEmail(apiKey, {
          from,
          to: body.to,
          subject: body.subject,
          text: body.text,
        });
        return Response.json({ ok: true, sent, state: await loadResendState(apiKey, currentFrom) }, { headers: noStore });
      }
      case "cancel_email": {
        await cancelResendEmail(apiKey, body.emailId);
        return Response.json({ ok: true, state: await loadResendState(apiKey, currentFrom) }, { headers: noStore });
      }
      case "create_audience": {
        const audience = await createResendAudience(apiKey, body.name);
        return Response.json({ ok: true, audience, state: await loadResendState(apiKey, currentFrom, audience.id) }, { headers: noStore });
      }
      case "delete_audience": {
        await deleteResendAudience(apiKey, body.audienceId);
        return Response.json({ ok: true, state: await loadResendState(apiKey, currentFrom) }, { headers: noStore });
      }
      case "create_contact": {
        await createResendContact(apiKey, body.audienceId, {
          email: body.email,
          firstName: body.firstName,
          lastName: body.lastName,
        });
        return Response.json({ ok: true, state: await loadResendState(apiKey, currentFrom, body.audienceId) }, { headers: noStore });
      }
      case "update_contact": {
        await updateResendContact(apiKey, body.audienceId, body.contactId, {
          unsubscribed: body.unsubscribed,
        });
        return Response.json({ ok: true, state: await loadResendState(apiKey, currentFrom, body.audienceId) }, { headers: noStore });
      }
      case "delete_contact": {
        await deleteResendContact(apiKey, body.audienceId, body.contactId);
        return Response.json({ ok: true, state: await loadResendState(apiKey, currentFrom, body.audienceId) }, { headers: noStore });
      }
      case "create_broadcast": {
        const from = body.from || currentFrom || "onboarding@resend.dev";
        const created = await createResendBroadcast(apiKey, {
          audienceId: body.audienceId,
          name: body.name,
          from,
          subject: body.subject,
          text: body.text,
        });
        return Response.json({ ok: true, created, state: await loadResendState(apiKey, currentFrom) }, { headers: noStore });
      }
      case "send_broadcast": {
        await sendResendBroadcast(apiKey, body.broadcastId);
        return Response.json({ ok: true, state: await loadResendState(apiKey, currentFrom) }, { headers: noStore });
      }
      case "delete_broadcast": {
        await deleteResendBroadcast(apiKey, body.broadcastId);
        return Response.json({ ok: true, state: await loadResendState(apiKey, currentFrom) }, { headers: noStore });
      }
      case "create_webhook": {
        const webhook = await createResendWebhook(apiKey, { endpoint: body.endpoint, events: body.events });
        return Response.json(
          { ok: true, webhook: { id: webhook.id }, state: await loadResendState(apiKey, currentFrom) },
          { headers: noStore },
        );
      }
      case "delete_webhook": {
        await deleteResendWebhook(apiKey, body.webhookId);
        return Response.json({ ok: true, state: await loadResendState(apiKey, currentFrom) }, { headers: noStore });
      }
    }
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

    await deleteSecret(project.id, "RESEND_API_KEY");
    if (project.sandboxId) await syncProjectEnv(project).catch(() => undefined);
    return Response.json({ ok: true, disconnected: true }, { headers: noStore });
  } catch (error) {
    return errorResponse(error);
  }
}
