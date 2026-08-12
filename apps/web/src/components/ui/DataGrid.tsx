/**
 * F3 DataGrid — TanStack Table v8 + Lumen styling.
 * Server-driven sort/filter/pagination (manual*). Column visibility + density.
 */
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
  type OnChangeFn,
} from "@tanstack/react-table";
import type { ReactNode } from "react";

export type DataGridProps<T> = {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  getRowId: (row: T) => string;
  /** Server sort state. */
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  columnVisibility?: VisibilityState;
  onColumnVisibilityChange?: OnChangeFn<VisibilityState>;
  /** Visible column order (ids). */
  columnOrder?: string[];
  density?: "comfortable" | "compact";
  selectedIds?: ReadonlySet<string>;
  onToggleRow?: (id: string) => void;
  onToggleAll?: (selectAll: boolean) => void;
  bulkBar?: ReactNode;
  empty?: ReactNode;
  className?: string;
  "data-testid"?: string;
  activeRowId?: string | null;
  /** Total rows for aria-rowcount (server total). Defaults to page length. */
  ariaRowCount?: number;
  getRowTestId?: (row: T) => string;
  getSelectTestId?: (row: T) => string;
  selectAllTestId?: string;
  getRowAttrs?: (
    row: T,
  ) => Record<string, string | number | boolean | undefined | null>;
  wrapAttrs?: Record<string, string | number | boolean | undefined | null>;
  toolbar?: ReactNode;
  /** Enter on a focused row (keyboard open). */
  onRowActivate?: (row: T) => void;
};

function attrMap(
  attrs:
    | Record<string, string | number | boolean | undefined | null>
    | undefined,
): Record<string, string> {
  if (!attrs) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    out[k] = v === true ? "true" : String(v);
  }
  return out;
}

export function DataGrid<T>({
  columns,
  data,
  getRowId,
  sorting,
  onSortingChange,
  columnVisibility,
  onColumnVisibilityChange,
  columnOrder,
  density = "comfortable",
  selectedIds,
  onToggleRow,
  onToggleAll,
  bulkBar,
  empty,
  className = "",
  "data-testid": testId = "data-grid",
  activeRowId,
  ariaRowCount,
  getRowTestId,
  getSelectTestId,
  selectAllTestId,
  getRowAttrs,
  wrapAttrs,
  toolbar,
  onRowActivate,
}: DataGridProps<T>) {
  const selectable = Boolean(onToggleRow);

  const orderedColumns = (() => {
    if (!columnOrder || columnOrder.length === 0) return columns;
    const byId = new Map(
      columns.map((c) => [String(c.id ?? (c as { accessorKey?: string }).accessorKey ?? ""), c]),
    );
    const out: ColumnDef<T, unknown>[] = [];
    for (const id of columnOrder) {
      const col = byId.get(id);
      if (col) {
        out.push(col);
        byId.delete(id);
      }
    }
    for (const col of byId.values()) out.push(col);
    return out;
  })();

  const table = useReactTable({
    data,
    columns: orderedColumns,
    state: {
      sorting: sorting ?? [],
      columnVisibility: columnVisibility ?? {},
    },
    onSortingChange,
    onColumnVisibilityChange,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => getRowId(row),
    manualSorting: true,
    manualFiltering: true,
    manualPagination: true,
    enableSortingRemoval: false,
  });

  const rows = table.getRowModel().rows;
  const allSelected =
    selectable &&
    rows.length > 0 &&
    rows.every((r) => selectedIds?.has(r.id));
  const someSelected =
    selectable && rows.some((r) => selectedIds?.has(r.id));

  if (data.length === 0 && empty) {
    return (
      <div
        className={className}
        data-testid={testId}
        data-state="empty"
        {...attrMap(wrapAttrs)}
      >
        {toolbar}
        {empty}
      </div>
    );
  }

  return (
    <div
      className={["l2-table-wrap", "l2-data-grid", className]
        .filter(Boolean)
        .join(" ")}
      data-testid={testId}
      data-state={someSelected ? "selected" : "rest"}
      data-density={density}
      {...attrMap(wrapAttrs)}
    >
      {toolbar ? (
        <div
          className="l2-data-grid__toolbar"
          data-testid={`${testId}-toolbar`}
        >
          {toolbar}
        </div>
      ) : null}
      {someSelected && bulkBar ? (
        <div
          className="l2-table__bulk l2-table__bulk--sticky"
          data-testid={`${testId}-bulk`}
          role="region"
          aria-label="Bulk actions"
        >
          {bulkBar}
        </div>
      ) : null}
      <table
        className={[
          "l2-table",
          density === "compact" ? "l2-table--compact" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-rowcount={ariaRowCount ?? data.length}
        aria-colcount={
          (selectable ? 1 : 0) +
          table.getVisibleLeafColumns().length
        }
      >
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {selectable ? (
                <th className="l2-table__check" scope="col">
                  <input
                    type="checkbox"
                    className="lumen-focusable"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected && !allSelected;
                    }}
                    onChange={() => onToggleAll?.(!allSelected)}
                    aria-label="Select all rows"
                    data-testid={selectAllTestId}
                  />
                </th>
              ) : null}
              {hg.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    scope="col"
                    className={
                      canSort ? "l2-data-grid__th--sortable" : undefined
                    }
                    aria-sort={
                      sorted === "asc"
                        ? "ascending"
                        : sorted === "desc"
                          ? "descending"
                          : canSort
                            ? "none"
                            : undefined
                    }
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        className="l2-data-grid__sort lumen-focusable"
                        data-testid={`grid-sort-${header.column.id}`}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        <span className="l2-data-grid__sort-ind" aria-hidden>
                          {sorted === "asc"
                            ? " ↑"
                            : sorted === "desc"
                              ? " ↓"
                              : ""}
                        </span>
                      </button>
                    ) : (
                      flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.map((row) => {
            const id = row.id;
            const selected = selectedIds?.has(id) ?? false;
            const active = activeRowId != null && activeRowId === id;
            const original = row.original;
            return (
              <tr
                key={id}
                className={
                  [
                    selected ? "is-selected" : "",
                    active ? "is-active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                data-state={
                  active ? "active" : selected ? "selected" : "rest"
                }
                data-testid={getRowTestId?.(original)}
                tabIndex={onRowActivate ? 0 : undefined}
                onKeyDown={
                  onRowActivate
                    ? (e) => {
                        // Ignore keys originating from nested interactive controls.
                        const t = e.target as HTMLElement | null;
                        if (
                          t &&
                          t !== e.currentTarget &&
                          (t.tagName === "BUTTON" ||
                            t.tagName === "A" ||
                            t.tagName === "INPUT" ||
                            t.isContentEditable)
                        ) {
                          return;
                        }
                        if (e.key === "Enter") {
                          e.preventDefault();
                          onRowActivate(original);
                        } else if (e.key === " " && onToggleRow) {
                          e.preventDefault();
                          onToggleRow(id);
                        }
                      }
                    : undefined
                }
                {...attrMap(getRowAttrs?.(original))}
              >
                {selectable ? (
                  <td className="l2-table__check">
                    <input
                      type="checkbox"
                      className="lumen-focusable"
                      checked={selected}
                      onChange={() => onToggleRow?.(id)}
                      aria-label={`Select row ${id}`}
                      data-testid={getSelectTestId?.(original)}
                    />
                  </td>
                ) : null}
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
