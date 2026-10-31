/** YYYY-MM-DD for `days` from now (UTC). Request-time helper for default form values. */
export function isoDateFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Interpret a wall-clock time in Europe/Lisbon ("YYYY-MM-DDTHH:mm[:ss]") as an
 * instant, accounting for summer time (WEST, UTC+1) and winter time (WET, UTC+0).
 */
export function lisbonWallClockToDate(value: string): Date {
  const withSeconds = /T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
  const asUtc = new Date(`${withSeconds}Z`);
  const offsetMs = (at: Date) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Europe/Lisbon", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - at.getTime();
  };
  // Two passes handle instants next to a DST switch.
  let guess = new Date(asUtc.getTime() - offsetMs(asUtc));
  guess = new Date(asUtc.getTime() - offsetMs(guess));
  return guess;
}
