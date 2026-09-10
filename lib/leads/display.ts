/** Customer/admin-safe label when a lead field was never collected. */
export function formatOptionalLeadField(
  value: string | null | undefined,
): string {
  if (value == null || value.trim() === "") return "Not provided";
  return value;
}

/** Join a text array, or "Not provided" when it was never collected. */
export function formatOptionalLeadList(
  value: string[] | null | undefined,
): string {
  if (value == null || value.length === 0) return "Not provided";
  const cleaned = value.map((item) => item.trim()).filter(Boolean);
  if (cleaned.length === 0) return "Not provided";
  return cleaned.join(", ");
}
