export type AccumulatedToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
  /** True when the model stream stopped mid-JSON (e.g. finish_reason === "length"). */
  truncatedJson?: boolean;
};

export type StreamUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type StreamTurnResult = {
  content: string;
  calls: AccumulatedToolCall[];
  finishReason: string | null;
  chunkCount: number;
  usage: StreamUsage | null;
};

export type StreamChunkLike = {
  usage?: {
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    total_tokens?: number | null;
  } | null;
  choices?: Array<{
    finish_reason?: string | null;
    delta?: {
      role?: string;
      content?: string | null;
      reasoning?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
};

export class ModelStreamTimeoutError extends Error {
  readonly kind: "first_chunk_timeout" | "chunk_stall_timeout" | "turn_timeout" | "empty_stream";

  constructor(
    kind: "first_chunk_timeout" | "chunk_stall_timeout" | "turn_timeout" | "empty_stream",
    message: string,
  ) {
    super(message);
    this.name = "ModelStreamTimeoutError";
    this.kind = kind;
  }
}

const RETRYABLE_HTTP_STATUSES = new Set([
  408, // Request Timeout
  409, // Conflict / transient lock
  425, // Too Early
  429, // Rate Limited
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
  520, // Cloudflare Unknown Error
  521, // Cloudflare Web Server Down
  522, // Cloudflare Connection Timed Out
  523, // Cloudflare Origin Unreachable
  524, // Cloudflare A Timeout Occurred
  529, // Provider Overloaded
]);

export function isRetryableModelError(error: unknown): boolean {
  if (error instanceof ModelStreamTimeoutError) return true;
  if (!error || typeof error !== "object") return false;
  if (error instanceof Error && error.name === "AbortError") return false;

  const status = "status" in error && typeof error.status === "number" ? error.status : undefined;
  if (status !== undefined) {
    return RETRYABLE_HTTP_STATUSES.has(status);
  }

  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  const cause =
    "cause" in error && error.cause instanceof Error
      ? `${error.cause.name} ${error.cause.message}`
      : "";
  const combined = `${message} ${cause}`;

  return /fetch failed|network|econnreset|etimedout|epipe|eai_again|enotfound|und_err_socket|socket hang up|premature close|other side closed|terminated|timeout|timed out|bodytimeouterror|headerstimeouterror|overloaded|rate limit|too many requests|502|503|504|522|524|unexpected end of json/i.test(
    combined,
  );
}

function retryAfterMsFromError(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("headers" in error) || !error.headers) return null;
  const headers = error.headers as { get?: (name: string) => string | null } | Record<string, unknown>;
  const raw =
    typeof headers.get === "function"
      ? headers.get("retry-after")
      : typeof (headers as Record<string, unknown>)["retry-after"] === "string"
        ? String((headers as Record<string, unknown>)["retry-after"])
        : null;
  if (!raw) return null;
  const seconds = Number.parseFloat(raw);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(Math.ceil(seconds * 1_000), 15_000);
  }
  return null;
}

function isCompleteJsonObject(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/** Extracts a friendly live status label from partially streamed tool-call JSON arguments. */
export function extractStreamingActivityLabel(toolName: string, partialArgs: string): string | null {
  if (!toolName) return null;

  const pathMatch = partialArgs.match(/"path"\s*:\s*"([^"\\]{1,140})"/);
  if (toolName === "write_file") {
    return pathMatch ? `Drafting ${pathMatch[1]}` : "Drafting project file";
  }
  if (toolName === "edit_file") {
    return pathMatch ? `Preparing edit to ${pathMatch[1]}` : "Preparing file edit";
  }
  if (toolName === "read_file") {
    return pathMatch ? `Reading ${pathMatch[1]}` : null;
  }
  if (toolName === "run_command") {
    const cmdMatch = partialArgs.match(/"command"\s*:\s*"([^"\\]{1,80})"/);
    return cmdMatch ? `Preparing command: ${cmdMatch[1].slice(0, 56)}` : "Preparing terminal command";
  }
  if (toolName === "neon_database") {
    const actionMatch = partialArgs.match(/"action"\s*:\s*"([^"\\]{1,40})"/);
    return actionMatch ? `Preparing Cloud Database (${actionMatch[1]})` : "Preparing Cloud Database";
  }
  if (toolName === "cloud_storage") {
    const actionMatch = partialArgs.match(/"action"\s*:\s*"([^"\\]{1,40})"/);
    return actionMatch ? `Preparing Cloud Storage (${actionMatch[1]})` : "Preparing Cloud Storage";
  }
  if (toolName === "resend_email") {
    return "Preparing Cloud Email action";
  }
  return null;
}

async function nextWithTimeout<T>(
  iterator: AsyncIterator<T>,
  timeoutMs: number,
  onTimeout: () => ModelStreamTimeoutError,
): Promise<IteratorResult<T>> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(onTimeout()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type StreamTurnOptions = {
  createStream: (signal: AbortSignal) => Promise<AsyncIterable<StreamChunkLike>>;
  onStatus?: (label: string) => void | Promise<void>;
  maxAttempts?: number;
  firstChunkTimeoutMs?: number;
  chunkStallTimeoutMs?: number;
  turnTimeoutMs?: number;
  baseBackoffMs?: readonly number[];
  statusThrottleMs?: number;
};

const DEFAULT_BACKOFF_MS = [1_200, 2_800, 6_000] as const;

export async function streamModelTurnWithRetry(options: StreamTurnOptions): Promise<StreamTurnResult> {
  const maxAttempts = options.maxAttempts ?? 4;
  const firstChunkTimeoutMs = options.firstChunkTimeoutMs ?? 65_000;
  const chunkStallTimeoutMs = options.chunkStallTimeoutMs ?? 40_000;
  const turnTimeoutMs = options.turnTimeoutMs ?? 210_000;
  const backoff = options.baseBackoffMs ?? DEFAULT_BACKOFF_MS;
  const statusThrottleMs = options.statusThrottleMs ?? 1_800;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const turnDeadlineTimer = setTimeout(() => {
      controller.abort(
        new ModelStreamTimeoutError(
          "turn_timeout",
          `Model response exceeded ${Math.round(turnTimeoutMs / 1000)}s turn limit.`,
        ),
      );
    }, turnTimeoutMs);

    try {
      const iterable = await Promise.race([
        options.createStream(controller.signal),
        new Promise<never>((_, reject) => {
          const connectTimer = setTimeout(() => {
            const err = new ModelStreamTimeoutError(
              "first_chunk_timeout",
              `Model did not start responding within ${Math.round(firstChunkTimeoutMs / 1000)}s.`,
            );
            controller.abort(err);
            reject(err);
          }, firstChunkTimeoutMs);
          controller.signal.addEventListener("abort", () => clearTimeout(connectTimer), { once: true });
        }),
      ]);

      const iterator = iterable[Symbol.asyncIterator]();
      let content = "";
      let finishReason: string | null = null;
      let chunkCount = 0;
      let usage: StreamUsage | null = null;
      const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

      let lastStatusLabel = "";
      let lastStatusAt = 0;
      let emittedReasoningHint = false;
      const streamStartedAt = Date.now();

      const maybeEmitStatus = async (label: string | null) => {
        if (!label || !options.onStatus || label === lastStatusLabel) return;
        const now = Date.now();
        if (now - lastStatusAt < statusThrottleMs) return;
        lastStatusLabel = label;
        lastStatusAt = now;
        await options.onStatus(label);
      };

      try {
        while (true) {
          if (controller.signal.aborted) {
            throw controller.signal.reason instanceof Error
              ? controller.signal.reason
              : new ModelStreamTimeoutError("turn_timeout", "Model turn timed out.");
          }

          const waitMs = chunkCount === 0 ? firstChunkTimeoutMs : chunkStallTimeoutMs;
          const step = await nextWithTimeout(iterator, waitMs, () => {
            const err = new ModelStreamTimeoutError(
              chunkCount === 0 ? "first_chunk_timeout" : "chunk_stall_timeout",
              chunkCount === 0
                ? `Model sent no output within ${Math.round(firstChunkTimeoutMs / 1000)}s.`
                : `Model stream stalled for ${Math.round(chunkStallTimeoutMs / 1000)}s without new tokens.`,
            );
            controller.abort(err);
            return err;
          });

          if (step.done) break;
          chunkCount += 1;

          if (step.value.usage) {
            const promptTokens = Number(step.value.usage.prompt_tokens ?? 0);
            const completionTokens = Number(step.value.usage.completion_tokens ?? 0);
            const totalTokens = Number(step.value.usage.total_tokens ?? promptTokens + completionTokens);
            if (promptTokens > 0 || completionTokens > 0 || totalTokens > 0) {
              usage = {
                promptTokens: Math.max(0, Math.trunc(promptTokens)),
                completionTokens: Math.max(0, Math.trunc(completionTokens)),
                totalTokens: Math.max(0, Math.trunc(totalTokens)),
              };
            }
          }

          const choice = step.value.choices?.[0];
          if (choice?.finish_reason) {
            finishReason = choice.finish_reason;
          }
          const delta = choice?.delta;
          if (!delta) continue;

          if (delta.content) {
            content += delta.content;
          }

          const hasReasoning = Boolean(delta.reasoning_content || delta.reasoning);
          if (hasReasoning && !emittedReasoningHint && toolCalls.size === 0 && Date.now() - streamStartedAt > 3_000) {
            emittedReasoningHint = true;
            await maybeEmitStatus("Planning next build steps");
          }

          for (const toolDelta of delta.tool_calls ?? []) {
            const current = toolCalls.get(toolDelta.index) ?? { id: "", name: "", arguments: "" };
            current.id += toolDelta.id ?? "";
            current.name += toolDelta.function?.name ?? "";
            current.arguments += toolDelta.function?.arguments ?? "";
            toolCalls.set(toolDelta.index, current);

            const liveLabel = extractStreamingActivityLabel(current.name, current.arguments);
            if (liveLabel) {
              await maybeEmitStatus(liveLabel);
            }
          }
        }
      } finally {
        void iterator.return?.().catch(() => undefined);
      }

      // Guard against custom proxy "empty 200 OK" streams where upstream closed before emitting anything.
      if (!content.trim() && toolCalls.size === 0 && (chunkCount === 0 || finishReason === null)) {
        throw new ModelStreamTimeoutError(
          "empty_stream",
          "Model stream closed without returning any text or tool calls.",
        );
      }

      const calls: AccumulatedToolCall[] = [...toolCalls.entries()]
        .sort(([a], [b]) => a - b)
        .filter(([, call]) => call.name.trim().length > 0)
        .map(([, call]) => {
          const validJson = isCompleteJsonObject(call.arguments);
          return {
            id: call.id || crypto.randomUUID(),
            type: "function" as const,
            function: { name: call.name, arguments: call.arguments },
            ...(!validJson && (finishReason === "length" || !call.arguments.trim().endsWith("}"))
              ? { truncatedJson: true }
              : {}),
          };
        });

      return {
        content,
        calls,
        finishReason,
        chunkCount,
        usage,
      };
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isRetryableModelError(error)) {
        throw error;
      }

      const explicitWait = retryAfterMsFromError(error);
      const baseWait = backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 4_000;
      const jitter = Math.floor(Math.random() * 350);
      const delayMs = explicitWait ?? baseWait + jitter;

      const statusCode =
        error && typeof error === "object" && "status" in error && typeof error.status === "number"
          ? error.status
          : null;
      const reason =
        error instanceof ModelStreamTimeoutError
          ? error.kind === "first_chunk_timeout"
            ? "Model took too long to start"
            : error.kind === "chunk_stall_timeout"
              ? "Model stream stalled"
              : "Model response interrupted"
          : statusCode === 429
            ? "Model rate limit reached"
            : "Temporary model connection hiccup";

      if (options.onStatus) {
        await options.onStatus(`${reason} — retrying (${attempt + 1}/${maxAttempts})…`);
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } finally {
      clearTimeout(turnDeadlineTimer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Model stream failed after retries.");
}
