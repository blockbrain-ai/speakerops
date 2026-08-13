/**
 * Map a published programme into a stable snapshot other platforms can ingest.
 * This is a projector helper — it does not call third-party HTTP.
 */
import {
  PublicProgrammeResponseSchema,
  type PublicProgrammeResponse,
} from "@speakerops/shared";

export type ProgrammeProjectionSpeaker = {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  bio: string | null;
  headshotUrl: string | null;
};

export type ProgrammeProjectionSession = {
  id: string;
  title: string;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  roomName: string | null;
  trackName: string | null;
  speakerIds: string[];
  speakerNames: string[];
};

export type ProgrammeProjection = {
  eventId: string;
  eventName: string;
  slug: string;
  timezone: string;
  publishedAt: string;
  version: number;
  speakers: ProgrammeProjectionSpeaker[];
  sessions: ProgrammeProjectionSession[];
};

export function parsePublishedProgramme(
  body: unknown,
): PublicProgrammeResponse {
  const parsed = PublicProgrammeResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("Unexpected public programme response");
  }
  return parsed.data;
}

export function toProgrammeProjection(
  programme: PublicProgrammeResponse,
): ProgrammeProjection {
  return {
    eventId: programme.event.id,
    eventName: programme.event.name,
    slug: programme.event.slug,
    timezone: programme.event.timezone,
    publishedAt: programme.publishedAt,
    version: programme.version,
    speakers: programme.speakers.map((s) => ({
      id: s.id,
      name: s.name,
      title: s.title,
      company: s.company,
      bio: s.bio,
      headshotUrl: s.headshotUrl,
    })),
    sessions: programme.sessions.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      startsAt: s.startsAt,
      endsAt: s.endsAt,
      roomName: s.roomName,
      trackName: s.trackName,
      speakerIds: s.speakers.map((sp) => sp.participationId),
      speakerNames: s.speakers.map((sp) => sp.name),
    })),
  };
}
