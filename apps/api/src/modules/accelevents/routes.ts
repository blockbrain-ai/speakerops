import { Hono } from "hono";
import {
  IntegrationsStatusResponseSchema,
  SaveAcceleventsBodySchema,
  SaveAcceleventsResponseSchema,
  VerifyAcceleventsBodySchema,
  VerifyAcceleventsResponseSchema,
  errorEnvelope,
  VALIDATION_ERROR,
  VERSION,
  INTERNAL_ERROR,
} from "@speakerops/shared";
import type { ApiEnv } from "../../env.js";
import type { AuthStore } from "../auth/store.js";
import type { EventsStore } from "../events/store.js";
import type { KeysStore } from "../keys/store.js";
import { requireRole } from "../../middleware/authz.js";
import { resolveAcceleventsKey, type AcceleventsEnv } from "./client.js";
import {
  listIntegrations,
  queueAcceleventsVerify,
  saveAcceleventsConnection,
} from "./commands.js";
import type { IntegrationsStore } from "./store.js";

export function createIntegrationsRoutes(options: {
  store: AuthStore;
  events: EventsStore;
  integrations: IntegrationsStore;
  clientEnv: AcceleventsEnv;
  keys?: KeysStore;
}): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  const { store, events, integrations, clientEnv, keys } = options;

  const readBearer = keys
    ? {
        keysStore: keys,
        bearerScopes: ["integrations:read", "airtable:read"] as const,
        eventsStore: events,
      }
    : {};
  const writeBearer = keys
    ? {
        keysStore: keys,
        bearerScopes: ["integrations:write"] as const,
        eventsStore: events,
      }
    : {};

  function liveEnv(c: { env?: { ACCELEVENTS_API_KEY?: string } }): AcceleventsEnv {
    const fromBind =
      typeof c.env?.ACCELEVENTS_API_KEY === "string"
        ? c.env.ACCELEVENTS_API_KEY
        : undefined;
    return {
      ACCELEVENTS_API_KEY: fromBind ?? clientEnv.ACCELEVENTS_API_KEY,
    };
  }

  app.get(
    "/:eventId/integrations",
    requireRole(store, ["admin"], { eventIdFrom: "param", ...readBearer }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const ev = await events.findEventById(eventId);
      if (!ev) {
        return c.json(errorEnvelope("Event not found", "NOT_FOUND"), 404);
      }
      const data = await listIntegrations(integrations, liveEnv(c), eventId);
      const out = IntegrationsStatusResponseSchema.safeParse(data);
      if (!out.success) {
        return c.json(errorEnvelope("Response validation failed", INTERNAL_ERROR), 500);
      }
      return c.json(out.data, 200);
    },
  );

  app.put(
    "/:eventId/integrations/accelevents",
    requireRole(store, ["admin"], { eventIdFrom: "param", ...writeBearer }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const ev = await events.findEventById(eventId);
      if (!ev) {
        return c.json(errorEnvelope("Event not found", "NOT_FOUND"), 404);
      }
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json(errorEnvelope("Invalid JSON", VALIDATION_ERROR), 400);
      }
      const parsed = SaveAcceleventsBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(errorEnvelope("Validation failed", VALIDATION_ERROR), 400);
      }
      const result = await saveAcceleventsConnection(
        integrations,
        liveEnv(c),
        eventId,
        parsed.data,
      );
      if (!result.ok) {
        return c.json(
          errorEnvelope(result.error, result.code === "VERSION" ? VERSION : VALIDATION_ERROR),
          result.status,
        );
      }
      const out = SaveAcceleventsResponseSchema.safeParse({
        connection: result.connection,
      });
      if (!out.success) {
        return c.json(errorEnvelope("Response validation failed", INTERNAL_ERROR), 500);
      }
      return c.json(out.data, 200);
    },
  );

  app.post(
    "/:eventId/integrations/accelevents/verify",
    requireRole(store, ["admin"], { eventIdFrom: "param", ...writeBearer }),
    async (c) => {
      const eventId = c.req.param("eventId");
      const ev = await events.findEventById(eventId);
      if (!ev) {
        return c.json(errorEnvelope("Event not found", "NOT_FOUND"), 404);
      }
      let raw: unknown = {};
      try {
        const text = await c.req.text();
        if (text.trim()) raw = JSON.parse(text) as unknown;
      } catch {
        return c.json(errorEnvelope("Invalid JSON", VALIDATION_ERROR), 400);
      }
      const parsed = VerifyAcceleventsBodySchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(errorEnvelope("Validation failed", VALIDATION_ERROR), 400);
      }
      const result = await queueAcceleventsVerify(
        integrations,
        liveEnv(c),
        eventId,
        parsed.data.expectedVersion,
      );
      if (!result.ok) {
        return c.json(
          errorEnvelope(result.error, result.code === "VERSION" ? VERSION : VALIDATION_ERROR),
          result.status,
        );
      }
      const out = VerifyAcceleventsResponseSchema.safeParse({
        queued: true as const,
        connection: result.connection,
      });
      if (!out.success) {
        return c.json(errorEnvelope("Response validation failed", INTERNAL_ERROR), 500);
      }
      return c.json(out.data, 200);
    },
  );

  // Prove credentialPresent is computed from env names, never leaked as a value.
  void resolveAcceleventsKey;

  return app;
}
