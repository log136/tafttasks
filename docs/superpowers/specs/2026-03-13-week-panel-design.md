# Due This Week Panel — Design Spec

**Date:** 2026-03-13
**Status:** Approved (v2 — post spec review)

---

## Overview

A collapsible "Due This Week" summary panel inserted at the top of the main dashboard content area, above the course cards. Gives a quick-glance view of the current calendar week's assignments without scrolling through every course card. Assignments can be checked off directly from the panel.

---

## Layout & Position

- Rendered as the first element inside `#mainContent`, prepended before the course card HTML
- `renderAll()` is modified to generate the panel HTML first: `main.innerHTML = renderWeekPanel() + COURSES.map(...).join('') + addCourseCard`
- Sits below the controls bar (filter buttons / search), above the first course card
- White background, `border-bottom: 1px solid var(--border)` to separate from content below
- Full width within the main content column
- Panel is only rendered from `renderAll()`, which is only called when `#app` is active — so the panel never appears on auth, wizard, or landing screens

---

## Structure

```
┌─ Panel Header ────────────────────────────────────────────┐
│  "DUE THIS WEEK"   ‹  Mar 10 – 16  ›          Hide ▲     │
├─ Day Tabs ────────────────────────────────────────────────┤
│  Mon  Tue  [Wed · today]  Thu  Fri  Sat  Sun              │
│   2    1       2           0    1    0    0  ← badges     │
├─ Panel Body (selected day) ───────────────────────────────┤
│  ☐  Quiz Ch 9          Statistics ●    [Due today]        │
│  ☐  Problem Set 9      Statistics ●                       │
└───────────────────────────────────────────────────────────┘
```

---

## Week Navigation

- **Week definition:** Monday–Sunday calendar week (not rolling 7 days)
- **Default week:** the week containing today
- **Prev / Next buttons** (‹ ›) shift by exactly 7 days
- **Week label format:** "Mar 10 – 16". For weeks spanning two months: "Mar 31 – Apr 6"
- **Selected tab default:** today's day of week index (Mon=0…Sun=6). When navigating to another week, default to Monday (idx 0)
- **Today on a weekend:** Saturday or Sunday tab is selected by default even if empty — no fallback override

---

## Day Index Convention

Panel uses a Monday-first index (0 = Mon, 1 = Tue … 6 = Sun) — different from JavaScript's `Date.getDay()` (0 = Sun, 1 = Mon … 6 = Sat).

Conversion from JS day to panel index:
```js
const panelIdx = (jsDay + 6) % 7;  // Sun→6, Mon→0, Tue→1, …, Sat→5
```

Use this conversion whenever deriving the selected tab from `new Date().getDay()`.

---

## Date Comparison

`item.due` is stored as an ISO date string (`"2026-03-12"`). Do **not** use `new Date(item.due)` for bucketing — this parses as midnight UTC and shifts the date by one day for users in negative-offset timezones.

Instead, compare date strings directly:

```js
// Get YYYY-MM-DD string for a given panel day index in the displayed week.
// Uses local date arithmetic — NOT toISOString() — to avoid UTC offset shifting
// the date to the previous day for US timezone users.
function getPanelDayStr(weekMonday, panelIdx) {
  const d = new Date(weekMonday);
  d.setDate(d.getDate() + panelIdx);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// weekMonday itself should be computed using local date arithmetic:
function getWeekMonday(weekOffset) {
  const today = new Date();
  const jsDay = today.getDay();
  const diffToMon = (jsDay + 6) % 7;  // days since Monday
  const mon = new Date(today);
  mon.setDate(today.getDate() - diffToMon + weekOffset * 7);
  mon.setHours(0, 0, 0, 0);
  return mon;
}
```

An assignment belongs to a day when `item.due === getPanelDayStr(weekMonday, panelIdx)`.

---

## Day Tabs

- 7 tabs: Mon through Sun
- Each tab shows: abbreviated day name, date number, count badge
- **Badge states** (based on items in that day's slot):
  - `totalCount === 0`: muted grey "0" badge
  - `incompleteCount > 0`: red badge — `background: var(--tag-overdue)`, `color: var(--tag-overdue-text)` — shows incomplete count
  - `incompleteCount === 0 && totalCount > 0` (all checked off): green badge — `background: var(--tag-quiz)`, `color: var(--tag-quiz-text)` — shows "✓"
- **Today tab:** only marked on current calendar week; label appended with "· today", label and date in `var(--taft-red)`. No "· today" marker when browsing other weeks.
- **Weekend tabs:** 50% opacity when `totalCount === 0`
- **Active tab:** raised appearance (white bg, border on 3 sides, no bottom border), connects visually to panel body

---

## Panel Body

- Background: `var(--bg)` — slightly recessed from the white panel header
- Each assignment row contains:
  - Checkbox (16×16px, rounded 3px, `var(--taft-red)` when checked)
  - Assignment name (strikes through and color mutes to `var(--muted)` when checked)
  - Course color dot + course name (right-aligned, `var(--muted)`)
  - "Due today" or "Overdue" red pill tag for past-due or same-day items — hidden (not shown) once the item is checked off
- Empty day: centered muted message "Nothing due — enjoy the break."
- Rows separated by a subtle `var(--border)` divider

---

## Checking Off Assignments

**Important:** `toggleDone(id, courseId)` unconditionally flips `state.done[id]` as its first synchronous line, then does the Supabase persist asynchronously. `weekPanelToggleDone` must **not** flip `state.done` itself — doing so would double-flip the flag (cancelling the toggle) and persist the wrong value to Supabase.

Correct pattern:

```js
function weekPanelToggleDone(id, courseId) {
  toggleDone(id, courseId);   // synchronously flips state.done[id] as its first line,
                               // then persists + updates main row DOM asynchronously
  renderWeekPanelBody();      // state.done[id] is already correct — re-render panel
}
```

Since `toggleDone`'s flip of `state.done[id]` is synchronous (before any `await`), calling `renderWeekPanelBody()` immediately after gives it the correct updated value. No `await` needed.

`toggleDone` internally calls `updateMissingCount()` and `applyFilter()` — no extra calls needed from the panel.

---

## Collapse Behavior

- "Hide ▲" / "Show ▼" toggle button in the panel header (top-right)
- Collapsed state hides the day tabs and panel body; header row stays visible
- Collapse state persisted in `localStorage` under key `weekPanelCollapsed`
- Read from `localStorage` during `renderWeekPanel()` to set initial state

---

## Dark Mode

All colors use existing CSS variables (`--bg`, `--card`, `--border`, `--text`, `--muted`, `--taft-red`). Badge colors reuse existing tag variables:
- Red badge: `--tag-overdue` (bg) / `--tag-overdue-text` (text) — already dark-mode-aware
- Green badge: `--tag-quiz` (bg) / `--tag-quiz-text` (text) — already dark-mode-aware

Verify both variables are defined in the dark mode block (`[data-theme="dark"]`) in the existing CSS before implementation. If `--tag-quiz` is not defined as a CSS var (it may be inline in existing tag styles), define it in both light and dark blocks.

---

## State Object

A module-level object tracks panel UI state (not persisted beyond collapse flag):

```js
const weekPanelState = {
  weekOffset: 0,       // 0 = current week, -1 = last week, +1 = next week
  selectedDayIdx: (new Date().getDay() + 6) % 7,  // today's panel index (Mon=0…Sun=6)
};
```

Initialize `selectedDayIdx` to today's panel index at definition time — not hardcoded `0` — so the first render defaults to today's tab without any extra initialization step.

---

## Key Functions

| Function | Responsibility |
|---|---|
| `renderWeekPanel()` | Returns full panel HTML string. Called inside `renderAll()` and by `weekPanelNavigate()`. Reads `weekPanelState` and `localStorage` for collapsed state. |
| `renderWeekPanelBody()` | Re-renders the panel body rows and tab badges in-place. Called after tab switch and checkbox toggle. Does **not** update the week label or tab date numbers — those require a full `renderWeekPanel()` call. |
| `weekPanelSelectDay(idx)` | Updates `weekPanelState.selectedDayIdx`, calls `renderWeekPanelBody()` |
| `weekPanelNavigate(delta)` | Shifts `weekOffset` by ±1, resets `selectedDayIdx` to 0 (Mon), replaces the panel element via a full `renderWeekPanel()` call (week navigation is infrequent; full re-render is simpler and correct) |
| `weekPanelToggleCollapse()` | Toggles collapsed state, persists to `localStorage`, toggles DOM visibility of tabs + body |
| `weekPanelToggleDone(id, courseId)` | Calls `toggleDone(id, courseId)` (which synchronously flips `state.done`), then calls `renderWeekPanelBody()` to reflect new state |

---

## Data

Pulls from the existing in-memory `COURSES` array — no new Supabase queries. For a given day, collects all items where `item.due === getPanelDayStr(weekMonday, panelIdx)`. Completed items (`state.done[item.id] === true`) are included in the list but shown struck-through; they do not count toward the red badge but do count toward the green "all done" badge condition.

If `COURSES` is empty, all badges show 0 and all days show the empty state message — this is acceptable.

---

## What's Not Included

- No per-item editing or deletion from the panel (use the course card below)
- No drag-to-reorder
- No assignment type tags in the panel (keeps rows compact)
- No points display
