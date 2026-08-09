/**
 * Section 10.3 — Turnstile DEMO_MODE + allowlist unit proofs.
 *
 * AC-10.3-C: demoMode false rejects TURNSTILE_DEV_PASS_TOKEN
 * AC-10.3-D: DEMO token not accepted on non-allowlisted hosts
 * Also: demoMode true + allowlisted host accepts DEV_PASS
 */
import { describe, it, expect } from "vitest";
import {
  TURNSTILE_DEV_PASS_TOKEN,
  TURNSTILE_DEV_FAIL_TOKEN,
  TURNSTILE_TEST_SECRET_PASS,
} from "@speakerops/shared";
import {
  verifyTurnstile,
  isDemoPassTokenAllowed,
  normalizeDemoHost,
  parseDemoAllowlist,
} from "./turnstile.js";

describe("normalizeDemoHost / parseDemoAllowlist", () => {
  it("strips port and lowercases host", () => {
    expect(normalizeDemoHost("WWW.SpeakerOps.org:443")).toBe(
      "www.speakerops.org",
    );
    expect(normalizeDemoHost("localhost:8787")).toBe("localhost");
    expect(normalizeDemoHost("127.0.0.1:5173")).toBe("127.0.0.1");
  });

  it("parseDemoAllowlist splits comma list", () => {
    expect(parseDemoAllowlist("www.speakerops.org, localhost")).toEqual([
      "www.speakerops.org",
      "localhost",
    ]);
    expect(parseDemoAllowlist(undefined)).toEqual([]);
  });
});

describe("isDemoPassTokenAllowed", () => {
  it("false when demoMode is not true", () => {
    expect(isDemoPassTokenAllowed({})).toBe(false);
    expect(isDemoPassTokenAllowed({ demoMode: false })).toBe(false);
  });

  it("true when demoMode and allowlist disabled", () => {
    expect(
      isDemoPassTokenAllowed({
        demoMode: true,
        demoAllowlistEnabled: false,
      }),
    ).toBe(true);
  });

  it("false when allowlist enabled and host missing or not listed", () => {
    expect(
      isDemoPassTokenAllowed({
        demoMode: true,
        demoAllowlistEnabled: true,
        demoAllowlistHosts: ["www.speakerops.org"],
        host: "evil.example.com",
      }),
    ).toBe(false);
    expect(
      isDemoPassTokenAllowed({
        demoMode: true,
        demoAllowlistEnabled: true,
        demoAllowlistHosts: ["www.speakerops.org"],
      }),
    ).toBe(false);
  });

  it("true when allowlist enabled and host matches", () => {
    expect(
      isDemoPassTokenAllowed({
        demoMode: true,
        demoAllowlistEnabled: true,
        demoAllowlistHosts: ["www.speakerops.org", "localhost"],
        host: "www.speakerops.org:443",
      }),
    ).toBe(true);
  });

  it("event slug allowlist rejects non-listed events", () => {
    expect(
      isDemoPassTokenAllowed({
        demoMode: true,
        demoAllowlistEnabled: true,
        demoAllowlistHosts: ["localhost"],
        demoAllowlistEventSlugs: ["demo-summit"],
        host: "localhost",
        eventSlug: "other-event",
      }),
    ).toBe(false);
    expect(
      isDemoPassTokenAllowed({
        demoMode: true,
        demoAllowlistEnabled: true,
        demoAllowlistHosts: ["localhost"],
        demoAllowlistEventSlugs: ["demo-summit"],
        host: "localhost",
        eventSlug: "demo-summit",
      }),
    ).toBe(true);
  });
});

describe("verifyTurnstile DEMO path (section 10.3)", () => {
  it("AC-10.3-C: demoMode false rejects TURNSTILE_DEV_PASS_TOKEN", async () => {
    // Even with no secret (local path) or real-looking secret — DEV_PASS denied.
    const noSecret = await verifyTurnstile({
      token: TURNSTILE_DEV_PASS_TOKEN,
      secret: undefined,
      demoMode: false,
    });
    expect(noSecret.ok).toBe(false);

    const withTestSecret = await verifyTurnstile({
      token: TURNSTILE_DEV_PASS_TOKEN,
      secret: "test",
      demoMode: false,
    });
    expect(withTestSecret.ok).toBe(false);

    const withProdSecret = await verifyTurnstile({
      token: TURNSTILE_DEV_PASS_TOKEN,
      secret: "prod-secret-not-a-test-value",
      demoMode: false,
      // siteverify must not be reached for DEV_PASS when demoMode false
      fetchImpl: async () => {
        throw new Error("siteverify must not be called for DEV_PASS reject");
      },
    });
    expect(withProdSecret.ok).toBe(false);

    // demoMode omitted (undefined) is also reject
    const omitted = await verifyTurnstile({
      token: TURNSTILE_DEV_PASS_TOKEN,
      secret: "test",
    });
    expect(omitted.ok).toBe(false);
  });

  it("AC-10.3-D: DEMO token not accepted on non-allowlisted hosts", async () => {
    const result = await verifyTurnstile({
      token: TURNSTILE_DEV_PASS_TOKEN,
      secret: "test",
      demoMode: true,
      demoAllowlistEnabled: true,
      demoAllowlistHosts: ["www.speakerops.org"],
      host: "attacker.example.com",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.toLowerCase()).toMatch(/turnstile/);
    }
  });

  it("demoMode true + allowlisted host accepts DEV_PASS (AC-10.3-A unit)", async () => {
    const result = await verifyTurnstile({
      token: TURNSTILE_DEV_PASS_TOKEN,
      secret: "test",
      demoMode: true,
      demoAllowlistEnabled: true,
      demoAllowlistHosts: ["www.speakerops.org", "localhost"],
      host: "localhost:8787",
      eventSlug: "any-event",
    });
    expect(result.ok).toBe(true);
  });

  it("demoMode true without allowlist (local e2e) accepts DEV_PASS", async () => {
    const result = await verifyTurnstile({
      token: TURNSTILE_DEV_PASS_TOKEN,
      secret: undefined,
      demoMode: true,
      demoAllowlistEnabled: false,
    });
    expect(result.ok).toBe(true);
  });

  it("DEV_FAIL always rejected under demoMode", async () => {
    const result = await verifyTurnstile({
      token: TURNSTILE_DEV_FAIL_TOKEN,
      secret: "test",
      demoMode: true,
    });
    expect(result.ok).toBe(false);
  });

  it("forged non-empty token fails closed under demoMode local path", async () => {
    const result = await verifyTurnstile({
      token: "forged-but-non-empty-token",
      secret: "test",
      demoMode: true,
    });
    expect(result.ok).toBe(false);
  });

  it("always-pass test secret still siteverifies non-DEV tokens", async () => {
    let called = false;
    const result = await verifyTurnstile({
      token: "widget-token-from-cf",
      secret: TURNSTILE_TEST_SECRET_PASS,
      demoMode: false,
      fetchImpl: async () => {
        called = true;
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      },
    });
    expect(called).toBe(true);
    expect(result.ok).toBe(true);
  });
});
