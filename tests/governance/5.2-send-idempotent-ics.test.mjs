/**
 * Section 5.2 — governance / file assertions for send idempotent ICS.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const migrationPath = join(
  root,
  "packages",
  "db",
  "migrations",
  "0016_comms_send_ics.sql",
);
const schemaPath = join(root, "packages", "db", "schema.ts");
const icsPath = join(root, "apps", "api", "src", "modules", "comms", "ics.ts");
const sendPath = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "comms",
  "send.ts",
);
const consumerPath = join(
  root,
  "apps",
  "api",
  "src",
  "workers",
  "emailConsumer.ts",
);
const commandsPath = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "comms",
  "commands.ts",
);
const unitTest = join(
  root,
  "apps",
  "api",
  "src",
  "modules",
  "comms",
  "comms-send.test.ts",
);
const sectionDoc = join(root, "docs", "sections", "5.2-send-ics.md");
const secretsDoc = join(root, "docs", "SECRETS.md");
const openapiPath = join(root, "apps", "api", "src", "openapi.ts");
const contractsCommands = join(
  root,
  "KMS-competition",
  "initiative",
  "contracts",
  "COMMANDS.md",
);

describe("5.2 send idempotent ICS governance", () => {
  it("0016 migration creates recipients, delivery_events, calendar_invites", () => {
    assert.equal(existsSync(migrationPath), true, "0016_comms_send_ics.sql");
    const sql = readFileSync(migrationPath, "utf8");
    assert.match(sql, /message_recipients/i);
    assert.match(sql, /to_email/i);
    assert.match(sql, /delivery_events/i);
    assert.match(sql, /calendar_invites/i);
    assert.match(sql, /sequence/i);
    assert.match(sql, /\buid\b/i);
  });

  it("schema.ts defines 5.2 comms tables", () => {
    const src = readFileSync(schemaPath, "utf8");
    assert.match(src, /messageRecipients/);
    assert.match(src, /deliveryEvents/);
    assert.match(src, /calendarInvites/);
    assert.match(src, /toEmail|to_email/);
  });

  it("ICS UID/SEQUENCE helpers exist", () => {
    assert.equal(existsSync(icsPath), true);
    const src = readFileSync(icsPath, "utf8");
    assert.match(src, /stableIcsUid/);
    assert.match(src, /bumpSequence/);
    assert.match(src, /SEQUENCE/);
    assert.match(src, /METHOD/);
  });

  it("provider adapter defaults to sandbox", () => {
    assert.equal(existsSync(sendPath), true);
    const src = readFileSync(sendPath, "utf8");
    assert.match(src, /SandboxEmailProvider|sandbox/);
    assert.match(src, /resolveEmailProviderMode/);
    assert.match(src, /createEmailProvider/);
    assert.match(src, /RESEND_API_KEY/);
    // Default path returns sandbox
    assert.match(src, /return "sandbox"/);
  });

  it("email consumer drains outbox without request-path provider", () => {
    assert.equal(existsSync(consumerPath), true);
    const consumer = readFileSync(consumerPath, "utf8");
    assert.match(consumer, /processCommsOutbox/);
    assert.match(consumer, /COMMS_OUTBOX_TOPIC|comms\.send/);
    assert.match(consumer, /delivery|sandbox/i);
    const commands = readFileSync(commandsPath, "utf8");
    // Command path still enqueues only — no Resend SDK import
    assert.doesNotMatch(
      commands,
      /from\s+["'](?:resend|@sendgrid|@aws-sdk\/client-ses|nodemailer)/i,
    );
    assert.match(commands, /idempotency|enqueueSendAtomic/);
    // Recipients + outbox + idempotency + audit are a single atomic enqueue (E7).
    assert.match(
      commands,
      /enqueueSendAtomic|buildRecipientRows|materializeRecipients|insertRecipient/,
    );
  });

  it("named test assertions present", () => {
    assert.equal(existsSync(unitTest), true);
    const test = readFileSync(unitTest, "utf8");
    assert.match(test, /assert send without previewId 400/);
    assert.match(test, /assert same idempotencyKey returns same job id/);
    assert.match(test, /assert ICS uid stable across sequence\+\+ helper/);
  });

  it("section doc and secrets env names", () => {
    assert.equal(existsSync(sectionDoc), true);
    const doc = readFileSync(sectionDoc, "utf8");
    assert.match(doc, /J04|idempotent/i);
    assert.match(doc, /J08|preview/i);
    assert.match(doc, /J10|SEQUENCE/i);
    assert.match(doc, /[Ss]andbox/);
    const secrets = readFileSync(secretsDoc, "utf8");
    assert.match(secrets, /EMAIL_PROVIDER/);
    assert.match(secrets, /RESEND_API_KEY/);
  });

  it("OpenAPI and COMMANDS include Comms.Send and IcsForPlacement", () => {
    const openapi = readFileSync(openapiPath, "utf8");
    assert.match(openapi, /Comms\.Send/);
    assert.match(openapi, /Comms\.IcsForPlacement/);
    const contracts = readFileSync(contractsCommands, "utf8");
    assert.match(contracts, /Comms\.Send/);
    assert.match(contracts, /Comms\.IcsForPlacement/);
    assert.match(contracts, /\/api\/comms\/send/);
  });
});
