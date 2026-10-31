/** YYYY-MM-DD for `days` from now (UTC). Request-time helper for default form values. */
export function isoDateFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
