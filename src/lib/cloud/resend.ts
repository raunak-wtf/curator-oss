const RESEND_API_BASE = "https://api.resend.com";
const RESEND_TIMEOUT_MS = 15_000;

export class ResendApiError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(scrubResendKey(message));
    this.name = "ResendApiError";
    this.status = status;
  }
}

export function scrubResendKey(text: string) {
  return text.replace(/\bre_[A-Za-z0-9_]{8,}\b/g, "re_[REDACTED]");
}

export function validateResendApiKeyFormat(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) throw new ResendApiError("Enter your email API key (starts with re_).", 400);
  if (!/^re_[A-Za-z0-9_-]{10,128}$/.test(trimmed)) {
    throw new ResendApiError("That does not look like a valid email API key (expected a key starting with re_).", 400);
  }
  return trimmed;
}

async function resendRequest<T>(
  apiKey: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const cleanKey = validateResendApiKeyFormat(apiKey);
  const response = await fetch(`${RESEND_API_BASE}${path}`, {
    method: init.method ?? "GET",
    cache: "no-store",
    signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    headers: {
      authorization: `Bearer ${cleanKey}`,
      accept: "application/json",
      "user-agent": "Cognix-Cloud/1.0",
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  if (response.status === 204) return {} as T;
  const text = await response.text().catch(() => "");
  let payload: Record<string, unknown> = {};
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  }

  if (!response.ok) {
    const message =
      typeof payload.message === "string"
        ? payload.message
        : typeof payload.error === "string"
          ? payload.error
          : `Email service rejected the request (HTTP ${response.status}).`;
    throw new ResendApiError(message, response.status);
  }

  return payload as T;
}

export type ResendDomainRecord = {
  record: string;
  name: string;
  type: string;
  ttl: string;
  status: string;
  value: string;
  priority?: number;
};

export type ResendDomain = {
  id: string;
  name: string;
  status: string;
  created_at: string;
  region: string;
  records?: ResendDomainRecord[];
};

export type ResendEmailItem = {
  id: string;
  to: string[];
  from: string;
  created_at: string;
  subject: string;
  last_event?: string;
  scheduled_at?: string | null;
};

export type ResendAudience = {
  id: string;
  name: string;
  created_at: string;
};

export type ResendContact = {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  created_at: string;
  unsubscribed: boolean;
};

export type ResendBroadcast = {
  id: string;
  name?: string;
  audience_id: string;
  from?: string;
  subject?: string;
  status?: string;
  created_at: string;
  scheduled_at?: string | null;
  sent_at?: string | null;
};

export type ResendWebhook = {
  id: string;
  endpoint: string;
  events?: string[];
  status?: string;
  created_at: string;
};

export type ResendApiKeyMeta = {
  id: string;
  name: string;
  created_at: string;
};

// Domains
export async function listResendDomains(apiKey: string): Promise<ResendDomain[]> {
  const res = await resendRequest<{ data?: ResendDomain[] }>(apiKey, "/domains");
  return res.data ?? [];
}

export async function getResendDomain(apiKey: string, domainId: string): Promise<ResendDomain> {
  return resendRequest<ResendDomain>(apiKey, `/domains/${encodeURIComponent(domainId)}`);
}

export async function createResendDomain(
  apiKey: string,
  input: {
    name: string;
    region?: "us-east-1" | "eu-west-1" | "sa-east-1" | "ap-northeast-1";
    customReturnPath?: string;
  },
): Promise<ResendDomain> {
  return resendRequest<ResendDomain>(apiKey, "/domains", {
    method: "POST",
    body: {
      name: input.name.trim().toLowerCase(),
      ...(input.region ? { region: input.region } : {}),
      ...(input.customReturnPath ? { custom_return_path: input.customReturnPath } : {}),
    },
  });
}

export async function verifyResendDomain(apiKey: string, domainId: string) {
  return resendRequest<{ id: string }>(apiKey, `/domains/${encodeURIComponent(domainId)}/verify`, {
    method: "POST",
  });
}

export async function updateResendDomain(
  apiKey: string,
  domainId: string,
  input: { openTracking?: boolean; clickTracking?: boolean; tls?: "opportunistic" | "enforced" },
) {
  return resendRequest<{ id: string }>(apiKey, `/domains/${encodeURIComponent(domainId)}`, {
    method: "PATCH",
    body: {
      ...(input.openTracking !== undefined ? { open_tracking: input.openTracking } : {}),
      ...(input.clickTracking !== undefined ? { click_tracking: input.clickTracking } : {}),
      ...(input.tls ? { tls: input.tls } : {}),
    },
  });
}

export async function deleteResendDomain(apiKey: string, domainId: string) {
  return resendRequest<{ id: string; deleted?: boolean }>(
    apiKey,
    `/domains/${encodeURIComponent(domainId)}`,
    { method: "DELETE" },
  );
}

// Emails
export async function listResendEmails(apiKey: string): Promise<ResendEmailItem[]> {
  try {
    const res = await resendRequest<{ data?: ResendEmailItem[] }>(apiKey, "/emails");
    return res.data ?? [];
  } catch (error) {
    // Restricted sending-only Resend keys may return 401/403 on list endpoints while sending works.
    if (error instanceof ResendApiError && (error.status === 401 || error.status === 403)) return [];
    throw error;
  }
}

export async function getResendEmail(apiKey: string, emailId: string): Promise<ResendEmailItem> {
  return resendRequest<ResendEmailItem>(apiKey, `/emails/${encodeURIComponent(emailId)}`);
}

export async function sendResendEmail(
  apiKey: string,
  input: {
    from: string;
    to: string | string[];
    subject: string;
    text?: string;
    html?: string;
    replyTo?: string;
    cc?: string[];
    bcc?: string[];
    scheduledAt?: string;
  },
) {
  return resendRequest<{ id: string }>(apiKey, "/emails", {
    method: "POST",
    body: {
      from: input.from,
      to: Array.isArray(input.to) ? input.to : [input.to],
      subject: input.subject,
      ...(input.text ? { text: input.text } : {}),
      ...(input.html ? { html: input.html } : {}),
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      ...(input.cc?.length ? { cc: input.cc } : {}),
      ...(input.bcc?.length ? { bcc: input.bcc } : {}),
      ...(input.scheduledAt ? { scheduled_at: input.scheduledAt } : {}),
    },
  });
}

export async function sendResendBatchEmails(
  apiKey: string,
  emails: {
    from: string;
    to: string | string[];
    subject: string;
    text?: string;
    html?: string;
  }[],
) {
  return resendRequest<{ data?: { id: string }[] }>(apiKey, "/emails/batch", {
    method: "POST",
    body: emails.map((email) => ({
      from: email.from,
      to: Array.isArray(email.to) ? email.to : [email.to],
      subject: email.subject,
      ...(email.text ? { text: email.text } : {}),
      ...(email.html ? { html: email.html } : {}),
    })),
  });
}

export async function updateResendEmail(apiKey: string, emailId: string, scheduledAt: string) {
  return resendRequest<{ id: string }>(apiKey, `/emails/${encodeURIComponent(emailId)}`, {
    method: "PATCH",
    body: { scheduled_at: scheduledAt },
  });
}

export async function cancelResendEmail(apiKey: string, emailId: string) {
  return resendRequest<{ id: string }>(apiKey, `/emails/${encodeURIComponent(emailId)}/cancel`, {
    method: "POST",
  });
}

// Audiences & Contacts
export async function listResendAudiences(apiKey: string): Promise<ResendAudience[]> {
  try {
    const res = await resendRequest<{ data?: ResendAudience[] }>(apiKey, "/audiences");
    return res.data ?? [];
  } catch (error) {
    if (error instanceof ResendApiError && (error.status === 401 || error.status === 403)) return [];
    throw error;
  }
}

export async function getResendAudience(apiKey: string, audienceId: string): Promise<ResendAudience> {
  return resendRequest<ResendAudience>(apiKey, `/audiences/${encodeURIComponent(audienceId)}`);
}

export async function createResendAudience(apiKey: string, name: string): Promise<ResendAudience> {
  return resendRequest<ResendAudience>(apiKey, "/audiences", {
    method: "POST",
    body: { name: name.trim() },
  });
}

export async function deleteResendAudience(apiKey: string, audienceId: string) {
  return resendRequest<{ id: string; deleted?: boolean }>(
    apiKey,
    `/audiences/${encodeURIComponent(audienceId)}`,
    { method: "DELETE" },
  );
}

export async function listResendContacts(apiKey: string, audienceId: string): Promise<ResendContact[]> {
  const res = await resendRequest<{ data?: ResendContact[] }>(
    apiKey,
    `/audiences/${encodeURIComponent(audienceId)}/contacts`,
  );
  return res.data ?? [];
}

export async function getResendContact(apiKey: string, audienceId: string, contactId: string) {
  return resendRequest<ResendContact>(
    apiKey,
    `/audiences/${encodeURIComponent(audienceId)}/contacts/${encodeURIComponent(contactId)}`,
  );
}

export async function createResendContact(
  apiKey: string,
  audienceId: string,
  input: { email: string; firstName?: string; lastName?: string; unsubscribed?: boolean },
) {
  return resendRequest<{ id: string }>(
    apiKey,
    `/audiences/${encodeURIComponent(audienceId)}/contacts`,
    {
      method: "POST",
      body: {
        email: input.email.trim(),
        ...(input.firstName ? { first_name: input.firstName } : {}),
        ...(input.lastName ? { last_name: input.lastName } : {}),
        ...(input.unsubscribed !== undefined ? { unsubscribed: input.unsubscribed } : {}),
      },
    },
  );
}

export async function updateResendContact(
  apiKey: string,
  audienceId: string,
  contactId: string,
  input: { firstName?: string; lastName?: string; unsubscribed?: boolean },
) {
  return resendRequest<{ id: string }>(
    apiKey,
    `/audiences/${encodeURIComponent(audienceId)}/contacts/${encodeURIComponent(contactId)}`,
    {
      method: "PATCH",
      body: {
        ...(input.firstName !== undefined ? { first_name: input.firstName } : {}),
        ...(input.lastName !== undefined ? { last_name: input.lastName } : {}),
        ...(input.unsubscribed !== undefined ? { unsubscribed: input.unsubscribed } : {}),
      },
    },
  );
}

export async function deleteResendContact(apiKey: string, audienceId: string, contactId: string) {
  return resendRequest<{ deleted?: boolean }>(
    apiKey,
    `/audiences/${encodeURIComponent(audienceId)}/contacts/${encodeURIComponent(contactId)}`,
    { method: "DELETE" },
  );
}

// Broadcasts
export async function listResendBroadcasts(apiKey: string): Promise<ResendBroadcast[]> {
  try {
    const res = await resendRequest<{ data?: ResendBroadcast[] }>(apiKey, "/broadcasts");
    return res.data ?? [];
  } catch (error) {
    if (error instanceof ResendApiError && (error.status === 401 || error.status === 403 || error.status === 404)) {
      return [];
    }
    throw error;
  }
}

export async function getResendBroadcast(apiKey: string, broadcastId: string) {
  return resendRequest<ResendBroadcast>(apiKey, `/broadcasts/${encodeURIComponent(broadcastId)}`);
}

export async function createResendBroadcast(
  apiKey: string,
  input: {
    name?: string;
    audienceId: string;
    from: string;
    subject: string;
    html?: string;
    text?: string;
    replyTo?: string;
  },
) {
  return resendRequest<{ id: string }>(apiKey, "/broadcasts", {
    method: "POST",
    body: {
      audience_id: input.audienceId,
      from: input.from,
      subject: input.subject,
      ...(input.name ? { name: input.name } : {}),
      ...(input.html ? { html: input.html } : {}),
      ...(input.text ? { text: input.text } : {}),
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
    },
  });
}

export async function sendResendBroadcast(apiKey: string, broadcastId: string, scheduledAt?: string) {
  return resendRequest<{ id: string }>(
    apiKey,
    `/broadcasts/${encodeURIComponent(broadcastId)}/send`,
    {
      method: "POST",
      body: scheduledAt ? { scheduled_at: scheduledAt } : {},
    },
  );
}

export async function deleteResendBroadcast(apiKey: string, broadcastId: string) {
  return resendRequest<{ deleted?: boolean }>(
    apiKey,
    `/broadcasts/${encodeURIComponent(broadcastId)}`,
    { method: "DELETE" },
  );
}

// Webhooks
export async function listResendWebhooks(apiKey: string): Promise<ResendWebhook[]> {
  try {
    const res = await resendRequest<{ data?: ResendWebhook[] }>(apiKey, "/webhooks");
    return res.data ?? [];
  } catch (error) {
    if (error instanceof ResendApiError && (error.status === 401 || error.status === 403 || error.status === 404)) {
      return [];
    }
    throw error;
  }
}

export async function getResendWebhook(apiKey: string, webhookId: string) {
  return resendRequest<ResendWebhook>(apiKey, `/webhooks/${encodeURIComponent(webhookId)}`);
}

export async function createResendWebhook(
  apiKey: string,
  input: { endpoint: string; events: string[] },
) {
  return resendRequest<{ id: string; signing_secret?: string }>(apiKey, "/webhooks", {
    method: "POST",
    body: { endpoint: input.endpoint, events: input.events },
  });
}

export async function updateResendWebhook(
  apiKey: string,
  webhookId: string,
  input: { endpoint?: string; events?: string[]; status?: "enabled" | "disabled" },
) {
  return resendRequest<{ id: string }>(apiKey, `/webhooks/${encodeURIComponent(webhookId)}`, {
    method: "PATCH",
    body: input,
  });
}

export async function deleteResendWebhook(apiKey: string, webhookId: string) {
  return resendRequest<{ deleted?: boolean }>(
    apiKey,
    `/webhooks/${encodeURIComponent(webhookId)}`,
    { method: "DELETE" },
  );
}

// API Keys (metadata only on list)
export async function listResendApiKeys(apiKey: string): Promise<ResendApiKeyMeta[]> {
  try {
    const res = await resendRequest<{ data?: ResendApiKeyMeta[] }>(apiKey, "/api-keys");
    return res.data ?? [];
  } catch (error) {
    if (error instanceof ResendApiError && (error.status === 401 || error.status === 403)) return [];
    throw error;
  }
}

/**
 * Verifies a Resend API key works before saving it. Even sending-only keys answer HTTP 200 or 401/403
 * with a structured error distinguishing an invalid key (401/400) from a restricted sending key.
 */
export async function verifyResendApiKey(apiKey: string): Promise<{ domains: ResendDomain[]; restrictedKey: boolean }> {
  try {
    const domains = await listResendDomains(apiKey);
    return { domains, restrictedKey: false };
  } catch (error) {
    if (error instanceof ResendApiError && error.status === 401 && /restricted|send/i.test(error.message)) {
      return { domains: [], restrictedKey: true };
    }
    throw error;
  }
}
