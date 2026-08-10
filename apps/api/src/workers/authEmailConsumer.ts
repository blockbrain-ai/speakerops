/**
 * Auth magic-link email consumer (dogfood / production durable delivery).
 *
 * Drains outbox_events topic `auth.magic_link`. Request path never calls
 * Cloudflare Email / Resend (E7). Decrypts token, builds login URL from
 * APP_PUBLIC_BASE_URL only, sends, redacts payload.
 */
import { AUTH_MAGIC_LINK_OUTBOX_TOPIC, uuidv7 } from "@speakerops/shared";
import {
  OUTBOX_CLAIM_LEASE_MS,
  type CommsStore,
} from "../modules/comms/store.js";
import {
  decryptMagicLinkToken,
  type EncryptedMagicLinkPayload,
} from "../modules/auth/link-crypto.js";
import {
  createEmailProvider,
  type EmailProvider,
} from "../modules/comms/send.js";

export type AuthEmailConsumerDeps = {
  comms: CommsStore;
  appPublicBaseUrl: string;
  authLinkEncryptionKey: string;
  /** cloudflare (default) | resend */
  authEmailProvider?: string;
  authEmailFrom: string;
  cloudflareAccountId?: string;
  cloudflareEmailApiToken?: string;
  authResendApiKey?: string;
  /** Workers send_email binding when available. */
  cloudflareEmail?: unknown;
  /** Test inject. */
  sendEmail?: (msg: {
    to: string;
    subject: string;
    text: string;
  }) => Promise<void>;
  /** Test inject provider. */
  provider?: EmailProvider;
};

export type ProcessAuthOutboxResult = {
  processed: number;
  failed: number;
  skipped: number;
};

type AuthMagicLinkPayload = {
  magicLinkId?: string;
  email?: string;
  enc?: EncryptedMagicLinkPayload;
  redacted?: boolean;
};

async function deliverAuthEmail(
  deps: AuthEmailConsumerDeps,
  to: string,
  subject: string,
  text: string,
): Promise<void> {
  if (deps.sendEmail) {
    await deps.sendEmail({ to, subject, text });
    return;
  }
  if (deps.provider) {
    const result = await deps.provider.send({
      to,
      subject,
      body: text,
      from: deps.authEmailFrom,
    });
    if (!result.ok) {
      throw new Error(result.error ?? "auth_email_provider_failed");
    }
    return;
  }

  const mode = (deps.authEmailProvider ?? "cloudflare").toLowerCase();
  if (mode === "cloudflare") {
    const provider = createEmailProvider(
      {
        EMAIL_PROVIDER: "cloudflare",
        EMAIL_FROM: deps.authEmailFrom,
        CLOUDFLARE_ACCOUNT_ID: deps.cloudflareAccountId,
        CLOUDFLARE_EMAIL_API_TOKEN: deps.cloudflareEmailApiToken,
      },
      { cloudflareEmail: deps.cloudflareEmail },
    );
    const result = await provider.send({
      to,
      subject,
      body: text,
      from: deps.authEmailFrom,
    });
    if (!result.ok) {
      throw new Error(result.error ?? "cloudflare_email_failed");
    }
    return;
  }
  if (mode === "resend" && deps.authResendApiKey) {
    const provider = createEmailProvider({
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: deps.authResendApiKey,
      EMAIL_FROM: deps.authEmailFrom,
    });
    const result = await provider.send({
      to,
      subject,
      body: text,
      from: deps.authEmailFrom,
    });
    if (!result.ok) {
      throw new Error(result.error ?? "resend_email_failed");
    }
    return;
  }
  throw new Error("AUTH_EMAIL_PROVIDER not configured for send");
}

export async function processAuthMagicLinkOutbox(
  deps: AuthEmailConsumerDeps,
  options: { limit?: number } = {},
): Promise<ProcessAuthOutboxResult> {
  const base = deps.appPublicBaseUrl.replace(/\/$/, "");
  if (!base.startsWith("https://") && !base.startsWith("http://localhost")) {
    // Fail closed for misconfigured public base on non-local.
    return { processed: 0, failed: 0, skipped: 0 };
  }
  if (!deps.authLinkEncryptionKey?.trim()) {
    return { processed: 0, failed: 0, skipped: 0 };
  }

  const pending = await deps.comms.listUnprocessedOutboxByTopic(
    AUTH_MAGIC_LINK_OUTBOX_TOPIC,
  );
  const limit = options.limit ?? pending.length;
  const batch = pending.slice(0, limit);
  let processed = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of batch) {
    const claimToken = uuidv7();
    const claimedUntil = new Date(
      Date.now() + OUTBOX_CLAIM_LEASE_MS,
    ).toISOString();
    const claimed = await deps.comms.claimOutboxForProcessing(row.id, {
      claimToken,
      claimedUntil,
      attempts: (row.attempts ?? 0) + 1,
    });
    if (!claimed) {
      skipped += 1;
      continue;
    }
    try {
      const payload = JSON.parse(row.payloadJson) as AuthMagicLinkPayload;
      if (payload.redacted || !payload.enc || !payload.email) {
        await deps.comms.markOutboxProcessed(row.id, {
          processedAt: new Date().toISOString(),
          attempts: (row.attempts ?? 0) + 1,
          lastError: null,
          payloadJson: JSON.stringify({
            magicLinkId: payload.magicLinkId ?? null,
            email: payload.email ?? null,
            redacted: true,
          }),
        });
        processed += 1;
        continue;
      }
      const plaintext = await decryptMagicLinkToken(
        payload.enc,
        deps.authLinkEncryptionKey,
      );
      const loginUrl = `${base}/login?token=${encodeURIComponent(plaintext)}`;
      const subject = "Your SpeakerOps login link";
      const text = [
        "Use this one-time link to sign in to SpeakerOps:",
        "",
        loginUrl,
        "",
        "This link expires soon and can only be used once.",
        "If you did not request this, you can ignore this email.",
      ].join("\n");
      await deliverAuthEmail(deps, payload.email, subject, text);
      await deps.comms.markOutboxProcessed(row.id, {
        processedAt: new Date().toISOString(),
        attempts: (row.attempts ?? 0) + 1,
        lastError: null,
        payloadJson: JSON.stringify({
          magicLinkId: payload.magicLinkId ?? null,
          email: payload.email,
          redacted: true,
        }),
      });
      processed += 1;
    } catch (err) {
      failed += 1;
      // Drop exclusive claim so cron/queue can retry. Never log token material.
      void (err instanceof Error ? err.message : "send_failed");
      try {
        await deps.comms.releaseOutboxClaim(row.id, claimToken);
      } catch {
        // ignore
      }
    }
  }
  return { processed, failed, skipped };
}
