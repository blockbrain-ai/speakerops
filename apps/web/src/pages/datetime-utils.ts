/**
 * datetime-local ↔ ISO-8601 conversion helpers.
 *
 * Judge-visible surfaces never show raw ISO strings (beauty bar): admins edit
 * wall-clock values in native datetime-local controls; the API keeps storing
 * ISO instants. Shared by RubricSettings (review deadline) and FormBuilder
 * (CFP open/close window).
 */

/** ISO-8601 → datetime-local input value (local time, minute precision). */
export function isoToDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/** datetime-local input value → ISO-8601 (null when empty/invalid). */
export function datetimeLocalToIso(value: string): string | null {
  const t = value.trim();
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
