/**
 * Form builder HTTP routes (section 3.1).
 *
 * POST /api/events/:eventId/forms   → Form.Create
 * GET  /api/events/:eventId/forms   → Form.List (admin)
 * GET  /api/forms/:formId           → Form.GetAdmin (admin draft detail)
 * PUT  /api/forms/:formId/draft     → Form.UpdateDraftFields
 * POST /api/forms/:formId/publish   → Form.Publish
 * GET  /api/public/cfp/:slug        → Form.GetPublic
 *
 * Canonical registry: KMS-competition/initiative/contracts/COMMANDS.md
 */
import { Hono, type Context } from "hono";
import {
  FormCreateBodySchema,
  FormCreateResponseSchema,
  FormUpdateDraftBodySchema,
  FormUpdateDraftResponseSchema,
  FormPublishResponseSchema,
  FormListResponseSchema,
  FormAdminGetResponseSchema,
  PublicCfpResponseSchema,
  TURNSTILE_TEST_SITE_KEY,
  errorEnvelope,
  VALIDATION_ERROR,
  INTERNAL_ERROR,
  NOT_FOUND,
  CONFLICT,
  type ErrorCode,
} from "@speakerops/shared";
import type { ApiEnv } from "../../env.js";
import type { AuthStore } from "../auth/store.js";
import type { EventsStore } from "../events/store.js";
import type { FormsStore } from "./store.js";
import type { KeysStore } from "../keys/store.js";
import { requireRole } from "../../middleware/authz.js";
import {
  createForm,
  updateDraftFields,
  publishForm,
  getPublicForm,
  listFormsForEvent,
  getFormAdmin,
} from "./commands.js";

export type FormsRouteOptions = {
  store: AuthStore;
  events: EventsStore;
  forms: FormsStore;
  /** Bearer cfp:read / cfp:write for CLI (7.2). */
  keys?: KeysStore;
};

function commandError(
  c: Context<ApiEnv>,
  err: { status: 400 | 404 | 409; error: string; code: string; details?: unknown },
) {
  const code: ErrorCode =
    err.code === "CONFLICT"
      ? CONFLICT
      : err.code === "NOT_FOUND"
        ? NOT_FOUND
        : (err.code as ErrorCode);
  return c.json(errorEnvelope(err.error, code, err.details), err.status);
}

/**
 * Form.Create / Form.List mounted under /api/events
 * Paths: POST /:eventId/forms, GET /:eventId/forms
 */
export function createEventFormsRoutes(
  options: FormsRouteOptions,
): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const { store, events, forms, keys } = options;
  const deps = { forms, events, auth: store };
  const bearerRead = keys
    ? {
        keysStore: keys,
        bearerScopes: ["cfp:read", "cfp:write"] as const,
        eventsStore: events,
      }
    : {};
  const bearerWrite = keys
    ? {
        keysStore: keys,
        bearerScopes: ["cfp:write"] as const,
        eventsStore: events,
      }
    : {};

  /**
   * GET /:eventId/forms — Form.List (admin / cfp:read; builder reload)
   */
  app.get(
    "/:eventId/forms",
    requireRole(store, ["admin"], { eventIdFrom: "param", ...bearerRead }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const result = await listFormsForEvent(deps, eventId);
      if (!result.ok) {
        return commandError(c, result);
      }
      const out = FormListResponseSchema.safeParse(result.value);
      if (!out.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }
      return c.json(out.data, 200);
    },
  );

  /**
   * POST /:eventId/forms — Form.Create (admin / cfp:write)
   */
  app.post(
    "/:eventId/forms",
    requireRole(store, ["admin"], { eventIdFrom: "param", ...bearerWrite }),
    async (c) => {
      const user = c.get("user");
      if (!user) {
        return c.json(
          errorEnvelope("Authentication required", "UNAUTHORIZED"),
          401,
        );
      }

      const eventId = c.req.param("eventId");
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json(
          errorEnvelope("Invalid JSON body", VALIDATION_ERROR),
          400,
        );
      }

      const parsed = FormCreateBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, {
            issues: parsed.error.flatten(),
          }),
          400,
        );
      }

      const result = await createForm(deps, {
        ...parsed.data,
        eventId,
        actorUserId: user.id,
        correlationId: c.get("correlationId"),
      });

      if (!result.ok) {
        return commandError(c, result);
      }

      const out = FormCreateResponseSchema.safeParse(result.value);
      if (!out.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }
      return c.json(out.data, 201);
    },
  );

  return app;
}

/**
 * Form draft/publish routes mounted at /api/forms
 * Paths: GET /:formId, PUT /:formId/draft, POST /:formId/publish
 */
export function createFormsRoutes(options: FormsRouteOptions): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const { store, events, forms, keys } = options;
  const deps = { forms, events, auth: store };
  const bearerRead = keys
    ? {
        keysStore: keys,
        bearerScopes: ["cfp:read", "cfp:write"] as const,
        eventsStore: events,
      }
    : {};
  const bearerWrite = keys
    ? {
        keysStore: keys,
        bearerScopes: ["cfp:write"] as const,
        eventsStore: events,
      }
    : {};

  /**
   * Resolve form → event membership (session) or API key event binding (Bearer).
   */
  async function requireAdminOnForm(
    c: Context<ApiEnv>,
    formId: string,
  ): Promise<
    | { ok: true; user: { id: string; email: string }; eventId: string }
    | { ok: false; response: Response }
  > {
    const form = await forms.findFormById(formId);
    if (!form) {
      return {
        ok: false,
        response: c.json(errorEnvelope("Not found", NOT_FOUND), 404),
      };
    }

    const apiKey = c.get("apiKey");
    if (apiKey) {
      if (apiKey.eventId && apiKey.eventId !== form.eventId) {
        return {
          ok: false,
          response: c.json(errorEnvelope("Not found", NOT_FOUND), 404),
        };
      }
      if (!apiKey.eventId) {
        const event = await events.findEventById(form.eventId);
        if (!event || event.orgId !== apiKey.orgId) {
          return {
            ok: false,
            response: c.json(errorEnvelope("Not found", NOT_FOUND), 404),
          };
        }
      }
      return {
        ok: true,
        user: { id: apiKey.createdBy, email: "" },
        eventId: form.eventId,
      };
    }

    const user = c.get("user");
    if (!user) {
      return {
        ok: false,
        response: c.json(
          errorEnvelope("Authentication required", "UNAUTHORIZED"),
          401,
        ),
      };
    }

    const membership = await store.findMembership(form.eventId, user.id);
    if (!membership) {
      // Cross-event isolation: no membership → 404
      return {
        ok: false,
        response: c.json(errorEnvelope("Not found", NOT_FOUND), 404),
      };
    }
    if (membership.role !== "admin") {
      return {
        ok: false,
        response: c.json(
          errorEnvelope("Insufficient role", "FORBIDDEN", {
            required: ["admin"],
            role: membership.role,
          }),
          403,
        ),
      };
    }

    return { ok: true, user, eventId: form.eventId };
  }

  /**
   * GET /:formId — Form.GetAdmin (draft detail for builder reload)
   */
  app.get(
    "/:formId",
    requireRole(store, ["admin"], { eventIdFrom: "none", ...bearerRead }),
    async (c) => {
      const formId = c.req.param("formId");
      const gate = await requireAdminOnForm(c, formId);
      if (!gate.ok) return gate.response;

      const result = await getFormAdmin(deps, formId);
      if (!result.ok) {
        return commandError(c, result);
      }

      const out = FormAdminGetResponseSchema.safeParse(result.value);
      if (!out.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }
      return c.json(out.data, 200);
    },
  );

  /**
   * PUT /:formId/draft — Form.UpdateDraftFields
   */
  app.put(
    "/:formId/draft",
    requireRole(store, ["admin"], { eventIdFrom: "none", ...bearerWrite }),
    async (c) => {
      const formId = c.req.param("formId");
      const gate = await requireAdminOnForm(c, formId);
      if (!gate.ok) return gate.response;

      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json(
          errorEnvelope("Invalid JSON body", VALIDATION_ERROR),
          400,
        );
      }

      const parsed = FormUpdateDraftBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, {
            issues: parsed.error.flatten(),
          }),
          400,
        );
      }

      const result = await updateDraftFields(deps, {
        ...parsed.data,
        formId,
        actorUserId: gate.user.id,
        correlationId: c.get("correlationId"),
      });

      if (!result.ok) {
        return commandError(c, result);
      }

      const out = FormUpdateDraftResponseSchema.safeParse(result.value);
      if (!out.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }
      return c.json(out.data, 200);
    },
  );

  /**
   * POST /:formId/publish — Form.Publish (immutable form_versions row)
   */
  app.post(
    "/:formId/publish",
    requireRole(store, ["admin"], { eventIdFrom: "none", ...bearerWrite }),
    async (c) => {
      const formId = c.req.param("formId");
      const gate = await requireAdminOnForm(c, formId);
      if (!gate.ok) return gate.response;

      // Body optional
      try {
        const text = await c.req.text();
        if (text.trim().length > 0) {
          JSON.parse(text);
        }
      } catch {
        return c.json(
          errorEnvelope("Invalid JSON body", VALIDATION_ERROR),
          400,
        );
      }

      const result = await publishForm(deps, {
        formId,
        actorUserId: gate.user.id,
        correlationId: c.get("correlationId"),
      });

      if (!result.ok) {
        return commandError(c, result);
      }

      const out = FormPublishResponseSchema.safeParse(result.value);
      if (!out.success) {
        return c.json(
          errorEnvelope("Response validation failed", INTERNAL_ERROR),
          500,
        );
      }
      return c.json(out.data, 200);
    },
  );

  return app;
}

/**
 * Public CFP form route — published only.
 * Mounted at /api/public
 */
export function createPublicFormsRoutes(
  options: FormsRouteOptions,
): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const deps = {
    forms: options.forms,
    events: options.events,
    auth: options.store,
  };

  /**
   * GET /cfp/:slug — Form.GetPublic (no auth).
   * Never returns draft fields/rules (S-CFP published surface only).
   * turnstileSiteKey comes from TURNSTILE_SITE_KEY env when set (production widget).
   * DEMO_MODE=1 forces Cloudflare always-pass test site key (section 10.3) so the
   * SPA shows the interactive test control and submits TURNSTILE_DEV_PASS_TOKEN.
   */
  app.get("/cfp/:slug", async (c) => {
    const slug = c.req.param("slug");
    const result = await getPublicForm(deps, slug);
    if (!result.ok) {
      return commandError(c, result);
    }
    const demoMode =
      typeof c.env?.DEMO_MODE === "string" && c.env.DEMO_MODE.trim() === "1";
    const envSiteKey =
      !demoMode &&
      typeof c.env?.TURNSTILE_SITE_KEY === "string" &&
      c.env.TURNSTILE_SITE_KEY.trim().length > 0
        ? c.env.TURNSTILE_SITE_KEY.trim()
        : undefined;
    const payload = {
      ...result.value,
      turnstileSiteKey: demoMode
        ? TURNSTILE_TEST_SITE_KEY
        : (envSiteKey ??
          result.value.turnstileSiteKey ??
          TURNSTILE_TEST_SITE_KEY),
    };
    const out = PublicCfpResponseSchema.safeParse(payload);
    if (!out.success) {
      return c.json(
        errorEnvelope("Response validation failed", INTERNAL_ERROR),
        500,
      );
    }
    return c.json(out.data, 200);
  });

  return app;
}
