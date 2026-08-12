/**
 * SpeakerOps D1 schema (Drizzle) — section 1.3 baseline + 2.1 auth + 2.2 memberships
 * + 2.3 rooms/tracks + 2.4 design tokens / logo file_assets + 3.1 forms
 * + 3.3 people / submissions + 3.4 eval rounds / criteria / assignments / scores
 * + 3.5 decisions / program sessions / participations / task_templates / speaker_tasks
 * + 5.1 email_templates / message_jobs (S-COMMS outbox enqueue)
 * + 5.2 message_recipients / delivery_events / calendar_invites (send + ICS)
 * + 6.1 schedule_placements / room_block_reservations / speaker_block_reservations
 * + 7.1 api_keys (hashed secrets + scopes; S-CLI)
 * + 7.3 projection_records (Airtable one-way; S-AIRTABLE).
 *
 * Columns match KMS-competition/initiative/contracts/SCHEMA.md for tables
 * owned by 1.3 / 2.1 / 2.2 / 2.3 / 2.4 / 3.1 / 3.3 / 3.4 / 3.5 / 5.1 / 5.2 / 6.1 / 7.1 / 7.3.
 * Later sections add domain tables via additive migrations.
 *
 * Path locked by E1: packages/db/schema.ts
 */
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** organizations — multi-tenant org shell (single-org dogfood still uses this). */
export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * events — mutable aggregate; optimistic `version` required (E1).
 * Repository queries that touch event-owned data must scope by event id.
 */
export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey().notNull(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    timezone: text("timezone").notNull(),
    startsAt: text("starts_at"),
    endsAt: text("ends_at"),
    settingsJson: text("settings_json"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [index("idx_events_org_id").on(t.orgId)],
);

/**
 * programme_publications — F7 public programme publish gate (migration 0039).
 */
export const programmePublications = sqliteTable(
  "programme_publications",
  {
    eventId: text("event_id")
      .primaryKey()
      .notNull()
      .references(() => events.id),
    publishedAt: text("published_at").notNull(),
    publishedBy: text("published_by"),
    version: integer("version").notNull().default(1),
    snapshotJson: text("snapshot_json"),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("idx_programme_publications_published_at").on(t.publishedAt)],
);

/**
 * portal_forms — N1 post-acceptance data collection (migration 0040).
 * Scoped to participation (no Group aggregate).
 */
export const portalForms = sqliteTable(
  "portal_forms",
  {
    id: text("id").primaryKey().notNull(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    title: text("title").notNull(),
    description: text("description"),
    scope: text("scope").notNull().default("participation"),
    status: text("status").notNull().default("draft"),
    fieldsJson: text("fields_json").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    index("idx_portal_forms_event_id").on(t.eventId),
    index("idx_portal_forms_event_status").on(t.eventId, t.status),
  ],
);

export const portalFormResponses = sqliteTable(
  "portal_form_responses",
  {
    id: text("id").primaryKey().notNull(),
    formId: text("form_id")
      .notNull()
      .references(() => portalForms.id),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    participationId: text("participation_id").notNull(),
    answersJson: text("answers_json").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    index("idx_portal_form_responses_event").on(t.eventId),
    index("idx_portal_form_responses_participation").on(t.participationId),
    uniqueIndex("idx_portal_form_responses_form_part").on(
      t.formId,
      t.participationId,
    ),
  ],
);

/**
 * portal_resources — N2 wiki/resources pages (migration 0041).
 */
export const portalResources = sqliteTable(
  "portal_resources",
  {
    id: text("id").primaryKey().notNull(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    title: text("title").notNull(),
    bodyMd: text("body_md"),
    status: text("status").notNull().default("draft"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [index("idx_portal_resources_event").on(t.eventId, t.status)],
);

/**
 * file_requests — N3 reusable file request templates (migration 0041).
 */
export const fileRequests = sqliteTable(
  "file_requests",
  {
    id: text("id").primaryKey().notNull(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    title: text("title").notNull(),
    instructions: text("instructions"),
    scope: text("scope").notNull().default("participation"),
    status: text("status").notNull().default("draft"),
    purpose: text("purpose").notNull().default("other"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [index("idx_file_requests_event").on(t.eventId, t.status)],
);

/**
 * audit_events — consequential writes (E3).
 * correlation_id is required so request/CLI entry can be traced.
 */
export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey().notNull(),
    eventId: text("event_id"),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    correlationId: text("correlation_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_audit_events_event_id").on(t.eventId),
    index("idx_audit_events_correlation_id").on(t.correlationId),
  ],
);

/**
 * outbox_events — transactional outbox for email / Airtable / side effects (E7).
 * Workers drain rows; request path never waits on external systems.
 */
export const outboxEvents = sqliteTable(
  "outbox_events",
  {
    id: text("id").primaryKey().notNull(),
    topic: text("topic").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: text("created_at").notNull(),
    processedAt: text("processed_at"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [index("idx_outbox_events_processed_at").on(t.processedAt)],
);

/**
 * idempotency_keys — replay-safe writes for sends/imports (E7).
 */
export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    id: text("id").primaryKey().notNull(),
    key: text("key").notNull().unique(),
    requestHash: text("request_hash").notNull(),
    responseJson: text("response_json"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_idempotency_keys_key").on(t.key)],
);

/**
 * users — auth identity (section 2.1). Person ≠ Speaker (people table is separate).
 * Email is unique for magic-link lookup; tokens never stored on this row.
 */
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey().notNull(),
    email: text("email").notNull(),
    name: text("name"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("idx_users_email").on(t.email)],
);

/**
 * auth_sessions — HttpOnly cookie session material (section 2.1).
 * token_hash only — plaintext session token never persists (E10).
 */
export const authSessions = sqliteTable(
  "auth_sessions",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_auth_sessions_user_id").on(t.userId),
    index("idx_auth_sessions_token_hash").on(t.tokenHash),
  ],
);

/**
 * magic_links — single-use exchange tokens (section 2.1).
 * token_hash only; used_at marks consumption (replay → 401).
 */
export const magicLinks = sqliteTable(
  "magic_links",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    eventId: text("event_id"),
    purpose: text("purpose").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_magic_links_user_id").on(t.userId),
    index("idx_magic_links_token_hash").on(t.tokenHash),
    index("idx_magic_links_event_id").on(t.eventId),
  ],
);

/** Named baseline table set for exports and gate assertions (1.3). */
export const baselineTables = {
  organizations,
  events,
  auditEvents,
  outboxEvents,
  idempotencyKeys,
} as const;

/**
 * event_memberships — event-scoped roles admin|evaluator|speaker (section 2.2).
 * UNIQUE(event_id, user_id). Server-side requireRole reads this table (E2).
 */
export const eventMemberships = sqliteTable(
  "event_memberships",
  {
    id: text("id").primaryKey().notNull(),
    eventId: text("event_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_event_memberships_event_user").on(t.eventId, t.userId),
    index("idx_event_memberships_user_id").on(t.userId),
    index("idx_event_memberships_event_id").on(t.eventId),
  ],
);

/** Auth tables owned by section 2.1. */
export const authTables = {
  users,
  authSessions,
  magicLinks,
} as const;

/** Membership tables owned by section 2.2. */
export const membershipTables = {
  eventMemberships,
} as const;

/**
 * rooms — event-scoped venues (section 2.3).
 * Queries must filter by event_id at repository layer (E2).
 */
export const rooms = sqliteTable(
  "rooms",
  {
    id: text("id").primaryKey().notNull(),
    eventId: text("event_id").notNull(),
    name: text("name").notNull(),
    capacity: integer("capacity"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [index("idx_rooms_event_id").on(t.eventId)],
);

/**
 * tracks — event-scoped programme tracks (section 2.3).
 * Queries must filter by event_id at repository layer (E2).
 */
export const tracks = sqliteTable(
  "tracks",
  {
    id: text("id").primaryKey().notNull(),
    eventId: text("event_id").notNull(),
    name: text("name").notNull(),
    color: text("color"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [index("idx_tracks_event_id").on(t.eventId)],
);

/** Rooms/tracks tables owned by section 2.3. */
export const eventSettingsTables = {
  rooms,
  tracks,
} as const;

/**
 * design_token_drafts — admin draft Design Kit tokens (section 2.4).
 * tokens_json: { brand, brandSoft, radius, wordmark, logoFileId, brandFg? }
 * Optimistic version for SetDraft / Publish.
 */
export const designTokenDrafts = sqliteTable("design_token_drafts", {
  eventId: text("event_id").primaryKey().notNull(),
  tokensJson: text("tokens_json").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * design_token_published — public CFP tokens only after Design.Publish (section 2.4).
 * Draft never leaks here (C10 / S-THEME).
 */
export const designTokenPublished = sqliteTable("design_token_published", {
  eventId: text("event_id").primaryKey().notNull(),
  tokensJson: text("tokens_json").notNull(),
  version: integer("version").notNull().default(1),
  publishedAt: text("published_at").notNull(),
  publishedBy: text("published_by"),
});

/**
 * file_assets — logo (2.4) + portal headshot/slides (4.2) metadata only.
 * SCHEMA.md: purpose logo|headshot|slides|other; bytes live in R2 (FILES), not D1.
 * `uploaded` is a dedicated readiness flag (0 pending / 2 claim / 1 stored);
 * `checksum` is for content digests only (File.CompleteUpload).
 * `virus_scan_status` stub defaults unscanned (no scanner in 4.2).
 */
export const fileAssets = sqliteTable(
  "file_assets",
  {
    id: text("id").primaryKey().notNull(),
    eventId: text("event_id").notNull(),
    ownerParticipationId: text("owner_participation_id"),
    r2Key: text("r2_key").notNull(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    checksum: text("checksum"),
    purpose: text("purpose").notNull(),
    createdAt: text("created_at").notNull(),
    /**
     * Upload lifecycle: 0 = pending body, 2 = claim in progress (not ready),
     * 1 = bytes stored. Only 1 is readiness for Design.SetDraft / public serve.
     */
    uploaded: integer("uploaded").notNull().default(0),
    /** Virus scan stub: unscanned | clean | infected | error (default unscanned). */
    virusScanStatus: text("virus_scan_status").notNull().default("unscanned"),
    /**
     * Public CFP upload binding (0033): the ACTIVE published form version the
     * upload was authorized against. NULL for non-CFP assets (logo/portal).
     */
    formVersionId: text("form_version_id"),
    /** File-typed field key the upload answers; paired with form_version_id. */
    fieldKey: text("field_key"),
  },
  (t) => [index("idx_file_assets_event_id").on(t.eventId)],
);

/**
 * file_blobs — optional durable body storage when R2 is not bound (dogfood).
 * Prefer R2 FILES in production; D1 holds small base64 blobs only.
 */
export const fileBlobs = sqliteTable(
  "file_blobs",
  {
    fileId: text("file_id").primaryKey().notNull(),
    eventId: text("event_id").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
    bytesB64: text("bytes_b64").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_file_blobs_event_id").on(t.eventId)],
);

/** Design Kit tables owned by section 2.4. */
export const designTables = {
  designTokenDrafts,
  designTokenPublished,
  fileAssets,
  fileBlobs,
} as const;

/**
 * forms — event-scoped CFP form shell (section 3.1).
 * status: draft | published. Draft working copy lives on form_versions version_num=0.
 */
export const forms = sqliteTable(
  "forms",
  {
    id: text("id").primaryKey().notNull(),
    eventId: text("event_id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("idx_forms_event_id").on(t.eventId)],
);

/**
 * form_versions — draft (version_num=0, published_at NULL) + immutable published snapshots.
 * Publish freezes snapshot_json and never mutates published rows (S-CFP / 3.1).
 */
export const formVersions = sqliteTable(
  "form_versions",
  {
    id: text("id").primaryKey().notNull(),
    formId: text("form_id").notNull(),
    versionNum: integer("version_num").notNull(),
    welcomeMd: text("welcome_md"),
    thankYouMd: text("thank_you_md"),
    /** Rich-text welcome doc envelope JSON (F2; 0036). Dual-read with welcome_md. */
    welcomeRichJson: text("welcome_rich_json"),
    /** Rich-text thank-you doc envelope JSON (F2; 0036). Dual-read with thank_you_md. */
    thankYouRichJson: text("thank_you_rich_json"),
    opensAt: text("opens_at"),
    closesAt: text("closes_at"),
    submissionLimit: integer("submission_limit"),
    /** Max submitted proposals per primary-speaker email (post-11.9 depth; 0028). */
    perSubmitterLimit: integer("per_submitter_limit"),
    /** Configurable speaker bounds (post-11.9 depth; 0024). Defaults preserve 1–5. */
    minSpeakers: integer("min_speakers").notNull().default(1),
    maxSpeakers: integer("max_speakers").notNull().default(5),
    publishedAt: text("published_at"),
    /** Immutable JSON snapshot of fields+rules+meta at publish time. */
    snapshotJson: text("snapshot_json"),
  },
  (t) => [
    index("idx_form_versions_form_id").on(t.formId),
    uniqueIndex("idx_form_versions_form_version_num").on(t.formId, t.versionNum),
  ],
);

/**
 * form_fields — fields on a form_version; field_key is stable for submission_answers.
 */
export const formFields = sqliteTable(
  "form_fields",
  {
    id: text("id").primaryKey().notNull(),
    formVersionId: text("form_version_id").notNull(),
    fieldKey: text("field_key").notNull(),
    type: text("type").notNull(),
    label: text("label").notNull(),
    required: integer("required").notNull().default(0),
    optionsJson: text("options_json"),
    sortOrder: integer("sort_order").notNull().default(0),
    conditionsJson: text("conditions_json"),
    /** Author guidance under the label (post-11.9 depth; 0023). */
    helpText: text("help_text"),
    /** Input placeholder copy (post-11.9 depth; 0023). */
    placeholder: text("placeholder"),
    /** Character cap for text/textarea answers (post-11.9 depth; 0023). */
    maxChars: integer("max_chars"),
    /** Node discrimination: input (answerable) | layout (section/divider) (0027). */
    nodeKind: text("node_kind").notNull().default("input"),
    /** section | divider when node_kind = layout; NULL for inputs (0027). */
    layoutType: text("layout_type"),
    /**
     * Per-section "Description & Instructions" rich-text envelope JSON
     * (F2; 0036). Layout section nodes only; help_text is NOT overloaded.
     */
    descriptionRichJson: text("description_rich_json"),
  },
  (t) => [
    index("idx_form_fields_form_version_id").on(t.formVersionId),
    uniqueIndex("idx_form_fields_version_key").on(t.formVersionId, t.fieldKey),
  ],
);

/**
 * form_rules — category routing rules (when_json → route_to_category).
 */
export const formRules = sqliteTable(
  "form_rules",
  {
    id: text("id").primaryKey().notNull(),
    formVersionId: text("form_version_id").notNull(),
    whenJson: text("when_json").notNull(),
    routeToCategory: text("route_to_category").notNull(),
  },
  (t) => [index("idx_form_rules_form_version_id").on(t.formVersionId)],
);

/** Forms tables owned by section 3.1. */
export const formTables = {
  forms,
  formVersions,
  formFields,
  formRules,
} as const;

/**
 * people — canonical identity (section 3.3). Person ≠ Speaker (join rows).
 * Email unique per org for upsert on multi-speaker CFP submit.
 */
export const people = sqliteTable(
  "people",
  {
    id: text("id").primaryKey().notNull(),
    orgId: text("org_id").notNull(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_people_org_id").on(t.orgId),
    uniqueIndex("idx_people_org_email").on(t.orgId, t.email),
  ],
);

/**
 * submissions — CFP applications pinned to form_version_id (section 3.3).
 * status: draft|submitted|in_review|accepted|rejected|waitlist|withdrawn
 * Public create writes status=submitted.
 */
export const submissions = sqliteTable(
  "submissions",
  {
    id: text("id").primaryKey().notNull(),
    eventId: text("event_id").notNull(),
    formVersionId: text("form_version_id").notNull(),
    title: text("title").notNull(),
    category: text("category"),
    status: text("status").notNull(),
    submittedAt: text("submitted_at").notNull(),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    index("idx_submissions_event_id").on(t.eventId),
    index("idx_submissions_form_version_id").on(t.formVersionId),
    index("idx_submissions_status").on(t.eventId, t.status),
  ],
);

/**
 * submission_answers — field_key → value_json (stable keys from form_fields).
 */
export const submissionAnswers = sqliteTable(
  "submission_answers",
  {
    id: text("id").primaryKey().notNull(),
    submissionId: text("submission_id").notNull(),
    fieldKey: text("field_key").notNull(),
    valueJson: text("value_json").notNull(),
  },
  (t) => [
    index("idx_submission_answers_submission_id").on(t.submissionId),
    uniqueIndex("idx_submission_answers_submission_key").on(
      t.submissionId,
      t.fieldKey,
    ),
  ],
);

/**
 * submission_speakers — Person on a CFP submission (pre-accept).
 */
export const submissionSpeakers = sqliteTable(
  "submission_speakers",
  {
    submissionId: text("submission_id").notNull(),
    personId: text("person_id").notNull(),
    isPrimary: integer("is_primary").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Optional "About this speaker" seed fields (Wave 2, 0031). */
    bio: text("bio"),
    company: text("company"),
    title: text("title"),
  },
  (t) => [
    index("idx_submission_speakers_person_id").on(t.personId),
    uniqueIndex("idx_submission_speakers_pk").on(t.submissionId, t.personId),
  ],
);

/** Submissions tables owned by section 3.3. */
export const submissionTables = {
  people,
  submissions,
  submissionAnswers,
  submissionSpeakers,
} as const;

/**
 * eval_rounds — human evaluation round per event (section 3.4 / S-EVAL).
 * status: open | closed
 */
export const evalRounds = sqliteTable(
  "eval_rounds",
  {
    id: text("id").primaryKey().notNull(),
    eventId: text("event_id").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull(),
    closesAt: text("closes_at"),
    /** Evaluator guidance rendered as plain text in the queue (0026). */
    instructionsMd: text("instructions_md"),
    /** 1 = evaluator proposal DTO omits speakers[] (server-side; 0029). */
    hideSpeakers: integer("hide_speakers").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [index("idx_eval_rounds_event_id").on(t.eventId)],
);

/**
 * eval_criteria — rubric rows for a round (name, max_score, weight).
 */
export const evalCriteria = sqliteTable(
  "eval_criteria",
  {
    id: text("id").primaryKey().notNull(),
    roundId: text("round_id").notNull(),
    name: text("name").notNull(),
    maxScore: real("max_score").notNull(),
    weight: real("weight").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("idx_eval_criteria_round_id").on(t.roundId)],
);

/**
 * eval_assignments — submission assigned to an evaluator for a round.
 * status: pending | scored
 * UNIQUE(round_id, submission_id, evaluator_user_id)
 */
export const evalAssignments = sqliteTable(
  "eval_assignments",
  {
    id: text("id").primaryKey().notNull(),
    roundId: text("round_id").notNull(),
    submissionId: text("submission_id").notNull(),
    evaluatorUserId: text("evaluator_user_id").notNull(),
    status: text("status").notNull(),
    overallComment: text("overall_comment"),
    /** Optional evaluator-provided abstain reason (0025). */
    abstainReason: text("abstain_reason"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_eval_assignments_round_id").on(t.roundId),
    index("idx_eval_assignments_evaluator").on(t.evaluatorUserId),
    index("idx_eval_assignments_submission").on(t.submissionId),
    uniqueIndex("idx_eval_assignments_unique").on(
      t.roundId,
      t.submissionId,
      t.evaluatorUserId,
    ),
  ],
);

/**
 * scores — per-criterion value on an assignment.
 * UNIQUE(assignment_id, criterion_id)
 */
export const scores = sqliteTable(
  "scores",
  {
    id: text("id").primaryKey().notNull(),
    assignmentId: text("assignment_id").notNull(),
    criterionId: text("criterion_id").notNull(),
    value: real("value").notNull(),
    comment: text("comment"),
  },
  (t) => [
    index("idx_scores_assignment_id").on(t.assignmentId),
    index("idx_scores_criterion_id").on(t.criterionId),
    uniqueIndex("idx_scores_assignment_criterion").on(
      t.assignmentId,
      t.criterionId,
    ),
  ],
);

/** Eval tables owned by section 3.4. */
export const evalTables = {
  evalRounds,
  evalCriteria,
  evalAssignments,
  scores,
} as const;

/**
 * decisions — accept / reject / waitlist on a submission (section 3.5).
 * UNIQUE(submission_id) — one recorded decision row per submission (idempotent accept).
 */
export const decisions = sqliteTable(
  "decisions",
  {
    id: text("id").primaryKey().notNull(),
    submissionId: text("submission_id").notNull(),
    decision: text("decision").notNull(),
    reason: text("reason"),
    decidedBy: text("decided_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_decisions_submission_id").on(t.submissionId),
    uniqueIndex("idx_decisions_submission_unique").on(t.submissionId),
  ],
);

/**
 * event_participations — Person on an event (Person ≠ Speaker join) (section 3.5 / 4.1).
 */
export const eventParticipations = sqliteTable(
  "event_participations",
  {
    id: text("id").primaryKey().notNull(),
    eventId: text("event_id").notNull(),
    personId: text("person_id").notNull(),
    userId: text("user_id"),
    roleLabel: text("role_label"),
    status: text("status").notNull(),
    bio: text("bio"),
    /** Rich-text bio doc envelope JSON (F2; 0036). Dual-read with bio. */
    bioRichJson: text("bio_rich_json"),
    company: text("company"),
    title: text("title"),
    headshotFileId: text("headshot_file_id"),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_event_participations_event_id").on(t.eventId),
    index("idx_event_participations_person_id").on(t.personId),
    uniqueIndex("idx_event_participations_event_person").on(
      t.eventId,
      t.personId,
    ),
  ],
);

/**
 * program sessions — SCHEMA.md `sessions` (not auth_sessions) (section 3.5).
 * Direct/sponsor entry allowed without source_submission_id.
 */
export const programSessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey().notNull(),
    eventId: text("event_id").notNull(),
    sourceSubmissionId: text("source_submission_id"),
    title: text("title").notNull(),
    description: text("description"),
    trackId: text("track_id"),
    status: text("status").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_sessions_event_id").on(t.eventId),
    // One session per CFP submission; NULL allowed for direct/sponsor (SQLite UNIQUE + NULL).
    uniqueIndex("idx_sessions_source_submission_unique").on(t.sourceSubmissionId),
  ],
);

/**
 * session_speakers — participation on a program session (section 3.5).
 */
export const sessionSpeakers = sqliteTable(
  "session_speakers",
  {
    sessionId: text("session_id").notNull(),
    participationId: text("participation_id").notNull(),
    isPrimary: integer("is_primary").notNull().default(0),
  },
  (t) => [
    index("idx_session_speakers_participation").on(t.participationId),
    uniqueIndex("idx_session_speakers_pk").on(t.sessionId, t.participationId),
  ],
);

/**
 * task_templates — event-scoped templates (on_accept | manual) (section 3.5 / 4.1 O05).
 * Mutable aggregate: optimistic `version` required (E1).
 */
export const taskTemplates = sqliteTable(
  "task_templates",
  {
    id: text("id").primaryKey().notNull(),
    eventId: text("event_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    trigger: text("trigger").notNull(),
    dueOffsetDays: integer("due_offset_days").notNull().default(0),
    /** Optional https:// resource link rendered on portal task cards (0030). */
    linkUrl: text("link_url"),
    /**
     * 1 = incomplete tasks block portal readiness; 0 = optional.
     * Default 1 (0032 repair): pre-0030 semantics — every task blocks unless
     * the organizer explicitly opts INTO optional.
     */
    required: integer("required").notNull().default(1),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_task_templates_event_id").on(t.eventId),
    index("idx_task_templates_event_trigger").on(t.eventId, t.trigger),
  ],
);

/**
 * speaker_tasks — instantiated tasks for a participation (section 3.5 / portal 4.x).
 */
export const speakerTasks = sqliteTable(
  "speaker_tasks",
  {
    id: text("id").primaryKey().notNull(),
    templateId: text("template_id").notNull(),
    participationId: text("participation_id").notNull(),
    status: text("status").notNull(),
    dueAt: text("due_at"),
    completedAt: text("completed_at"),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_speaker_tasks_participation").on(t.participationId),
    index("idx_speaker_tasks_template").on(t.templateId),
    uniqueIndex("idx_speaker_tasks_template_participation").on(
      t.templateId,
      t.participationId,
    ),
  ],
);

/** Decision / session / task tables owned by section 3.5. */
export const decisionTables = {
  decisions,
  eventParticipations,
  programSessions,
  sessionSpeakers,
  taskTemplates,
  speakerTasks,
} as const;

/**
 * email_templates — event-scoped message templates with merge fields (section 5.1 / S-COMMS).
 * UNIQUE(event_id, key). body_md holds markdown/plaintext with {{mergeField}} tokens.
 * Optimistic `version` on mutable aggregate (E1).
 */
export const emailTemplates = sqliteTable(
  "email_templates",
  {
    id: text("id").primaryKey().notNull(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    key: text("key").notNull(),
    subject: text("subject").notNull(),
    bodyMd: text("body_md").notNull(),
    /** Rich-text body doc envelope JSON (F2; 0036). Dual-read with body_md. */
    bodyRichJson: text("body_rich_json"),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_email_templates_event_id").on(t.eventId),
    uniqueIndex("idx_email_templates_event_key").on(t.eventId, t.key),
  ],
);

/**
 * message_jobs — preview drafts + queued sends (section 5.1).
 * jobs carry idempotency_key (SCHEMA.md). Status preview → queued on enqueue.
 * Provider delivery is section 5.2; request path only inserts outbox_events (E7).
 */
export const messageJobs = sqliteTable(
  "message_jobs",
  {
    id: text("id").primaryKey().notNull(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    templateId: text("template_id")
      .notNull()
      .references(() => emailTemplates.id),
    status: text("status").notNull(),
    segmentJson: text("segment_json").notNull(),
    recipientsJson: text("recipients_json"),
    bodiesJson: text("bodies_json"),
    missingFieldsJson: text("missing_fields_json"),
    idempotencyKey: text("idempotency_key"),
    /** Optional ICS attach carrier — set only by Comms.Send. */
    calendarInviteId: text("calendar_invite_id"),
    createdBy: text("created_by").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_message_jobs_event_id").on(t.eventId),
    index("idx_message_jobs_template_id").on(t.templateId),
    index("idx_message_jobs_status").on(t.status),
    uniqueIndex("idx_message_jobs_idempotency_key").on(t.idempotencyKey),
  ],
);

/**
 * message_recipients — per-recipient snapshot at send time (section 5.2).
 * I16: to_email from segment preview (Comms.Preview → message_recipients.to_email).
 */
export const messageRecipients = sqliteTable(
  "message_recipients",
  {
    id: text("id").primaryKey().notNull(),
    jobId: text("job_id")
      .notNull()
      .references(() => messageJobs.id),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    participationId: text("participation_id"),
    toEmail: text("to_email").notNull(),
    name: text("name"),
    subject: text("subject"),
    body: text("body"),
    /** Durable HTML part snapshot (F2; 0036). body stays the text part. */
    bodyHtml: text("body_html"),
    status: text("status").notNull().default("pending"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_message_recipients_job_id").on(t.jobId),
    index("idx_message_recipients_event_id").on(t.eventId),
    index("idx_message_recipients_to_email").on(t.toEmail),
  ],
);

/**
 * delivery_events — provider attempt log (sandbox | resend) (section 5.2).
 */
export const deliveryEvents = sqliteTable(
  "delivery_events",
  {
    id: text("id").primaryKey().notNull(),
    jobId: text("job_id")
      .notNull()
      .references(() => messageJobs.id),
    recipientId: text("recipient_id").references(() => messageRecipients.id),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    provider: text("provider").notNull(),
    providerMessageId: text("provider_message_id"),
    status: text("status").notNull(),
    attempt: integer("attempt").notNull().default(1),
    error: text("error"),
    payloadJson: text("payload_json"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("idx_delivery_events_job_id").on(t.jobId),
    index("idx_delivery_events_recipient_id").on(t.recipientId),
    index("idx_delivery_events_event_id").on(t.eventId),
  ],
);

/**
 * calendar_invites — ICS UID + SEQUENCE lifecycle (section 5.2 / S-COMMS).
 * SCHEMA: calendar: uid, sequence, method.
 */
export const calendarInvites = sqliteTable(
  "calendar_invites",
  {
    id: text("id").primaryKey().notNull(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    placementId: text("placement_id").notNull(),
    sessionId: text("session_id"),
    uid: text("uid").notNull(),
    sequence: integer("sequence").notNull().default(0),
    method: text("method").notNull(),
    summary: text("summary"),
    startsAt: text("starts_at"),
    endsAt: text("ends_at"),
    location: text("location"),
    icsBody: text("ics_body").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_calendar_invites_uid").on(t.uid),
    uniqueIndex("idx_calendar_invites_event_placement").on(
      t.eventId,
      t.placementId,
    ),
    index("idx_calendar_invites_event_id").on(t.eventId),
  ],
);

/** Comms tables owned by sections 5.1–5.2. */
export const commsTables = {
  emailTemplates,
  messageJobs,
  messageRecipients,
  deliveryEvents,
  calendarInvites,
} as const;

/**
 * schedule_placements — versioned session placement on a room/time (section 6.1 / S-SCHED).
 * Unique session_id: one placement per program session (use Move to reschedule).
 */
export const schedulePlacements = sqliteTable(
  "schedule_placements",
  {
    id: text("id").primaryKey().notNull(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    sessionId: text("session_id").notNull(),
    roomId: text("room_id").notNull(),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_schedule_placements_session").on(t.sessionId),
    index("idx_schedule_placements_event_id").on(t.eventId),
    index("idx_schedule_placements_room").on(t.eventId, t.roomId),
  ],
);

/**
 * room_block_reservations — room occupancy for a placement (section 6.1).
 * Unique (event_id, room_id, starts_at, ends_at); overlap checked in domain.
 */
export const roomBlockReservations = sqliteTable(
  "room_block_reservations",
  {
    id: text("id").primaryKey().notNull(),
    eventId: text("event_id").notNull(),
    roomId: text("room_id").notNull(),
    placementId: text("placement_id")
      .notNull()
      .references(() => schedulePlacements.id),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_room_block_reservations_unique").on(
      t.eventId,
      t.roomId,
      t.startsAt,
      t.endsAt,
    ),
    index("idx_room_block_reservations_room").on(t.eventId, t.roomId),
    index("idx_room_block_reservations_placement").on(t.placementId),
  ],
);

/**
 * speaker_block_reservations — speaker occupancy for a placement (section 6.1).
 * Unique (event_id, participation_id, starts_at, ends_at); overlap in domain.
 */
export const speakerBlockReservations = sqliteTable(
  "speaker_block_reservations",
  {
    id: text("id").primaryKey().notNull(),
    eventId: text("event_id").notNull(),
    participationId: text("participation_id").notNull(),
    placementId: text("placement_id")
      .notNull()
      .references(() => schedulePlacements.id),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_speaker_block_reservations_unique").on(
      t.eventId,
      t.participationId,
      t.startsAt,
      t.endsAt,
    ),
    index("idx_speaker_block_reservations_speaker").on(
      t.eventId,
      t.participationId,
    ),
    index("idx_speaker_block_reservations_placement").on(t.placementId),
  ],
);

/** Schedule tables owned by section 6.1. */
export const scheduleTables = {
  schedulePlacements,
  roomBlockReservations,
  speakerBlockReservations,
} as const;

/**
 * api_keys — agent/CLI credentials (section 7.1 / S-CLI).
 * key_hash only — plaintext secret returned once on Keys.Create (E10).
 * scopes_json: JSON string array of SCOPES.md strings; default-deny high-risk.
 */
export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: text("id").primaryKey().notNull(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    scopesJson: text("scopes_json").notNull(),
    eventId: text("event_id"),
    expiresAt: text("expires_at"),
    revokedAt: text("revoked_at"),
    createdBy: text("created_by").notNull(),
    lastUsedAt: text("last_used_at"),
    /**
     * Nullable: added by 0022 (0018 shipped without it) — pre-backfill rows
     * are NULL; the keys store maps NULL to a fixed fallback ISO.
     */
    createdAt: text("created_at"),
  },
  (t) => [
    uniqueIndex("idx_api_keys_key_hash").on(t.keyHash),
    index("idx_api_keys_org_id").on(t.orgId),
    index("idx_api_keys_key_prefix").on(t.keyPrefix),
    index("idx_api_keys_event_id").on(t.eventId),
    // Demo mint quota COUNTs (8.4): composite serves both the active count
    // (created_by prefix) and the rolling 24h mint window (created_by +
    // created_at range) — one index, no separate created_by index needed.
    index("idx_api_keys_created_by_created_at").on(t.createdBy, t.createdAt),
  ],
);

/** API keys table owned by section 7.1. */
export const apiKeysTables = {
  apiKeys,
} as const;

/**
 * projection_records — one-way external mirror state (section 7.3 / S-AIRTABLE).
 * SCHEMA: id, system (airtable), entity_type, internal_id, external_id, source_version, updated_at
 * Upsert key: (system, entity_type, internal_id). Never SoR; Airtable may lag.
 */
export const projectionRecords = sqliteTable(
  "projection_records",
  {
    id: text("id").primaryKey().notNull(),
    system: text("system").notNull(),
    entityType: text("entity_type").notNull(),
    internalId: text("internal_id").notNull(),
    externalId: text("external_id"),
    sourceVersion: integer("source_version").notNull().default(1),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("idx_projection_records_system_entity_internal").on(
      t.system,
      t.entityType,
      t.internalId,
    ),
    index("idx_projection_records_system").on(t.system),
    index("idx_projection_records_internal_id").on(t.internalId),
  ],
);

/** Projection tables owned by section 7.3. */
export const projectionTables = {
  projectionRecords,
} as const;

/**
 * saved_views — F3 data-grid primitive (migration 0037).
 * Per (user, event, surface) grid definitions: columns/order/widths/sort/filters/density.
 */
export const savedViews = sqliteTable(
  "saved_views",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    surface: text("surface").notNull(),
    name: text("name").notNull(),
    definitionJson: text("definition_json").notNull(),
    isDefault: integer("is_default").notNull().default(0),
    version: integer("version").notNull().default(1),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_saved_views_user_event_surface").on(
      t.userId,
      t.eventId,
      t.surface,
    ),
  ],
);

export const gridTables = {
  savedViews,
} as const;

/**
 * search_documents — F5 global Find projection (migration 0038).
 * FTS5 virtual table search_documents_fts is SQL-only (not Drizzle-mapped).
 */
export const searchDocuments = sqliteTable(
  "search_documents",
  {
    id: text("id").primaryKey().notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    eventId: text("event_id").notNull(),
    title: text("title").notNull().default(""),
    body: text("body").notNull().default(""),
    ownerUserId: text("owner_user_id"),
    participationId: text("participation_id"),
    status: text("status"),
    route: text("route").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("idx_search_docs_event_type").on(t.eventId, t.entityType),
    index("idx_search_docs_event_owner").on(t.eventId, t.ownerUserId),
    index("idx_search_docs_event_part").on(t.eventId, t.participationId),
    index("idx_search_docs_entity").on(t.entityType, t.entityId),
  ],
);

export const searchTables = {
  searchDocuments,
} as const;

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type NewOutboxEvent = typeof outboxEvents.$inferInsert;
export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AuthSession = typeof authSessions.$inferSelect;
export type NewAuthSession = typeof authSessions.$inferInsert;
export type MagicLink = typeof magicLinks.$inferSelect;
export type NewMagicLink = typeof magicLinks.$inferInsert;
export type EventMembership = typeof eventMemberships.$inferSelect;
export type NewEventMembership = typeof eventMemberships.$inferInsert;
export type Room = typeof rooms.$inferSelect;
export type NewRoom = typeof rooms.$inferInsert;
export type Track = typeof tracks.$inferSelect;
export type NewTrack = typeof tracks.$inferInsert;
export type DesignTokenDraft = typeof designTokenDrafts.$inferSelect;
export type NewDesignTokenDraft = typeof designTokenDrafts.$inferInsert;
export type DesignTokenPublishedRow = typeof designTokenPublished.$inferSelect;
export type NewDesignTokenPublished = typeof designTokenPublished.$inferInsert;
export type FileAsset = typeof fileAssets.$inferSelect;
export type NewFileAsset = typeof fileAssets.$inferInsert;
export type Form = typeof forms.$inferSelect;
export type NewForm = typeof forms.$inferInsert;
export type FormVersion = typeof formVersions.$inferSelect;
export type NewFormVersion = typeof formVersions.$inferInsert;
export type FormField = typeof formFields.$inferSelect;
export type NewFormField = typeof formFields.$inferInsert;
export type FormRule = typeof formRules.$inferSelect;
export type NewFormRule = typeof formRules.$inferInsert;
export type Person = typeof people.$inferSelect;
export type NewPerson = typeof people.$inferInsert;
export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;
export type SubmissionAnswer = typeof submissionAnswers.$inferSelect;
export type NewSubmissionAnswer = typeof submissionAnswers.$inferInsert;
export type SubmissionSpeaker = typeof submissionSpeakers.$inferSelect;
export type NewSubmissionSpeaker = typeof submissionSpeakers.$inferInsert;
export type EvalRound = typeof evalRounds.$inferSelect;
export type NewEvalRound = typeof evalRounds.$inferInsert;
export type EvalCriterion = typeof evalCriteria.$inferSelect;
export type NewEvalCriterion = typeof evalCriteria.$inferInsert;
export type EvalAssignment = typeof evalAssignments.$inferSelect;
export type NewEvalAssignment = typeof evalAssignments.$inferInsert;
export type Score = typeof scores.$inferSelect;
export type NewScore = typeof scores.$inferInsert;
export type Decision = typeof decisions.$inferSelect;
export type NewDecision = typeof decisions.$inferInsert;
export type EventParticipation = typeof eventParticipations.$inferSelect;
export type NewEventParticipation = typeof eventParticipations.$inferInsert;
export type ProgramSession = typeof programSessions.$inferSelect;
export type NewProgramSession = typeof programSessions.$inferInsert;
export type SessionSpeaker = typeof sessionSpeakers.$inferSelect;
export type NewSessionSpeaker = typeof sessionSpeakers.$inferInsert;
export type TaskTemplate = typeof taskTemplates.$inferSelect;
export type NewTaskTemplate = typeof taskTemplates.$inferInsert;
export type SpeakerTask = typeof speakerTasks.$inferSelect;
export type NewSpeakerTask = typeof speakerTasks.$inferInsert;
export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type NewEmailTemplate = typeof emailTemplates.$inferInsert;
export type MessageJob = typeof messageJobs.$inferSelect;
export type NewMessageJob = typeof messageJobs.$inferInsert;
export type MessageRecipient = typeof messageRecipients.$inferSelect;
export type NewMessageRecipient = typeof messageRecipients.$inferInsert;
export type DeliveryEvent = typeof deliveryEvents.$inferSelect;
export type NewDeliveryEvent = typeof deliveryEvents.$inferInsert;
export type CalendarInvite = typeof calendarInvites.$inferSelect;
export type NewCalendarInvite = typeof calendarInvites.$inferInsert;
export type SchedulePlacement = typeof schedulePlacements.$inferSelect;
export type NewSchedulePlacement = typeof schedulePlacements.$inferInsert;
export type RoomBlockReservation = typeof roomBlockReservations.$inferSelect;
export type NewRoomBlockReservation = typeof roomBlockReservations.$inferInsert;
export type SpeakerBlockReservation =
  typeof speakerBlockReservations.$inferSelect;
export type NewSpeakerBlockReservation =
  typeof speakerBlockReservations.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type ProjectionRecord = typeof projectionRecords.$inferSelect;
export type NewProjectionRecord = typeof projectionRecords.$inferInsert;

/** Full schema object for drizzle(..., { schema }). */
export const schema = {
  organizations,
  events,
  auditEvents,
  outboxEvents,
  idempotencyKeys,
  users,
  authSessions,
  magicLinks,
  eventMemberships,
  rooms,
  tracks,
  designTokenDrafts,
  designTokenPublished,
  fileAssets,
  forms,
  formVersions,
  formFields,
  formRules,
  people,
  submissions,
  submissionAnswers,
  submissionSpeakers,
  evalRounds,
  evalCriteria,
  evalAssignments,
  scores,
  decisions,
  eventParticipations,
  programSessions,
  sessionSpeakers,
  taskTemplates,
  speakerTasks,
  emailTemplates,
  messageJobs,
  messageRecipients,
  deliveryEvents,
  calendarInvites,
  schedulePlacements,
  roomBlockReservations,
  speakerBlockReservations,
  apiKeys,
  projectionRecords,
  savedViews,
  searchDocuments,
  programmePublications,
  portalForms,
  portalFormResponses,
  portalResources,
  fileRequests,
} as const;

export type SavedView = typeof savedViews.$inferSelect;
export type NewSavedView = typeof savedViews.$inferInsert;
export type SearchDocument = typeof searchDocuments.$inferSelect;
export type NewSearchDocument = typeof searchDocuments.$inferInsert;
export type ProgrammePublication = typeof programmePublications.$inferSelect;
export type NewProgrammePublication = typeof programmePublications.$inferInsert;
export type PortalForm = typeof portalForms.$inferSelect;
export type NewPortalForm = typeof portalForms.$inferInsert;
export type PortalFormResponse = typeof portalFormResponses.$inferSelect;
export type NewPortalFormResponse = typeof portalFormResponses.$inferInsert;
export type PortalResource = typeof portalResources.$inferSelect;
export type NewPortalResource = typeof portalResources.$inferInsert;
export type FileRequest = typeof fileRequests.$inferSelect;
export type NewFileRequest = typeof fileRequests.$inferInsert;

