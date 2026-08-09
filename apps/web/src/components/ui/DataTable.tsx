/**
 * Lumen 2 DataTable — sticky headers, selection, density (section 11.0).
 */
import type { ReactNode } from "react";

export type DataTableColumn<T> = {
  id: string;
  header: string;
  /** Primary identity column (title + secondary id). */
  primary?: boolean;
  cell: (row: T) => ReactNode;
  className?: string;
};

export type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  selectedIds?: ReadonlySet<string>;
  onToggleRow?: (id: string) => void;
  onToggleAll?: (selectAll: boolean) => void;
  density?: "comfortable" | "compact";
  bulkBar?: ReactNode;
  empty?: ReactNode;
  className?: string;
  "data-testid"?: string;
};

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  selectedIds,
  onToggleRow,
  onToggleAll,
  density = "comfortable",
  bulkBar,
  empty,
  className = "",
  "data-testid": testId,
}: DataTableProps<T>) {
  const selectable = Boolean(onToggleRow);
  const allSelected =
    selectable && rows.length > 0 && rows.every((r) => selectedIds?.has(getRowId(r)));
  const someSelected =
    selectable && rows.some((r) => selectedIds?.has(getRowId(r)));

  if (rows.length === 0 && empty) {
    return (
      <div className={className} data-testid={testId} data-state="empty">
        {empty}
      </div>
    );
  }

  return (
    <div
      className={["l2-table-wrap", className].filter(Boolean).join(" ")}
      data-testid={testId}
      data-state={someSelected ? "selected" : "rest"}
    >
      {someSelected && bulkBar ? (
        <div className="l2-table__bulk" data-testid={testId ? `${testId}-bulk` : undefined}>
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
      >
        <thead>
          <tr>
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
                />
              </th>
            ) : null}
            {columns.map((col) => (
              <th key={col.id} scope="col" className={col.className}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const id = getRowId(row);
            const selected = selectedIds?.has(id) ?? false;
            return (
              <tr
                key={id}
                className={selected ? "is-selected" : undefined}
                data-state={selected ? "selected" : "rest"}
              >
                {selectable ? (
                  <td className="l2-table__check">
                    <input
                      type="checkbox"
                      className="lumen-focusable"
                      checked={selected}
                      onChange={() => onToggleRow?.(id)}
                      aria-label={`Select row ${id}`}
                    />
                  </td>
                ) : null}
                {columns.map((col) => (
                  <td
                    key={col.id}
                    className={[
                      col.primary ? "l2-table__primary" : "",
                      col.className ?? "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {col.cell(row)}
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
