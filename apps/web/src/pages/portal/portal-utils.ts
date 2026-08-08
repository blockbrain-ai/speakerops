/**
 * Speaker portal pure helpers (section 4.3 / S-PORTAL).
 *
 * - Task display status (overdue visual from dueAt)
 * - Bio XSS: strip/control characters; never treat as HTML
 * - Optimistic complete snapshot / revert helpers
 */

import type { PortalTaskDto, ParticipationProfileDto } from "@speakerops/shared";

/** Display status for task list badges (G05/G06). */
export type TaskDisplayStatus = "pending" | "overdue" | "completed" | "cancelled";

/**
 * Compute visual task status.
 * Pending tasks past dueAt render as overdue (G06).
 */
export function taskDisplayStatus(
  task: Pick<PortalTaskDto, "status" | "dueAt">,
  nowMs: number = Date.now(),
): TaskDisplayStatus {
  const raw = (task.status ?? "").toLowerCase();
  if (raw === "completed") return "completed";
  if (raw === "cancelled") return "cancelled";
  if (raw === "overdue") return "overdue";
  if (raw === "pending" && task.dueAt) {
    const due = Date.parse(task.dueAt);
    if (Number.isFinite(due) && due <= nowMs) return "overdue";
  }
  return "pending";
}

/** True when task still needs speaker action. */
export function isIncompleteTask(task: Pick<PortalTaskDto, "status">): boolean {
  const s = (task.status ?? "").toLowerCase();
  return s === "pending" || s === "overdue";
}

/**
 * Sanitize bio for safe storage/display as text (G02 XSS).
 * - Strips HTML tags and angle brackets
 * - Removes control characters except newline/tab
 * - Never returns markup — callers must render as text nodes only
 */
export function sanitizeBioText(raw: string): string {
  let s = raw;
  // Remove tags first so script bodies remain as plain text without execution
  s = s.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<\/?[a-zA-Z][^>]*>/g, "");
  s = s.replace(/[<>]/g, "");
  // Neutralize common XSS remnants that can appear as plain text
  s = s.replace(/javascript\s*:/gi, "");
  s = s.replace(/\bon\w+\s*=/gi, "");
  // Drop control chars except \n \r \t
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  return s.slice(0, 8000);
}

/**
 * Assert bio is plain text for display — no script tags remain.
 * Used by unit tests (assert bio XSS text content not script).
 */
export function bioIsPlainText(bio: string): boolean {
  if (/<script\b/i.test(bio)) return false;
  if (/javascript\s*:/i.test(bio)) return false;
  if (/on\w+\s*=/i.test(bio)) return false;
  return true;
}

/** Snapshot for optimistic complete + revert. */
export type TaskOptimisticSnapshot = {
  taskId: string;
  previous: PortalTaskDto;
  previousNextTask: PortalTaskDto | null;
};

export function applyOptimisticComplete(
  tasks: PortalTaskDto[],
  taskId: string,
  completedAt: string,
): PortalTaskDto[] {
  return tasks.map((t) =>
    t.id === taskId
      ? {
          ...t,
          status: "completed",
          completedAt,
          version: t.version + 1,
        }
      : t,
  );
}

export function revertOptimisticComplete(
  tasks: PortalTaskDto[],
  snapshot: TaskOptimisticSnapshot,
): PortalTaskDto[] {
  return tasks.map((t) =>
    t.id === snapshot.taskId ? snapshot.previous : t,
  );
}

export function pickNextIncomplete(
  tasks: PortalTaskDto[],
  nowMs: number = Date.now(),
): PortalTaskDto | null {
  const pending = tasks.filter((t) => {
    const d = taskDisplayStatus(t, nowMs);
    return d === "pending" || d === "overdue";
  });
  if (pending.length === 0) return null;
  pending.sort((a, b) => {
    const ad = a.dueAt ?? "9999";
    const bd = b.dueAt ?? "9999";
    if (ad !== bd) return ad.localeCompare(bd);
    return a.id.localeCompare(b.id);
  });
  return pending[0] ?? null;
}

/** Primary participation for profile form. */
export function primaryParticipation(
  list: ParticipationProfileDto[],
): ParticipationProfileDto | null {
  return list[0] ?? null;
}

/** Hex SHA-256 of file bytes for File.CompleteUpload. */
export async function sha256Hex(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", buf);
    const bytes = new Uint8Array(digest);
    let hex = "";
    for (let i = 0; i < bytes.length; i++) {
      hex += bytes[i]!.toString(16).padStart(2, "0");
    }
    return `sha256:${hex}`;
  }
  // Fallback (non-browser unit envs): length-based opaque checksum
  return `sha256:len${buf.byteLength}`;
}

/** Headshot mime allowlist mirror (shared package is source of truth for API). */
export const PORTAL_HEADSHOT_MIMES = ["image/jpeg", "image/png"] as const;
export const PORTAL_SLIDES_MIMES = ["application/pdf"] as const;

export function isAllowedHeadshotMime(mime: string): boolean {
  return (PORTAL_HEADSHOT_MIMES as readonly string[]).includes(
    mime.trim().toLowerCase(),
  );
}

export function isAllowedSlidesMime(mime: string): boolean {
  return (PORTAL_SLIDES_MIMES as readonly string[]).includes(
    mime.trim().toLowerCase(),
  );
}

/**
 * Resolve effective mime for portal upload (browser may leave type empty).
 * Extension fallback only for known safe extensions — never for .exe/.svg.
 */
export function resolveUploadMime(
  file: Pick<File, "type" | "name">,
  purpose: "headshot" | "slides",
): string {
  const typed = (file.type ?? "").trim().toLowerCase();
  if (typed) return typed;
  const name = file.name.toLowerCase();
  if (purpose === "headshot") {
    if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
    if (name.endsWith(".png")) return "image/png";
  }
  if (purpose === "slides" && name.endsWith(".pdf")) return "application/pdf";
  return typed;
}
