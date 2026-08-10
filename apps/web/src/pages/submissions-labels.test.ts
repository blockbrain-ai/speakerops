import { describe, it, expect } from "vitest";
import { humanizeFieldKey } from "./Submissions.js";

describe("submission answer labels", () => {
  it("humanizes snake_case field keys for operators", () => {
    expect(humanizeFieldKey("track_pref")).toBe("Track Pref");
    expect(humanizeFieldKey("talk_title")).toBe("Talk Title");
    expect(humanizeFieldKey("bio")).toBe("Bio");
  });
});
