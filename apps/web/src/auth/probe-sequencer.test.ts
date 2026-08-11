/**
 * Deferred-response regression for the RequireRole guard race (Codex
 * fix-wave MUST_FIX #1): a stale slow "ok" probe must never overwrite a
 * newer 401/403 verdict. Tests the exact sequencer the guard commits
 * through — every guard verdict passes an isCurrent() gate.
 */
import { describe, it, expect } from "vitest";
import { createProbeSequencer } from "./RequireRole.js";

type Verdict = "ok" | "forbidden" | "unauthenticated";

/** Manually-resolvable probe, mirroring the guard's commit-through-gate shape. */
function deferredProbe(seq: ReturnType<typeof createProbeSequencer>) {
  const handle = seq.begin();
  let resolve!: (v: Verdict) => void;
  const settled = new Promise<Verdict>((r) => {
    resolve = r;
  });
  return {
    resolve,
    /** Commits only when this probe is still the newest — as the guard does. */
    async commitTo(target: { state: Verdict | null }) {
      const verdict = await settled;
      if (handle.isCurrent()) target.state = verdict;
    },
  };
}

describe("RequireRole probe sequencer (latest verdict wins)", () => {
  it("drops a stale slow ok that resolves after a newer forbidden", async () => {
    const seq = createProbeSequencer();
    const target = { state: null as Verdict | null };

    const slowOld = deferredProbe(seq); // e.g. mount probe, slow network
    const fastNew = deferredProbe(seq); // e.g. visibility re-probe after 403

    fastNew.resolve("forbidden");
    await fastNew.commitTo(target);
    expect(target.state).toBe("forbidden");

    slowOld.resolve("ok"); // delayed 200 arrives AFTER the newer 403
    await slowOld.commitTo(target);
    expect(target.state).toBe("forbidden"); // stale ok must not resurrect the shell
  });

  it("drops a stale slow forbidden after a newer ok (no spurious lockout)", async () => {
    const seq = createProbeSequencer();
    const target = { state: null as Verdict | null };

    const slowOld = deferredProbe(seq);
    const fastNew = deferredProbe(seq);

    fastNew.resolve("ok");
    await fastNew.commitTo(target);
    slowOld.resolve("forbidden");
    await slowOld.commitTo(target);
    expect(target.state).toBe("ok");
  });

  it("a single probe with no successor always commits", async () => {
    const seq = createProbeSequencer();
    const target = { state: null as Verdict | null };
    const only = deferredProbe(seq);
    only.resolve("unauthenticated");
    await only.commitTo(target);
    expect(target.state).toBe("unauthenticated");
  });

  it("three overlapping probes: only the newest commits regardless of order", async () => {
    const seq = createProbeSequencer();
    const target = { state: null as Verdict | null };
    const first = deferredProbe(seq);
    const second = deferredProbe(seq);
    const third = deferredProbe(seq);

    second.resolve("ok");
    await second.commitTo(target);
    expect(target.state).toBe(null); // superseded by third before resolving

    third.resolve("forbidden");
    await third.commitTo(target);
    first.resolve("ok");
    await first.commitTo(target);
    expect(target.state).toBe("forbidden");
  });
});
