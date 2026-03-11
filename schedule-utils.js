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

/**
 * Return { entries, label } for a given Date.
 * Checks SCHEDULE_OVERRIDES first, then falls back to TAFT_SCHEDULE.
 * Uses localDateStr (not toISOString) to avoid UTC offset issues.
 * @param {Date} date
 * @param {object} TAFT_SCHEDULE - hardcoded schedule constant
 * @param {object} SCHEDULE_OVERRIDES - map of ISO date → { label, entries }
 * @param {object} APP_SETTINGS - map of key → value (e.g. alt_saturday_date)
 * @returns {{ entries: array, label: string|null }}
 */
export function getScheduleForDate(date, TAFT_SCHEDULE, SCHEDULE_OVERRIDES, APP_SETTINGS) {
  const iso = localDateStr(date);
  if (SCHEDULE_OVERRIDES[iso]) {
    return { entries: SCHEDULE_OVERRIDES[iso].entries, label: SCHEDULE_OVERRIDES[iso].label };
  }
  const dow = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  if (dow === 0) return { entries: [], label: null };
  const dayKeys = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const key = (dow === 6 && APP_SETTINGS['alt_saturday_date'] === iso) ? 'alt_saturday' : dayKeys[dow];
  return { entries: TAFT_SCHEDULE[key] || [], label: null };
}
