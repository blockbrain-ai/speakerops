/**
 * Minimal OpenAPI 3.0 document for domain commands (section 3.1+).
 *
 * Full generation is Phase 7 (CLI12); 3.1 requires Form commands listed.
 * Paths match COMMANDS.md HTTP route map.
 */
import type { Hono } from "hono";
import type { ApiEnv } from "./env.js";

/** OpenAPI paths for Form.* commands (section 3.1). */
export const FORM_OPENAPI_PATHS = {
  "/api/events/{eventId}/forms": {
    post: {
      operationId: "Form.Create",
      summary: "Form.Create",
      description: "Create event-scoped form shell + empty draft version",
      tags: ["Form"],
      parameters: [
        {
          name: "eventId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["name"],
              properties: {
                name: { type: "string", minLength: 1, maxLength: 200 },
              },
            },
          },
        },
      },
      responses: {
        "201": { description: "Form + draft created" },
        "400": { description: "Validation error (E4)" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Event not found / no membership" },
      },
    },
  },
  "/api/forms/{formId}/draft": {
    put: {
      operationId: "Form.UpdateDraftFields",
      summary: "Form.UpdateDraftFields",
      description:
        "Replace draft fields and category routing rules; does not mutate published snapshot_json",
      tags: ["Form"],
      parameters: [
        {
          name: "formId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["fields"],
              properties: {
                fields: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["fieldKey", "type", "label"],
                    properties: {
                      fieldKey: {
                        type: "string",
                        description: "Stable key for submission_answers",
                      },
                      type: { type: "string" },
                      label: { type: "string" },
                      required: { type: "boolean" },
                      options: { type: "array" },
                      sortOrder: { type: "integer" },
                      conditions: { type: "object" },
                    },
                  },
                },
                rules: {
                  type: "array",
                  description: "Category routing rules",
                  items: {
                    type: "object",
                    required: ["when", "routeToCategory"],
                    properties: {
                      when: { type: "object" },
                      routeToCategory: { type: "string" },
                    },
                  },
                },
                welcomeMd: { type: "string", nullable: true },
                thankYouMd: { type: "string", nullable: true },
                opensAt: { type: "string", format: "date-time", nullable: true },
                closesAt: {
                  type: "string",
                  format: "date-time",
                  nullable: true,
                },
                submissionLimit: { type: "integer", nullable: true },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Draft form version" },
        "400": { description: "Validation error (invalid condition field_key)" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Form not found / no membership" },
      },
    },
  },
  "/api/forms/{formId}/publish": {
    post: {
      operationId: "Form.Publish",
      summary: "Form.Publish",
      description:
        "Publish draft as immutable form_versions row (version_num++); freezes snapshot_json",
      tags: ["Form"],
      parameters: [
        {
          name: "formId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": { description: "Immutable published form version" },
        "400": { description: "Validation error" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Form not found / no membership" },
      },
    },
  },
  "/api/public/cfp/{slug}": {
    get: {
      operationId: "Form.GetPublic",
      summary: "Form.GetPublic",
      description:
        "Latest published form for event slug (never draft) + window/meta (3.3)",
      tags: ["Form"],
      parameters: [
        {
          name: "slug",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": { description: "Published form or null when none" },
        "404": { description: "Event slug not found" },
      },
    },
  },
  "/api/public/cfp/{slug}/submissions": {
    post: {
      operationId: "Submission.Create",
      summary: "Submission.Create",
      description:
        "Public multi-speaker CFP submit with Turnstile, form_version pin, rate limit",
      tags: ["Submission"],
      parameters: [
        {
          name: "slug",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["formVersionId", "title", "speakers", "turnstileToken"],
              properties: {
                formVersionId: { type: "string" },
                title: { type: "string" },
                answers: { type: "array" },
                speakers: { type: "array" },
                turnstileToken: { type: "string" },
                category: { type: "string", nullable: true },
              },
            },
          },
        },
      },
      responses: {
        "201": { description: "Submission created" },
        "400": {
          description:
            "Validation / closed window / Turnstile / wrong form_version pin",
        },
        "404": { description: "Event slug not found" },
        "429": { description: "Rate limited (X-RateLimit-* headers)" },
      },
    },
  },
  "/api/public/cfp/{slug}/files": {
    post: {
      operationId: "Cfp.FileUpload",
      summary: "Cfp.FileUpload",
      description: "Public supporting file upload (mime allowlist + size)",
      tags: ["Submission"],
      parameters: [
        {
          name: "slug",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "201": { description: "File stored" },
        "400": { description: "Type/size rejected" },
        "404": { description: "Event slug not found" },
        "429": { description: "Rate limited" },
      },
    },
  },
} as const;

/** Commands registered in the OpenAPI document (expand per section). */
export const OPENAPI_COMMANDS = [
  "Form.Create",
  "Form.UpdateDraftFields",
  "Form.Publish",
  "Form.GetPublic",
  "Submission.Create",
  "Cfp.FileUpload",
] as const;

export function buildOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.0.3",
    info: {
      title: "SpeakerOps API",
      version: "0.1.0",
      description:
        "Domain commands from COMMANDS.md. Form builder (3.1) + public submit (3.3).",
    },
    paths: {
      ...FORM_OPENAPI_PATHS,
    },
    tags: [
      { name: "Form", description: "CFP form builder (S-CFP / 3.1)" },
      { name: "Submission", description: "Public CFP submit (S-CFP / 3.3)" },
    ],
    "x-speakerops-commands": [...OPENAPI_COMMANDS],
  };
}

/**
 * Register GET /openapi.json on the app.
 * Public document (no auth) so agents can discover Form command paths.
 */
export function registerOpenApiRoute(app: Hono<ApiEnv>): void {
  app.get("/openapi.json", (c) => {
    return c.json(buildOpenApiDocument(), 200);
  });
}
