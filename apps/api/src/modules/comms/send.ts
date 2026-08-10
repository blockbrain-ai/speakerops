/**
 * Comms send helpers — provider adapter + request hash (section 5.2 / S-COMMS).
 *
 * Request path (Comms.Send) never calls provider HTTP (E7).
 * Queue consumer uses createEmailProvider (sandbox default) to drain outbox.
 *
 * Env names only (E10): EMAIL_PROVIDER, RESEND_API_KEY, EMAIL_FROM.
 */

import { uuidv7 } from "@speakerops/shared";

/** Provider identity recorded on delivery_events / auth delivery. */
export type EmailProviderName = "sandbox" | "resend" | "cloudflare";

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
  /**
   * "sandbox" (default) | "resend" | "cloudflare".
   * resend requires RESEND_API_KEY; cloudflare requires token+account or EMAIL binding.
   */
  EMAIL_PROVIDER?: string;
  /** Env name only — never commit values (E10). */
  RESEND_API_KEY?: string;
  /** Default From: address for provider sends. */
  EMAIL_FROM?: string;
  /** Cloudflare account id for Email Sending REST API (env name only). */
  CLOUDFLARE_ACCOUNT_ID?: string;
  /** Cloudflare API token with Email Sending permission (env name only). */
  CLOUDFLARE_EMAIL_API_TOKEN?: string;
};

/**
 * Resolve provider mode.
 * - resend when EMAIL_PROVIDER=resend and RESEND_API_KEY set
 * - cloudflare when EMAIL_PROVIDER=cloudflare (binding or REST token)
 * - else sandbox
 */
export function resolveEmailProviderMode(
  env: EmailProviderEnv = {},
  options: { preferCloudflareBinding?: boolean } = {},
): EmailProviderName {
  const mode = (env.EMAIL_PROVIDER ?? "sandbox").trim().toLowerCase();
  if (mode === "resend") {
    const key =
      typeof env.RESEND_API_KEY === "string" ? env.RESEND_API_KEY.trim() : "";
    if (key.length > 0) return "resend";
  }
  if (mode === "cloudflare") {
    const token =
      typeof env.CLOUDFLARE_EMAIL_API_TOKEN === "string"
        ? env.CLOUDFLARE_EMAIL_API_TOKEN.trim()
        : "";
    const account =
      typeof env.CLOUDFLARE_ACCOUNT_ID === "string"
        ? env.CLOUDFLARE_ACCOUNT_ID.trim()
        : "";
    if (options.preferCloudflareBinding || (token.length > 0 && account.length > 0)) {
      return "cloudflare";
    }
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
 * Cloudflare Email Sending — Workers binding (`env.EMAIL.send`) or REST API.
 * Used for auth magic-link delivery on dogfood (AUTH_EMAIL_PROVIDER=cloudflare).
 */
export class CloudflareEmailProvider implements EmailProvider {
  readonly name = "cloudflare" as const;
  private readonly defaultFrom: string;
  private readonly accountId: string | null;
  private readonly apiToken: string | null;
  private readonly fetchImpl: typeof fetch;
  /** Optional Workers send_email binding. */
  private readonly binding: { send?: (msg: unknown) => Promise<unknown> } | null;

  constructor(
    options: {
      from?: string;
      accountId?: string;
      apiToken?: string;
      fetchImpl?: typeof fetch;
      cloudflareEmail?: unknown;
    } = {},
  ) {
    this.defaultFrom = options.from ?? "SpeakerOps <noreply@speakerops.org>";
    this.accountId = options.accountId?.trim() || null;
    this.apiToken = options.apiToken?.trim() || null;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.binding =
      options.cloudflareEmail &&
      typeof (options.cloudflareEmail as { send?: unknown }).send === "function"
        ? (options.cloudflareEmail as { send: (msg: unknown) => Promise<unknown> })
        : null;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const fromRaw = message.from ?? this.defaultFrom;
    try {
      // Fail closed: CF path does not support program ICS attachments.
      if (message.attachments && message.attachments.length > 0) {
        return {
          ok: false,
          provider: "cloudflare",
          providerMessageId: null,
          status: "failed",
          error: "cloudflare_attachments_unsupported",
        };
      }
      if (this.binding?.send) {
        // Workers binding form: from.email (not address).
        const parsed = parseFromAddress(fromRaw);
        await this.binding.send({
          to: message.to,
          from: { email: parsed.address, name: parsed.name },
          subject: message.subject,
          text: message.body,
        });
        return {
          ok: true,
          provider: "cloudflare",
          providerMessageId: null,
          status: "sent",
        };
      }
      if (!this.accountId || !this.apiToken) {
        return {
          ok: false,
          provider: "cloudflare",
          providerMessageId: null,
          status: "failed",
          error: "cloudflare_email_missing_creds",
        };
      }
      // REST API: from.address
      const parsed = parseFromAddress(fromRaw);
      const res = await this.fetchImpl(
        `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/email/sending/send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            to: message.to,
            from: { address: parsed.address, name: parsed.name },
            subject: message.subject,
            text: message.body,
          }),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          ok: false,
          provider: "cloudflare",
          providerMessageId: null,
          status: "failed",
          error: `cloudflare_http_${res.status}:${text.slice(0, 200)}`,
        };
      }
      return {
        ok: true,
        provider: "cloudflare",
        providerMessageId: null,
        status: "sent",
      };
    } catch (err) {
      return {
        ok: false,
        provider: "cloudflare",
        providerMessageId: null,
        status: "failed",
        error: err instanceof Error ? err.message : "cloudflare_error",
      };
    }
  }
}

function parseFromAddress(from: string): { address: string; name?: string } {
  // "Name <addr@host>" or bare addr
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) {
    const name = m[1]!.replace(/^["']|["']$/g, "").trim();
    return { address: m[2]!.trim(), name: name || undefined };
  }
  return { address: from.trim() };
}

/**
 * Factory — sandbox default (section 5.2 AC).
 */
export function createEmailProvider(
  env: EmailProviderEnv = {},
  options: {
    fetchImpl?: typeof fetch;
    sandbox?: SandboxEmailProvider;
    cloudflareEmail?: unknown;
  } = {},
): EmailProvider {
  const mode = resolveEmailProviderMode(env, {
    preferCloudflareBinding: Boolean(options.cloudflareEmail),
  });
  if (mode === "resend") {
    const key = env.RESEND_API_KEY!.trim();
    return new ResendEmailProvider(key, {
      from: env.EMAIL_FROM,
      fetchImpl: options.fetchImpl,
    });
  }
  if (mode === "cloudflare") {
    return new CloudflareEmailProvider({
      from: env.EMAIL_FROM,
      accountId: env.CLOUDFLARE_ACCOUNT_ID,
      apiToken: env.CLOUDFLARE_EMAIL_API_TOKEN,
      fetchImpl: options.fetchImpl,
      cloudflareEmail: options.cloudflareEmail,
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
  calendarInviteId?: string | null;
}): Promise<string> {
  const payload = JSON.stringify({
    idempotencyKey: input.idempotencyKey,
    previewId: input.previewId,
    calendarInviteId: input.calendarInviteId ?? null,
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
