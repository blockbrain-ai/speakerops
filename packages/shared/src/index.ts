/**
 * @speakerops/shared — shared DTOs, Zod schemas, E4 error envelope.
 * Imported by apps/web, apps/api, and packages/cli (no duplicate types).
 */
export {
  ErrorEnvelopeSchema,
  type ErrorEnvelope,
  type ErrorCode,
  errorEnvelope,
  VALIDATION_ERROR,
  UNAUTHORIZED,
  FORBIDDEN,
  NOT_FOUND,
  CONFLICT,
  INTERNAL_ERROR,
} from "./errors.js";

export { HEALTH_OK, type HealthResponse, HealthResponseSchema } from "./health.js";

export { uuidv7, isUuidv7 } from "./uuid.js";

export {
  EventRoleSchema,
  type EventRole,
  MagicLinkPurposeSchema,
  type MagicLinkPurpose,
  RequestMagicLinkBodySchema,
  type RequestMagicLinkBody,
  RequestMagicLinkResponseSchema,
  type RequestMagicLinkResponse,
  ExchangeMagicLinkBodySchema,
  type ExchangeMagicLinkBody,
  ExchangeMagicLinkResponseSchema,
  type ExchangeMagicLinkResponse,
  SESSION_COOKIE_NAME,
  MAGIC_LINK_TTL_MINUTES,
  SESSION_TTL_DAYS,
  DEFAULT_BOOTSTRAP_EVENT_ID,
  EventListItemSchema,
  type EventListItem,
  EventListResponseSchema,
  type EventListResponse,
  SchedulePlaceBodySchema,
  type SchedulePlaceBody,
  SchedulePlaceResponseSchema,
  type SchedulePlaceResponse,
} from "./auth.js";

export {
  DEFAULT_ORG_ID,
  TimezoneSchema,
  EventSchema,
  type EventDto,
  EventCreateBodySchema,
  type EventCreateBody,
  EventResponseSchema,
  type EventResponse,
  EventUpdateBodySchema,
  type EventUpdateBody,
  EventListItemFullSchema,
  type EventListItemFull,
  EventListResponseFullSchema,
  type EventListResponseFull,
  RoomSchema,
  type RoomDto,
  RoomUpsertBodySchema,
  type RoomUpsertBody,
  RoomResponseSchema,
  type RoomResponse,
  RoomListResponseSchema,
  type RoomListResponse,
  TrackSchema,
  type TrackDto,
  TrackUpsertBodySchema,
  type TrackUpsertBody,
  TrackResponseSchema,
  type TrackResponse,
  TrackListResponseSchema,
  type TrackListResponse,
} from "./events.js";
