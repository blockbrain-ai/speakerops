/**
 * Auth domain commands (section 2.1).
 *
 * Auth.RequestMagicLink — always { sent: true }; hash token at rest; capture for test outbox
 * Auth.ExchangeMagicLink — single-use; Set-Cookie session
 * Auth.Logout — clear cookie + delete session
 *
 * Never log plaintext tokens (E10).
 *
 * Bootstrap policy (E2 security):
 * - "open": local e2e / unit tests — create user + grant purpose role (dogfood convenience)
 * - "controlled" (production default): existing users only; optional first-admin bootstrap
 *   when no admin memberships exist (or BOOTSTRAP_ADMIN_EMAIL allowlist). Caller-supplied
 *   purpose never elevates an existing user's membership.
 */
import {
  uuidv7,
  MAGIC_LINK_TTL_MINUTES,
  SESSION_TTL_DAYS,
  DEFAULT_BOOTSTRAP_EVENT_ID,
  type EventRole,
  type MagicLinkPurpose,
  type RequestMagicLinkResponse,
  type ExchangeMagicLinkResponse,
} from "@speakerops/shared";
import {
  generateToken,
  hashToken,
  expiresAtMinutesFromNow,
  expiresAtDaysFromNow,
  isExpired,
} from "./crypto.js";
import type {
  AuthStore,
  MagicLinkTestOutbox,
  CapturedMagicLink,
  UserRow,
} from "./store.js";
import { normalizeEmail } from "./store.js";

/** Map magic-link purpose → event_memberships.role (section 2.2). */
export function purposeToRole(purpose: MagicLinkPurpose): EventRole {
  return purpose;
}

/**
 * Production vs test bootstrap for Auth.RequestMagicLink.
 * Production Worker must use "controlled".
 */
export type BootstrapPolicy = "open" | "controlled";

export type RequestMagicLinkInput = {
  email: string;
  purpose: MagicLinkPurpose;
  eventId?: string;
  correlationId: string;
  /**
   * Optional allowlist email for controlled first-admin bootstrap
   * (from BOOTSTRAP_ADMIN_EMAIL env name — never a secret value in repo).
   */
  bootstrapAdminEmail?: string | null;
};

export type ExchangeMagicLinkInput = {
  token: string;
  correlationId: string;
};

export type LogoutInput = {
  sessionToken: string | null;
  correlationId: string;
};

export type ExchangeSuccess = {
  ok: true;
  response: ExchangeMagicLinkResponse;
  sessionToken: string;
};

export type ExchangeFailure = {
  ok: false;
  reason: "invalid" | "used" | "expired";
};

export type AuthCommandDeps = {
  store: AuthStore;
  outbox: MagicLinkTestOutbox;
  /** Default "controlled". Tests/e2e pass "open". */
  bootstrapPolicy?: BootstrapPolicy;
};

/**
 * Decide whether an unknown email may be created + granted membership.
 * Controlled: first-admin only (purpose=admin, zero admins, optional email allowlist).
 */
export async function isAllowedBootstrap(
  store: AuthStore,
  input: {
    email: string;
    purpose: MagicLinkPurpose;
    bootstrapAdminEmail?: string | null;
  },
  policy: BootstrapPolicy,
): Promise<boolean> {
  if (policy === "open") return true;
  if (input.purpose !== "admin") return false;
  const adminCount = await store.countMembershipsByRole("admin");
  if (adminCount > 0) return false;
  const allow = input.bootstrapAdminEmail?.trim().toLowerCase();
  if (allow && allow.length > 0) {
    return normalizeEmail(input.email) === allow;
  }
  // Empty allowlist: first admin of an empty system (ops-controlled empty D1).
  return true;
}

/**
 * Auth.RequestMagicLink
 * - Always returns { sent: true } (no email enumeration)
 * - Controlled: unknown email is a silent no-op unless first-admin bootstrap
 * - Existing users get a magic link; purpose does not rewrite memberships
 */
export async function requestMagicLink(
  deps: AuthCommandDeps,
  input: RequestMagicLinkInput,
): Promise<RequestMagicLinkResponse> {
  const email = normalizeEmail(input.email);
  const response: RequestMagicLinkResponse = { sent: true };
  const policy = deps.bootstrapPolicy ?? "controlled";

  let user: UserRow | null = await deps.store.findUserByEmail(email);
  let grantedMembershipId: string | null = null;
  let grantedRole: EventRole | null = null;
  let isBootstrapCreate = false;

  if (!user) {
    const allowed = await isAllowedBootstrap(
      deps.store,
      {
        email,
        purpose: input.purpose,
        bootstrapAdminEmail: input.bootstrapAdminEmail,
      },
      policy,
    );
    if (!allowed) {
      // No enumeration: identical response, no user / link / membership side effects
      return response;
    }
    user = await deps.store.createUser({ email });
    isBootstrapCreate = true;
  }

  const plaintext = generateToken(32);
  const tokenHash = await hashToken(plaintext);
  const now = new Date();
  const magicId = uuidv7();
  const createdAt = now.toISOString();
  const membershipEventId = input.eventId ?? DEFAULT_BOOTSTRAP_EVENT_ID;

  await deps.store.insertMagicLink({
    id: magicId,
    userId: user.id,
    eventId: input.eventId ?? null,
    purpose: input.purpose,
    tokenHash,
    expiresAt: expiresAtMinutesFromNow(MAGIC_LINK_TTL_MINUTES, now),
    usedAt: null,
    createdAt,
  });

  // Membership grants:
  // - open: purpose → role upsert (e2e dogfood)
  // - controlled: only on first-admin bootstrap create; never elevate existing users
  if (policy === "open") {
    const role = purposeToRole(input.purpose);
    const membership = await deps.store.upsertMembership({
      eventId: membershipEventId,
      userId: user.id,
      role,
    });
    grantedMembershipId = membership.id;
    grantedRole = role;
  } else if (isBootstrapCreate && input.purpose === "admin") {
    const membership = await deps.store.upsertMembership({
      eventId: membershipEventId,
      userId: user.id,
      role: "admin",
    });
    grantedMembershipId = membership.id;
    grantedRole = "admin";
  }

  const captured: CapturedMagicLink = {
    email,
    purpose: input.purpose,
    token: plaintext,
    eventId: input.eventId ?? null,
    userId: user.id,
    magicLinkId: magicId,
    createdAt,
  };
  // Dev transport: capture for tests / local e2e — never log token
  deps.outbox.capture(captured);

  await deps.store.insertAudit({
    id: uuidv7(),
    eventId: membershipEventId,
    actorType: "system",
    actorId: "auth",
    action: "Auth.RequestMagicLink",
    entityType: "magic_link",
    entityId: magicId,
    // after_json must not include plaintext token
    afterJson: JSON.stringify({
      email,
      purpose: input.purpose,
      userId: user.id,
      membershipId: grantedMembershipId,
      role: grantedRole,
      bootstrapPolicy: policy,
      bootstrapCreate: isBootstrapCreate,
    }),
    correlationId: input.correlationId,
    createdAt,
  });

  return response;
}

/**
 * Auth.ExchangeMagicLink — single-use; issues session cookie material.
 */
export async function exchangeMagicLink(
  deps: AuthCommandDeps,
  input: ExchangeMagicLinkInput,
): Promise<ExchangeSuccess | ExchangeFailure> {
  const tokenHash = await hashToken(input.token);
  const link = await deps.store.findMagicLinkByTokenHash(tokenHash);
  if (!link) {
    return { ok: false, reason: "invalid" };
  }
  if (link.usedAt) {
    return { ok: false, reason: "used" };
  }
  if (isExpired(link.expiresAt)) {
    return { ok: false, reason: "expired" };
  }

  const usedAt = new Date().toISOString();
  await deps.store.markMagicLinkUsed(link.id, usedAt);

  const user = await deps.store.findUserById(link.userId);
  if (!user) {
    return { ok: false, reason: "invalid" };
  }

  const sessionToken = generateToken(32);
  const sessionHash = await hashToken(sessionToken);
  const sessionId = uuidv7();
  const now = new Date();
  await deps.store.insertSession({
    id: sessionId,
    userId: user.id,
    tokenHash: sessionHash,
    expiresAt: expiresAtDaysFromNow(SESSION_TTL_DAYS, now),
    createdAt: now.toISOString(),
  });

  await deps.store.insertAudit({
    id: uuidv7(),
    eventId: link.eventId,
    actorType: "user",
    actorId: user.id,
    action: "Auth.ExchangeMagicLink",
    entityType: "auth_session",
    entityId: sessionId,
    afterJson: JSON.stringify({
      purpose: link.purpose,
      userId: user.id,
      email: user.email,
    }),
    correlationId: input.correlationId,
    createdAt: now.toISOString(),
  });

  return {
    ok: true,
    sessionToken,
    response: {
      ok: true,
      purpose: link.purpose,
      email: user.email,
    },
  };
}

/**
 * Auth.Logout — revoke session if present; always succeed for cookie clear.
 */
export async function logoutSession(
  deps: AuthCommandDeps,
  input: LogoutInput,
): Promise<{ cleared: boolean }> {
  if (!input.sessionToken) {
    return { cleared: false };
  }
  const tokenHash = await hashToken(input.sessionToken);
  const session = await deps.store.findSessionByTokenHash(tokenHash);
  const deleted = await deps.store.deleteSessionByTokenHash(tokenHash);

  if (session || deleted) {
    await deps.store.insertAudit({
      id: uuidv7(),
      eventId: null,
      actorType: session ? "user" : "system",
      actorId: session?.userId ?? "anonymous",
      action: "Auth.Logout",
      entityType: "auth_session",
      entityId: session?.id ?? "unknown",
      correlationId: input.correlationId,
      createdAt: new Date().toISOString(),
    });
  }

  return { cleared: deleted };
}

/**
 * Assert no magic-link or session row contains a known plaintext token.
 * Used by tests — production store only ever receives hashes from commands.
 */
export async function assertNoPlaintextTokenInStore(
  store: AuthStore,
  plaintext: string,
): Promise<boolean> {
  const hash = await hashToken(plaintext);
  const links = await store.listMagicLinks();
  const sessions = await store.listSessions();
  for (const link of links) {
    if (link.tokenHash === plaintext) return false;
    if (link.tokenHash !== hash && link.tokenHash.includes(plaintext)) {
      return false;
    }
  }
  for (const s of sessions) {
    if (s.tokenHash === plaintext) return false;
  }
  // Hash must be present for issued links
  const match = links.find((l) => l.tokenHash === hash);
  return match !== undefined;
}
