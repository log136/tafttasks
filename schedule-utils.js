// Pure schedule utility functions — imported by tests.
// In index.html these are inlined directly (no module system in the browser app).

/** Parse a canonical Taft time string ("8:15 am", "1:05 pm") into a Date with today's date. */
export function parseTaftTime(str) {
  const [time, period] = str.trim().toLowerCase().split(' ');
  let [h, m] = time.split(':').map(Number);
  if (period === 'pm' && h !== 12) h += 12;
  if (period === 'am' && h === 12) h = 0;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

/** Returns true if `now` (default: current time) falls within [start, end) of the entry. */
export function isCurrentBlock(entry, now = new Date()) {
  const start = parseTaftTime(entry.start);
  const end   = parseTaftTime(entry.end);
  return now >= start && now < end;
}

/** Returns local YYYY-MM-DD string for a Date (avoids UTC offset issues with toISOString). */
export function localDateStr(date) {
  const y  = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d  = String(date.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

/**
 * Advance a JS day-of-week integer (1=Mon…6=Sat) by +1 or -1, skipping Sunday (0).
 * Returns the new day number (1–6).
 */
export function advanceDay(day, delta) {
  let next = day + delta;
  if (next === 0) next = 6;  // backward from Mon → Sat
  if (next === 7) next = 1;  // forward from Sat → Mon
  return next;
}
