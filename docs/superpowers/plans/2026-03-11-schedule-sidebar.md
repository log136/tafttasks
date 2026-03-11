# Schedule Sidebar Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a schedule sidebar to the Taft Dashboard showing the daily Taft block schedule with the user's own courses mapped to each block, day navigation, and an admin-only panel for setting alt Saturday and custom special-day schedules.

**Architecture:** All code lives in `index.html` (a no-build single-file vanilla JS + Supabase app). Three new Supabase tables store per-user block assignments, global schedule overrides, and global app settings. Admin features are gated by a hardcoded user ID constant.

**Tech Stack:** Vanilla JS, HTML/CSS, Supabase JS CDN, no build step.

**Spec:** `docs/superpowers/specs/2026-03-11-schedule-sidebar-design.md`

**Key file locations in `index.html`:**
- Global state vars: ~line 506
- `loadUserData()`: ~line 577 (early return at line 584)
- `renderAll()`: ~line 929
- `afterAuth()`: ~line 1149
- `#app` HTML header: ~line 400 (⚙ button goes here)
- `#app` `.main` div: ~line 484 (wrap this in `.app-body`)

---

## Chunk 1: Database + Schedule Data

### Task 1: Create Supabase Tables and RLS

**Files:**
- No code files — run SQL in Supabase dashboard (SQL Editor)

> **Important:** You need Logan's Supabase user ID before implementing the admin panel. Find it in Supabase → Authentication → Users. Copy the UUID. You'll use it as `ADMIN_USER_ID` in Task 2.

- [ ] **Step 1: Run table creation SQL in Supabase dashboard**

Open Supabase → SQL Editor and run:

```sql
-- block_schedule: per-user block → course mapping
create table if not exists block_schedule (
  user_id   uuid references auth.users(id) on delete cascade not null,
  block     text not null check (block in ('A','B','C','D','E','F','G')),
  course_id uuid references courses(id) on delete set null,
  primary key (user_id, block)
);

-- schedule_overrides: global special-day schedules
create table if not exists schedule_overrides (
  date    date primary key,
  label   text not null,
  entries jsonb not null default '[]'::jsonb
);

-- app_settings: global key/value (e.g. alt_saturday_date)
create table if not exists app_settings (
  key   text primary key,
  value text not null default ''
);
```

- [ ] **Step 2: Enable RLS and create policies**

Run in Supabase SQL Editor (replace `LOGAN_USER_ID` with the actual UUID from Authentication → Users):

```sql
-- block_schedule RLS
alter table block_schedule enable row level security;
create policy "Users manage own block_schedule"
  on block_schedule for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- schedule_overrides RLS
alter table schedule_overrides enable row level security;
create policy "Anyone can read schedule_overrides"
  on schedule_overrides for select
  using (auth.role() = 'authenticated');
create policy "Admin can write schedule_overrides"
  on schedule_overrides for all
  using (auth.uid() = 'LOGAN_USER_ID'::uuid)
  with check (auth.uid() = 'LOGAN_USER_ID'::uuid);

-- app_settings RLS
alter table app_settings enable row level security;
create policy "Anyone can read app_settings"
  on app_settings for select
  using (auth.role() = 'authenticated');
create policy "Admin can write app_settings"
  on app_settings for all
  using (auth.uid() = 'LOGAN_USER_ID'::uuid)
  with check (auth.uid() = 'LOGAN_USER_ID'::uuid);
```

- [ ] **Step 3: Verify in Supabase Table Editor**

Check that all three tables appear under Table Editor. Click each one and confirm the columns match. No commit needed — this is a database change only.

---

### Task 2: Schedule Data Constants and Utility Functions

**Files:**
- Modify: `index.html` — add constants and utility functions in the `<script>` block after the existing global state vars (~line 513)
- Create: `schedule.test.js` — unit tests for pure utility functions

- [ ] **Step 1: Write failing tests in `schedule.test.js`**

Create `/Users/logan/Desktop/Taft Dashboard/taft-dashboard/schedule.test.js`:

```js
// Tests for schedule utility functions
// Run: node --experimental-vm-modules node_modules/.bin/jest schedule.test.js
// Or: npx jest schedule.test.js

import { parseTaftTime, isCurrentBlock, getScheduleForDate, advanceDay } from './schedule-utils.js';

describe('parseTaftTime', () => {
  test('parses am time', () => {
    const d = parseTaftTime('8:15 am');
    expect(d.getHours()).toBe(8);
    expect(d.getMinutes()).toBe(15);
  });
  test('parses pm time', () => {
    const d = parseTaftTime('1:05 pm');
    expect(d.getHours()).toBe(13);
    expect(d.getMinutes()).toBe(5);
  });
  test('parses 12:00 pm as noon', () => {
    const d = parseTaftTime('12:00 pm');
    expect(d.getHours()).toBe(12);
    expect(d.getMinutes()).toBe(0);
  });
  test('parses 12:00 am as midnight', () => {
    const d = parseTaftTime('12:00 am');
    expect(d.getHours()).toBe(0);
  });
});

describe('isCurrentBlock', () => {
  test('returns true when now is within block window', () => {
    const now = new Date(); now.setHours(10, 30, 0, 0);
    expect(isCurrentBlock({ start: '10:00 am', end: '11:00 am' }, now)).toBe(true);
  });
  test('returns false when now is before block', () => {
    const now = new Date(); now.setHours(9, 0, 0, 0);
    expect(isCurrentBlock({ start: '10:00 am', end: '11:00 am' }, now)).toBe(false);
  });
  test('returns false when now is at or after end', () => {
    const now = new Date(); now.setHours(11, 0, 0, 0);
    expect(isCurrentBlock({ start: '10:00 am', end: '11:00 am' }, now)).toBe(false);
  });
});

describe('advanceDay', () => {
  test('Monday advances to Tuesday', () => {
    expect(advanceDay(1, 1)).toBe(2);
  });
  test('Saturday advances to next Monday (skips Sunday)', () => {
    expect(advanceDay(6, 1)).toBe(1); // 1 = Monday
  });
  test('Saturday goes back to Friday', () => {
    expect(advanceDay(6, -1)).toBe(5);
  });
  test('Monday goes back to Saturday (skips Sunday)', () => {
    expect(advanceDay(1, -1)).toBe(6);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

The project has `"type": "module"` in `package.json`, so Jest needs the experimental VM modules flag:

```bash
cd "/Users/logan/Desktop/Taft Dashboard/taft-dashboard"
node --experimental-vm-modules node_modules/.bin/jest schedule.test.js 2>&1 | head -20
```

Expected: FAIL — `Cannot find module './schedule-utils.js'`

- [ ] **Step 3: Create `schedule-utils.js` with implementations**

Create `/Users/logan/Desktop/Taft Dashboard/taft-dashboard/schedule-utils.js`:

```js
// Pure schedule utility functions — imported by tests
// In index.html these are inlined (no module system)

/**
 * Parse a canonical Taft time string ("8:15 am", "1:05 pm") into a Date
 * with today's date and the given time. Returns a Date object.
 */
export function parseTaftTime(str) {
  const [time, period] = str.trim().toLowerCase().split(' ');
  let [h, m] = time.split(':').map(Number);
  if (period === 'pm' && h !== 12) h += 12;
  if (period === 'am' && h === 12) h = 0;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

/**
 * Returns true if the given Date `now` falls within [start, end).
 * entry: { start: "8:15 am", end: "9:15 am" }
 */
export function isCurrentBlock(entry, now = new Date()) {
  const start = parseTaftTime(entry.start);
  const end   = parseTaftTime(entry.end);
  return now >= start && now < end;
}

/**
 * Advance or retreat a JS day-of-week (0=Sun…6=Sat) by `delta` (+1 or -1),
 * skipping Sunday (0). Returns the new day number (1–6 for Mon–Sat).
 */
export function advanceDay(day, delta) {
  let next = day + delta;
  if (next === 0) next = 6;   // skip Sunday going backward: land on Saturday
  if (next === 7) next = 1;   // skip Sunday going forward: land on Monday
  return next;
}

/**
 * Return the canonical schedule entries array for a given Date,
 * given TAFT_SCHEDULE constant, SCHEDULE_OVERRIDES map, APP_SETTINGS map.
 * Returns { entries, label } where label is null for normal days.
 */
export /** Returns local YYYY-MM-DD string (not UTC) for a Date object. */
export function localDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getScheduleForDate(date, TAFT_SCHEDULE, SCHEDULE_OVERRIDES, APP_SETTINGS) {
  const iso = localDateStr(date);
  if (SCHEDULE_OVERRIDES[iso]) {
    return { entries: SCHEDULE_OVERRIDES[iso].entries, label: SCHEDULE_OVERRIDES[iso].label };
  }
  const dow = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  if (dow === 0) return { entries: [], label: null };
  const dayKeys = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const key = dow === 6 && APP_SETTINGS['alt_saturday_date'] === iso ? 'alt_saturday' : dayKeys[dow];
  return { entries: TAFT_SCHEDULE[key] || [], label: null };
}
```

- [ ] **Step 4: Run tests — should pass**

```bash
cd "/Users/logan/Desktop/Taft Dashboard/taft-dashboard"
node --experimental-vm-modules node_modules/.bin/jest schedule.test.js
```

Expected: All tests pass (✓ parseTaftTime, ✓ isCurrentBlock, ✓ advanceDay).

> Note: `getScheduleForDate` is not tested here because it depends on the large `TAFT_SCHEDULE` constant which lives in `index.html`. Its logic is simple enough to verify manually.

- [ ] **Step 5: Add `TAFT_SCHEDULE`, `BLOCK_COLORS`, and `ADMIN_USER_ID` constants to `index.html`**

In `index.html`, after the `const PRESET_COLORS = [...]` line (~line 513), add:

```js
// ─────────────────────────────────────────────
//  ADMIN + SCHEDULE CONSTANTS
// ─────────────────────────────────────────────
const ADMIN_USER_ID = 'REPLACE_WITH_LOGAN_UUID'; // Logan's Supabase user ID

const BLOCK_COLORS = {
  A: '#e6a817', B: '#e87c7c', C: '#7c9de8',
  D: '#9b5de5', E: '#4caf6a', F: '#4f9ca8', G: '#a8c84f',
};

const TAFT_SCHEDULE = {
  monday: [
    { type: 'block',   block: 'A', label: null,               start: '8:15 am',  end: '9:15 am'  },
    { type: 'block',   block: 'C', label: null,               start: '9:20 am',  end: '10:05 am' },
    { type: 'block',   block: 'B', label: null,               start: '10:10 am', end: '11:25 am' },
    { type: 'special', block: null, label: 'Community Lunch', start: '11:30 am', end: '12:10 pm' },
    { type: 'block',   block: 'D', label: null,               start: '12:15 pm', end: '1:00 pm'  },
    { type: 'block',   block: 'E', label: null,               start: '1:05 pm',  end: '1:50 pm'  },
    { type: 'block',   block: 'F', label: null,               start: '1:55 pm',  end: '2:40 pm'  },
  ],
  tuesday: [
    { type: 'block',   block: 'G', label: null,               start: '8:15 am',  end: '9:15 am'  },
    { type: 'special', block: null, label: 'School Meeting',  start: '9:20 am',  end: '10:00 am' },
    { type: 'block',   block: 'F', label: null,               start: '10:05 am', end: '11:20 am' },
    { type: 'block',   block: 'D', label: null,               start: '11:30 am', end: '12:30 pm' },
    { type: 'block',   block: 'C', label: null,               start: '12:35 pm', end: '1:50 pm'  },
    { type: 'block',   block: 'A', label: null,               start: '1:55 pm',  end: '2:40 pm'  },
  ],
  wednesday: [
    { type: 'block',   block: 'B', label: null,               start: '8:15 am',  end: '9:15 am'  },
    { type: 'special', block: null, label: 'Assembly',        start: '9:20 am',  end: '9:50 am'  },
    { type: 'block',   block: 'G', label: null,               start: '9:55 am',  end: '10:40 am' },
    { type: 'block',   block: 'E', label: null,               start: '10:45 am', end: '12:00 pm' },
  ],
  thursday: [
    { type: 'block',   block: 'F', label: null,               start: '8:15 am',  end: '9:15 am'  },
    { type: 'special', block: null, label: 'I-Block',         start: '9:20 am',  end: '10:00 am' },
    { type: 'block',   block: 'A', label: null,               start: '10:05 am', end: '11:20 am' },
    { type: 'block',   block: 'C', label: null,               start: '11:30 am', end: '12:30 pm' },
    { type: 'block',   block: 'D', label: null,               start: '12:35 pm', end: '1:50 pm'  },
    { type: 'block',   block: 'E', label: null,               start: '1:55 pm',  end: '2:40 pm'  },
  ],
  friday: [
    { type: 'block',   block: 'E', label: null,                start: '8:15 am',  end: '9:15 am'  },
    { type: 'special', block: null, label: 'Dept./Faculty Mtg', start: '9:20 am', end: '10:00 am' },
    { type: 'block',   block: 'G', label: null,                start: '10:05 am', end: '11:20 am' },
    { type: 'block',   block: 'D', label: null,                start: '11:25 am', end: '12:10 pm' },
    { type: 'block',   block: 'C', label: null,                start: '12:15 pm', end: '1:00 pm'  },
    { type: 'block',   block: 'F', label: null,                start: '1:05 pm',  end: '1:50 pm'  },
    { type: 'block',   block: 'B', label: null,                start: '1:55 pm',  end: '2:40 pm'  },
  ],
  saturday: [
    { type: 'block',   block: 'A', label: null,               start: '9:00 am',  end: '9:45 am'  },
    { type: 'special', block: null, label: 'Assembly',        start: '9:50 am',  end: '10:20 am' },
    { type: 'block',   block: 'B', label: null,               start: '10:25 am', end: '11:10 am' },
    { type: 'block',   block: 'G', label: null,               start: '11:15 am', end: '12:00 pm' },
  ],
  alt_saturday: [
    { type: 'block',   block: 'A', label: null,               start: '9:00 am',  end: '10:00 am' },
    { type: 'special', block: null, label: 'Assembly',        start: '10:05 am', end: '10:35 am' },
    { type: 'block',   block: 'B', label: null,               start: '10:40 am', end: '11:55 am' },
  ],
};
```

- [ ] **Step 6: Add global schedule state vars**

After `let authMode = 'signin';` (~line 511), add:

```js
let BLOCK_SCHEDULE = {};      // { A: course_id|null, … }
let SCHEDULE_OVERRIDES = {};  // { 'YYYY-MM-DD': { label, entries } }
let APP_SETTINGS = {};        // { key: value }
let schedViewDate = new Date(); // date currently shown in sidebar
let schedEditMode = false;
```

- [ ] **Step 7: Commit**

```bash
git add index.html schedule-utils.js schedule.test.js
git commit -m "feat: schedule constants, utilities, and tests"
```

---

## Chunk 2: Data Loaders + Layout + Sidebar Rendering

### Task 3: Data Loaders

**Files:**
- Modify: `index.html` — add three loader functions after `loadUserData()` (~line 633), and wire them in

- [ ] **Step 1: Add the three loader functions after `loadUserData()`**

After the closing `}` of `loadUserData()` (after line ~633), add:

```js
async function loadBlockAssignments() {
  const { data } = await sb.from('block_schedule')
    .select('block, course_id')
    .eq('user_id', currentUser.id);
  BLOCK_SCHEDULE = {};
  (data || []).forEach(row => { BLOCK_SCHEDULE[row.block] = row.course_id; });
}

async function loadScheduleOverrides() {
  const { data } = await sb.from('schedule_overrides').select('*');
  SCHEDULE_OVERRIDES = {};
  (data || []).forEach(row => { SCHEDULE_OVERRIDES[row.date] = { label: row.label, entries: row.entries }; });
}

async function loadAppSettings() {
  const { data } = await sb.from('app_settings').select('*');
  APP_SETTINGS = {};
  (data || []).forEach(row => { APP_SETTINGS[row.key] = row.value; });
}
```

- [ ] **Step 2: Wire all three loaders into `loadUserData()` unconditionally**

In `loadUserData()`, the function currently starts with the courses fetch and early-returns at the first line if there are no courses. Add three parallel loader calls **before** that early return — replace the opening of `loadUserData()`:

Find this (line ~577):
```js
async function loadUserData() {
  const { data: coursesData, error } = await sb
    .from('courses')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('sort_order', { ascending: true });

  if (error || !coursesData || coursesData.length === 0) return false;
```

Replace with:
```js
async function loadUserData() {
  // Load global/schedule data unconditionally (work for all users, even new ones)
  await Promise.all([loadScheduleOverrides(), loadAppSettings(), loadBlockAssignments()]);

  const { data: coursesData, error } = await sb
    .from('courses')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('sort_order', { ascending: true });

  if (error || !coursesData || coursesData.length === 0) return false;
```

- [ ] **Step 3: Manually verify loaders don't crash on empty tables**

Open the browser console after loading the app. Run:
```js
await loadScheduleOverrides(); console.log(SCHEDULE_OVERRIDES);
await loadAppSettings();       console.log(APP_SETTINGS);
await loadBlockAssignments();  console.log(BLOCK_SCHEDULE);
```
Expected: All three log empty objects `{}` (tables are empty at this point).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add schedule data loaders wired into loadUserData"
```

---

### Task 4: Layout HTML + CSS

**Files:**
- Modify: `index.html` — wrap `.main` in `.app-body`, add `#scheduleSidebar`, add CSS

- [ ] **Step 1: Add CSS for `.app-body` and `.schedule-sidebar`**

In the `<style>` block, after the `.main` rule (~line 119), add:

```css
/* ── App Body (sidebar layout) ── */
.app-body { display: flex; flex-direction: row; align-items: flex-start; gap: 0; }
.app-body .main { flex: 1; min-width: 0; }
@media (max-width: 768px) { .schedule-sidebar { display: none; } }

/* ── Schedule Sidebar ── */
.schedule-sidebar {
  width: 220px;
  flex-shrink: 0;
  background: white;
  border-left: 1px solid var(--border);
  min-height: calc(100vh - 140px);
  position: sticky;
  top: 100px;
  max-height: calc(100vh - 120px);
  overflow-y: auto;
}
.sched-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 12px;
  background: #1a1a2e; color: white;
  font-size: 0.78rem; font-weight: 700;
  position: sticky; top: 0; z-index: 1;
}
.sched-edit-btn {
  background: none; border: none; color: rgba(255,255,255,0.7);
  cursor: pointer; font-size: 0.85rem; padding: 2px 4px;
  transition: color 0.15s;
}
.sched-edit-btn:hover, .sched-edit-btn.active { color: white; }
.sched-day-nav {
  display: flex; align-items: center; justify-content: space-between;
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
  background: #f9fafb;
  position: sticky; top: 36px; z-index: 1;
}
.sched-nav-arrow {
  width: 22px; height: 22px;
  background: var(--border); border-radius: 4px;
  border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 0.85rem; color: #374151;
  transition: background 0.15s;
}
.sched-nav-arrow:hover { background: #d1d5db; }
.sched-day-label { font-size: 0.78rem; font-weight: 700; text-align: center; }
.sched-day-sub   { font-size: 0.65rem; color: var(--muted); text-align: center; }
.sched-override-banner {
  background: #fef3c7; color: #92400e;
  padding: 5px 10px; font-size: 0.7rem; font-weight: 600;
  border-bottom: 1px solid #fde68a;
}
.sched-block-row {
  display: flex; align-items: center;
  border-bottom: 1px solid #f3f4f6;
  min-height: 46px;
}
.sched-block-row.current { background: #fff8f8; }
.sched-block-letter {
  width: 32px; flex-shrink: 0;
  text-align: center; font-weight: 800; font-size: 0.88rem;
  color: white; padding: 10px 0; align-self: stretch;
  display: flex; align-items: center; justify-content: center;
}
.sched-block-info { padding: 6px 8px; flex: 1; min-width: 0; }
.sched-block-course {
  font-weight: 600; color: #111827;
  font-size: 0.72rem; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis;
}
.sched-block-row.current .sched-block-course { color: var(--taft-red); }
.sched-block-free { color: #9ca3af; font-style: italic; font-size: 0.72rem; }
.sched-block-time { font-size: 0.63rem; color: #9ca3af; margin-top: 1px; }
.sched-special-row {
  display: flex; align-items: center;
  border-bottom: 1px solid #f3f4f6;
  background: #fafafa; min-height: 36px;
}
.sched-special-icon { width: 32px; text-align: center; font-size: 0.72rem; color: #9ca3af; flex-shrink: 0; }
.sched-special-info { padding: 5px 8px; flex: 1; }
.sched-special-label { font-size: 0.68rem; color: #6b7280; font-style: italic; }
.sched-special-time  { font-size: 0.62rem; color: #9ca3af; margin-top: 1px; }
.sched-empty { padding: 20px 12px; text-align: center; color: #9ca3af; font-size: 0.78rem; }
.sched-select {
  width: 100%; font-size: 0.7rem; padding: 3px 4px;
  border: 1px solid var(--border); border-radius: 4px;
  background: white; color: #111827; outline: none;
}
.sched-select:focus { border-color: var(--taft-red); }
```

- [ ] **Step 2: Wrap `.main` in `.app-body` and add the sidebar element**

In the `#app` HTML section, find (line ~483):
```html
  <!-- MAIN -->
  <div class="main" id="mainContent">
    <div style="text-align:center;padding:80px 20px;color:#6b7280;font-size:0.92rem;">⏳ Loading your dashboard…</div>
  </div>
```

Replace with:
```html
  <!-- MAIN + SIDEBAR -->
  <div class="app-body">
    <div class="main" id="mainContent">
      <div style="text-align:center;padding:80px 20px;color:#6b7280;font-size:0.92rem;">⏳ Loading your dashboard…</div>
    </div>
    <div class="schedule-sidebar" id="scheduleSidebar"></div>
  </div>
```

- [ ] **Step 3: Verify layout in browser**

Load the app. The main content area should still display correctly. The sidebar area is empty for now (no visual change on narrow screens; on wide screens a thin border appears on the right side).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: add app-body wrapper and schedule sidebar layout"
```

---

### Task 5: Sidebar Rendering

**Files:**
- Modify: `index.html` — add `parseTaftTime`, `isCurrentBlock`, `advanceDay`, `getScheduleForDate`, `renderScheduleSidebar` functions

- [ ] **Step 1: Add pure utility functions to `index.html`**

After the global state vars section (~line 517), add:

```js
// ─────────────────────────────────────────────
//  SCHEDULE UTILITIES
// ─────────────────────────────────────────────
function parseTaftTime(str) {
  const [time, period] = str.trim().toLowerCase().split(' ');
  let [h, m] = time.split(':').map(Number);
  if (period === 'pm' && h !== 12) h += 12;
  if (period === 'am' && h === 12) h = 0;
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

function isCurrentBlock(entry) {
  const now = new Date();
  return now >= parseTaftTime(entry.start) && now < parseTaftTime(entry.end);
}

// Returns local YYYY-MM-DD string (avoids UTC offset issues with toISOString)
function localDateStr(date) {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d  = String(date.getDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

// Advance a JS day-of-week integer (1=Mon…6=Sat) by +1 or -1, skipping Sunday (0)
function advanceDay(day, delta) {
  let next = day + delta;
  if (next === 0) next = 6;  // backward from Mon → Sat
  if (next === 7) next = 1;  // forward from Sat → Mon
  return next;
}

function getScheduleForDate(date) {
  const iso = localDateStr(date);
  if (SCHEDULE_OVERRIDES[iso]) {
    return { entries: SCHEDULE_OVERRIDES[iso].entries, label: SCHEDULE_OVERRIDES[iso].label };
  }
  const dow = date.getDay();
  if (dow === 0) return { entries: [], label: null };
  const dayKeys = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const key = (dow === 6 && APP_SETTINGS['alt_saturday_date'] === iso) ? 'alt_saturday' : dayKeys[dow];
  return { entries: TAFT_SCHEDULE[key] || [], label: null };
}
```

- [ ] **Step 2: Add `renderScheduleSidebar()` function**

Add this function in the rendering section, after `renderAll()` (~line 940):

```js
// ─────────────────────────────────────────────
//  SCHEDULE SIDEBAR
// ─────────────────────────────────────────────
function renderScheduleSidebar() {
  const el = document.getElementById('scheduleSidebar');
  if (!el) return;

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const viewIso  = schedViewDate.toISOString().slice(0, 10);
  const isToday  = viewIso === todayIso;
  const dow      = schedViewDate.getDay();

  const { entries, label } = getScheduleForDate(schedViewDate);

  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dayLabel = dayNames[dow];
  const dateLabel = `${monthNames[schedViewDate.getMonth()]} ${schedViewDate.getDate()}`;

  // Build entry rows HTML
  let rowsHtml = '';
  if (entries.length === 0) {
    rowsHtml = `<div class="sched-empty">No classes today</div>`;
  } else {
    for (const entry of entries) {
      if (entry.type === 'special') {
        rowsHtml += `
          <div class="sched-special-row">
            <div class="sched-special-icon">·</div>
            <div class="sched-special-info">
              <div class="sched-special-label">${entry.label}</div>
              <div class="sched-special-time">${entry.start}–${entry.end}</div>
            </div>
          </div>`;
      } else {
        const current = isToday && isCurrentBlock(entry);
        const color   = BLOCK_COLORS[entry.block] || '#6b7280';
        const courseId = BLOCK_SCHEDULE[entry.block];
        const course   = courseId ? COURSES.find(c => c.id === courseId) : null;
        const courseName = course?.name || null;

        let courseCell;
        if (schedEditMode) {
          const options = [
            `<option value="" ${!courseId ? 'selected' : ''}>Free block</option>`,
            ...COURSES.map(c =>
              `<option value="${c.id}" ${c.id === courseId ? 'selected' : ''}>${c.name}</option>`
            ),
          ].join('');
          courseCell = `<select class="sched-select" onchange="saveBlockAssignment('${entry.block}', this.value)">${options}</select>`;
        } else {
          courseCell = courseName
            ? `<div class="sched-block-course">${courseName}</div>`
            : `<div class="sched-block-free">Free block</div>`;
        }

        rowsHtml += `
          <div class="sched-block-row${current ? ' current' : ''}">
            <div class="sched-block-letter" style="background:${color}">${entry.block}</div>
            <div class="sched-block-info">
              ${courseCell}
              <div class="sched-block-time">${entry.start}–${entry.end}</div>
            </div>
          </div>`;
      }
    }
  }

  const overrideBanner = label
    ? `<div class="sched-override-banner">Special: ${label}</div>`
    : '';

  const editBtnClass = schedEditMode ? 'sched-edit-btn active' : 'sched-edit-btn';

  el.innerHTML = `
    <div class="sched-header">
      <span>📅 Schedule</span>
      <button class="${editBtnClass}" onclick="toggleSchedEditMode()" title="Edit block assignments">✏️</button>
    </div>
    <div class="sched-day-nav">
      <button class="sched-nav-arrow" onclick="schedNav(-1)">‹</button>
      <div>
        <div class="sched-day-label">${isToday ? 'Today · ' : ''}${dayLabel}</div>
        <div class="sched-day-sub">${dateLabel}</div>
      </div>
      <button class="sched-nav-arrow" onclick="schedNav(1)">›</button>
    </div>
    ${overrideBanner}
    ${rowsHtml}
  `;
}

function schedNav(delta) {
  // Use advanceDay to skip Sunday consistently with the tested utility
  const currentDow = schedViewDate.getDay(); // 1=Mon…6=Sat
  const targetDow  = advanceDay(currentDow, delta);
  const diff = targetDow - currentDow;
  // If going forward and target < current (Mon after Sat), add 7; if backward and target > current (Sat before Mon), subtract 7
  const daysDiff = delta > 0
    ? (diff > 0 ? diff : diff + 7)
    : (diff < 0 ? diff : diff - 7);
  const d = new Date(schedViewDate);
  d.setDate(d.getDate() + daysDiff);
  schedViewDate = d;
  renderScheduleSidebar();
}

function toggleSchedEditMode() {
  schedEditMode = !schedEditMode;
  renderScheduleSidebar();
}

async function saveBlockAssignment(block, courseId) {
  const val = courseId || null;
  BLOCK_SCHEDULE[block] = val;
  const { error } = await sb.from('block_schedule').upsert(
    { user_id: currentUser.id, block, course_id: val },
    { onConflict: 'user_id,block' }
  );
  if (error) console.error('saveBlockAssignment error:', error.message);
}
```

- [ ] **Step 3: Call `renderScheduleSidebar()` in three places**

**3a. Add to `renderAll()` — after `applyFilter()` on line 936:**

Find (line 929–937):
```js
function renderAll() {
  const main = document.getElementById('mainContent');
  if (!main) return;
  main.innerHTML = COURSES.map(c => renderCourse(c)).join('') +
    `<div class="add-course-card" onclick="openAddCourseModal()">+ Add a Course</div>`;
  renderJumps();
  updateOverall();
  applyFilter();
}
```
Replace with:
```js
function renderAll() {
  const main = document.getElementById('mainContent');
  if (!main) return;
  main.innerHTML = COURSES.map(c => renderCourse(c)).join('') +
    `<div class="add-course-card" onclick="openAddCourseModal()">+ Add a Course</div>`;
  renderJumps();
  updateOverall();
  applyFilter();
  renderScheduleSidebar();
}
```

**3b. Add to `finishWizard()` — at line 739:**

Find (line 738–741):
```js
  const hasData = await loadUserData();
  if (hasData) { renderAll(); updateMissingCount(); }
  else { document.getElementById('mainContent').innerHTML = '<div class="add-course-card" onclick="openAddCourseModal()">+ Add a Course</div>'; }
  setSyncStatus('ok');
```
Replace with:
```js
  const hasData = await loadUserData();
  if (hasData) { renderAll(); updateMissingCount(); }
  else { document.getElementById('mainContent').innerHTML = '<div class="add-course-card" onclick="openAddCourseModal()">+ Add a Course</div>'; }
  renderScheduleSidebar();
  setSyncStatus('ok');
```

(Note: `renderAll()` already calls `renderScheduleSidebar()` after 3a, so the `if (hasData)` branch is covered. The `else` branch needs the extra call here.)

- [ ] **Step 4: Initialize `schedViewDate` to skip Sunday on load**

After `let schedViewDate = new Date();` in the state vars, add the Sunday check on the next line:

```js
let schedViewDate = new Date();
if (schedViewDate.getDay() === 0) schedViewDate.setDate(schedViewDate.getDate() + 1);
```

- [ ] **Step 5: Verify in browser**

Load the app. The right sidebar should show today's blocks with times. Navigate with ‹ › arrows — should step Mon–Sat, skip Sunday. If you navigate to a block that's happening right now, it should be highlighted red. Edit mode (✏️) should show dropdowns.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat: render schedule sidebar with day nav and edit mode"
```

---

## Chunk 3: Admin Panel

### Task 6: Admin Panel HTML, CSS, and JS

**Files:**
- Modify: `index.html` — add ⚙ button to header, admin modal HTML, admin CSS, admin JS functions

- [ ] **Step 1: Add the ⚙ admin button to the header HTML**

Find the header buttons area (~line 413):
```html
        <button class="sync-canvas-btn" id="syncCanvasBtn" onclick="reSyncCanvas()">↻ Sync Canvas</button>
        <button class="logout-btn" onclick="signOut()">Sign out</button>
```

Add the admin button between them (it will only be shown via JS for Logan):
```html
        <button class="admin-btn" id="adminBtn" onclick="openAdminModal()" style="display:none" title="Admin">⚙</button>
        <button class="sync-canvas-btn" id="syncCanvasBtn" onclick="reSyncCanvas()">↻ Sync Canvas</button>
        <button class="logout-btn" onclick="signOut()">Sign out</button>
```

- [ ] **Step 2: Add admin modal HTML**

After the existing add-course modal HTML (~line 492, before `</div><!-- #app -->`), add:

```html
  <!-- ADMIN MODAL -->
  <div class="modal-overlay" id="adminModal" onclick="if(event.target===this)closeAdminModal()">
    <div class="modal" style="max-width:560px">
      <div class="modal-header">
        <div><h2>⚙ Admin Settings</h2></div>
        <button class="modal-close" onclick="closeAdminModal()">✕</button>
      </div>
      <div class="modal-body">

        <!-- Section 1: Alt Saturday -->
        <h3 style="font-size:0.85rem;font-weight:700;margin-bottom:12px;">Alt Saturday Date</h3>
        <p style="font-size:0.78rem;color:#6b7280;margin-bottom:10px;">Set this to the date of the upcoming alt Saturday. Users will automatically see the alternate schedule on that day.</p>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <input type="date" id="adminAltSatDate" style="padding:6px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:0.85rem;outline:none;">
          <button class="modal-submit-btn" onclick="saveAltSaturday()" style="padding:6px 16px;font-size:0.82rem;">Save</button>
          <button class="logout-btn" onclick="clearAltSaturday()" style="padding:6px 12px;font-size:0.78rem;">Clear</button>
        </div>
        <p id="adminAltSatStatus" style="font-size:0.75rem;margin-top:6px;color:#6b7280;"></p>

        <hr style="margin:20px 0;border:none;border-top:1px solid var(--border);">

        <!-- Section 2: Custom Schedule Editor -->
        <h3 style="font-size:0.85rem;font-weight:700;margin-bottom:12px;">Custom Schedule Override</h3>
        <p style="font-size:0.78rem;color:#6b7280;margin-bottom:12px;">Create a special schedule for a specific date. All users will see it.</p>
        <div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:flex-end;">
          <div>
            <label style="display:block;font-size:0.75rem;font-weight:600;margin-bottom:4px;">Date</label>
            <input type="date" id="adminOverrideDate" onchange="loadOverrideForDate()" style="padding:6px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:0.82rem;outline:none;">
          </div>
          <div style="flex:1;min-width:160px;">
            <label style="display:block;font-size:0.75rem;font-weight:600;margin-bottom:4px;">Label</label>
            <input type="text" id="adminOverrideLabel" placeholder="e.g. Exam Day Schedule" style="width:100%;padding:6px 10px;border:1.5px solid var(--border);border-radius:6px;font-size:0.82rem;outline:none;">
          </div>
        </div>

        <div id="adminOverrideEntries" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px;"></div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
          <button class="logout-btn" onclick="adminAddEntry('block')" style="font-size:0.78rem;padding:5px 12px;">+ Block</button>
          <button class="logout-btn" onclick="adminAddEntry('special')" style="font-size:0.78rem;padding:5px 12px;">+ Special Event</button>
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="modal-submit-btn" onclick="saveOverride()" style="padding:7px 20px;font-size:0.85rem;">Save Override</button>
          <button class="logout-btn" onclick="deleteOverride()" style="padding:7px 14px;font-size:0.78rem;color:#dc2626;border-color:#fca5a5;">Delete</button>
        </div>
        <p id="adminOverrideStatus" style="font-size:0.75rem;margin-top:8px;color:#6b7280;"></p>

      </div>
    </div>
  </div>
```

- [ ] **Step 3: Add admin CSS**

In the `<style>` block, add:

```css
/* ── Admin button ── */
.admin-btn {
  background: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.35);
  color: white; border-radius: 6px; padding: 4px 9px; font-size: 0.85rem;
  cursor: pointer; transition: background 0.15s;
}
.admin-btn:hover { background: rgba(255,255,255,0.28); }
```

- [ ] **Step 4: Add admin JS functions**

Add these functions after the schedule sidebar functions:

```js
// ─────────────────────────────────────────────
//  ADMIN PANEL
// ─────────────────────────────────────────────
function openAdminModal() {
  // Pre-fill alt saturday date
  const existing = APP_SETTINGS['alt_saturday_date'] || '';
  document.getElementById('adminAltSatDate').value = existing;
  document.getElementById('adminAltSatStatus').textContent =
    existing ? `Currently set to ${existing}` : 'Not set';

  // Clear override editor
  document.getElementById('adminOverrideDate').value = '';
  document.getElementById('adminOverrideLabel').value = '';
  document.getElementById('adminOverrideEntries').innerHTML = '';
  document.getElementById('adminOverrideStatus').textContent = '';

  document.getElementById('adminModal').classList.add('open');
}

function closeAdminModal() {
  document.getElementById('adminModal').classList.remove('open');
}

async function saveAltSaturday() {
  const val = document.getElementById('adminAltSatDate').value;
  if (!val) { alert('Pick a date first.'); return; }
  const { error } = await sb.from('app_settings')
    .upsert({ key: 'alt_saturday_date', value: val }, { onConflict: 'key' });
  if (error) { document.getElementById('adminAltSatStatus').textContent = '✗ ' + error.message; return; }
  APP_SETTINGS['alt_saturday_date'] = val;
  document.getElementById('adminAltSatStatus').textContent = `✓ Saved — ${val}`;
  renderScheduleSidebar();
}

async function clearAltSaturday() {
  const { error } = await sb.from('app_settings')
    .upsert({ key: 'alt_saturday_date', value: '' }, { onConflict: 'key' });
  if (error) { document.getElementById('adminAltSatStatus').textContent = '✗ ' + error.message; return; }
  APP_SETTINGS['alt_saturday_date'] = '';
  document.getElementById('adminAltSatDate').value = '';
  document.getElementById('adminAltSatStatus').textContent = 'Cleared.';
  renderScheduleSidebar();
}

// ── Custom schedule editor ──

let adminEntries = []; // working copy of entry rows

function loadOverrideForDate() {
  const date = document.getElementById('adminOverrideDate').value;
  if (!date) return;
  if (SCHEDULE_OVERRIDES[date]) {
    document.getElementById('adminOverrideLabel').value = SCHEDULE_OVERRIDES[date].label;
    adminEntries = JSON.parse(JSON.stringify(SCHEDULE_OVERRIDES[date].entries));
  } else {
    document.getElementById('adminOverrideLabel').value = '';
    adminEntries = [];
  }
  renderAdminEntries();
}

function adminAddEntry(type) {
  if (type === 'block') {
    adminEntries.push({ type: 'block', block: 'A', label: null, start: '8:15 am', end: '9:15 am' });
  } else {
    adminEntries.push({ type: 'special', block: null, label: 'Assembly', start: '9:20 am', end: '9:50 am' });
  }
  renderAdminEntries();
}

function adminRemoveEntry(i) {
  adminEntries.splice(i, 1);
  renderAdminEntries();
}

function adminMoveEntry(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= adminEntries.length) return;
  [adminEntries[i], adminEntries[j]] = [adminEntries[j], adminEntries[i]];
  renderAdminEntries();
}

function adminUpdateEntry(i, field, value) {
  adminEntries[i][field] = value || null;
}

function renderAdminEntries() {
  const container = document.getElementById('adminOverrideEntries');
  if (!container) return;
  container.innerHTML = adminEntries.map((entry, i) => {
    const moveUp   = i > 0 ? `<button class="logout-btn" onclick="adminMoveEntry(${i},-1)" style="padding:2px 6px;font-size:0.7rem;">↑</button>` : '<span style="width:26px"></span>';
    const moveDown = i < adminEntries.length - 1 ? `<button class="logout-btn" onclick="adminMoveEntry(${i},1)" style="padding:2px 6px;font-size:0.7rem;">↓</button>` : '<span style="width:26px"></span>';
    const typeLabel = entry.type === 'block' ? '🔵' : '✦';

    const blockOrLabel = entry.type === 'block'
      ? `<select onchange="adminUpdateEntry(${i},'block',this.value)" style="padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-size:0.78rem;">
          ${['A','B','C','D','E','F','G'].map(b => `<option value="${b}" ${entry.block===b?'selected':''}>${b}</option>`).join('')}
         </select>`
      : `<input type="text" value="${entry.label || ''}" oninput="adminUpdateEntry(${i},'label',this.value)" placeholder="Event name" style="width:80px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-size:0.78rem;">`;

    return `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:4px 0;border-bottom:1px solid #f3f4f6;">
      <span style="font-size:0.8rem;">${typeLabel}</span>
      ${blockOrLabel}
      <input type="text" value="${entry.start}" oninput="adminUpdateEntry(${i},'start',this.value)" placeholder="9:00 am" style="width:68px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-size:0.78rem;">
      <span style="font-size:0.7rem;color:#9ca3af;">–</span>
      <input type="text" value="${entry.end}" oninput="adminUpdateEntry(${i},'end',this.value)" placeholder="10:00 am" style="width:68px;padding:3px 6px;border:1px solid var(--border);border-radius:4px;font-size:0.78rem;">
      ${moveUp}${moveDown}
      <button class="logout-btn" onclick="adminRemoveEntry(${i})" style="padding:2px 6px;font-size:0.7rem;color:#dc2626;">×</button>
    </div>`;
  }).join('');
}

async function saveOverride() {
  const date  = document.getElementById('adminOverrideDate').value;
  const label = document.getElementById('adminOverrideLabel').value.trim();
  if (!date)  { document.getElementById('adminOverrideStatus').textContent = '✗ Pick a date.'; return; }
  if (!label) { document.getElementById('adminOverrideStatus').textContent = '✗ Add a label.'; return; }
  if (!adminEntries.length) { document.getElementById('adminOverrideStatus').textContent = '✗ Add at least one entry.'; return; }

  const { error } = await sb.from('schedule_overrides')
    .upsert({ date, label, entries: adminEntries }, { onConflict: 'date' });
  if (error) { document.getElementById('adminOverrideStatus').textContent = '✗ ' + error.message; return; }

  SCHEDULE_OVERRIDES[date] = { label, entries: JSON.parse(JSON.stringify(adminEntries)) };
  document.getElementById('adminOverrideStatus').textContent = `✓ Saved override for ${date}`;
  renderScheduleSidebar();
}

async function deleteOverride() {
  const date = document.getElementById('adminOverrideDate').value;
  if (!date) { document.getElementById('adminOverrideStatus').textContent = '✗ Pick a date first.'; return; }
  if (!SCHEDULE_OVERRIDES[date]) { document.getElementById('adminOverrideStatus').textContent = 'No override exists for this date.'; return; }
  if (!confirm(`Delete the custom schedule for ${date}?`)) return;

  const { error } = await sb.from('schedule_overrides').delete().eq('date', date);
  if (error) { document.getElementById('adminOverrideStatus').textContent = '✗ ' + error.message; return; }

  delete SCHEDULE_OVERRIDES[date];
  adminEntries = [];
  document.getElementById('adminOverrideLabel').value = '';
  renderAdminEntries();
  document.getElementById('adminOverrideStatus').textContent = `✓ Deleted override for ${date}`;
  renderScheduleSidebar();
}
```

- [ ] **Step 5: Add admin modal to the Escape key handler**

Find the existing Escape handler at line 1142:
```js
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeMissingModal(); closeAddCourseModal(); }
});
```
Replace with:
```js
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeMissingModal(); closeAddCourseModal(); closeAdminModal(); }
});
```

- [ ] **Step 6: Show ⚙ button for admin in `afterAuth()`**

In `afterAuth()`, after `currentUser` is confirmed, add:

```js
// Show admin button for Logan only
const adminBtn = document.getElementById('adminBtn');
if (adminBtn) adminBtn.style.display = currentUser.id === ADMIN_USER_ID ? 'inline-block' : 'none';
```

Also add the same in `signOut()` to hide it on logout:
```js
const adminBtn = document.getElementById('adminBtn');
if (adminBtn) adminBtn.style.display = 'none';
```

- [ ] **Step 7: Verify admin panel in browser**

1. Log in as Logan. The ⚙ button should appear in the header.
2. Click ⚙ — the admin modal opens.
3. Set an alt Saturday date and click Save. Check `APP_SETTINGS['alt_saturday_date']` in the console.
4. Navigate the schedule sidebar to that Saturday — it should use the alt schedule.
5. Create a custom override: pick a date, add a label, add a couple entries (one Block, one Special), click Save. Navigate the sidebar to that date — it should show the custom schedule with "Special: [label]" banner.
6. Log in as a different user — ⚙ button must not appear.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "feat: admin panel for alt Saturday and custom schedule overrides"
```

---

## Final Verification

- [ ] Navigate each day of the week in the sidebar — correct blocks shown with correct times
- [ ] Edit mode assigns a course to a block, persists on page reload
- [ ] Current block is highlighted only when viewing today and a block is in progress
- [ ] Sunday is skipped by navigation (both forward and backward)
- [ ] Alt Saturday: set a future Saturday's date in admin panel → navigate to that Saturday → alt schedule shown
- [ ] Custom override: create one → navigate to that date → custom schedule + banner shown → delete it → normal schedule returns
- [ ] Non-admin user: no ⚙ button visible
- [ ] Sidebar hidden on mobile (< 768px)
