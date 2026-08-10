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
 * - "controlled" (production default): existing users only; first-admin bootstrap only when
 *   BOOTSTRAP_ADMIN_EMAIL is set, matches the caller, and zero admin memberships exist
 *   (default-deny when unset). Caller-supplied purpose never elevates an existing user's membership.
 */
import {
  uuidv7,
  MAGIC_LINK_TTL_MINUTES,
  SESSION_TTL_DAYS,
  DEFAULT_BOOTSTRAP_EVENT_ID,
  DEMO_ROLE_EMAILS,
  AUTH_MAGIC_LINK_OUTBOX_TOPIC,
  type EventRole,
  type MagicLinkPurpose,
  type RequestMagicLinkResponse,
  type ExchangeMagicLinkResponse,
  type DevRoleSwitchResponse,
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
import { encryptMagicLinkToken } from "./link-crypto.js";
import type { CommsStore } from "../comms/store.js";

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
  /**
   * Comma-separated emails allowed to receive magic links (dogfood testers).
   * When non-empty under controlled policy: only listed emails get links + email.
   * Empty/undefined: existing-user / bootstrap rules only.
   */
  magicLinkAllowlist?: string[] | null;
};

export type ExchangeMagicLinkInput = {
  token: string;
  correlationId: string;
};

export type LogoutInput = {
  sessionToken: string | null;
  /**
   * Preserved judge-origin session from Auth.DevRoleSwitch (section 8.4).
   * Distinct from the active product session when admin→evaluator/speaker;
   * both must be revoked so a stolen/replayed judge cookie cannot mint sessions.
   */
  judgeSessionToken?: string | null;
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

/** Durable magic-link email delivery (optional — dogfood/production). */
export type MagicLinkMailDeps = {
  comms: CommsStore;
  /** AUTH_LINK_ENCRYPTION_KEY — encrypt plaintext before outbox. */
  authLinkEncryptionKey: string;
  /** Queue kick after enqueue (JOBS_QUEUE). */
  queueKick?: { send: (body: unknown) => Promise<void> } | null;
};

export type AuthCommandDeps = {
  store: AuthStore;
  outbox: MagicLinkTestOutbox;
  /** Default "controlled". Tests/e2e pass "open". */
  bootstrapPolicy?: BootstrapPolicy;
  /** When set, enqueue encrypted auth.magic_link outbox for email delivery. */
  magicLinkMail?: MagicLinkMailDeps | null;
};

/** Normalize allowlist entries (lowercase). */
export function parseMagicLinkAllowlist(
  raw: string | string[] | null | undefined,
): string[] {
  if (!raw) return [];
  const parts = Array.isArray(raw) ? raw : raw.split(",");
  return parts
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && s.includes("@"));
}

export function isEmailOnMagicLinkAllowlist(
  email: string,
  allowlist: string[] | null | undefined,
): boolean {
  if (!allowlist || allowlist.length === 0) return false;
  const e = normalizeEmail(email);
  return allowlist.some((a) => a === e);
}

/**
 * Decide whether an unknown email may be created + granted membership.
 * Controlled: first-admin only when BOOTSTRAP_ADMIN_EMAIL is set, matches the
 * caller email, purpose=admin, and zero admin memberships exist (default-deny).
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
  const allow = input.bootstrapAdminEmail?.trim().toLowerCase();
  // Default-deny: controlled first-admin requires an explicit allowlist email.
  if (!allow || allow.length === 0) return false;
  if (normalizeEmail(input.email) !== allow) return false;
  const adminCount = await store.countMembershipsByRole("admin");
  return adminCount === 0;
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
  const allowlist = parseMagicLinkAllowlist(input.magicLinkAllowlist ?? null);
  const onAllowlist = isEmailOnMagicLinkAllowlist(email, allowlist);

  let user: UserRow | null = await deps.store.findUserByEmail(email);
  let grantedMembershipId: string | null = null;
  let grantedRole: EventRole | null = null;
  let isBootstrapCreate = false;
  const membershipEventIdEarly = input.eventId ?? DEFAULT_BOOTSTRAP_EVENT_ID;

  /** Provisioned program user: has membership or will be checked for participation by caller event. */
  let programReentry = false;
  if (user && policy === "controlled" && allowlist.length > 0 && !onAllowlist) {
    const membership = await deps.store.findMembership(
      membershipEventIdEarly,
      user.id,
    );
    if (membership) {
      programReentry = true;
    }
  }

  if (!user) {
    // Controlled + allowlist: testers may self-register only when listed.
    if (policy === "controlled" && allowlist.length > 0) {
      if (!onAllowlist) {
        return response;
      }
      user = await deps.store.createUser({ email });
      isBootstrapCreate = true;
    } else {
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
  } else if (
    policy === "controlled" &&
    allowlist.length > 0 &&
    !onAllowlist &&
    !programReentry
  ) {
    // Existing user but not on dogfood tester allowlist and not a provisioned
    // event member — silent no-op (no open self-serve for strangers).
    return response;
  }

  // Allowlisted existing users: ensure membership for requested purpose.
  if (user && onAllowlist && policy === "controlled") {
    const role = purposeToRole(input.purpose);
    const membership = await deps.store.upsertMembership({
      eventId: input.eventId ?? DEFAULT_BOOTSTRAP_EVENT_ID,
      userId: user.id,
      role,
    });
    grantedMembershipId = membership.id;
    grantedRole = role;
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
  // - controlled + allowlist create: grant purpose role for tester walk
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
  } else if (isBootstrapCreate && onAllowlist) {
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

  // Durable email delivery (E7): encrypt token into outbox; consumer sends.
  let mailEnqueued = false;
  if (deps.magicLinkMail?.authLinkEncryptionKey?.trim()) {
    try {
      const enc = await encryptMagicLinkToken(
        plaintext,
        deps.magicLinkMail.authLinkEncryptionKey,
      );
      await deps.magicLinkMail.comms.insertOutbox({
        id: uuidv7(),
        topic: AUTH_MAGIC_LINK_OUTBOX_TOPIC,
        payloadJson: JSON.stringify({
          magicLinkId: magicId,
          email,
          enc,
          purpose: input.purpose,
          eventId: input.eventId ?? membershipEventId,
        }),
        createdAt,
        processedAt: null,
        attempts: 0,
        lastError: null,
      });
      mailEnqueued = true;
      const kick = deps.magicLinkMail.queueKick;
      if (kick && typeof kick.send === "function") {
        try {
          await kick.send({
            kind: "auth.magic_link",
            outboxTopic: AUTH_MAGIC_LINK_OUTBOX_TOPIC,
          });
        } catch {
          // Cron backup drains if queue kick fails.
        }
      }
    } catch {
      // Fail closed on encrypt/enqueue: still return sent:true (no enumeration).
      // Link remains in DB; operator can re-request or mint.
      mailEnqueued = false;
    }
  }

  await deps.store.insertAudit({
    id: uuidv7(),
    eventId: membershipEventId,
    actorType: "system",
    actorId: "auth",
    action: "Auth.RequestMagicLink",    entityType: "magic_link",
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
      mailEnqueued,
      allowlistActive: allowlist.length > 0,
    }),
    correlationId: input.correlationId,
    createdAt,
  });

  return response;
}

/**
 * Program invite after accept — creates magic link + optional outbox for an
 * already-provisioned user. Bypasses allowlist/bootstrap (not open registration).
 * Does not create users or change memberships.
 */
export async function issueProgramInviteMagicLink(
  deps: AuthCommandDeps,
  input: {
    email: string;
    userId: string;
    eventId: string;
    purpose?: MagicLinkPurpose;
    correlationId: string;
  },
): Promise<{ magicLinkId: string; mailEnqueued: boolean }> {
  const email = normalizeEmail(input.email);
  const purpose: MagicLinkPurpose = input.purpose ?? "speaker";
  const plaintext = generateToken(32);
  const tokenHash = await hashToken(plaintext);
  const now = new Date();
  const magicId = uuidv7();
  const createdAt = now.toISOString();

  await deps.store.insertMagicLink({
    id: magicId,
    userId: input.userId,
    eventId: input.eventId,
    purpose,
    tokenHash,
    expiresAt: expiresAtMinutesFromNow(MAGIC_LINK_TTL_MINUTES, now),
    usedAt: null,
    createdAt,
  });

  deps.outbox.capture({
    email,
    purpose,
    token: plaintext,
    eventId: input.eventId,
    userId: input.userId,
    magicLinkId: magicId,
    createdAt,
  });

  let mailEnqueued = false;
  if (deps.magicLinkMail?.authLinkEncryptionKey?.trim()) {
    try {
      const enc = await encryptMagicLinkToken(
        plaintext,
        deps.magicLinkMail.authLinkEncryptionKey,
      );
      await deps.magicLinkMail.comms.insertOutbox({
        id: uuidv7(),
        topic: AUTH_MAGIC_LINK_OUTBOX_TOPIC,
        payloadJson: JSON.stringify({
          magicLinkId: magicId,
          email,
          enc,
          purpose,
          eventId: input.eventId,
        }),
        createdAt,
        processedAt: null,
        attempts: 0,
        lastError: null,
      });
      mailEnqueued = true;
      const kick = deps.magicLinkMail.queueKick;
      if (kick && typeof kick.send === "function") {
        try {
          await kick.send({
            kind: "auth.magic_link",
            outboxTopic: AUTH_MAGIC_LINK_OUTBOX_TOPIC,
          });
        } catch {
          /* cron drains */
        }
      }
    } catch {
      mailEnqueued = false;
    }
  }

  await deps.store.insertAudit({
    id: uuidv7(),
    eventId: input.eventId,
    actorType: "system",
    actorId: "auth",
    action: "Auth.ProgramInviteMagicLink",
    entityType: "magic_link",
    entityId: magicId,
    afterJson: JSON.stringify({
      email,
      purpose,
      userId: input.userId,
      mailEnqueued,
      programInvite: true,
    }),
    correlationId: input.correlationId,
    createdAt,
  });

  return { magicLinkId: magicId, mailEnqueued };
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
  // Atomic single-use: only the winner of the conditional consume may issue a session.
  const consumed = await deps.store.consumeMagicLink(link.id, usedAt);
  if (!consumed) {
    return { ok: false, reason: "used" };
  }

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
 * Auth.Logout — revoke active session and any distinct judge-origin session;
 * always succeed for cookie clear. Tokens are never logged (E10).
 */
export async function logoutSession(
  deps: AuthCommandDeps,
  input: LogoutInput,
): Promise<{ cleared: boolean }> {
  // Distinct plaintext tokens only — admin without impersonation may send the
  // same value twice if both cookies were set to one session.
  const tokens = new Set<string>();
  if (input.sessionToken) tokens.add(input.sessionToken);
  if (input.judgeSessionToken) tokens.add(input.judgeSessionToken);

  if (tokens.size === 0) {
    return { cleared: false };
  }

  let anyCleared = false;
  for (const token of tokens) {
    const tokenHash = await hashToken(token);
    const session = await deps.store.findSessionByTokenHash(tokenHash);
    const deleted = await deps.store.deleteSessionByTokenHash(tokenHash);
    if (deleted) anyCleared = true;

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
  }

  return { cleared: anyCleared };
}

/**
 * Auth.DevRoleSwitch — dogfood/dev only (section 8.4).
 *
 * Issues a session for the deterministic demo account of the requested role.
 * Caller must only invoke when the route is registered (enableRoleSwitcher).
 * Never logs tokens. Memberships must already exist (seed / prior magic-link).
 */
export type DevRoleSwitchInput = {
  role: EventRole;
  eventId?: string;
  correlationId: string;
  /**
   * When true (tests/e2e open bootstrap), create demo user + membership if missing.
   * Production dogfood with ROLE_SWITCHER_ENABLED should seed first — create=false.
   */
  allowCreate?: boolean;
};

export type DevRoleSwitchSuccess = {
  ok: true;
  sessionToken: string;
  response: DevRoleSwitchResponse;
};

export type DevRoleSwitchFailure = {
  ok: false;
  status: 404 | 403;
  error: string;
  code: string;
};

/**
 * SPA landing after a demo role mint (section 8.4 + 10.4 S-AUTH-ROLES).
 * Speaker portal requires eventId query or tasks never load (session looks "lost").
 */
function redirectForRole(role: EventRole, eventId: string): string {
  switch (role) {
    case "admin":
      return "/admin";
    case "evaluator":
      return "/eval";
    case "speaker":
      return `/portal?eventId=${encodeURIComponent(eventId)}`;
    default:
      return "/login";
  }
}

export async function devRoleSwitch(
  deps: AuthCommandDeps,
  input: DevRoleSwitchInput,
): Promise<DevRoleSwitchSuccess | DevRoleSwitchFailure> {
  const eventId = input.eventId ?? DEFAULT_BOOTSTRAP_EVENT_ID;
  const email = DEMO_ROLE_EMAILS[input.role];
  const now = new Date();
  const createdAt = now.toISOString();

  let user = await deps.store.findUserByEmail(email);
  if (!user) {
    if (!input.allowCreate) {
      return {
        ok: false,
        status: 404,
        error: "Demo role user not seeded",
        code: "ROLE_SWITCH_USER_MISSING",
      };
    }
    user = await deps.store.createUser({
      email,
      name: `Demo ${input.role}`,
    });
    await deps.store.upsertMembership({
      eventId,
      userId: user.id,
      role: input.role,
    });
  } else {
    const membership = await deps.store.findMembership(eventId, user.id);
    if (!membership || membership.role !== input.role) {
      if (!input.allowCreate) {
        return {
          ok: false,
          status: 403,
          error: "Demo user lacks requested role on event",
          code: "ROLE_SWITCH_ROLE_MISSING",
        };
      }
      await deps.store.upsertMembership({
        eventId,
        userId: user.id,
        role: input.role,
      });
    }
  }

  const sessionToken = generateToken(32);
  const sessionHash = await hashToken(sessionToken);
  const sessionId = uuidv7();
  await deps.store.insertSession({
    id: sessionId,
    userId: user.id,
    tokenHash: sessionHash,
    expiresAt: expiresAtDaysFromNow(SESSION_TTL_DAYS, now),
    createdAt,
  });

  await deps.store.insertAudit({
    id: uuidv7(),
    eventId,
    actorType: "user",
    actorId: user.id,
    action: "Auth.DevRoleSwitch",
    entityType: "auth_session",
    entityId: sessionId,
    afterJson: JSON.stringify({
      role: input.role,
      email: user.email,
      // never include sessionToken
    }),
    correlationId: input.correlationId,
    createdAt,
  });

  return {
    ok: true,
    sessionToken,
    response: {
      ok: true,
      role: input.role,
      email: user.email,
      eventId,
      redirectTo: redirectForRole(input.role, eventId),
    },
  };
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
