/**
 * Form builder HTTP routes (section 3.1).
 *
 * POST /api/events/:eventId/forms   → Form.Create
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
import { requireRole } from "../../middleware/authz.js";
import {
  createForm,
  updateDraftFields,
  publishForm,
  getPublicForm,
} from "./commands.js";

export type FormsRouteOptions = {
  store: AuthStore;
  events: EventsStore;
  forms: FormsStore;
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
 * Form.Create mounted under /api/events
 * Path: POST /:eventId/forms
 */
export function createEventFormsRoutes(
  options: FormsRouteOptions,
): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const { store, events, forms } = options;
  const deps = { forms, events, auth: store };

  /**
   * POST /:eventId/forms — Form.Create (admin / cfp:write via admin role)
   */
  app.post(
    "/:eventId/forms",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
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
 * Paths: PUT /:formId/draft, POST /:formId/publish
 */
export function createFormsRoutes(options: FormsRouteOptions): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const { store, events, forms } = options;
  const deps = { forms, events, auth: store };

  /**
   * Resolve form → event membership for formId-scoped routes.
   */
  async function requireAdminOnForm(
    c: Context<ApiEnv>,
    formId: string,
  ): Promise<
    | { ok: true; user: { id: string; email: string }; eventId: string }
    | { ok: false; response: Response }
  > {
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

    const form = await forms.findFormById(formId);
    if (!form) {
      return {
        ok: false,
        response: c.json(errorEnvelope("Not found", NOT_FOUND), 404),
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
   * PUT /:formId/draft — Form.UpdateDraftFields
   */
  app.put(
    "/:formId/draft",
    requireRole(store, ["admin"], { eventIdFrom: "none" }),
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
    requireRole(store, ["admin"], { eventIdFrom: "none" }),
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
   */
  app.get("/cfp/:slug", async (c) => {
    const slug = c.req.param("slug");
    const result = await getPublicForm(deps, slug);
    if (!result.ok) {
      return commandError(c, result);
    }
    const envSiteKey =
      typeof c.env?.TURNSTILE_SITE_KEY === "string" &&
      c.env.TURNSTILE_SITE_KEY.trim().length > 0
        ? c.env.TURNSTILE_SITE_KEY.trim()
        : undefined;
    const payload = {
      ...result.value,
      turnstileSiteKey: envSiteKey ?? result.value.turnstileSiteKey ?? TURNSTILE_TEST_SITE_KEY,
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
