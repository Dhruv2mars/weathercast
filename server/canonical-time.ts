export function parseCanonicalUtcTimestamp(value: string, label: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new Error(`${label} must use canonical UTC ISO format.`);
  }
  return value;
}
