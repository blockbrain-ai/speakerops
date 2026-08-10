/**
 * OpenAPI 3.0 document for domain commands (section 7.2 / CLI12).
 *
 * Paths match COMMANDS.md HTTP route map. Served at GET /openapi.json.
 * Includes /api/events (Event.List) for agent discovery.
 */
import type { Hono } from "hono";
import type { ApiEnv } from "./env.js";

/**
 * Auth.* OpenAPI paths (section 8.4 dogfood role switcher).
 * Route is absent (404) unless ROLE_SWITCHER_ENABLED / enableRoleSwitcher.
 */
export const AUTH_OPENAPI_PATHS = {
  "/api/auth/judge-access": {
    post: {
      operationId: "Auth.JudgeAccess",
      summary: "Auth.JudgeAccess",
      description:
        "Competition judge entry (shared demo only): exchange the access code " +
        "(JUDGE_ACCESS_CODE secret, provided in the submission) for a 4-hour " +
        "session as a seeded demo persona on the demo event. Registered only " +
        "when ROLE_SWITCHER_ENABLED=1 AND the code secret are set; 404 " +
        "otherwise. Constant-time code compare; generic 401 failures; " +
        "rate-limited; audit event on mint; demo sessions cannot create API keys.",
      tags: ["Auth"],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["code", "role"],
              properties: {
                code: { type: "string", minLength: 8 },
                role: {
                  type: "string",
                  enum: ["admin", "evaluator", "speaker"],
                },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description:
            "Session cookie set (Max-Age 14400); { ok, role, email, eventId, redirectTo }",
        },
        "401": { description: "Invalid access code (generic)" },
        "404": { description: "Judge access disabled on this deployment" },
        "429": { description: "Rate limited" },
      },
    },
  },
  "/api/auth/dev/role-switch": {
    post: {
      operationId: "Auth.DevRoleSwitch",
      summary: "Auth.DevRoleSwitch",
      description:
        "Dogfood/dev only: issue session for seeded demo role user (admin|evaluator|speaker). " +
        "Requires ROLE_SWITCHER_ENABLED=1 on Worker or local e2e createAppWithAuth. " +
        "Production/controlled dogfood requires an existing valid session cookie " +
        "(workers.dev is not private — unauthenticated callers cannot mint event-admin). " +
        "Local e2e open bootstrap may allow unauthenticated switch. " +
        "Never registered on public production default.",
      tags: ["Auth"],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["role"],
              properties: {
                role: {
                  type: "string",
                  enum: ["admin", "evaluator", "speaker"],
                },
                eventId: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "200": {
          description: "{ ok, role, email, eventId, redirectTo } + Set-Cookie session",
        },
        "400": { description: "Validation error (E4)" },
        "401": {
          description:
            "Authentication required (controlled/production dogfood — no open admin mint)",
        },
        "403": { description: "Demo user lacks role on event" },
        "404": { description: "Route disabled or demo user not seeded" },
      },
    },
  },
} as const;

/** Event.* OpenAPI paths (section 2.3 + 7.2 CLI01). */
export const EVENT_OPENAPI_PATHS = {
  "/api/events": {
    get: {
      operationId: "Event.List",
      summary: "Event.List",
      description:
        "List events for admin memberships (or Bearer events:read). CLI: speakerops events list --json",
      tags: ["Event"],
      responses: {
        "200": { description: "events[]" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role or scope" },
      },
    },
    post: {
      operationId: "Event.Create",
      summary: "Event.Create",
      description: "Create event (admin / events:write)",
      tags: ["Event"],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["name", "timezone"],
              properties: {
                name: { type: "string" },
                timezone: { type: "string" },
                startsAt: { type: "string", nullable: true },
                endsAt: { type: "string", nullable: true },
              },
            },
          },
        },
      },
      responses: {
        "201": { description: "Event created" },
        "400": { description: "Validation error (E4)" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role or scope" },
      },
    },
  },
  "/api/events/{eventId}": {
    get: {
      operationId: "Event.Get",
      summary: "Event.Get",
      description: "Get event by id (admin / events:read)",
      tags: ["Event"],
      parameters: [
        {
          name: "eventId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": { description: "Event" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden" },
        "404": { description: "Not found" },
      },
    },
    patch: {
      operationId: "Event.Update",
      summary: "Event.Update",
      description: "Update event (admin / events:write); expectedVersion required",
      tags: ["Event"],
      parameters: [
        {
          name: "eventId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": { description: "Event updated" },
        "400": { description: "Validation error" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden" },
        "404": { description: "Not found" },
        "409": { description: "VERSION conflict" },
      },
    },
  },
} as const;

/** Design.* OpenAPI paths (section 2.4 + 7.2 CLI03–CLI05). */
export const DESIGN_OPENAPI_PATHS = {
  "/api/events/{eventId}/design": {
    get: {
      operationId: "Design.Get",
      summary: "Design.Get",
      description:
        "Draft + published design tokens. CLI: speakerops design get --event E --json",
      tags: ["Design"],
      parameters: [
        {
          name: "eventId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": { description: "{ draft, published }" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role or scope" },
        "404": { description: "Not found" },
      },
    },
    put: {
      operationId: "Design.SetDraft",
      summary: "Design.SetDraft",
      description:
        "Update draft tokens (no freeform CSS). CLI: speakerops design set --event E --brand '#4F46E5'",
      tags: ["Design"],
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
              required: ["tokens"],
              properties: {
                tokens: {
                  type: "object",
                  required: ["brand"],
                  properties: {
                    brand: { type: "string" },
                    brandSoft: { type: "string", nullable: true },
                    radius: {
                      type: "string",
                      enum: ["soft", "curvy", "round"],
                    },
                    wordmark: { type: "string", nullable: true },
                    logoFileId: { type: "string", nullable: true },
                  },
                },
                expectedVersion: { type: "integer" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Draft updated" },
        "400": { description: "Validation error (E4)" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role or scope" },
        "404": { description: "Not found" },
        "409": { description: "VERSION conflict" },
      },
    },
  },
  "/api/events/{eventId}/design/publish": {
    post: {
      operationId: "Design.Publish",
      summary: "Design.Publish",
      description:
        "Publish draft with contrast gate. CLI: speakerops design publish --event E",
      tags: ["Design"],
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
              required: ["expectedVersion"],
              properties: {
                expectedVersion: { type: "integer" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Published tokens" },
        "400": { description: "Validation / CONTRAST_FAILED" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role or scope" },
        "404": { description: "Not found" },
        "409": { description: "VERSION conflict" },
      },
    },
  },
} as const;

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
                      type: {
                        type: "string",
                        description:
                          "text|textarea|select|multiselect|checkbox|number|email|url|date|file",
                      },
                      label: { type: "string" },
                      required: { type: "boolean" },
                      options: { type: "array" },
                      sortOrder: { type: "integer" },
                      conditions: { type: "object" },
                      helpText: {
                        type: "string",
                        nullable: true,
                        maxLength: 500,
                        description:
                          "Guidance under the label on public CFP (post-11.9 depth)",
                      },
                      placeholder: {
                        type: "string",
                        nullable: true,
                        maxLength: 200,
                      },
                      maxChars: {
                        type: "integer",
                        nullable: true,
                        description:
                          "Character cap for text/textarea; enforced on Submission.Create",
                      },
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
                minSpeakers: {
                  type: "integer",
                  nullable: true,
                  minimum: 1,
                  maximum: 15,
                  description:
                    "Configurable speaker minimum (enforced against the pinned version on Submission.Create)",
                },
                maxSpeakers: {
                  type: "integer",
                  nullable: true,
                  minimum: 1,
                  maximum: 15,
                  description: "Configurable speaker maximum (1–15)",
                },
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
  "/api/public/cfp/{slug}/drafts": {
    post: {
      operationId: "Submission.SaveDraft",
      summary: "Submission.SaveDraft",
      description:
        "Public CFP draft save (title-only allowed; no Turnstile; closed window rejected)",
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
              required: ["formVersionId", "title"],
              properties: {
                formVersionId: { type: "string" },
                title: { type: "string" },
                answers: { type: "array" },
                speakers: { type: "array" },
                draftId: { type: "string" },
                category: { type: "string", nullable: true },
              },
            },
          },
        },
      },
      responses: {
        "201": { description: "Draft created" },
        "200": { description: "Draft updated" },
        "400": { description: "Validation / closed window / empty title" },
        "404": { description: "Event or draft not found" },
        "409": { description: "Version conflict" },
        "429": { description: "Rate limited" },
      },
    },
  },
  "/api/public/cfp/{slug}/drafts/{draftId}": {
    get: {
      operationId: "Submission.GetDraft",
      summary: "Submission.GetDraft",
      description:
        "Resume public CFP draft; event-scoped; non-draft status → 404",
      tags: ["Submission"],
      parameters: [
        {
          name: "slug",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "draftId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": { description: "Draft + snapshot" },
        "404": { description: "Draft not found / wrong event / not draft" },
      },
    },
  },
} as const;

/** Eval + assignment OpenAPI paths (section 3.4 / S-EVAL). */
export const EVAL_OPENAPI_PATHS = {
  "/api/events/{eventId}/eval/rubric": {
    put: {
      operationId: "Eval.UpsertRubric",
      summary: "Eval.UpsertRubric",
      description:
        "Admin create/update active eval round criteria (human rubric) + review deadline (closesAt) and evaluator instructions (post-11.9 depth)",
      tags: ["Eval"],
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
              required: ["criteria"],
              properties: {
                roundId: { type: "string" },
                name: { type: "string" },
                closesAt: {
                  type: "string",
                  format: "date-time",
                  nullable: true,
                  description:
                    "Review deadline; Eval.Score / Eval.Abstain 409 after close",
                },
                instructionsMd: {
                  type: "string",
                  nullable: true,
                  description:
                    "Evaluator guidance rendered as plain text in the queue",
                },
                criteria: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["name", "maxScore"],
                    properties: {
                      id: { type: "string" },
                      name: { type: "string" },
                      maxScore: { type: "number" },
                      weight: { type: "number" },
                      sortOrder: { type: "integer" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Rubric upserted" },
        "400": { description: "Validation error (E4)" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Event not found / no membership" },
      },
    },
    get: {
      operationId: "Eval.GetRubric",
      summary: "Eval.GetRubric",
      description: "Admin read active eval rubric for event",
      tags: ["Eval"],
      parameters: [
        {
          name: "eventId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": { description: "Round + criteria (or empty)" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Event not found / no membership" },
      },
    },
  },
  "/api/events/{eventId}/eval/rollup": {
    get: {
      operationId: "Eval.AdminRollup",
      summary: "Eval.AdminRollup",
      description:
        "Admin aggregate scores per submission for active round. Optional sort: score_desc|score_asc|title (section 10.6).",
      tags: ["Eval"],
      parameters: [
        {
          name: "eventId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "sort",
          in: "query",
          required: false,
          schema: {
            type: "string",
            enum: ["score_desc", "score_asc", "title"],
          },
        },
      ],
      responses: {
        "200": { description: "Submission rollups with aggregateScore" },
        "400": { description: "Invalid sort" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Event not found / no membership" },
      },
    },
  },
  "/api/events/{eventId}/eval/export": {
    get: {
      operationId: "Eval.ExportScores",
      summary: "Eval.ExportScores",
      description:
        "Admin CSV export of single-round scores/status (section 10.6 / S-EVAL-EXPORT). Default sort score_desc.",
      tags: ["Eval"],
      parameters: [
        {
          name: "eventId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "sort",
          in: "query",
          required: false,
          schema: {
            type: "string",
            enum: ["score_desc", "score_asc", "title"],
            default: "score_desc",
          },
        },
      ],
      responses: {
        "200": {
          description: "text/csv attachment",
          content: {
            "text/csv": {
              schema: { type: "string", format: "binary" },
            },
          },
        },
        "400": { description: "Invalid sort" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Event not found / no membership" },
      },
    },
  },
  "/api/assignments/{assignmentId}/scores": {
    post: {
      operationId: "Eval.Score",
      summary: "Eval.Score",
      description:
        "Evaluator scores assigned submission criteria (rejects value > maxScore)",
      tags: ["Eval"],
      parameters: [
        {
          name: "assignmentId",
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
              required: ["scores"],
              properties: {
                scores: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["criterionId", "value"],
                    properties: {
                      criterionId: { type: "string" },
                      value: { type: "number" },
                      comment: { type: "string", nullable: true },
                    },
                  },
                },
                comment: { type: "string", nullable: true },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Assignment scored" },
        "400": { description: "Validation / score > max" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Not assigned evaluator" },
        "404": { description: "Assignment not found" },
        "409": { description: "Review round closed (deadline passed)" },
      },
    },
  },
  "/api/me/eval-assignments/{assignmentId}/abstain": {
    post: {
      operationId: "Eval.Abstain",
      summary: "Eval.Abstain",
      description:
        "Evaluator abstains from an assigned review (owner-verified). Optional reason is visible to admins; abstained assignments leave the pending flow and never count toward score aggregates (post-11.9 depth).",
      tags: ["Eval"],
      parameters: [
        {
          name: "assignmentId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                reason: {
                  type: "string",
                  nullable: true,
                  maxLength: 2000,
                  description: "Optional reason shown to admins",
                },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Assignment abstained" },
        "400": { description: "Validation error (E4)" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Not assigned evaluator" },
        "404": { description: "Assignment not found" },
        "409": {
          description: "Already abstained or review round closed",
        },
      },
    },
  },
  "/api/me/eval-queue": {
    get: {
      operationId: "Eval.GetQueue",
      summary: "Eval.GetQueue",
      description:
        "Evaluator queue — only assignments for the current user (unassigned hidden)",
      tags: ["Eval"],
      responses: {
        "200": { description: "Assigned queue items" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Not evaluator/admin" },
      },
    },
  },
  "/api/submissions/{submissionId}/assign": {
    post: {
      operationId: "Submission.AssignEvaluators",
      summary: "Submission.AssignEvaluators",
      description: "Admin assign evaluators to a submission for the active round",
      tags: ["Eval"],
      parameters: [
        {
          name: "submissionId",
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
              required: ["userIds"],
              properties: {
                userIds: {
                  type: "array",
                  items: { type: "string" },
                },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Assignments created" },
        "400": { description: "Validation / no rubric" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Submission not found" },
      },
    },
  },
} as const;

/** Decision + admin submissions OpenAPI paths (section 3.5). */
export const DECISION_OPENAPI_PATHS = {
  "/api/submissions/{submissionId}/decision": {
    post: {
      operationId: "Decision.Record",
      summary: "Decision.Record",
      description:
        "Admin accept/reject/waitlist; accept materializes session + speaker_tasks",
      tags: ["Decision"],
      parameters: [
        {
          name: "submissionId",
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
              required: ["decision"],
              properties: {
                decision: {
                  type: "string",
                  enum: ["accept", "reject", "waitlist"],
                },
                reason: { type: "string", nullable: true },
                expectedVersion: { type: "integer" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Decision recorded (+ session/tasks on accept)" },
        "400": { description: "Validation error (E4)" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden (e.g. evaluator)" },
        "404": { description: "Submission not found" },
        "409": { description: "expectedVersion conflict" },
      },
    },
  },
  "/api/submissions/{submissionId}": {
    get: {
      operationId: "Submission.Get",
      summary: "Submission.Get",
      description: "Admin submission detail with answers, speakers, decision",
      tags: ["Decision"],
      parameters: [
        {
          name: "submissionId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": { description: "Submission detail" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Not found" },
      },
    },
  },
  "/api/events/{eventId}/submissions": {
    get: {
      operationId: "Submission.List",
      summary: "Submission.List",
      description:
        "Admin list with server-side status/category filters and page window " +
        "(limit default 25 max 100, offset default 0). Response: " +
        "{ submissions, total, limit, offset, categories } (AC-10.1-E / S-SUB-LIST).",
      tags: ["Decision"],
      parameters: [
        {
          name: "eventId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "status",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
        {
          name: "category",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
        {
          name: "limit",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
        },
        {
          name: "offset",
          in: "query",
          required: false,
          schema: { type: "integer", minimum: 0, default: 0 },
        },
      ],
      responses: {
        "200": {
          description:
            "{ submissions[], total, limit, offset, categories[] } page window",
        },
        "400": { description: "Invalid query (E4 VALIDATION_ERROR)" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Event not found" },
      },
    },
  },
  "/api/events/{eventId}/sessions/direct": {
    post: {
      operationId: "Session.CreateDirect",
      summary: "Session.CreateDirect",
      description: "Direct/sponsor session entry without CFP (E07)",
      tags: ["Decision"],
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
              required: ["title"],
              properties: {
                title: { type: "string" },
                description: { type: "string", nullable: true },
                trackId: { type: "string", nullable: true },
                speakers: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["name", "email"],
                    properties: {
                      name: { type: "string" },
                      email: { type: "string" },
                      isPrimary: { type: "boolean" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        "201": { description: "Session created" },
        "400": { description: "Validation error" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Event not found" },
      },
    },
  },
  "/api/events/{eventId}/submissions/bulk-preview": {
    post: {
      operationId: "Decision.BulkPreview",
      summary: "Decision.BulkPreview",
      description: "Preview bulk status change (E08); empty selection blocked",
      tags: ["Decision"],
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
              required: ["submissionIds", "decision"],
              properties: {
                submissionIds: {
                  type: "array",
                  items: { type: "string" },
                  minItems: 1,
                },
                decision: {
                  type: "string",
                  enum: ["accept", "reject", "waitlist"],
                },
                reason: { type: "string", nullable: true },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Preview items" },
        "400": { description: "Empty selection / validation" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
      },
    },
  },
} as const;

/** Portal + speakers + task templates OpenAPI paths (section 4.1). */
export const PORTAL_OPENAPI_PATHS = {
  "/api/portal/sessions/{sessionId}/invite.ics": {
    get: {
      operationId: "Portal.SessionIcs",
      summary: "Portal.SessionIcs",
      description:
        "Speaker-owned calendar invite download (G09). Serves text/calendar " +
        "for ONE of the signed-in speaker's own placed sessions; ownership " +
        "verified server-side (participation → session link); non-owned or " +
        "unknown sessions 404 (no existence probing); unscheduled 404. " +
        "Read-only: reuses stored invite UID/SEQUENCE when the admin comms " +
        "flow issued one, else stable UID with SEQUENCE 0.",
      tags: ["Portal"],
      parameters: [
        {
          name: "sessionId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "eventId",
          in: "query",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          description:
            "text/calendar attachment (invite.ics) with UID/SEQUENCE",
        },
        "401": { description: "Authentication required" },
        "404": { description: "Not found / not owned / not scheduled" },
      },
    },
  },
  "/api/portal/home": {
    get: {
      operationId: "Portal.GetHome",
      summary: "Portal.GetHome",
      description: "Speaker portal home: own tasks, sessions, next incomplete task",
      tags: ["Portal"],
      parameters: [
        {
          name: "eventId",
          in: "query",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": { description: "Portal home payload" },
        "400": { description: "Validation error" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Event / membership not found" },
      },
    },
  },
  "/api/portal/participations/{id}": {
    patch: {
      operationId: "Participation.UpdateProfile",
      summary: "Participation.UpdateProfile",
      description: "Speaker updates own bio/company/title (G02 field-flow)",
      tags: ["Portal"],
      parameters: [
        {
          name: "id",
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
              required: ["expectedVersion"],
              properties: {
                bio: { type: "string", nullable: true },
                company: { type: "string", nullable: true },
                title: { type: "string", nullable: true },
                headshotFileId: { type: "string", nullable: true },
                expectedVersion: { type: "integer" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Updated participation" },
        "400": { description: "Validation error" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Not own participation" },
        "409": { description: "expectedVersion conflict" },
      },
    },
  },
  "/api/portal/tasks/{taskId}/complete": {
    post: {
      operationId: "Task.Complete",
      summary: "Task.Complete",
      description: "Speaker completes own task only",
      tags: ["Portal"],
      parameters: [
        {
          name: "taskId",
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
              required: ["expectedVersion"],
              properties: {
                expectedVersion: { type: "integer" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Task completed" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Not own task" },
        "409": { description: "expectedVersion conflict" },
      },
    },
  },
  "/api/events/{eventId}/speakers": {
    get: {
      operationId: "Speakers.List",
      summary: "Speakers.List",
      description: "Admin event-scoped speakers list (N01/N02)",
      tags: ["Speakers"],
      parameters: [
        {
          name: "eventId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "q",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
        {
          name: "status",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": { description: "Speakers list" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Event not found" },
      },
    },
  },
  "/api/events/{eventId}/speakers/{participationId}": {
    get: {
      operationId: "Speakers.Get",
      summary: "Speakers.Get",
      description: "Admin speaker detail with tasks + files (N03/N04)",
      tags: ["Speakers"],
      parameters: [
        {
          name: "eventId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "participationId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": { description: "Speaker detail" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Not found" },
      },
    },
    patch: {
      operationId: "Speakers.UpdateProfile",
      summary: "Speakers.UpdateProfile",
      description:
        "Admin updates speaker programme profile (bio/company/title/headshot) on their behalf",
      tags: ["Speakers"],
      parameters: [
        {
          name: "eventId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "participationId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": { description: "Updated participation profile" },
        "400": { description: "Validation error" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Not found" },
        "409": { description: "Version conflict" },
      },
    },
  },
  "/api/events/{eventId}/task-templates": {
    get: {
      operationId: "TaskTemplate.List",
      summary: "TaskTemplate.List",
      description: "Admin list on_accept/manual task templates (O05)",
      tags: ["TaskTemplate"],
      parameters: [
        {
          name: "eventId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": { description: "Template list" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
      },
    },
    post: {
      operationId: "TaskTemplate.Create",
      summary: "TaskTemplate.Create",
      description: "Admin create task template (O05)",
      tags: ["TaskTemplate"],
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
              required: ["title"],
              properties: {
                title: { type: "string" },
                description: { type: "string", nullable: true },
                trigger: { type: "string", enum: ["on_accept", "manual"] },
                dueOffsetDays: { type: "integer" },
              },
            },
          },
        },
      },
      responses: {
        "201": { description: "Template created" },
        "400": { description: "Validation error" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
      },
    },
  },
  "/api/events/{eventId}/task-templates/{templateId}": {
    patch: {
      operationId: "TaskTemplate.Update",
      summary: "TaskTemplate.Update",
      description: "Admin update task template (O05)",
      tags: ["TaskTemplate"],
      parameters: [
        {
          name: "eventId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "templateId",
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
              required: ["expectedVersion"],
              properties: {
                title: { type: "string" },
                description: { type: "string", nullable: true },
                trigger: { type: "string", enum: ["on_accept", "manual"] },
                dueOffsetDays: { type: "integer" },
                expectedVersion: { type: "integer" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Template updated" },
        "400": { description: "Validation error" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Not found" },
        "409": { description: "expectedVersion conflict" },
      },
    },
    delete: {
      operationId: "TaskTemplate.Delete",
      summary: "TaskTemplate.Delete",
      description:
        "Admin delete task template (O05). Requires expectedVersion for E1 optimistic concurrency.",
      tags: ["TaskTemplate"],
      parameters: [
        {
          name: "eventId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "templateId",
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
              required: ["expectedVersion"],
              properties: {
                expectedVersion: { type: "integer" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Template deleted" },
        "400": { description: "Validation error" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Not found" },
        "409": { description: "expectedVersion conflict" },
      },
    },
  },
} as const;

/** File.* OpenAPI paths (section 2.4 logo + 4.2 portal headshot/slides). */
export const FILE_OPENAPI_PATHS = {
  "/api/files/presign": {
    post: {
      operationId: "File.PresignUpload",
      summary: "File.PresignUpload",
      description:
        "Create file_assets metadata + signed upload URL. Mime allowlist by purpose (logo PNG; headshot jpeg/png; slides pdf). Executables rejected. Metadata only — bytes via File.Upload to R2.",
      tags: ["File"],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["eventId", "purpose", "mime", "size"],
              properties: {
                eventId: { type: "string" },
                purpose: {
                  type: "string",
                  enum: ["logo", "headshot", "slides", "other"],
                },
                mime: { type: "string" },
                size: { type: "integer", maximum: 10485760 },
                filename: { type: "string" },
                ownerParticipationId: {
                  type: "string",
                  description:
                    "Required for headshot/slides — binds file_assets.owner_participation_id",
                },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Presign URL + fileId" },
        "400": { description: "Validation / mime reject (E4)" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Event not found / no membership" },
      },
    },
  },
  "/api/files/{fileId}/upload": {
    put: {
      operationId: "File.Upload",
      summary: "File.Upload",
      description:
        "Worker-hosted body transfer for a prior File.PresignUpload (R2 binding FILES). Single-use; max 10 MiB.",
      tags: ["File"],
      parameters: [
        {
          name: "fileId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "eventId",
          in: "query",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": { description: "Bytes stored" },
        "400": { description: "Validation / expired / size" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Not found" },
        "409": { description: "Already uploaded" },
      },
    },
  },
  "/api/files/{fileId}/complete": {
    post: {
      operationId: "File.CompleteUpload",
      summary: "File.CompleteUpload",
      description:
        "Set content checksum (+ optional filename) on a prior presign. Metadata only; virus_scan_status remains unscanned stub.",
      tags: ["File"],
      parameters: [
        {
          name: "fileId",
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
              required: ["checksum"],
              properties: {
                checksum: { type: "string" },
                eventId: { type: "string" },
                filename: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "file_asset metadata" },
        "400": { description: "No prior presign / validation" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Not found" },
      },
    },
  },
  "/api/files/{fileId}": {
    get: {
      operationId: "File.Get",
      summary: "File.Get",
      description:
        "Authenticated private file bytes (headshot/slides/logo). Admin of event or owning speaker; Bearer files:write.",
      tags: ["File"],
      parameters: [
        {
          name: "fileId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": { description: "File bytes" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden" },
        "404": { description: "Not found" },
      },
    },
  },
  "/api/public/files/{fileId}": {
    get: {
      operationId: "File.GetPublic",
      summary: "File.GetPublic",
      description:
        "Public image bytes only for purpose=logo referenced by published design. Headshot/slides always private (auth required).",
      tags: ["File"],
      parameters: [
        {
          name: "fileId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": { description: "Image bytes" },
        "404": { description: "Not public / not found" },
      },
    },
  },
} as const;

/** OpenAPI paths for Comms.* commands (section 5.1–5.3). */
export const COMMS_OPENAPI_PATHS = {
  "/api/events/{eventId}/templates/{key}": {
    put: {
      operationId: "Comms.UpsertTemplate",
      summary: "Comms.UpsertTemplate",
      description:
        "Create or update an event-scoped email template (subject + body with merge fields). No provider HTTP.",
      tags: ["Comms"],
      parameters: [
        {
          name: "eventId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "key",
          in: "path",
          required: true,
          schema: { type: "string", description: "Template key (e.g. accept-reminder)" },
        },
      ],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["subject", "body"],
              properties: {
                subject: { type: "string" },
                body: { type: "string" },
                expectedVersion: { type: "integer" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Template updated" },
        "201": { description: "Template created" },
        "400": { description: "Validation error (E4)" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Event not found / no membership" },
        "409": { description: "Version conflict" },
      },
    },
  },
  "/api/events/{eventId}/templates": {
    get: {
      operationId: "Comms.ListTemplates",
      summary: "Comms.ListTemplates",
      description: "List email templates for an event (admin SPA picker).",
      tags: ["Comms"],
      parameters: [
        {
          name: "eventId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": { description: "templates[]" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Event not found / no membership" },
      },
    },
  },
  "/api/events/{eventId}/comms/jobs": {
    get: {
      operationId: "Comms.ListJobs",
      summary: "Comms.ListJobs",
      description: "Delivery log — message jobs for an event (J05).",
      tags: ["Comms"],
      parameters: [
        {
          name: "eventId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": { description: "jobs[]" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Event not found / no membership" },
      },
    },
  },
  "/api/events/{eventId}/comms/jobs/{jobId}": {
    get: {
      operationId: "Comms.GetJob",
      summary: "Comms.GetJob",
      description: "Job detail with recipients + delivery_events (J05).",
      tags: ["Comms"],
      parameters: [
        {
          name: "eventId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "jobId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": { description: "job + recipients + deliveryEvents" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Job not found" },
      },
    },
  },
  "/api/events/{eventId}/comms/ics": {
    get: {
      operationId: "Comms.ListIcs",
      summary: "Comms.ListIcs",
      description: "List calendar invites for ICS attach display (J06).",
      tags: ["Comms"],
      parameters: [
        {
          name: "eventId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": { description: "invites[]" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Event not found / no membership" },
      },
    },
    post: {
      operationId: "Comms.IcsForPlacement",
      summary: "Comms.IcsForPlacement",
      description:
        "Create or update calendar_invite with stable UID; SEQUENCE bumps on reschedule (J10).",
      tags: ["Comms"],
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
              required: ["placementId", "summary", "startsAt", "endsAt"],
              properties: {
                placementId: { type: "string" },
                summary: { type: "string" },
                startsAt: { type: "string" },
                endsAt: { type: "string" },
                location: { type: "string", nullable: true },
                cancel: { type: "boolean" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Invite updated (SEQUENCE bumped)" },
        "201": { description: "Invite created" },
        "400": { description: "Validation error (E4)" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Event not found" },
      },
    },
  },
  "/api/comms/preview": {
    post: {
      operationId: "Comms.Preview",
      summary: "Comms.Preview",
      description:
        "Render merge fields for a segment; returns recipients, bodies, missingFields. Stores draft message_job.",
      tags: ["Comms"],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["templateId"],
              properties: {
                templateId: { type: "string" },
                segment: {
                  type: "object",
                  properties: {
                    status: { type: "string" },
                    participationIds: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Preview with rendered bodies" },
        "400": { description: "Validation error (E4)" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Template not found" },
      },
    },
  },
  "/api/comms/send": {
    post: {
      operationId: "Comms.Send",
      summary: "Comms.Send",
      description:
        "Enqueue send: requires previewId + idempotencyKey; materializes message_recipients; inserts outbox_events + idempotency_keys. Never calls provider HTTP (emailConsumer drains with sandbox default).",
      tags: ["Comms"],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["previewId", "idempotencyKey"],
              properties: {
                previewId: { type: "string" },
                idempotencyKey: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Idempotent replay" },
        "201": { description: "Job enqueued" },
        "400": { description: "Validation error (E4)" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Preview not found" },
        "409": { description: "Version conflict" },
      },
    },
  },
} as const;

/** Commands registered in the OpenAPI document (expand per section). */
export const OPENAPI_COMMANDS = [
  "Auth.DevRoleSwitch",
  "Event.List",
  "Event.Create",
  "Event.Get",
  "Event.Update",
  "Design.Get",
  "Design.SetDraft",
  "Design.Publish",
  "Form.Create",
  "Form.UpdateDraftFields",
  "Form.Publish",
  "Form.GetPublic",
  "Submission.Create",
  "Submission.SaveDraft",
  "Submission.GetDraft",
  "Cfp.FileUpload",
  "Eval.UpsertRubric",
  "Eval.GetRubric",
  "Eval.AdminRollup",
  "Eval.Score",
  "Eval.Abstain",
  "Eval.GetQueue",
  "Submission.AssignEvaluators",
  "Decision.Record",
  "Submission.Get",
  "Submission.List",
  "Session.CreateDirect",
  "Decision.BulkPreview",
  "Portal.GetHome",
  "Participation.UpdateProfile",
  "Task.Complete",
  "Speakers.List",
  "Speakers.Get",
  "Speakers.UpdateProfile",
  "TaskTemplate.List",
  "TaskTemplate.Create",
  "TaskTemplate.Update",
  "TaskTemplate.Delete",
  "File.PresignUpload",
  "File.Upload",
  "File.CompleteUpload",
  "File.Get",
  "File.GetPublic",
  "Comms.UpsertTemplate",
  "Comms.ListTemplates",
  "Comms.Preview",
  "Comms.Send",
  "Comms.ListJobs",
  "Comms.GetJob",
  "Comms.ListIcs",
  "Comms.IcsForPlacement",
  "Schedule.List",
  "Schedule.Place",
  "Schedule.Move",
  "Schedule.Unschedule",
  "Reports.Readiness",
  "Reports.AirtableStatus",
  "Keys.List",
  "Keys.Create",
  "Keys.Revoke",
] as const;

/** OpenAPI paths for Keys.* commands (section 7.1 / S-CLI). */
export const KEYS_OPENAPI_PATHS = {
  "/api/keys": {
    get: {
      operationId: "Keys.List",
      summary: "Keys.List",
      description:
        "List API keys without secrets (prefix + scopes only). Admin session or Bearer keys:admin.",
      tags: ["Keys"],
      responses: {
        "200": { description: "keys[] without secret or hash" },
        "401": { description: "Unauthenticated / revoked key" },
        "403": { description: "Forbidden role or scope" },
      },
    },
    post: {
      operationId: "Keys.Create",
      summary: "Keys.Create",
      description:
        "Mint API key; secret returned once only; hash stored. Default-deny high-risk scopes unless explicitly listed.",
      tags: ["Keys"],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["name", "scopes"],
              properties: {
                name: { type: "string", minLength: 1, maxLength: 200 },
                scopes: {
                  type: "array",
                  items: { type: "string" },
                  minItems: 1,
                  description: "SCOPES.md strings; default-deny not auto-granted",
                },
                eventId: { type: "string", nullable: true },
                expiresAt: {
                  type: "string",
                  format: "date-time",
                  nullable: true,
                },
              },
            },
          },
        },
      },
      responses: {
        "201": { description: "{ id, secret, prefix } — secret once only" },
        "400": { description: "Validation error (E4)" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role or scope" },
        "404": { description: "eventId not found when provided" },
      },
    },
  },
  "/api/keys/{keyId}": {
    delete: {
      operationId: "Keys.Revoke",
      summary: "Keys.Revoke",
      description:
        "Soft-revoke API key; subsequent Bearer auth returns 401",
      tags: ["Keys"],
      parameters: [
        {
          name: "keyId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": { description: "ok + revokedAt" },
        "400": { description: "Already revoked" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role or scope" },
        "404": { description: "Key not found" },
      },
    },
  },
} as const;

/** OpenAPI paths for Reports.AirtableStatus (section 7.3 / S-AIRTABLE). */
export const AIRTABLE_OPENAPI_PATHS = {
  "/api/events/{eventId}/airtable/status": {
    get: {
      operationId: "Reports.AirtableStatus",
      summary: "Reports.AirtableStatus",
      description:
        "Airtable one-way projection lag + errors (S-AIRTABLE / 7.3). Never calls Airtable HTTP on request path; paused when AIRTABLE_API_KEY unset. Scope: airtable:read.",
      tags: ["Reports"],
      parameters: [
        {
          name: "eventId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          description:
            "configured, paused, lag {pendingCount, oldestPendingAt, maxAttempts}, lastSuccessAt, projectedCount, recentErrors",
        },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role or missing airtable:read" },
        "404": { description: "Event not found" },
      },
    },
  },
} as const;

/** OpenAPI paths for Reports.Readiness (section 6.3 / S-READY). */
export const READINESS_OPENAPI_PATHS = {
  "/api/events/{eventId}/readiness": {
    get: {
      operationId: "Reports.Readiness",
      summary: "Reports.Readiness",
      description:
        "Outstanding speaker tasks + readiness stats for live admin dashboard (S-READY / 6.3). Poll ≤5s for live update after portal complete.",
      tags: ["Reports"],
      parameters: [
        {
          name: "eventId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "overdueOnly",
          in: "query",
          required: false,
          schema: { type: "string", enum: ["true", "1", "false", "0"] },
          description: "When true/1, outstanding[] is overdue-only (H02)",
        },
      ],
      responses: {
        "200": { description: "stats + outstanding[]" },
        "400": { description: "Validation error (E4)" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Event not found / no membership" },
      },
    },
  },
} as const;

/** OpenAPI paths for Schedule.* commands (section 6.1). */
export const SCHEDULE_OPENAPI_PATHS = {
  "/api/events/{eventId}/schedule": {
    get: {
      operationId: "Schedule.List",
      summary: "Schedule.List",
      description:
        "List placements + unscheduled confirmed sessions for an event (S-SCHED / 6.1)",
      tags: ["Schedule"],
      parameters: [
        {
          name: "eventId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "view",
          in: "query",
          required: false,
          schema: {
            type: "string",
            enum: ["list", "day", "week", "track", "room"],
          },
        },
      ],
      responses: {
        "200": { description: "placements + unscheduled" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Event not found / no membership" },
      },
    },
  },
  "/api/events/{eventId}/schedule/place": {
    post: {
      operationId: "Schedule.Place",
      summary: "Schedule.Place",
      description:
        "Place unscheduled session into room/time; hard room/speaker conflict → 409 CONFLICT with conflicts[]",
      tags: ["Schedule"],
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
              required: ["sessionId", "roomId", "startsAt", "endsAt"],
              properties: {
                sessionId: { type: "string" },
                roomId: { type: "string" },
                startsAt: { type: "string", format: "date-time" },
                endsAt: { type: "string", format: "date-time" },
                expectedVersion: { type: "integer" },
              },
            },
          },
        },
      },
      responses: {
        "201": { description: "Placement created" },
        "400": { description: "Validation error (E4)" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Session/room not found" },
        "409": {
          description:
            "CONFLICT with conflicts[] (room/speaker) or VERSION stale",
        },
      },
    },
  },
  "/api/events/{eventId}/schedule/move": {
    post: {
      operationId: "Schedule.Move",
      summary: "Schedule.Move",
      description:
        "Move placement; expectedVersion required; 409 VERSION on stale; 409 CONFLICT on overlap",
      tags: ["Schedule"],
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
              required: [
                "placementId",
                "roomId",
                "startsAt",
                "endsAt",
                "expectedVersion",
              ],
              properties: {
                placementId: { type: "string" },
                roomId: { type: "string" },
                startsAt: { type: "string", format: "date-time" },
                endsAt: { type: "string", format: "date-time" },
                expectedVersion: { type: "integer" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Placement updated" },
        "400": { description: "Validation error (E4)" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Placement not found" },
        "409": { description: "CONFLICT or VERSION" },
      },
    },
  },
  "/api/events/{eventId}/schedule/unschedule": {
    post: {
      operationId: "Schedule.Unschedule",
      summary: "Schedule.Unschedule",
      description:
        "Remove placement and free room/speaker reservations; expectedVersion required",
      tags: ["Schedule"],
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
              required: ["placementId", "expectedVersion"],
              properties: {
                placementId: { type: "string" },
                expectedVersion: { type: "integer" },
              },
            },
          },
        },
      },
      responses: {
        "200": { description: "Unscheduled; reservations freed" },
        "400": { description: "Validation error (E4)" },
        "401": { description: "Unauthenticated" },
        "403": { description: "Forbidden role" },
        "404": { description: "Placement not found" },
        "409": { description: "VERSION stale" },
      },
    },
  },
} as const;

export function buildOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.0.3",
    info: {
      title: "SpeakerOps API",
      version: "0.1.0",
      description:
        "Domain commands from COMMANDS.md. CLI parity via speakerops (7.2 / S-CLI). Form builder (3.1) + public submit (3.3) + eval scoring (3.4) + decisions (3.5) + portal (4.1) + files (4.2) + comms templates/outbox (5.1) + send/ICS (5.2) + admin UI reads (5.3) + schedule conflict engine (6.1) + readiness (6.3) + API keys (7.1) + OpenAPI/CLI (7.2) + Airtable projection (7.3).",
    },
    paths: {
      ...AUTH_OPENAPI_PATHS,
      ...EVENT_OPENAPI_PATHS,
      ...DESIGN_OPENAPI_PATHS,
      ...FORM_OPENAPI_PATHS,
      ...EVAL_OPENAPI_PATHS,
      ...DECISION_OPENAPI_PATHS,
      ...PORTAL_OPENAPI_PATHS,
      ...FILE_OPENAPI_PATHS,
      ...COMMS_OPENAPI_PATHS,
      ...SCHEDULE_OPENAPI_PATHS,
      ...READINESS_OPENAPI_PATHS,
      ...AIRTABLE_OPENAPI_PATHS,
      ...KEYS_OPENAPI_PATHS,
    },
    tags: [
      {
        name: "Auth",
        description:
          "Session auth; Auth.DevRoleSwitch is dogfood/dev only (8.4 — 404 when flag off)",
      },
      { name: "Event", description: "Event list/create/update (2.3 / CLI01)" },
      {
        name: "Design",
        description: "Design Kit draft/publish (S-THEME / 2.4 / CLI03–CLI05)",
      },
      { name: "Form", description: "CFP form builder (S-CFP / 3.1)" },
      { name: "Submission", description: "Public CFP submit (S-CFP / 3.3)" },
      { name: "Eval", description: "Human evaluation scoring (S-EVAL / 3.4)" },
      {
        name: "Decision",
        description: "Accept/reject/waitlist + direct session (S-EVAL / 3.5)",
      },
      { name: "Portal", description: "Speaker portal tasks + profile (S-PORTAL / 4.1)" },
      { name: "Speakers", description: "Admin speakers list/detail (4.1 API)" },
      { name: "TaskTemplate", description: "On-accept task templates O05 (4.1)" },
      {
        name: "File",
        description: "Presign + R2 upload metadata (4.2 / CLI08 files:write)",
      },
      {
        name: "Comms",
        description:
          "Email templates + outbox enqueue (S-COMMS / 5.1); provider send (5.2); CLI draft/send (7.2)",
      },
      {
        name: "Schedule",
        description:
          "Placement commands + hard room/speaker conflict detection (S-SCHED / 6.1); CLI place (7.2)",
      },
      {
        name: "Reports",
        description:
          "Readiness outstanding dashboard (S-READY / 6.3); Airtable projection status (S-AIRTABLE / 7.3); CLI reports readiness (7.2)",
      },
      {
        name: "Keys",
        description:
          "API key mint/revoke + hashed secrets + scopes (S-CLI / 7.1); Bearer auth",
      },
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
