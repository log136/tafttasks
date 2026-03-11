# Schedule Sidebar Design

## Goal

Add a schedule sidebar to the Taft Dashboard that shows the Taft block schedule with the user's own courses mapped to each block. Includes day navigation, admin-only alt Saturday control, and an admin-only custom schedule editor for special days.

## Architecture

All implementation lives in `index.html` (the existing single-file vanilla JS app). Three new Supabase tables. The full standard Taft schedule is hardcoded as a JS constant. Admin features are gated by hardcoding Logan's Supabase user ID.

## Supabase Tables

### `block_schedule`
Per-user mapping of blocks to courses.
```
user_id    uuid  FK auth.users
block      text  one of: A, B, C, D, E, F, G
course_id  uuid  nullable FK courses(id)
PRIMARY KEY (user_id, block)
```
RLS: users read/write their own rows only.

### `schedule_overrides`
Global special-day schedules, readable by all users, writable only by Logan's user ID.
```
date     date  PRIMARY KEY  (YYYY-MM-DD)
label    text               e.g. "Exam Day Schedule"
entries  jsonb              ordered array of entry objects
```
Entry object shape:
```json
{ "type": "block", "block": "A", "label": null, "start": "9:00 am", "end": "10:15 am" }
{ "type": "special", "block": null, "label": "Assembly", "start": "9:20 am", "end": "9:50 am" }
```

### `app_settings`
Global key/value store, readable by all, writable only by Logan's user ID.
```
key    text  PRIMARY KEY
value  text
```
Used for: `key = "alt_saturday_date"`, `value = "2026-03-15"` (or empty/null when not set).

## Hardcoded Schedule Data

`TAFT_SCHEDULE` constant in JS. Each day is an ordered array of entry objects. **Canonical time format: `"H:MM am/pm"` (e.g. `"8:15 am"`, `"12:00 pm"`).** This same format is used in `schedule_overrides` JSONB entries. All time parsing uses this format consistently.

Each entry object:
```js
{ type: "block",   block: "A", label: null,          start: "8:15 am",  end: "9:15 am"  }
{ type: "special", block: null, label: "I-Block",    start: "9:20 am",  end: "10:00 am" }
```

Full schedule:
```
Monday:    A(8:15am-9:15am), C(9:20am-10:05am), B(10:10am-11:25am), [Community Lunch 11:30am-12:10pm], D(12:15pm-1:00pm), E(1:05pm-1:50pm), F(1:55pm-2:40pm)
Tuesday:   G(8:15am-9:15am), [School Meeting 9:20am-10:00am], F(10:05am-11:20am), D(11:30am-12:30pm), C(12:35pm-1:50pm), A(1:55pm-2:40pm)
Wednesday: B(8:15am-9:15am), [Assembly 9:20am-9:50am], G(9:55am-10:40am), E(10:45am-12:00pm)
Thursday:  F(8:15am-9:15am), [I-Block 9:20am-10:00am], A(10:05am-11:20am), C(11:30am-12:30pm), D(12:35pm-1:50pm), E(1:55pm-2:40pm)
Friday:    E(8:15am-9:15am), [Dept./Faculty Mtg 9:20am-10:00am], G(10:05am-11:20am), D(11:25am-12:10pm), C(12:15pm-1:00pm), F(1:05pm-1:50pm), B(1:55pm-2:40pm)
Saturday:  A(9:00am-9:45am), [Assembly 9:50am-10:20am], B(10:25am-11:10am), G(11:15am-12:00pm)
Alt Sat:   A(9:00am-10:00am), [Assembly 10:05am-10:35am], B(10:40am-11:55am)
Sunday:    (no classes — empty state)
```

Block colors (match Taft's own color coding):
```
A = #e6a817  (yellow)
B = #e87c7c  (pink)
C = #7c9de8  (blue)
D = #9b5de5  (purple)
E = #4caf6a  (green)
F = #4f9ca8  (teal)
G = #a8c84f  (yellow-green)
```

## Schedule Sidebar (All Users)

### Layout

Inside the `#app` screen, introduce a new `.app-body` wrapper element that wraps both the existing `.main` content and the new sidebar:
```html
<div class="app-body">
  <div class="main"><!-- existing course cards --></div>
  <div class="schedule-sidebar"><!-- new --></div>
</div>
```
`.app-body` is `display: flex; flex-direction: row; align-items: flex-start; gap: 16px;`. The existing `.main` stays `flex-direction: column` and gains `flex: 1`. The sidebar is `220px` fixed width. On narrow screens (`max-width: 768px`) the sidebar is hidden.

### Sidebar structure

```
┌─────────────────────┐
│ 📅 Schedule    [✏️] │  ← header; ✏️ toggles edit mode
├─────────────────────┤
│ ‹   Thursday        │
│     Mar 13      ›   │  ← day navigator
├─────────────────────┤
│ [F] AP Statistics   │
│     8:15–9:15 am    │
│ ··· I-Block         │  ← special event row
│     9:20–10:00 am   │
│ [A] AP Statistics ← │  ← current block (highlighted)
│     10:05–11:20     │
│ [C] Spanish IV      │
│ [D] Free block      │
│ [E] Psychology      │
└─────────────────────┘
```

- Day navigator defaults to today. If today is Sunday, auto-advance to the following Monday and show an empty-state message ("No classes today") on Sunday if the user manually navigates back. Arrows step Mon → Tue → Wed → Thu → Fri → Sat → (next) Mon, skipping Sunday. Pressing › on Saturday jumps to the following Monday.
- Block rows: colored letter badge, course name (or "Free block" in gray italic), time range.
- Current block: highlighted with a subtle red-tinted background, only when viewing today. A block is "current" if the current wall-clock time falls within its `[start, end)` window. Parse times using the canonical format defined below.
- Special event rows: lighter background, no color badge, italic label.
- If the selected date has a `schedule_overrides` row: use that instead of hardcoded schedule. Show a small banner: `"Special: [label]"`.
- Saturday: check `app_settings.alt_saturday_date`. If it matches the Saturday being viewed, use alt schedule.

### Edit mode

Toggle with ✏️ icon. Each block row's course name becomes a `<select>` with:
- "Free block" (null course_id) as first option
- All user's courses listed by name
- Current selection pre-selected

On `change`, upsert to `block_schedule`. On clicking ✏️ again, exit edit mode.

## Admin Panel (Logan Only)

### Access

Logan's Supabase user ID is hardcoded as `ADMIN_USER_ID` in the JS. When `currentUser.id === ADMIN_USER_ID`, a small ⚙ icon appears in the main dashboard header (right side, near logout). Clicking it opens an admin modal.

### Admin modal layout

Two stacked sections separated by a visual divider (`<hr>`). First section: Alt Saturday. Second section: Custom Schedule Editor.

### Admin modal — Alt Saturday

A date input + save button.
- Load current value from `app_settings` where `key = 'alt_saturday_date'`.
- User picks a date, clicks Save → upsert `app_settings`.
- Clear button sets value to empty string (disables alt Saturday).

### Admin modal — Custom Schedule Editor

Fields: date picker, label text input, entries list.

Each entry row:
- Type toggle: Block / Special
- If Block: letter select (A–G)
- If Special: text input for label
- Start time input (text, e.g. "9:00 am")
- End time input (text, e.g. "10:15 am")
- Remove (×) button

Controls: "Add Block" button, "Add Special Event" button, ↑↓ arrows to reorder rows, Save button.

Save upserts to `schedule_overrides`. A separate "Load existing" flow: if a date already has an override, populate the editor with it on date change.

Delete button removes the override for that date entirely.

## Data Loading

- `loadBlockAssignments()` — fetches all `block_schedule` rows for `currentUser.id`, stores in `BLOCK_SCHEDULE` map keyed by block letter: `{ A: course_id | null, … }`. Sidebar rendering resolves names by looking up `course_id` in the global `COURSES` array (e.g. `COURSES.find(c => c.id === course_id)?.name`).
- `loadScheduleOverrides()` — fetches all rows from `schedule_overrides`, stores in `SCHEDULE_OVERRIDES` map keyed by date string (YYYY-MM-DD).
- `loadAppSettings()` — fetches all rows from `app_settings`, stores in `APP_SETTINGS` map (`{ key: value }`).
- `loadScheduleOverrides()` and `loadAppSettings()` are called **unconditionally** near the top of `loadUserData()`, before the early-return check that bails out when the user has no courses. `loadBlockAssignments()` is also called unconditionally (it just produces an empty map for new users).
- Admin writes call Supabase directly (RLS enforced server-side by user ID policy).

## Edit Mode with No Courses

If the user has no courses yet (new user), edit mode `<select>` dropdowns show only "Free block". This is harmless — the user can set up courses first and return to assign them later.

## RLS Policies

`block_schedule`: standard user-scoped RLS. Upsert uses `onConflict: 'user_id,block'` targeting the full composite primary key (not a partial index), so upsert is safe here — the CLAUDE.md caveat about partial indexes does not apply.

`schedule_overrides`:
- SELECT: authenticated users
- INSERT/UPDATE/DELETE: `auth.uid() = '<LOGAN_USER_ID>'`

`app_settings`:
- SELECT: authenticated users
- INSERT/UPDATE/DELETE: `auth.uid() = '<LOGAN_USER_ID>'`
