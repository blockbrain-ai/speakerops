/**
 * Unit tests for readiness helpers (section 6.3).
 */
import { describe, it, expect } from "vitest";
import {
  READINESS_POLL_MS,
  SPEAKERS_PAGE_SIZE,
  paginateSlice,
  speakerDetailPath,
  participationIdFromSearch,
} from "./readiness-utils.js";

describe("readiness-utils", () => {
  it("live poll interval is ≤5s", () => {
    expect(READINESS_POLL_MS).toBeGreaterThan(0);
    expect(READINESS_POLL_MS).toBeLessThanOrEqual(5_000);
  });

  it("paginateSlice windows 150-row list", () => {
    const items = Array.from({ length: 150 }, (_, i) => i);
    const first = paginateSlice(items, 1, SPEAKERS_PAGE_SIZE);
    expect(first.pageItems).toHaveLength(SPEAKERS_PAGE_SIZE);
    expect(first.total).toBe(150);
    expect(first.totalPages).toBe(Math.ceil(150 / SPEAKERS_PAGE_SIZE));
    expect(first.pageItems[0]).toBe(0);

    const last = paginateSlice(items, first.totalPages, SPEAKERS_PAGE_SIZE);
    expect(last.pageItems.length).toBeGreaterThan(0);
    expect(last.pageItems[last.pageItems.length - 1]).toBe(149);
  });

  it("speakerDetailPath + parse round-trip", () => {
    const path = speakerDetailPath("part_abc");
    expect(path).toContain("participationId=part_abc");
    expect(participationIdFromSearch("?participationId=part_abc")).toBe(
      "part_abc",
    );
    expect(participationIdFromSearch("")).toBeNull();
  });
});
