/**
 * F3 column manager — visibility toggles + dnd-kit reorder.
 * Two-pane pattern simplified to a single ordered checklist (selected order
 * = visible columns; unchecked stay available below via search).
 */
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMemo, useState } from "react";

export type ColumnManagerItem = {
  id: string;
  label: string;
};

export type ColumnManagerProps = {
  /** All columns the surface can show (allowlist order as fallback). */
  available: ColumnManagerItem[];
  /** Visible columns in display order. */
  order: string[];
  onChange: (next: { order: string[]; visibility: Record<string, boolean> }) => void;
  "data-testid"?: string;
};

function SortableRow({
  id,
  label,
  checked,
  onToggle,
}: {
  id: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="l2-col-manager__item"
      data-dragging={isDragging ? "true" : undefined}
      data-testid={`col-manager-item-${id}`}
    >
      <button
        type="button"
        className="l2-col-manager__handle lumen-focusable"
        aria-label={`Reorder ${label}`}
        {...attributes}
        {...listeners}
        data-testid={`col-manager-handle-${id}`}
      >
        ⋮⋮
      </button>
      <label className="l2-col-manager__label">
        <input
          type="checkbox"
          className="lumen-focusable"
          checked={checked}
          onChange={onToggle}
          data-testid={`col-manager-toggle-${id}`}
        />{" "}
        {label}
      </label>
    </li>
  );
}

export function ColumnManager({
  available,
  order,
  onChange,
  "data-testid": testId = "column-manager",
}: ColumnManagerProps) {
  const [q, setQ] = useState("");
  const labelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of available) m.set(a.id, a.label);
    return m;
  }, [available]);

  // Full ordered list: visible order first, then remaining available.
  const fullOrder = useMemo(() => {
    const seen = new Set(order);
    const rest = available.map((a) => a.id).filter((id) => !seen.has(id));
    return [...order, ...rest];
  }, [order, available]);

  const visibleSet = useMemo(() => new Set(order), [order]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return fullOrder;
    return fullOrder.filter((id) =>
      (labelById.get(id) ?? id).toLowerCase().includes(needle),
    );
  }, [fullOrder, labelById, q]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function emit(nextFull: string[], nextVisible: Set<string>) {
    const nextOrder = nextFull.filter((id) => nextVisible.has(id));
    // Always keep at least one column.
    const safeOrder =
      nextOrder.length > 0
        ? nextOrder
        : [available[0]?.id ?? "title"].filter(Boolean);
    const visibility: Record<string, boolean> = {};
    for (const a of available) {
      visibility[a.id] = safeOrder.includes(a.id);
    }
    onChange({ order: safeOrder, visibility });
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = fullOrder.indexOf(String(active.id));
    const newIndex = fullOrder.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const nextFull = arrayMove(fullOrder, oldIndex, newIndex);
    emit(nextFull, visibleSet);
  }

  function toggle(id: string) {
    const next = new Set(visibleSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    emit(fullOrder, next);
  }

  return (
    <div className="l2-col-manager" data-testid={testId} role="dialog" aria-label="Columns">
      <input
        type="search"
        className="l2-col-manager__search lumen-focusable"
        placeholder="Search columns"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        data-testid={`${testId}-search`}
        aria-label="Search columns"
      />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={filtered} strategy={verticalListSortingStrategy}>
          <ul className="l2-col-manager__list" data-testid={`${testId}-list`}>
            {filtered.map((id) => (
              <SortableRow
                key={id}
                id={id}
                label={labelById.get(id) ?? id}
                checked={visibleSet.has(id)}
                onToggle={() => toggle(id)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}
