import { describe, it, expect } from "vitest";
import { formatAnswerValue, humanizeFieldKey } from "./Submissions.js";

describe("submission answer labels", () => {
  it("humanizes snake_case field keys for operators", () => {
    expect(humanizeFieldKey("track_pref")).toBe("Track Pref");
    expect(humanizeFieldKey("talk_title")).toBe("Talk Title");
    expect(humanizeFieldKey("bio")).toBe("Bio");
  });

  it("renders checkbox answers as Yes/No, never raw true/false", () => {
    expect(formatAnswerValue("true")).toBe("Yes");
    expect(formatAnswerValue("false")).toBe("No");
    expect(formatAnswerValue(true)).toBe("Yes");
    expect(formatAnswerValue(false)).toBe("No");
  });

  it("keeps an authored option label even when its value is true/false", () => {
    expect(
      formatAnswerValue("true", [{ value: "true", label: "Recording OK" }]),
    ).toBe("Recording OK");
  });

  it("leaves ordinary free-text answers untouched", () => {
    expect(formatAnswerValue("Truely great talk")).toBe("Truely great talk");
  });
});
