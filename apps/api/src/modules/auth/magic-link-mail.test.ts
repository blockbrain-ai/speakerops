/**
 * Magic-link durable email delivery + allowlist (auth.magic_link outbox).
 */
import { describe, it, expect } from "vitest";
import { AUTH_MAGIC_LINK_OUTBOX_TOPIC } from "@speakerops/shared";
import { createAppWithAuth } from "../../index.js";
import { MemoryCommsStore } from "../comms/store.js";
import {
  encryptMagicLinkToken,
  decryptMagicLinkToken,
} from "./link-crypto.js";
import { processAuthMagicLinkOutbox } from "../../workers/authEmailConsumer.js";
import {
  parseMagicLinkAllowlist,
  isEmailOnMagicLinkAllowlist,
} from "./commands.js";
import { SandboxEmailProvider } from "../comms/send.js";

const env = { APP_VERSION: "0.1.0" };
const TEST_KEY = "unit-test-auth-link-encryption-key-32b!!";

describe("link-crypto AES-GCM", () => {
  it("round-trips plaintext", async () => {
    const enc = await encryptMagicLinkToken("secret-token-value-xx", TEST_KEY);
    expect(enc.v).toBe(1);
    expect(enc.iv.length).toBeGreaterThan(4);
    expect(enc.ct.length).toBeGreaterThan(4);
    const pt = await decryptMagicLinkToken(enc, TEST_KEY);
    expect(pt).toBe("secret-token-value-xx");
  });
});

describe("magic link allowlist helpers", () => {
  it("parses and matches emails", () => {
    const list = parseMagicLinkAllowlist(
      "chris@noodco.com.au, Tester@Example.com",
    );
    expect(list).toEqual(["chris@noodco.com.au", "tester@example.com"]);
    expect(isEmailOnMagicLinkAllowlist("chris@noodco.com.au", list)).toBe(true);
    expect(isEmailOnMagicLinkAllowlist("stranger@x.com", list)).toBe(false);
  });
});

describe("requestMagicLink durable mail + allowlist", () => {
  it("enqueues encrypted outbox for allowlisted email under controlled policy", async () => {
    const comms = new MemoryCommsStore();
    const { app, store, outbox } = createAppWithAuth({
      bootstrapPolicy: "controlled",
      magicLinkMail: {
        comms,
        authLinkEncryptionKey: TEST_KEY,
      },
    });

    const email = "chris@noodco.com.au";
    const res = await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "corr-mail-1",
        },
        body: JSON.stringify({ email, purpose: "admin" }),
      },
      {
        ...env,
        MAGIC_LINK_ALLOWLIST: "chris@noodco.com.au",
        BOOTSTRAP_ADMIN_EMAIL: "",
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });

    // Dev outbox still captures for tests
    expect(outbox.lastForEmail(email)?.token.length).toBeGreaterThan(16);

    const pending = await comms.listUnprocessedOutboxByTopic(
      AUTH_MAGIC_LINK_OUTBOX_TOPIC,
    );
    expect(pending.length).toBe(1);
    const payload = JSON.parse(pending[0]!.payloadJson) as {
      email: string;
      enc: { v: number; iv: string; ct: string };
    };
    expect(payload.email).toBe(email);
    expect(payload.enc.v).toBe(1);
    // Plaintext not in payload
    expect(pending[0]!.payloadJson).not.toContain(outbox.lastForEmail(email)!.token);

    const user = await store.findUserByEmail(email);
    expect(user).toBeTruthy();
  });

  it("silent no-op for non-allowlisted email under controlled + allowlist", async () => {
    const comms = new MemoryCommsStore();
    const { app, store, outbox } = createAppWithAuth({
      bootstrapPolicy: "controlled",
      magicLinkMail: {
        comms,
        authLinkEncryptionKey: TEST_KEY,
      },
    });

    const res = await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "stranger@example.com",
          purpose: "admin",
        }),
      },
      {
        ...env,
        MAGIC_LINK_ALLOWLIST: "chris@noodco.com.au",
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: true });
    expect(outbox.lastForEmail("stranger@example.com")).toBeNull();
    expect(await store.findUserByEmail("stranger@example.com")).toBeNull();
    expect(
      (await comms.listUnprocessedOutboxByTopic(AUTH_MAGIC_LINK_OUTBOX_TOPIC))
        .length,
    ).toBe(0);
  });

  it("consumer sends and redacts payload", async () => {
    const comms = new MemoryCommsStore();
    const sandbox = new SandboxEmailProvider();
    const { app, outbox } = createAppWithAuth({
      bootstrapPolicy: "controlled",
      magicLinkMail: {
        comms,
        authLinkEncryptionKey: TEST_KEY,
      },
    });

    await app.request(
      "http://localhost/api/auth/magic-link",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "chris@noodco.com.au",
          purpose: "admin",
        }),
      },
      { ...env, MAGIC_LINK_ALLOWLIST: "chris@noodco.com.au" },
    );

    const token = outbox.lastForEmail("chris@noodco.com.au")!.token;
    const result = await processAuthMagicLinkOutbox({
      comms,
      appPublicBaseUrl: "https://www.speakerops.org",
      authLinkEncryptionKey: TEST_KEY,
      authEmailFrom: "SpeakerOps <noreply@speakerops.org>",
      provider: sandbox,
    });
    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    expect(sandbox.sent.length).toBe(1);
    expect(sandbox.sent[0]!.to).toBe("chris@noodco.com.au");
    expect(sandbox.sent[0]!.body).toContain(
      `https://www.speakerops.org/login?token=${encodeURIComponent(token)}`,
    );

    const pending = await comms.listUnprocessedOutboxByTopic(
      AUTH_MAGIC_LINK_OUTBOX_TOPIC,
    );
    expect(pending.length).toBe(0);
    const all = await comms.listOutboxByTopic(AUTH_MAGIC_LINK_OUTBOX_TOPIC);
    expect(all[0]!.processedAt).toBeTruthy();
    const redacted = JSON.parse(all[0]!.payloadJson) as { redacted?: boolean };
    expect(redacted.redacted).toBe(true);
    expect(all[0]!.payloadJson).not.toContain(token);
  });
});
