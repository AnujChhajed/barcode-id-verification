/**
 * Formats a Date as ISO-8601 UTC.
 *
 * Milliseconds are KEPT deliberately. Timestamps are compared as strings (for
 * example, the duplicate-scan window), and whole-second values cannot order two
 * rows written in the same second — a scan in and a scan out would then sort
 * arbitrarily, which would make "who is on site" unreliable. Fixed-width
 * milliseconds keep string order identical to chronological order.
 */
function toIso(date) {
  return date.toISOString();
}

export function nowIso(now = new Date()) {
  return toIso(now);
}

export function addMinutes(date, minutes) {
  return toIso(new Date(date.getTime() + minutes * 60_000));
}

export function addSeconds(date, seconds) {
  return toIso(new Date(date.getTime() + seconds * 1_000));
}

/**
 * Fail closed: a malformed or missing timestamp is treated as already past,
 * so an unreadable session can never be considered valid.
 */
export function isPast(iso, now = new Date()) {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return true;
  return parsed <= now.getTime();
}

/** Local calendar date (`YYYY-MM-DD`) for the given IANA time zone. */
export function dateKeyInZone(now, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Adds whole days to a `YYYY-MM-DD` date string without time-zone drift. */
export function addDaysToDateKey(dateKey, days) {
  const [year, month, day] = dateKey.split("-").map((value) => Number.parseInt(value, 10));
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return toIso(shifted).slice(0, 10);
}
