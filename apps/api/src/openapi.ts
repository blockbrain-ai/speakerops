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

/** Eval + assignment OpenAPI paths (section 3.4 / S-EVAL). */
export const EVAL_OPENAPI_PATHS = {
  "/api/events/{eventId}/eval/rubric": {
    put: {
      operationId: "Eval.UpsertRubric",
      summary: "Eval.UpsertRubric",
      description: "Admin create/update active eval round criteria (human rubric)",
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
      description: "Admin aggregate scores per submission for active round",
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
        "200": { description: "Submission rollups with aggregateScore" },
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
      description: "Admin list with status/category filters",
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
      ],
      responses: {
        "200": { description: "Submission list" },
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

/** OpenAPI paths for Comms.* commands (section 5.1). */
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
  "Form.Create",
  "Form.UpdateDraftFields",
  "Form.Publish",
  "Form.GetPublic",
  "Submission.Create",
  "Cfp.FileUpload",
  "Eval.UpsertRubric",
  "Eval.GetRubric",
  "Eval.AdminRollup",
  "Eval.Score",
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
  "TaskTemplate.List",
  "TaskTemplate.Create",
  "TaskTemplate.Update",
  "TaskTemplate.Delete",
  "File.PresignUpload",
  "File.Upload",
  "File.CompleteUpload",
  "File.GetPublic",
  "Comms.UpsertTemplate",
  "Comms.Preview",
  "Comms.Send",
  "Comms.IcsForPlacement",
] as const;

export function buildOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: "3.0.3",
    info: {
      title: "SpeakerOps API",
      version: "0.1.0",
      description:
        "Domain commands from COMMANDS.md. Form builder (3.1) + public submit (3.3) + eval scoring (3.4) + decisions (3.5) + portal (4.1) + files (4.2) + comms templates/outbox (5.1) + send/ICS (5.2).",
    },
    paths: {
      ...FORM_OPENAPI_PATHS,
      ...EVAL_OPENAPI_PATHS,
      ...DECISION_OPENAPI_PATHS,
      ...PORTAL_OPENAPI_PATHS,
      ...FILE_OPENAPI_PATHS,
      ...COMMS_OPENAPI_PATHS,
    },
    tags: [
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
        name: "Comms",
        description:
          "Email templates + outbox enqueue (S-COMMS / 5.1); provider send in 5.2",
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
