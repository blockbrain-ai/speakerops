/**
 * Schedule placements + room/speaker block reservations (section 6.1 / S-SCHED).
 *
 * MemoryScheduleStore — unit tests / local e2e (no D1 required).
 * D1ScheduleStore — production SoR.
 * Event-scoped queries take eventId (E2).
 *
 * Conflict integrity:
 * - Timestamps normalized to UTC ISO before storage/compare.
 * - intervalsOverlap uses numeric epochs (offset-equivalent instants match).
 * - Overlap re-checked at the write boundary (not only command pre-check).
 * - Memory: single critical-section all-or-nothing apply.
 * - D1: single db.batch() for placement + reservations; conditional inserts
 *   with NOT EXISTS overlap + integrity abort so concurrent overlapping
 *   intervals cannot both commit and partial writes never stick.
 */
import { and, eq, sql } from "drizzle-orm";
import { uuidv7 } from "@speakerops/shared";
import {
  createDb,
  type D1DatabaseLike,
  type SpeakerOpsDb,
  schedulePlacements,
  roomBlockReservations,
  speakerBlockReservations,
} from "@speakerops/db";
import { d1Changes } from "../auth/store.js";

export type PlacementRow = {
  id: string;
  eventId: string;
  sessionId: string;
  roomId: string;
  startsAt: string;
  endsAt: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type RoomReservationRow = {
  id: string;
  eventId: string;
  roomId: string;
  placementId: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
};

export type SpeakerReservationRow = {
  id: string;
  eventId: string;
  participationId: string;
  placementId: string;
  startsAt: string;
  endsAt: string;
  createdAt: string;
};

/** Atomic place payload: placement + one room res + N speaker res. */
export type PlacementWriteBundle = {
  placement: PlacementRow;
  roomReservation: RoomReservationRow;
  speakerReservations: SpeakerReservationRow[];
};

export type ScheduleStore = {
  findPlacementById(id: string): Promise<PlacementRow | null>;
  findPlacementBySession(sessionId: string): Promise<PlacementRow | null>;
  listPlacementsForEvent(eventId: string): Promise<PlacementRow[]>;

  /** Room reservations that overlap [startsAt, endsAt) for room in event. */
  listOverlappingRoomReservations(input: {
    eventId: string;
    roomId: string;
    startsAt: string;
    endsAt: string;
    /** Exclude this placement (Move self). */
    excludePlacementId?: string;
  }): Promise<RoomReservationRow[]>;

  /** Speaker reservations that overlap for a participation. */
  listOverlappingSpeakerReservations(input: {
    eventId: string;
    participationId: string;
    startsAt: string;
    endsAt: string;
    excludePlacementId?: string;
  }): Promise<SpeakerReservationRow[]>;

  listSpeakerReservationsForPlacement(
    placementId: string,
  ): Promise<SpeakerReservationRow[]>;

  /**
   * Insert placement + reservations. Fails closed if any unique/overlap hits.
   * Returns false on constraint / version race / hard conflict.
   */
  insertPlacementBundle(bundle: PlacementWriteBundle): Promise<boolean>;

  /**
   * Conditional update: WHERE id AND version = expectedVersion, then replace reservations.
   * Returns null on missing row, version conflict, or hard conflict.
   * Never leaves a placement without its reservations.
   */
  updatePlacementBundle(
    expectedVersion: number,
    bundle: PlacementWriteBundle,
  ): Promise<PlacementRow | null>;

  /**
   * Conditional delete: WHERE id AND version = expectedVersion; frees reservations.
   * Returns false on missing / version conflict.
   * Never frees reservations without deleting the placement (and vice versa).
   */
  deletePlacementBundle(
    placementId: string,
    expectedVersion: number,
  ): Promise<boolean>;
};

export function newPlacementId(): string {
  return uuidv7();
}
export function newReservationId(): string {
  return uuidv7();
}

/**
 * Normalize any Date.parse-compatible instant to canonical UTC ISO.
 * Ensures equivalent offsets compare equal and store under one form.
 */
export function normalizeIsoUtc(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toISOString();
}

/** Half-open style overlap via numeric epochs (not string lexicographic). */
export function intervalsOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  const as = Date.parse(aStart);
  const ae = Date.parse(aEnd);
  const bs = Date.parse(bStart);
  const be = Date.parse(bEnd);
  if (
    !Number.isFinite(as) ||
    !Number.isFinite(ae) ||
    !Number.isFinite(bs) ||
    !Number.isFinite(be)
  ) {
    // Fall back to lexicographic only for unparseable inputs (should not happen).
    return aStart < bEnd && aEnd > bStart;
  }
  return as < be && ae > bs;
}

/** Normalize all interval timestamps in a write bundle to UTC ISO. */
export function normalizePlacementBundle(
  bundle: PlacementWriteBundle,
): PlacementWriteBundle {
  const startsAt = normalizeIsoUtc(bundle.placement.startsAt);
  const endsAt = normalizeIsoUtc(bundle.placement.endsAt);
  return {
    placement: {
      ...bundle.placement,
      startsAt,
      endsAt,
      createdAt: normalizeIsoUtc(bundle.placement.createdAt),
      updatedAt: normalizeIsoUtc(bundle.placement.updatedAt),
    },
    roomReservation: {
      ...bundle.roomReservation,
      startsAt,
      endsAt,
      createdAt: normalizeIsoUtc(bundle.roomReservation.createdAt),
    },
    speakerReservations: bundle.speakerReservations.map((s) => ({
      ...s,
      startsAt,
      endsAt,
      createdAt: normalizeIsoUtc(s.createdAt),
    })),
  };
}

/**
 * In-memory schedule store — unit tests + e2e without D1.
 */
export class MemoryScheduleStore implements ScheduleStore {
  private placements = new Map<string, PlacementRow>();
  private bySession = new Map<string, string>();
  private roomRes = new Map<string, RoomReservationRow>();
  private speakerRes = new Map<string, SpeakerReservationRow>();

  async findPlacementById(id: string): Promise<PlacementRow | null> {
    const row = this.placements.get(id);
    return row ? { ...row } : null;
  }

  async findPlacementBySession(
    sessionId: string,
  ): Promise<PlacementRow | null> {
    const id = this.bySession.get(sessionId);
    if (!id) return null;
    return this.findPlacementById(id);
  }

  async listPlacementsForEvent(eventId: string): Promise<PlacementRow[]> {
    return [...this.placements.values()]
      .filter((p) => p.eventId === eventId)
      .map((p) => ({ ...p }));
  }

  async listOverlappingRoomReservations(input: {
    eventId: string;
    roomId: string;
    startsAt: string;
    endsAt: string;
    excludePlacementId?: string;
  }): Promise<RoomReservationRow[]> {
    const startsAt = normalizeIsoUtc(input.startsAt);
    const endsAt = normalizeIsoUtc(input.endsAt);
    return [...this.roomRes.values()]
      .filter(
        (r) =>
          r.eventId === input.eventId &&
          r.roomId === input.roomId &&
          (input.excludePlacementId
            ? r.placementId !== input.excludePlacementId
            : true) &&
          intervalsOverlap(startsAt, endsAt, r.startsAt, r.endsAt),
      )
      .map((r) => ({ ...r }));
  }

  async listOverlappingSpeakerReservations(input: {
    eventId: string;
    participationId: string;
    startsAt: string;
    endsAt: string;
    excludePlacementId?: string;
  }): Promise<SpeakerReservationRow[]> {
    const startsAt = normalizeIsoUtc(input.startsAt);
    const endsAt = normalizeIsoUtc(input.endsAt);
    return [...this.speakerRes.values()]
      .filter(
        (r) =>
          r.eventId === input.eventId &&
          r.participationId === input.participationId &&
          (input.excludePlacementId
            ? r.placementId !== input.excludePlacementId
            : true) &&
          intervalsOverlap(startsAt, endsAt, r.startsAt, r.endsAt),
      )
      .map((r) => ({ ...r }));
  }

  async listSpeakerReservationsForPlacement(
    placementId: string,
  ): Promise<SpeakerReservationRow[]> {
    return [...this.speakerRes.values()]
      .filter((r) => r.placementId === placementId)
      .map((r) => ({ ...r }));
  }

  /** Write-boundary hard conflict (room + speaker overlap). */
  private hasHardConflict(
    bundle: PlacementWriteBundle,
    excludePlacementId?: string,
  ): boolean {
    for (const r of this.roomRes.values()) {
      if (
        r.eventId === bundle.roomReservation.eventId &&
        r.roomId === bundle.roomReservation.roomId &&
        (excludePlacementId ? r.placementId !== excludePlacementId : true) &&
        intervalsOverlap(
          bundle.roomReservation.startsAt,
          bundle.roomReservation.endsAt,
          r.startsAt,
          r.endsAt,
        )
      ) {
        return true;
      }
    }
    for (const s of bundle.speakerReservations) {
      for (const existing of this.speakerRes.values()) {
        if (
          existing.eventId === s.eventId &&
          existing.participationId === s.participationId &&
          (excludePlacementId
            ? existing.placementId !== excludePlacementId
            : true) &&
          intervalsOverlap(s.startsAt, s.endsAt, existing.startsAt, existing.endsAt)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  async insertPlacementBundle(bundle: PlacementWriteBundle): Promise<boolean> {
    const b = normalizePlacementBundle(bundle);
    if (this.placements.has(b.placement.id)) return false;
    if (this.bySession.has(b.placement.sessionId)) return false;

    // Write-boundary overlap (not only exact unique keys).
    if (this.hasHardConflict(b)) return false;

    // Atomic: all-or-nothing
    this.placements.set(b.placement.id, { ...b.placement });
    this.bySession.set(b.placement.sessionId, b.placement.id);
    this.roomRes.set(b.roomReservation.id, { ...b.roomReservation });
    for (const s of b.speakerReservations) {
      this.speakerRes.set(s.id, { ...s });
    }
    return true;
  }

  async updatePlacementBundle(
    expectedVersion: number,
    bundle: PlacementWriteBundle,
  ): Promise<PlacementRow | null> {
    const b = normalizePlacementBundle(bundle);
    const existing = this.placements.get(b.placement.id);
    if (!existing || existing.version !== expectedVersion) return null;
    if (existing.sessionId !== b.placement.sessionId) return null;

    // Check conflicts against others *before* mutating maps (no partial free).
    if (this.hasHardConflict(b, b.placement.id)) return null;

    const next: PlacementRow = {
      ...b.placement,
      version: expectedVersion + 1,
    };

    // Atomic replace: remove old reservations then install new state together.
    for (const [id, r] of [...this.roomRes.entries()]) {
      if (r.placementId === b.placement.id) this.roomRes.delete(id);
    }
    for (const [id, r] of [...this.speakerRes.entries()]) {
      if (r.placementId === b.placement.id) this.speakerRes.delete(id);
    }
    this.placements.set(next.id, next);
    this.bySession.set(next.sessionId, next.id);
    this.roomRes.set(b.roomReservation.id, { ...b.roomReservation });
    for (const s of b.speakerReservations) {
      this.speakerRes.set(s.id, { ...s });
    }
    return { ...next };
  }

  async deletePlacementBundle(
    placementId: string,
    expectedVersion: number,
  ): Promise<boolean> {
    const existing = this.placements.get(placementId);
    if (!existing || existing.version !== expectedVersion) return false;

    // Atomic free: placement + all reservations together.
    this.placements.delete(placementId);
    this.bySession.delete(existing.sessionId);
    for (const [id, r] of [...this.roomRes.entries()]) {
      if (r.placementId === placementId) this.roomRes.delete(id);
    }
    for (const [id, r] of [...this.speakerRes.entries()]) {
      if (r.placementId === placementId) this.speakerRes.delete(id);
    }
    return true;
  }
}

/**
 * D1-backed schedule store (production SoR).
 *
 * All multi-row mutations use a single db.batch() so placement + reservations
 * commit or roll back together. Reservation inserts are gated with
 * NOT EXISTS (overlap) and an integrity SELECT aborts the batch if counts
 * do not match, so concurrent overlapping intervals cannot both land and
 * placements are never left without reservations.
 */
export class D1ScheduleStore implements ScheduleStore {
  private db: SpeakerOpsDb;

  constructor(d1: D1DatabaseLike) {
    this.db = createDb(d1);
  }

  async findPlacementById(id: string): Promise<PlacementRow | null> {
    const rows = await this.db
      .select()
      .from(schedulePlacements)
      .where(eq(schedulePlacements.id, id))
      .limit(1);
    return rows[0] ? this.mapPlacement(rows[0]) : null;
  }

  async findPlacementBySession(
    sessionId: string,
  ): Promise<PlacementRow | null> {
    const rows = await this.db
      .select()
      .from(schedulePlacements)
      .where(eq(schedulePlacements.sessionId, sessionId))
      .limit(1);
    return rows[0] ? this.mapPlacement(rows[0]) : null;
  }

  async listPlacementsForEvent(eventId: string): Promise<PlacementRow[]> {
    const rows = await this.db
      .select()
      .from(schedulePlacements)
      .where(eq(schedulePlacements.eventId, eventId));
    return rows.map((r) => this.mapPlacement(r));
  }

  async listOverlappingRoomReservations(input: {
    eventId: string;
    roomId: string;
    startsAt: string;
    endsAt: string;
    excludePlacementId?: string;
  }): Promise<RoomReservationRow[]> {
    const startsAt = normalizeIsoUtc(input.startsAt);
    const endsAt = normalizeIsoUtc(input.endsAt);
    // Pull room's reservations for event then filter overlap (D1 has no range operators).
    const rows = await this.db
      .select()
      .from(roomBlockReservations)
      .where(
        and(
          eq(roomBlockReservations.eventId, input.eventId),
          eq(roomBlockReservations.roomId, input.roomId),
        ),
      );
    return rows
      .filter(
        (r) =>
          (input.excludePlacementId
            ? r.placementId !== input.excludePlacementId
            : true) &&
          intervalsOverlap(startsAt, endsAt, r.startsAt, r.endsAt),
      )
      .map((r) => this.mapRoomRes(r));
  }

  async listOverlappingSpeakerReservations(input: {
    eventId: string;
    participationId: string;
    startsAt: string;
    endsAt: string;
    excludePlacementId?: string;
  }): Promise<SpeakerReservationRow[]> {
    const startsAt = normalizeIsoUtc(input.startsAt);
    const endsAt = normalizeIsoUtc(input.endsAt);
    const rows = await this.db
      .select()
      .from(speakerBlockReservations)
      .where(
        and(
          eq(speakerBlockReservations.eventId, input.eventId),
          eq(
            speakerBlockReservations.participationId,
            input.participationId,
          ),
        ),
      );
    return rows
      .filter(
        (r) =>
          (input.excludePlacementId
            ? r.placementId !== input.excludePlacementId
            : true) &&
          intervalsOverlap(startsAt, endsAt, r.startsAt, r.endsAt),
      )
      .map((r) => this.mapSpeakerRes(r));
  }

  async listSpeakerReservationsForPlacement(
    placementId: string,
  ): Promise<SpeakerReservationRow[]> {
    const rows = await this.db
      .select()
      .from(speakerBlockReservations)
      .where(eq(speakerBlockReservations.placementId, placementId));
    return rows.map((r) => this.mapSpeakerRes(r));
  }

  /**
   * Integrity abort: 1/0 if placement lacks exactly one room res and N speaker res.
   * Aborts the surrounding D1 batch → full rollback (no partial write).
   */
  private integrityGuard(placementId: string, speakerCount: number) {
    return this.db.run(sql`
      SELECT 1 / (
        CASE
          WHEN (
            SELECT COUNT(*) FROM room_block_reservations
            WHERE placement_id = ${placementId}
          ) = 1
          AND (
            SELECT COUNT(*) FROM speaker_block_reservations
            WHERE placement_id = ${placementId}
          ) = ${speakerCount}
          THEN 1
          ELSE 0
        END
      )
    `);
  }

  /** Room insert gated on placement existing + no overlapping room block. */
  private roomResInsertSelect(
    r: RoomReservationRow,
    placementVersion: number,
  ) {
    return this.db.insert(roomBlockReservations).select(
      this.db
        .select({
          id: sql<string>`${r.id}`.as("id"),
          eventId: sql<string>`${r.eventId}`.as("event_id"),
          roomId: sql<string>`${r.roomId}`.as("room_id"),
          placementId: sql<string>`${r.placementId}`.as("placement_id"),
          startsAt: sql<string>`${r.startsAt}`.as("starts_at"),
          endsAt: sql<string>`${r.endsAt}`.as("ends_at"),
          createdAt: sql<string>`${r.createdAt}`.as("created_at"),
        })
        .from(schedulePlacements)
        .where(
          and(
            eq(schedulePlacements.id, r.placementId),
            eq(schedulePlacements.version, placementVersion),
            sql`NOT EXISTS (
              SELECT 1 FROM room_block_reservations rbr
              WHERE rbr.event_id = ${r.eventId}
                AND rbr.room_id = ${r.roomId}
                AND rbr.placement_id != ${r.placementId}
                AND rbr.starts_at < ${r.endsAt}
                AND rbr.ends_at > ${r.startsAt}
            )`,
          ),
        )
        .limit(1),
    );
  }

  /** Speaker insert gated on placement version + no overlapping speaker block. */
  private speakerResInsertSelect(
    s: SpeakerReservationRow,
    placementVersion: number,
  ) {
    return this.db.insert(speakerBlockReservations).select(
      this.db
        .select({
          id: sql<string>`${s.id}`.as("id"),
          eventId: sql<string>`${s.eventId}`.as("event_id"),
          participationId: sql<string>`${s.participationId}`.as(
            "participation_id",
          ),
          placementId: sql<string>`${s.placementId}`.as("placement_id"),
          startsAt: sql<string>`${s.startsAt}`.as("starts_at"),
          endsAt: sql<string>`${s.endsAt}`.as("ends_at"),
          createdAt: sql<string>`${s.createdAt}`.as("created_at"),
        })
        .from(schedulePlacements)
        .where(
          and(
            eq(schedulePlacements.id, s.placementId),
            eq(schedulePlacements.version, placementVersion),
            sql`NOT EXISTS (
              SELECT 1 FROM speaker_block_reservations sbr
              WHERE sbr.event_id = ${s.eventId}
                AND sbr.participation_id = ${s.participationId}
                AND sbr.placement_id != ${s.placementId}
                AND sbr.starts_at < ${s.endsAt}
                AND sbr.ends_at > ${s.startsAt}
            )`,
          ),
        )
        .limit(1),
    );
  }

  async insertPlacementBundle(bundle: PlacementWriteBundle): Promise<boolean> {
    const b = normalizePlacementBundle(bundle);
    const speakerCount = b.speakerReservations.length;
    const placementInsert = this.db.insert(schedulePlacements).values({
      id: b.placement.id,
      eventId: b.placement.eventId,
      sessionId: b.placement.sessionId,
      roomId: b.placement.roomId,
      startsAt: b.placement.startsAt,
      endsAt: b.placement.endsAt,
      version: b.placement.version,
      createdAt: b.placement.createdAt,
      updatedAt: b.placement.updatedAt,
    });
    const roomInsert = this.roomResInsertSelect(
      b.roomReservation,
      b.placement.version,
    );
    const speakerInserts = b.speakerReservations.map((s) =>
      this.speakerResInsertSelect(s, b.placement.version),
    );
    const guard = this.integrityGuard(b.placement.id, speakerCount);

    try {
      // Single transactional batch: all-or-nothing (incl. integrity abort).
      if (speakerInserts.length === 0) {
        await this.db.batch([placementInsert, roomInsert, guard]);
      } else {
        await this.db.batch([
          placementInsert,
          roomInsert,
          speakerInserts[0]!,
          ...speakerInserts.slice(1),
          guard,
        ]);
      }
      return true;
    } catch {
      // Unique constraint, integrity abort (overlap), or FK — nothing committed.
      return false;
    }
  }

  async updatePlacementBundle(
    expectedVersion: number,
    bundle: PlacementWriteBundle,
  ): Promise<PlacementRow | null> {
    const b = normalizePlacementBundle(bundle);
    const nextVersion = expectedVersion + 1;
    const speakerCount = b.speakerReservations.length;

    // Version CAS — gates subsequent deletes/inserts via EXISTS on new version.
    const placementUpdate = this.db
      .update(schedulePlacements)
      .set({
        roomId: b.placement.roomId,
        startsAt: b.placement.startsAt,
        endsAt: b.placement.endsAt,
        version: nextVersion,
        updatedAt: b.placement.updatedAt,
      })
      .where(
        and(
          eq(schedulePlacements.id, b.placement.id),
          eq(schedulePlacements.version, expectedVersion),
        ),
      );

    // Free old reservations only if version CAS won (same batch visibility).
    const delSpeaker = this.db
      .delete(speakerBlockReservations)
      .where(
        and(
          eq(speakerBlockReservations.placementId, b.placement.id),
          sql`EXISTS (
            SELECT 1 FROM schedule_placements
            WHERE id = ${b.placement.id} AND version = ${nextVersion}
          )`,
        ),
      );
    const delRoom = this.db
      .delete(roomBlockReservations)
      .where(
        and(
          eq(roomBlockReservations.placementId, b.placement.id),
          sql`EXISTS (
            SELECT 1 FROM schedule_placements
            WHERE id = ${b.placement.id} AND version = ${nextVersion}
          )`,
        ),
      );

    const roomInsert = this.roomResInsertSelect(
      b.roomReservation,
      nextVersion,
    );
    const speakerInserts = b.speakerReservations.map((s) =>
      this.speakerResInsertSelect(s, nextVersion),
    );
    const guard = this.integrityGuard(b.placement.id, speakerCount);

    try {
      let results: unknown[];
      if (speakerInserts.length === 0) {
        results = await this.db.batch([
          placementUpdate,
          delSpeaker,
          delRoom,
          roomInsert,
          guard,
        ]);
      } else {
        results = await this.db.batch([
          placementUpdate,
          delSpeaker,
          delRoom,
          roomInsert,
          speakerInserts[0]!,
          ...speakerInserts.slice(1),
          guard,
        ]);
      }
      if (d1Changes(results[0]) === 0) {
        // Lost version CAS — batch may have no-op'd deletes/inserts; nothing applied.
        return null;
      }
      return this.findPlacementById(b.placement.id);
    } catch {
      // Integrity abort (overlap) or unique — full batch rolled back; placement unchanged.
      return null;
    }
  }

  async deletePlacementBundle(
    placementId: string,
    expectedVersion: number,
  ): Promise<boolean> {
    // Version-gate every delete so a lost CAS never frees reservations alone.
    const delSpeaker = this.db
      .delete(speakerBlockReservations)
      .where(
        and(
          eq(speakerBlockReservations.placementId, placementId),
          sql`EXISTS (
            SELECT 1 FROM schedule_placements
            WHERE id = ${placementId} AND version = ${expectedVersion}
          )`,
        ),
      );
    const delRoom = this.db
      .delete(roomBlockReservations)
      .where(
        and(
          eq(roomBlockReservations.placementId, placementId),
          sql`EXISTS (
            SELECT 1 FROM schedule_placements
            WHERE id = ${placementId} AND version = ${expectedVersion}
          )`,
        ),
      );
    const delPlacement = this.db
      .delete(schedulePlacements)
      .where(
        and(
          eq(schedulePlacements.id, placementId),
          eq(schedulePlacements.version, expectedVersion),
        ),
      );

    try {
      const results = await this.db.batch([delSpeaker, delRoom, delPlacement]);
      return d1Changes(results[2]) > 0;
    } catch {
      return false;
    }
  }

  private mapPlacement(row: {
    id: string;
    eventId: string;
    sessionId: string;
    roomId: string;
    startsAt: string;
    endsAt: string;
    version: number;
    createdAt: string;
    updatedAt: string;
  }): PlacementRow {
    return {
      id: row.id,
      eventId: row.eventId,
      sessionId: row.sessionId,
      roomId: row.roomId,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapRoomRes(row: {
    id: string;
    eventId: string;
    roomId: string;
    placementId: string;
    startsAt: string;
    endsAt: string;
    createdAt: string;
  }): RoomReservationRow {
    return {
      id: row.id,
      eventId: row.eventId,
      roomId: row.roomId,
      placementId: row.placementId,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      createdAt: row.createdAt,
    };
  }

  private mapSpeakerRes(row: {
    id: string;
    eventId: string;
    participationId: string;
    placementId: string;
    startsAt: string;
    endsAt: string;
    createdAt: string;
  }): SpeakerReservationRow {
    return {
      id: row.id,
      eventId: row.eventId,
      participationId: row.participationId,
      placementId: row.placementId,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      createdAt: row.createdAt,
    };
  }
}
