import { describe, it, expect } from "vitest";
import { SpeakerOps, unwrap, SpeakerOpsError, toProgrammeProjection } from "./index.js";
import type { PublicProgrammeResponse } from "@speakerops/shared";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("@speakerops/sdk", () => {
  it("lists events with Bearer auth and unwraps the body", async () => {
    const calls: { url: string; headers: Headers }[] = [];
    const so = new SpeakerOps({
      baseUrl: "https://www.speakerops.org",
      apiKey: "spk_test",
      fetchImpl: async (input, init) => {
        const url = typeof input === "string" ? input : String(input);
        calls.push({ url, headers: new Headers(init?.headers) });
        return jsonResponse(200, { events: [{ id: "evt_1", name: "Demo" }] });
      },
    });
    const body = unwrap<{ events: Array<{ id: string }> }>(
      await so.events.list(),
    );
    expect(calls[0]?.url).toBe("https://www.speakerops.org/api/events");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer spk_test");
    expect(body.events[0]?.id).toBe("evt_1");
  });

  it("reads a public programme without sending Bearer when key is empty", async () => {
    const headersSeen: string[] = [];
    const so = new SpeakerOps({
      baseUrl: "https://www.speakerops.org",
      apiKey: "",
      fetchImpl: async (_input, init) => {
        headersSeen.push(new Headers(init?.headers).get("authorization") ?? "");
        const programme: PublicProgrammeResponse = {
          event: {
            id: "evt_1",
            name: "Demo",
            slug: "demo",
            timezone: "UTC",
            startsAt: null,
            endsAt: null,
          },
          publishedAt: "2026-08-13T00:00:00.000Z",
          version: 1,
          sessions: [
            {
              id: "ses_1",
              title: "Opening",
              description: null,
              trackId: null,
              trackName: null,
              trackColor: null,
              status: "accepted",
              speakers: [
                { participationId: "par_1", name: "Ada", isPrimary: true },
              ],
              startsAt: "2026-09-01T09:00:00.000Z",
              endsAt: "2026-09-01T09:30:00.000Z",
              roomId: "room_1",
              roomName: "Main",
            },
          ],
          speakers: [
            {
              id: "par_1",
              name: "Ada",
              title: "Engineer",
              company: "AIE",
              bio: "Hello",
              headshotUrl: null,
              roleLabel: null,
            },
          ],
          agenda: [],
        };
        return jsonResponse(200, programme);
      },
    });
    const snap = await so.programme.projectPublished("demo");
    expect(headersSeen[0]).toBe("");
    expect(snap.slug).toBe("demo");
    expect(snap.sessions).toHaveLength(1);
    expect(snap.speakers[0]?.name).toBe("Ada");
    expect(snap.sessions[0]?.speakerIds).toEqual(["par_1"]);
  });

  it("throws SpeakerOpsError on 403", async () => {
    const so = new SpeakerOps({
      baseUrl: "https://www.speakerops.org",
      apiKey: "spk_test",
      fetchImpl: async () =>
        jsonResponse(403, { error: "Missing scope", code: "FORBIDDEN" }),
    });
    await expect(async () => unwrap(await so.schedule.list("evt_1"))).rejects.toBeInstanceOf(
      SpeakerOpsError,
    );
  });

  it("maps a programme DTO into a projector snapshot", () => {
    const snap = toProgrammeProjection({
      event: {
        id: "e",
        name: "N",
        slug: "s",
        timezone: "UTC",
        startsAt: null,
        endsAt: null,
      },
      publishedAt: "t",
      version: 2,
      sessions: [],
      speakers: [],
      agenda: [],
    });
    expect(snap.version).toBe(2);
    expect(snap.sessions).toEqual([]);
  });

  it("rejects speaker update without expectedVersion and still builds integrations path", async () => {
    const urls: string[] = [];
    const so = new SpeakerOps({
      baseUrl: "http://127.0.0.1:8787",
      apiKey: "spk_test",
      fetchImpl: async (input) => {
        urls.push(typeof input === "string" ? input : String(input));
        return jsonResponse(200, { connections: [] });
      },
    });
    const denied = await so.speakers.updateProfile("evt 1", "par/2", {
      bio: "x",
    } as never);
    expect(denied.ok).toBe(false);
    expect(urls).toHaveLength(0);
    const ok = await so.speakers.updateProfile("evt 1", "par/2", {
      bio: "x",
      expectedVersion: 1,
    });
    expect(urls[0]).toContain("/api/events/evt%201/speakers/par%2F2");
    expect(ok.ok).toBe(false);
    await so.integrations.status("evt 1");
    expect(urls[1]).toContain("/api/events/evt%201/integrations");
  });

  it("does not forward Bearer to a different origin", async () => {
    const headers: string[] = [];
    const so = new SpeakerOps({
      baseUrl: "https://www.speakerops.org",
      apiKey: "spk_secret",
      fetchImpl: async (_input, init) => {
        headers.push(new Headers(init?.headers).get("authorization") ?? "");
        return jsonResponse(200, { ok: true });
      },
    });
    await so.request("GET", "https://example.invalid/collect");
    expect(headers[0]).toBe("");
    await so.events.list();
    expect(headers[1]).toBe("Bearer spk_secret");
  });

  it("rejects a full URL as an Accelevents eventUrl", async () => {
    const so = new SpeakerOps({
      baseUrl: "https://www.speakerops.org",
      apiKey: "spk_test",
      fetchImpl: async () => jsonResponse(200, {}),
    });
    const result = await so.integrations.saveAccelevents("evt_1", {
      eventUrl: "https://accelevents.com/my-event",
      externalEventId: "1",
      enabled: true,
    });
    expect(result.ok).toBe(false);
  });
});
