/**
 * Post-11.9 depth Wave 2 — schedule-derived ICS picker (S-COMMS depth).
 *
 * J13: the Comms ICS panel offers a picker of ACTUAL scheduled sessions
 *      (title + time + room) instead of hand-entered placement-id/ISO
 *      inputs. Generating uses the placement's real start/end/room through
 *      the existing Comms.IcsForPlacement (UID stable). Rescheduling then
 *      regenerating bumps SEQUENCE and carries the new real times.
 *
 * Inventory: @inv:J13 (one test).
 * Requires E2E_WEB_SERVER=1 (pnpm test:e2e). New critical spec → retries 0.
 */
import { test, expect } from "@playwright/test";
import {
  loginAs,
  ensureEvent,
  selectAdminEvent,
  sessionHeaders,
} from "./helpers/cfp-eval-seed";

test.describe.configure({ retries: 0 });

test.describe("Wave 2 — schedule-derived ICS picker", () => {
  test("@inv:J13 e2e/comms/ics-picker scheduled session picked → invite real times; reschedule bumps SEQUENCE", async ({
    page,
    request,
    context,
    baseURL,
  }) => {
    const stamp = Date.now();
    const admin = await loginAs(
      request,
      context,
      baseURL,
      `e2e-j13-admin-${stamp}@example.com`,
      "admin",
    );
    const event = await ensureEvent(
      request,
      admin.session,
      `Depth ICS ${stamp}`,
    );

    // Seed a room + direct session + placement via API (prerequisites only).
    const roomId = `room_j13_${stamp}`;
    const roomRes = await request.put(
      `/api/events/${event.id}/rooms/${roomId}`,
      {
        headers: sessionHeaders(admin.session),
        data: { name: "Main Hall" },
      },
    );
    expect([200, 201]).toContain(roomRes.status());

    const sessionTitle = `Keynote ${stamp}`;
    const sessionRes = await request.post(
      `/api/events/${event.id}/sessions/direct`,
      {
        headers: sessionHeaders(admin.session),
        data: { title: sessionTitle, speakers: [] },
      },
    );
    expect(sessionRes.status()).toBe(201);
    const sessionId = ((await sessionRes.json()) as {
      session: { id: string };
    }).session.id;

    const START_1 = "2026-06-01T10:00:00.000Z";
    const END_1 = "2026-06-01T11:00:00.000Z";
    const placeRes = await request.post(
      `/api/events/${event.id}/schedule/place`,
      {
        headers: sessionHeaders(admin.session),
        data: { sessionId, roomId, startsAt: START_1, endsAt: END_1 },
      },
    );
    expect(placeRes.status()).toBe(201);
    const placement = ((await placeRes.json()) as {
      placement: { id: string; version: number };
    }).placement;

    // —— Real browser: the picker lists the actual scheduled session ——
    await selectAdminEvent(page, baseURL, event.id, "/admin/comms");
    const picker = page.getByTestId("comms-ics-placement-select");
    await expect(picker).toBeVisible();
    const optionLabel = await picker
      .locator(`option[value="${placement.id}"]`)
      .textContent();
    expect(optionLabel).toContain(sessionTitle);
    expect(optionLabel).toContain("Main Hall");
    expect(optionLabel).toContain("10:00");

    await picker.selectOption(placement.id);
    await page.getByTestId("comms-ics-generate").click();
    await expect(page.getByTestId("comms-ics-status")).toContainText(
      "SEQUENCE 0",
    );

    const inviteRow = page.getByTestId(`comms-ics-invite-${placement.id}`);
    await expect(inviteRow).toBeVisible();
    await expect(inviteRow).toHaveAttribute("data-sequence", "0");
    await expect(inviteRow).toHaveAttribute("data-starts-at", START_1);
    await expect(inviteRow).toHaveAttribute("data-ends-at", END_1);

    // DTO: the stored invite carries the placement's REAL times + room.
    const listRes1 = await request.get(`/api/events/${event.id}/comms/ics`, {
      headers: sessionHeaders(admin.session),
    });
    expect(listRes1.status()).toBe(200);
    const invites1 = ((await listRes1.json()) as {
      invites: Array<{
        placementId: string;
        uid: string;
        sequence: number;
        startsAt: string | null;
        endsAt: string | null;
        location: string | null;
        icsBody: string;
        summary: string | null;
      }>;
    }).invites;
    const invite1 = invites1.find((i) => i.placementId === placement.id);
    expect(invite1).toBeTruthy();
    expect(invite1!.startsAt).toBe(START_1);
    expect(invite1!.endsAt).toBe(END_1);
    expect(invite1!.location).toBe("Main Hall");
    expect(invite1!.summary).toBe(sessionTitle);
    expect(invite1!.icsBody).toContain("DTSTART:20260601T100000Z");

    // —— Reschedule via the schedule API, regenerate → SEQUENCE bumps ——
    const START_2 = "2026-06-01T12:00:00.000Z";
    const END_2 = "2026-06-01T13:00:00.000Z";
    const moveRes = await request.post(
      `/api/events/${event.id}/schedule/move`,
      {
        headers: sessionHeaders(admin.session),
        data: {
          placementId: placement.id,
          roomId,
          startsAt: START_2,
          endsAt: END_2,
          expectedVersion: placement.version,
        },
      },
    );
    expect(moveRes.status()).toBe(200);

    await page.getByTestId("comms-ics-refresh").click();
    // Wait until the picker option reflects the new time before regenerating.
    await expect(
      picker.locator(`option[value="${placement.id}"]`),
    ).toContainText("12:00");
    await picker.selectOption(placement.id);
    await page.getByTestId("comms-ics-generate").click();
    await expect(page.getByTestId("comms-ics-status")).toContainText(
      "SEQUENCE 1",
    );
    await expect(inviteRow).toHaveAttribute("data-sequence", "1");
    await expect(inviteRow).toHaveAttribute("data-starts-at", START_2);
    await expect(inviteRow).toHaveAttribute("data-ends-at", END_2);

    // DTO: same UID (stable), bumped SEQUENCE, new real times.
    const listRes2 = await request.get(`/api/events/${event.id}/comms/ics`, {
      headers: sessionHeaders(admin.session),
    });
    const invites2 = ((await listRes2.json()) as {
      invites: Array<{
        placementId: string;
        uid: string;
        sequence: number;
        startsAt: string | null;
        endsAt: string | null;
        icsBody: string;
      }>;
    }).invites;
    const invite2 = invites2.find((i) => i.placementId === placement.id);
    expect(invite2).toBeTruthy();
    expect(invite2!.uid).toBe(invite1!.uid);
    expect(invite2!.sequence).toBe(1);
    expect(invite2!.startsAt).toBe(START_2);
    expect(invite2!.icsBody).toContain("DTSTART:20260601T120000Z");
    expect(invite2!.icsBody).toContain("SEQUENCE:1");
  });
});
