/**
 * N2 portal resources + N3 file requests — memory + D1.
 */
import { and, eq } from "drizzle-orm";
import {
  createDb,
  type D1DatabaseLike,
  type SpeakerOpsDb,
  portalResources,
  fileRequests,
} from "@speakerops/db";

export type ResourceRow = {
  id: string;
  eventId: string;
  title: string;
  bodyMd: string | null;
  status: "draft" | "published" | "archived";
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type FileRequestRow = {
  id: string;
  eventId: string;
  title: string;
  instructions: string | null;
  scope: "participation";
  status: "draft" | "published" | "archived";
  purpose: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type ResourcesStore = {
  listResources(eventId: string): Promise<ResourceRow[]>;
  insertResource(row: ResourceRow): Promise<ResourceRow>;
  updateResource(
    eventId: string,
    id: string,
    expectedVersion: number,
    patch: Partial<
      Pick<ResourceRow, "title" | "bodyMd" | "status" | "sortOrder" | "updatedAt">
    >,
  ): Promise<ResourceRow | null>;
  deleteResource(eventId: string, id: string): Promise<boolean>;
  listFileRequests(eventId: string): Promise<FileRequestRow[]>;
  insertFileRequest(row: FileRequestRow): Promise<FileRequestRow>;
  updateFileRequest(
    eventId: string,
    id: string,
    expectedVersion: number,
    patch: Partial<
      Pick<
        FileRequestRow,
        "title" | "instructions" | "status" | "purpose" | "updatedAt"
      >
    >,
  ): Promise<FileRequestRow | null>;
  deleteFileRequest(eventId: string, id: string): Promise<boolean>;
};

export class MemoryResourcesStore implements ResourcesStore {
  private resources = new Map<string, ResourceRow>();
  private requests = new Map<string, FileRequestRow>();

  private rk(eventId: string, id: string) {
    return `${eventId}\0${id}`;
  }

  async listResources(eventId: string) {
    return [...this.resources.values()]
      .filter((r) => r.eventId === eventId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  }
  async insertResource(row: ResourceRow) {
    this.resources.set(this.rk(row.eventId, row.id), { ...row });
    return { ...row };
  }
  async updateResource(
    eventId: string,
    id: string,
    expectedVersion: number,
    patch: Partial<
      Pick<ResourceRow, "title" | "bodyMd" | "status" | "sortOrder" | "updatedAt">
    >,
  ) {
    const cur = this.resources.get(this.rk(eventId, id));
    if (!cur || cur.version !== expectedVersion) return null;
    const next = { ...cur, ...patch, version: cur.version + 1 };
    this.resources.set(this.rk(eventId, id), next);
    return { ...next };
  }
  async deleteResource(eventId: string, id: string) {
    return this.resources.delete(this.rk(eventId, id));
  }

  async listFileRequests(eventId: string) {
    return [...this.requests.values()]
      .filter((r) => r.eventId === eventId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async insertFileRequest(row: FileRequestRow) {
    this.requests.set(this.rk(row.eventId, row.id), { ...row });
    return { ...row };
  }
  async updateFileRequest(
    eventId: string,
    id: string,
    expectedVersion: number,
    patch: Partial<
      Pick<
        FileRequestRow,
        "title" | "instructions" | "status" | "purpose" | "updatedAt"
      >
    >,
  ) {
    const cur = this.requests.get(this.rk(eventId, id));
    if (!cur || cur.version !== expectedVersion) return null;
    const next = { ...cur, ...patch, version: cur.version + 1 };
    this.requests.set(this.rk(eventId, id), next);
    return { ...next };
  }
  async deleteFileRequest(eventId: string, id: string) {
    return this.requests.delete(this.rk(eventId, id));
  }
}

export class D1ResourcesStore implements ResourcesStore {
  private readonly db: SpeakerOpsDb;
  constructor(d1: D1DatabaseLike) {
    this.db = createDb(d1);
  }

  async listResources(eventId: string) {
    const rows = await this.db
      .select()
      .from(portalResources)
      .where(eq(portalResources.eventId, eventId));
    return rows
      .map((r) => ({
        id: r.id,
        eventId: r.eventId,
        title: r.title,
        bodyMd: r.bodyMd ?? null,
        status: r.status as ResourceRow["status"],
        sortOrder: r.sortOrder,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        version: r.version,
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
  }

  async insertResource(row: ResourceRow) {
    await this.db.insert(portalResources).values({
      id: row.id,
      eventId: row.eventId,
      title: row.title,
      bodyMd: row.bodyMd,
      status: row.status,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      version: row.version,
    });
    return row;
  }

  async updateResource(
    eventId: string,
    id: string,
    expectedVersion: number,
    patch: Partial<
      Pick<ResourceRow, "title" | "bodyMd" | "status" | "sortOrder" | "updatedAt">
    >,
  ) {
    const list = await this.listResources(eventId);
    const cur = list.find((r) => r.id === id);
    if (!cur || cur.version !== expectedVersion) return null;
    await this.db
      .update(portalResources)
      .set({
        title: patch.title ?? cur.title,
        bodyMd: patch.bodyMd !== undefined ? patch.bodyMd : cur.bodyMd,
        status: patch.status ?? cur.status,
        sortOrder: patch.sortOrder ?? cur.sortOrder,
        updatedAt: patch.updatedAt ?? cur.updatedAt,
        version: cur.version + 1,
      })
      .where(
        and(
          eq(portalResources.eventId, eventId),
          eq(portalResources.id, id),
          eq(portalResources.version, expectedVersion),
        ),
      );
    const next = (await this.listResources(eventId)).find((r) => r.id === id);
    return next ?? null;
  }

  async deleteResource(eventId: string, id: string) {
    const list = await this.listResources(eventId);
    if (!list.some((r) => r.id === id)) return false;
    await this.db
      .delete(portalResources)
      .where(
        and(eq(portalResources.eventId, eventId), eq(portalResources.id, id)),
      );
    return true;
  }

  async listFileRequests(eventId: string) {
    const rows = await this.db
      .select()
      .from(fileRequests)
      .where(eq(fileRequests.eventId, eventId));
    return rows
      .map((r) => ({
        id: r.id,
        eventId: r.eventId,
        title: r.title,
        instructions: r.instructions ?? null,
        scope: "participation" as const,
        status: r.status as FileRequestRow["status"],
        purpose: r.purpose,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        version: r.version,
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async insertFileRequest(row: FileRequestRow) {
    await this.db.insert(fileRequests).values({
      id: row.id,
      eventId: row.eventId,
      title: row.title,
      instructions: row.instructions,
      scope: row.scope,
      status: row.status,
      purpose: row.purpose,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      version: row.version,
    });
    return row;
  }

  async updateFileRequest(
    eventId: string,
    id: string,
    expectedVersion: number,
    patch: Partial<
      Pick<
        FileRequestRow,
        "title" | "instructions" | "status" | "purpose" | "updatedAt"
      >
    >,
  ) {
    const list = await this.listFileRequests(eventId);
    const cur = list.find((r) => r.id === id);
    if (!cur || cur.version !== expectedVersion) return null;
    await this.db
      .update(fileRequests)
      .set({
        title: patch.title ?? cur.title,
        instructions:
          patch.instructions !== undefined
            ? patch.instructions
            : cur.instructions,
        status: patch.status ?? cur.status,
        purpose: patch.purpose ?? cur.purpose,
        updatedAt: patch.updatedAt ?? cur.updatedAt,
        version: cur.version + 1,
      })
      .where(
        and(
          eq(fileRequests.eventId, eventId),
          eq(fileRequests.id, id),
          eq(fileRequests.version, expectedVersion),
        ),
      );
    return (await this.listFileRequests(eventId)).find((r) => r.id === id) ?? null;
  }

  async deleteFileRequest(eventId: string, id: string) {
    const list = await this.listFileRequests(eventId);
    if (!list.some((r) => r.id === id)) return false;
    await this.db
      .delete(fileRequests)
      .where(and(eq(fileRequests.eventId, eventId), eq(fileRequests.id, id)));
    return true;
  }
}
