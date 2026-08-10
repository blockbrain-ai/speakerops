/**
 * Pure helpers for evaluator queue round strip (active-round progress).
 */
import { isEvalRoundClosed, type EvalQueueItem } from "@speakerops/shared";

export type EvalRoundStripModel = {
  eventName: string;
  roundId: string;
  roundName: string;
  roundStatus: string;
  closesAt: string | null;
  /** Plain-text evaluator guidance from the round (never HTML). */
  instructionsMd: string | null;
  /** True when the round no longer accepts scores (status or deadline). */
  closed: boolean;
  done: number;
  total: number;
  pct: number;
};

function isComplete(item: EvalQueueItem): boolean {
  if (item.assignment.status === "scored") return true;
  // Abstained assignments leave the pending flow (post-11.9 depth).
  if (item.assignment.status === "abstained") return true;
  if (item.assignment.aggregateScore != null) return true;
  const scores = item.assignment.scores ?? [];
  if (item.criteria.length === 0) return false;
  return item.criteria.every((c) =>
    scores.some((s) => s.criterionId === c.id && s.value != null),
  );
}

/** Resolve the item that drives the strip: active, else first incomplete, else first. */
export function resolveStripSourceItem(
  items: EvalQueueItem[],
  activeId: string | null,
): EvalQueueItem | null {
  if (items.length === 0) return null;
  if (activeId) {
    const active = items.find((i) => i.assignment.id === activeId);
    if (active) return active;
  }
  const incomplete = items.find((i) => !isComplete(i));
  return incomplete ?? items[0]!;
}

/** Round-scoped progress for the strip's source item. */
export function buildEvalRoundStrip(
  items: EvalQueueItem[],
  activeId: string | null,
): EvalRoundStripModel | null {
  const source = resolveStripSourceItem(items, activeId);
  if (!source) return null;
  const roundId = source.round.id;
  const inRound = items.filter((i) => i.round.id === roundId);
  const total = inRound.length;
  const done = inRound.filter(isComplete).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return {
    eventName: source.event.name,
    roundId,
    roundName: source.round.name,
    roundStatus: source.round.status,
    closesAt: source.round.closesAt,
    instructionsMd: source.round.instructionsMd ?? null,
    closed: isEvalRoundClosed({
      status: source.round.status,
      closesAt: source.round.closesAt,
    }),
    done,
    total,
    pct,
  };
}

export function formatRoundDeadline(closesAt: string | null): string {
  if (!closesAt) return "No close date";
  const d = new Date(closesAt);
  if (Number.isNaN(d.getTime())) return closesAt;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
