/**
 * Lumen 2 DataTable — sticky headers, selection, density (section 11.0 / 11.4).
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
  /** Highlights the open master-detail row. */
  activeRowId?: string | null;
  getRowTestId?: (row: T) => string;
  getSelectTestId?: (row: T) => string;
  selectAllTestId?: string;
  /** Extra attributes on each `<tr>` (e.g. data-status). */
  getRowAttrs?: (
    row: T,
  ) => Record<string, string | number | boolean | undefined | null>;
  /** Extra attributes on the outer wrap (e.g. data-total). */
  wrapAttrs?: Record<string, string | number | boolean | undefined | null>;
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
  activeRowId,
  getRowTestId,
  getSelectTestId,
  selectAllTestId,
  getRowAttrs,
  wrapAttrs,
}: DataTableProps<T>) {
  const selectable = Boolean(onToggleRow);
  const allSelected =
    selectable &&
    rows.length > 0 &&
    rows.every((r) => selectedIds?.has(getRowId(r)));
  const someSelected =
    selectable && rows.some((r) => selectedIds?.has(getRowId(r)));

  if (rows.length === 0 && empty) {
    return (
      <div
        className={className}
        data-testid={testId}
        data-state="empty"
        {...attrMap(wrapAttrs)}
      >
        {empty}
      </div>
    );
  }

  return (
    <div
      className={["l2-table-wrap", className].filter(Boolean).join(" ")}
      data-testid={testId}
      data-state={someSelected ? "selected" : "rest"}
      {...attrMap(wrapAttrs)}
    >
      {someSelected && bulkBar ? (
        <div
          className="l2-table__bulk l2-table__bulk--sticky"
          data-testid={testId ? `${testId}-bulk` : "data-table-bulk"}
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
                  data-testid={selectAllTestId}
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
            const active = activeRowId != null && activeRowId === id;
            const rowClass = [
              selected ? "is-selected" : "",
              active ? "is-active" : "",
            ]
              .filter(Boolean)
              .join(" ");
            return (
              <tr
                key={id}
                className={rowClass || undefined}
                data-state={
                  active ? "active" : selected ? "selected" : "rest"
                }
                data-testid={getRowTestId?.(row)}
                {...attrMap(getRowAttrs?.(row))}
              >
                {selectable ? (
                  <td className="l2-table__check">
                    <input
                      type="checkbox"
                      className="lumen-focusable"
                      checked={selected}
                      onChange={() => onToggleRow?.(id)}
                      aria-label={`Select row ${id}`}
                      data-testid={getSelectTestId?.(row)}
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
