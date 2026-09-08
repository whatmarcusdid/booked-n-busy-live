/** Customer/admin-safe label when a lead field was never collected. */
export function formatOptionalLeadField(
  value: string | null | undefined,
): string {
  if (value == null || value.trim() === "") return "Not provided";
  return value;
}
