/**
 * Comms send helpers — provider adapter + request hash (section 5.2 / S-COMMS).
 *
 * Request path (Comms.Send) never calls provider HTTP (E7).
 * Queue consumer uses createEmailProvider (sandbox default) to drain outbox.
 *
 * Env names only (E10): EMAIL_PROVIDER, RESEND_API_KEY, EMAIL_FROM.
 */

import { uuidv7 } from "@speakerops/shared";

/** Provider identity recorded on delivery_events. */
export type EmailProviderName = "sandbox" | "resend";

export type EmailAttachment = {
  filename: string;
  contentType: string;
  /** Base64 or raw text content (ICS is text/calendar). */
  content: string;
};

export type EmailMessage = {
  to: string;
  subject: string;
  body: string;
  from?: string;
  /** Optional correlation for logs (never magic links / secrets). */
  correlationId?: string;
  jobId?: string;
  recipientId?: string;
  attachments?: EmailAttachment[];
};

export type EmailSendResult = {
  ok: boolean;
  provider: EmailProviderName;
  providerMessageId: string | null;
  /** sandbox | sent | failed */
  status: "sandbox" | "sent" | "failed";
  error?: string;
};

export type EmailProvider = {
  readonly name: EmailProviderName;
  send(message: EmailMessage): Promise<EmailSendResult>;
};

export type EmailProviderEnv = {
  /** "sandbox" (default) | "resend" — live only when RESEND_API_KEY also set. */
  EMAIL_PROVIDER?: string;
  /** Env name only — never commit values (E10). */
  RESEND_API_KEY?: string;
  /** Default From: address for provider sends. */
  EMAIL_FROM?: string;
};

/**
 * Resolve provider mode. **Sandbox is the default** unless EMAIL_PROVIDER=resend
 * and RESEND_API_KEY is non-empty.
 */
export function resolveEmailProviderMode(
  env: EmailProviderEnv = {},
): EmailProviderName {
  const mode = (env.EMAIL_PROVIDER ?? "sandbox").trim().toLowerCase();
  const key =
    typeof env.RESEND_API_KEY === "string" ? env.RESEND_API_KEY.trim() : "";
  if (mode === "resend" && key.length > 0) {
    return "resend";
  }
  return "sandbox";
}

/**
 * Sandbox adapter — records sends without any network I/O.
 * Used by default in local, test, and dogfood until live keys are configured.
 */
export class SandboxEmailProvider implements EmailProvider {
  readonly name = "sandbox" as const;
  /** Captured messages for unit tests (no secrets). */
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<EmailSendResult> {
    this.sent.push({ ...message });
    return {
      ok: true,
      provider: "sandbox",
      providerMessageId: `sandbox_${uuidv7()}`,
      status: "sandbox",
    };
  }
}

/**
 * Resend HTTP adapter — only constructed when mode is resend + key present.
 * Never used on the Comms.Send request path.
 */
export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend" as const;
  private readonly apiKey: string;
  private readonly defaultFrom: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    apiKey: string,
    options: { from?: string; fetchImpl?: typeof fetch } = {},
  ) {
    this.apiKey = apiKey;
    this.defaultFrom = options.from ?? "SpeakerOps <noreply@speakerops.local>";
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    try {
      const attachments =
        message.attachments?.map((a) => ({
          filename: a.filename,
          content: utf8ToBase64(a.content),
        })) ?? undefined;
      const res = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: message.from ?? this.defaultFrom,
          to: [message.to],
          subject: message.subject,
          text: message.body,
          ...(attachments ? { attachments } : {}),
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          ok: false,
          provider: "resend",
          providerMessageId: null,
          status: "failed",
          error: `resend_http_${res.status}:${text.slice(0, 200)}`,
        };
      }
      const json = (await res.json()) as { id?: string };
      return {
        ok: true,
        provider: "resend",
        providerMessageId: json.id ?? null,
        status: "sent",
      };
    } catch (err) {
      return {
        ok: false,
        provider: "resend",
        providerMessageId: null,
        status: "failed",
        error: err instanceof Error ? err.message : "resend_error",
      };
    }
  }
}

/**
 * Factory — sandbox default (section 5.2 AC).
 */
export function createEmailProvider(
  env: EmailProviderEnv = {},
  options: { fetchImpl?: typeof fetch; sandbox?: SandboxEmailProvider } = {},
): EmailProvider {
  const mode = resolveEmailProviderMode(env);
  if (mode === "resend") {
    const key = env.RESEND_API_KEY!.trim();
    return new ResendEmailProvider(key, {
      from: env.EMAIL_FROM,
      fetchImpl: options.fetchImpl,
    });
  }
  return options.sandbox ?? new SandboxEmailProvider();
}

/**
 * Stable request hash for idempotency_keys (E7).
 * Covers previewId + idempotencyKey so a reused key with different body → conflict.
 */
export async function hashSendRequest(input: {
  previewId: string;
  idempotencyKey: string;
}): Promise<string> {
  const payload = JSON.stringify({
    idempotencyKey: input.idempotencyKey,
    previewId: input.previewId,
  });
  const data = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Scope prefix for Comms.Send keys in idempotency_keys table. */
export const COMMS_SEND_IDEMPOTENCY_PREFIX = "comms.send:" as const;

export function commsSendIdempotencyStorageKey(idempotencyKey: string): string {
  return `${COMMS_SEND_IDEMPOTENCY_PREFIX}${idempotencyKey}`;
}

/** UTF-8 → base64 without Node Buffer (Worker-safe). */
function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}
