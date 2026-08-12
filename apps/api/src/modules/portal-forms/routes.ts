/**
 * N1 Portal Forms HTTP routes.
 *
 * Admin:
 *   GET    /api/events/:eventId/portal-forms
 *   POST   /api/events/:eventId/portal-forms
 *   PATCH  /api/events/:eventId/portal-forms/:formId
 *   DELETE /api/events/:eventId/portal-forms/:formId
 * Speaker:
 *   GET    /api/portal/forms?eventId=
 *   POST   /api/portal/forms/:formId/responses
 */
import { Hono } from "hono";
import {
  PortalFormCreateBodySchema,
  PortalFormUpdateBodySchema,
  PortalFormDtoSchema,
  PortalFormListResponseSchema,
  PortalFormSubmitBodySchema,
  PortalFormResponseDtoSchema,
  errorEnvelope,
  VALIDATION_ERROR,
  NOT_FOUND,
  CONFLICT,
  FORBIDDEN,
  uuidv7,
  type PortalFormDto,
  type PortalFormField,
} from "@speakerops/shared";
import type { ApiEnv } from "../../env.js";
import type { AuthStore } from "../auth/store.js";
import type { EventsStore } from "../events/store.js";
import type { SubmissionsStore } from "../publicCfp/store.js";
import type { DecisionsStore } from "../decisions/store.js";
import { requireRole, requireSession } from "../../middleware/authz.js";
import type { PortalFormsStore } from "./store.js";

function parseFields(json: string): PortalFormField[] {
  try {
    const raw: unknown = JSON.parse(json);
    if (!Array.isArray(raw)) return [];
    // Normalize partial field rows so DTO parse never throws 500.
    return raw
      .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
      .map((f) => ({
        key: String(f.key ?? ""),
        label: String(f.label ?? f.key ?? "Field"),
        type: (["text", "textarea", "url", "checkbox"].includes(
          String(f.type),
        )
          ? String(f.type)
          : "text") as PortalFormField["type"],
        required: Boolean(f.required),
        help: typeof f.help === "string" ? f.help : undefined,
      }))
      .filter((f) => f.key.length > 0);
  } catch {
    return [];
  }
}

function toDto(row: {
  id: string;
  eventId: string;
  title: string;
  description: string | null;
  scope: "participation" | string;
  status: "draft" | "published" | "archived" | string;
  fieldsJson: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}): PortalFormDto {
  const status =
    row.status === "published" || row.status === "archived"
      ? row.status
      : "draft";
  return {
    id: row.id,
    eventId: row.eventId,
    title: row.title,
    description: row.description ?? null,
    scope: "participation",
    status,
    fields: parseFields(row.fieldsJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
  };
}

function jsonDto(row: Parameters<typeof toDto>[0]) {
  const dto = toDto(row);
  const parsed = PortalFormDtoSchema.safeParse(dto);
  if (!parsed.success) {
    // Never 500 the client on response shape — strip to safe subset.
    return {
      ...dto,
      fields: dto.fields.filter((f) => /^[a-z][a-z0-9_]*$/.test(f.key)),
    };
  }
  return parsed.data;
}

export type PortalFormsRouteOptions = {
  store: AuthStore;
  events: EventsStore;
  portalForms: PortalFormsStore;
  submissions: SubmissionsStore;
  decisions: DecisionsStore;
};

export function createPortalFormsAdminRoutes(
  options: PortalFormsRouteOptions,
): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const { store, events, portalForms } = options;

  app.get(
    "/:eventId/portal-forms",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const event = await events.findEventById(eventId);
      if (!event) {
        return c.json(errorEnvelope("Event not found", NOT_FOUND), 404);
      }
      const rows = await portalForms.listForms(eventId);
      const body = PortalFormListResponseSchema.safeParse({
        forms: rows.map((r) => jsonDto(r)),
      });
      return c.json(
        body.success ? body.data : { forms: rows.map((r) => jsonDto(r)) },
        200,
      );
    },
  );

  app.post(
    "/:eventId/portal-forms",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const event = await events.findEventById(eventId);
      if (!event) {
        return c.json(errorEnvelope("Event not found", NOT_FOUND), 404);
      }
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json(errorEnvelope("Invalid JSON body", VALIDATION_ERROR), 400);
      }
      const parsed = PortalFormCreateBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, parsed.error.flatten()),
          400,
        );
      }
      const now = new Date().toISOString();
      const row = await portalForms.insertForm({
        id: uuidv7(),
        eventId,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        scope: "participation",
        status: "draft",
        fieldsJson: JSON.stringify(parsed.data.fields ?? []),
        createdAt: now,
        updatedAt: now,
        version: 1,
      });
      const user = c.get("user");
      await store.insertAudit({
        id: uuidv7(),
        eventId,
        actorType: "user",
        actorId: user?.id ?? "unknown",
        action: "PortalForm.Create",
        entityType: "portal_form",
        entityId: row.id,
        beforeJson: null,
        afterJson: JSON.stringify({ title: row.title }),
        correlationId: c.get("correlationId") ?? "unknown",
        createdAt: now,
      });
      return c.json(jsonDto(row), 201);
    },
  );

  app.patch(
    "/:eventId/portal-forms/:formId",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const formId = c.req.param("formId");
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json(errorEnvelope("Invalid JSON body", VALIDATION_ERROR), 400);
      }
      const parsed = PortalFormUpdateBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          errorEnvelope("Validation failed", VALIDATION_ERROR, parsed.error.flatten()),
          400,
        );
      }
      const now = new Date().toISOString();
      try {
        const patch: {
          title?: string;
          description?: string | null;
          status?: "draft" | "published" | "archived";
          fieldsJson?: string;
          updatedAt: string;
        } = { updatedAt: now };
        if (parsed.data.title !== undefined) patch.title = parsed.data.title;
        if (parsed.data.description !== undefined) {
          patch.description = parsed.data.description;
        }
        if (parsed.data.status !== undefined) patch.status = parsed.data.status;
        if (parsed.data.fields !== undefined) {
          patch.fieldsJson = JSON.stringify(parsed.data.fields);
        }
        const updated = await portalForms.updateForm(
          eventId,
          formId,
          parsed.data.expectedVersion,
          patch,
        );
        if (!updated) {
          return c.json(
            errorEnvelope("Version conflict or not found", CONFLICT),
            409,
          );
        }
        return c.json(jsonDto(updated), 200);
      } catch (err) {
        return c.json(
          errorEnvelope(
            err instanceof Error ? err.message : "Portal form update failed",
            "INTERNAL_ERROR",
          ),
          500,
        );
      }
    },
  );

  app.delete(
    "/:eventId/portal-forms/:formId",
    requireRole(store, ["admin"], { eventIdFrom: "param" }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const formId = c.req.param("formId");
      const ok = await portalForms.deleteForm(eventId, formId);
      if (!ok) {
        return c.json(errorEnvelope("Form not found", NOT_FOUND), 404);
      }
      return c.body(null, 204);
    },
  );

  return app;
}

export function createPortalFormsSpeakerRoutes(
  options: PortalFormsRouteOptions,
): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const { store, portalForms, decisions, submissions } = options;

  app.get("/forms", requireSession(store), async (c) => {
    const eventId = c.req.query("eventId")?.trim();
    if (!eventId) {
      return c.json(
        errorEnvelope("eventId query required", VALIDATION_ERROR),
        400,
      );
    }
    const user = c.get("user");
    if (!user) {
      return c.json(errorEnvelope("Authentication required", "UNAUTHORIZED"), 401);
    }
    const membership = await store.findMembership(eventId, user.id);
    if (!membership || membership.role !== "speaker") {
      return c.json(errorEnvelope("Speaker membership required", FORBIDDEN), 403);
    }
    const rows = await portalForms.listForms(eventId);
    const published = rows.filter((f) => f.status === "published");
    return c.json({ forms: published.map((r) => jsonDto(r)) }, 200);
  });

  app.post("/forms/:formId/responses", requireSession(store), async (c) => {
    const formId = c.req.param("formId");
    const user = c.get("user");
    if (!user) {
      return c.json(errorEnvelope("Authentication required", "UNAUTHORIZED"), 401);
    }
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(errorEnvelope("Invalid JSON body", VALIDATION_ERROR), 400);
    }
    const parsed = PortalFormSubmitBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        errorEnvelope("Validation failed", VALIDATION_ERROR, parsed.error.flatten()),
        400,
      );
    }
    const { participationId, answers } = parsed.data;

    const part = await decisions.findParticipationById(participationId);
    if (!part) {
      return c.json(errorEnvelope("Participation not found", NOT_FOUND), 404);
    }
    const eventId = part.eventId;

    const membership = await store.findMembership(eventId, user.id);
    if (
      !membership ||
      (membership.role !== "speaker" && membership.role !== "admin")
    ) {
      return c.json(errorEnvelope("Insufficient role", FORBIDDEN), 403);
    }

    if (membership.role === "speaker") {
      const person = await submissions.findPersonById(part.personId);
      const email =
        person && "email" in person && typeof person.email === "string"
          ? person.email
          : null;
      if (
        !email ||
        email.toLowerCase() !== user.email.toLowerCase()
      ) {
        // Also allow if participation is linked to userId
        if (part.userId !== user.id) {
          return c.json(
            errorEnvelope("You do not own this participation", FORBIDDEN),
            403,
          );
        }
      }
    }

    const form = await portalForms.getForm(eventId, formId);
    if (!form || form.status !== "published") {
      return c.json(errorEnvelope("Form not found", NOT_FOUND), 404);
    }

    const fields = parseFields(form.fieldsJson);
    for (const f of fields) {
      if (f.required) {
        const v = answers[f.key];
        if (v === undefined || v === null || v === "") {
          return c.json(
            errorEnvelope(`Missing required field: ${f.key}`, VALIDATION_ERROR),
            400,
          );
        }
      }
    }

    const now = new Date().toISOString();
    const existing = await portalForms.getResponse(formId, participationId);
    const row = await portalForms.upsertResponse({
      id: existing?.id ?? uuidv7(),
      formId,
      eventId,
      participationId,
      answersJson: JSON.stringify(answers),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      version: existing ? existing.version + 1 : 1,
    });

    return c.json(
      PortalFormResponseDtoSchema.parse({
        id: row.id,
        formId: row.formId,
        eventId: row.eventId,
        participationId: row.participationId,
        answers,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        version: row.version,
      }),
      existing ? 200 : 201,
    );
  });

  return app;
}
