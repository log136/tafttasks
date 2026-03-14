# Due This Week Panel — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible "Due This Week" panel above the course cards that shows assignments by day with tabs, week navigation, and inline checkboxes.

**Architecture:** All code lives in `index.html` (single-file app, no build step). CSS is added to the `<style>` block. JS state and functions are added to the `<script>` block. `renderAll()` is modified to prepend the panel HTML. No new files, no new Supabase queries — data comes from the existing in-memory `COURSES` array.

**Tech Stack:** Vanilla JS, HTML, CSS. Supabase JS (CDN). No test runner — verification is done by opening `index.html` in a browser (or the live Cloudflare Pages deployment).

**Spec:** `docs/superpowers/specs/2026-03-13-week-panel-design.md`

---

## Chunk 1: CSS + State + Utility Functions

### Task 1: Add week panel CSS

**Files:**
- Modify: `index.html` — `<style>` block, after line 335 (after `.modal-item-checkbox.checked::after`)

- [ ] **Step 1: Insert light-mode CSS after the modal-item-checkbox rules**

Find the line:
```css
    .modal-item-checkbox.checked::after { content: '✓'; color: white; font-size: 11px; font-weight: 700; }
```

Insert immediately after it:
```css
    /* ── Week Panel ── */
    .week-panel { background: var(--card); border-bottom: 1px solid var(--border); margin-bottom: 16px; border-radius: 14px; box-shadow: 0 1px 4px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04); overflow: hidden; }
    .week-panel-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 16px 0; }
    .week-panel-left { display: flex; align-items: center; gap: 10px; }
    .week-panel-title { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
    .week-nav { display: flex; align-items: center; gap: 5px; }
    .week-nav-btn { background: none; border: 1px solid var(--border); border-radius: 5px; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; color: var(--text); cursor: pointer; transition: background 0.12s; }
    .week-nav-btn:hover { background: var(--bg); }
    .week-range { font-size: 0.72rem; font-weight: 600; color: var(--text); }
    .week-collapse-btn { background: none; border: none; cursor: pointer; font-size: 0.72rem; color: var(--muted); padding: 2px 4px; display: flex; align-items: center; gap: 4px; transition: color 0.12s; }
    .week-collapse-btn:hover { color: var(--text); }
    .week-tabs { display: flex; gap: 4px; padding: 8px 16px 0; }
    .week-tab { flex: 1; text-align: center; padding: 6px 4px 5px; border-radius: 8px 8px 0 0; border: 1px solid transparent; border-bottom: none; cursor: pointer; transition: all 0.12s; position: relative; bottom: -1px; }
    .week-tab:hover { background: var(--bg); }
    .week-tab.active { background: var(--bg); border-color: var(--border); border-bottom-color: var(--bg); }
    .week-tab.today-tab .week-tab-day { color: var(--taft-red); }
    .week-tab.today-tab .week-tab-date { color: var(--taft-red); }
    .week-tab.weekend-tab { opacity: 0.5; }
    .week-tab-day { font-size: 0.6rem; font-weight: 700; text-transform: uppercase; color: var(--muted); }
    .week-tab.active .week-tab-day { color: var(--muted); }
    .week-tab-date { font-size: 0.82rem; font-weight: 700; color: var(--text); }
    .week-tab-badge { font-size: 0.58rem; font-weight: 700; border-radius: 99px; padding: 1px 5px; display: inline-block; margin-top: 2px; }
    .week-tab-badge.badge-empty { background: var(--border); color: var(--muted); }
    .week-tab-badge.badge-pending { background: var(--tag-overdue); color: var(--tag-overdue-text); }
    .week-tab-badge.badge-done { background: var(--tag-quiz); color: var(--tag-quiz-text); }
    .week-panel-body { background: var(--bg); border-top: 1px solid var(--border); padding: 10px 16px 12px; }
    .week-item { display: flex; align-items: center; gap: 9px; padding: 7px 0; border-bottom: 1px solid var(--border); }
    .week-item:last-child { border-bottom: none; }
    .week-item-checkbox { width: 16px; height: 16px; border-radius: 3px; border: 2px solid #d1d5db; background: var(--card); flex-shrink: 0; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: all 0.12s; }
    .week-item-checkbox:hover { border-color: var(--taft-red); }
    .week-item-checkbox.checked { background: var(--taft-red); border-color: var(--taft-red); }
    .week-item-checkbox.checked::after { content: '✓'; color: white; font-size: 9px; font-weight: 700; }
    .week-item-name { font-size: 0.82rem; font-weight: 500; color: var(--text); flex: 1; }
    .week-item-name.done { text-decoration: line-through; color: var(--muted); }
    .week-item-course { font-size: 0.68rem; color: var(--muted); display: flex; align-items: center; gap: 4px; white-space: nowrap; }
    .week-item-course-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
    .week-item-tag { font-size: 0.62rem; font-weight: 700; background: var(--tag-overdue); color: var(--tag-overdue-text); border-radius: 4px; padding: 1px 5px; white-space: nowrap; }
    .week-empty { font-size: 0.8rem; color: var(--muted); text-align: center; padding: 14px 0; }
```

- [ ] **Step 2: Add dark mode overrides**

Find the dark mode block near the bottom of the `<style>` tag. Find the line:
```css
    [data-theme="dark"] .assignment-row.urgent-red { background: #2a1010; border-left-color: #ef4444; }
```

Insert immediately before it:
```css
    [data-theme="dark"] .week-item-checkbox { background: var(--card); border-color: #3a3d4a; }
    [data-theme="dark"] .week-nav-btn:hover { background: #1f2230; }
```

- [ ] **Step 3: Verify CSS loads without errors**

Open `taft-dashboard/index.html` in a browser (or visit the deployed URL). Open DevTools → Console. Confirm no CSS parse errors. The dashboard should look unchanged since the new classes aren't used yet.

---

### Task 2: Add state object and utility functions

**Files:**
- Modify: `index.html` — `<script>` block, after line 1032 (after `let authMode = 'signin';`)

- [ ] **Step 1: Insert weekPanelState and utility functions after the global state declarations**

Find the line:
```js
let authMode = 'signin';
```

Insert immediately after it:
```js
const weekPanelState = {
  weekOffset: 0,
  selectedDayIdx: (new Date().getDay() + 6) % 7,  // Mon=0 … Sun=6
};

function getWeekMonday(weekOffset) {
  const today = new Date();
  const diffToMon = (today.getDay() + 6) % 7;
  const mon = new Date(today);
  mon.setDate(today.getDate() - diffToMon + weekOffset * 7);
  mon.setHours(0, 0, 0, 0);
  return mon;
}

function getPanelDayStr(weekMonday, panelIdx) {
  const d = new Date(weekMonday);
  d.setDate(d.getDate() + panelIdx);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function getWeekRangeLabel(weekMonday) {
  const sun = new Date(weekMonday);
  sun.setDate(weekMonday.getDate() + 6);
  const opts = { month: 'short', day: 'numeric' };
  const startStr = weekMonday.toLocaleDateString('en-US', opts);
  const endStr = weekMonday.getMonth() === sun.getMonth()
    ? sun.getDate()
    : sun.toLocaleDateString('en-US', opts);
  return `${startStr} – ${endStr}`;
}

function getDayItems(weekMonday, panelIdx) {
  const dayStr = getPanelDayStr(weekMonday, panelIdx);
  const items = [];
  COURSES.forEach(course => {
    course.groups.forEach(g => {
      g.items.forEach(item => {
        if (item.due === dayStr) items.push({ item, course });
      });
    });
  });
  return items;
}
```

- [ ] **Step 2: Verify no JS errors**

Reload the page in the browser. Open DevTools → Console. Confirm no errors. Dashboard should still work normally (the new variables and functions are defined but unused).

- [ ] **Step 3: Spot-check getDayItems in console**

In DevTools Console, run:
```js
getWeekMonday(0)
```
Confirm it returns a Date object set to the most recent Monday at midnight.

Then run:
```js
getPanelDayStr(getWeekMonday(0), 0)
```
Confirm it returns a `"YYYY-MM-DD"` string for Monday of the current week.

---

## Chunk 2: Rendering Functions

### Task 3: Add renderWeekPanel()

**Files:**
- Modify: `index.html` — `<script>` block, before the `renderAll()` function (line ~1726)

- [ ] **Step 1: Insert renderWeekPanel() before renderAll()**

Find the line:
```js
function renderAll() {
```

Insert immediately before it:
```js
// ─────────────────────────────────────────────
//  WEEK PANEL
// ─────────────────────────────────────────────
function renderWeekPanel() {
  const mon = getWeekMonday(weekPanelState.weekOffset);
  const todayStr = getPanelDayStr(getWeekMonday(0), (new Date().getDay() + 6) % 7);
  const isCurrentWeek = weekPanelState.weekOffset === 0;
  const collapsed = localStorage.getItem('weekPanelCollapsed') === 'true';
  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const tabsHtml = DAY_LABELS.map((label, i) => {
    const dayStr = getPanelDayStr(mon, i);
    const entries = getDayItems(mon, i);
    const total = entries.length;
    const incomplete = entries.filter(({ item }) => !state.done[item.id]).length;
    const isToday = isCurrentWeek && dayStr === todayStr;
    const isActive = i === weekPanelState.selectedDayIdx;
    const isWeekend = i >= 5;

    let badgeClass = 'badge-empty';
    let badgeText = total === 0 ? '0' : String(incomplete);
    if (total > 0 && incomplete === 0) { badgeClass = 'badge-done'; badgeText = '✓'; }
    else if (incomplete > 0) badgeClass = 'badge-pending';

    const dayDisplay = isToday ? `${label} · today` : label;
    // weekend-tab (half-opacity) only when the day has no items at all
    const showWeekendClass = isWeekend && total === 0;
    return `<div class="week-tab${isActive ? ' active' : ''}${isToday ? ' today-tab' : ''}${showWeekendClass ? ' weekend-tab' : ''}"
      onclick="weekPanelSelectDay(${i})">
      <div class="week-tab-day">${dayDisplay}</div>
      <div class="week-tab-date">${new Date(mon.getTime() + i * 86400000).getDate()}</div>
      <div class="week-tab-badge ${badgeClass}">${badgeText}</div>
    </div>`;
  }).join('');

  const bodyHtml = renderWeekPanelBodyHtml(mon);

  return `<div class="week-panel" id="weekPanel">
    <div class="week-panel-header">
      <div class="week-panel-left">
        <span class="week-panel-title">Due This Week</span>
        <div class="week-nav">
          <button class="week-nav-btn" onclick="weekPanelNavigate(-1)">‹</button>
          <span class="week-range">${getWeekRangeLabel(mon)}</span>
          <button class="week-nav-btn" onclick="weekPanelNavigate(1)">›</button>
        </div>
      </div>
      <button class="week-collapse-btn" onclick="weekPanelToggleCollapse()">
        <span id="weekCollapseLabel">${collapsed ? 'Show' : 'Hide'}</span>
        <span id="weekCollapseArrow">${collapsed ? '▼' : '▲'}</span>
      </button>
    </div>
    <div class="week-tabs" id="weekTabs" style="${collapsed ? 'display:none' : ''}">${tabsHtml}</div>
    <div class="week-panel-body" id="weekPanelBody" style="${collapsed ? 'display:none' : ''}">${bodyHtml}</div>
  </div>`;
}
```

- [ ] **Step 2: Verify no JS syntax errors**

Reload the page. DevTools → Console. No errors.

---

### Task 4: Add renderWeekPanelBodyHtml() and renderWeekPanelBody()

**Files:**
- Modify: `index.html` — immediately after `renderWeekPanel()`

- [ ] **Step 1: Insert the two body-rendering functions**

Find the line you just added:
```js
  </div>`;
}
```
(the closing of `renderWeekPanel`)

Insert immediately after it:
```js
function renderWeekPanelBodyHtml(mon) {
  const idx = weekPanelState.selectedDayIdx;
  const entries = getDayItems(mon, idx);
  if (!entries.length) return '<div class="week-empty">Nothing due — enjoy the break.</div>';

  const todayStr = getPanelDayStr(getWeekMonday(0), (new Date().getDay() + 6) % 7);
  const dayStr = getPanelDayStr(mon, idx);
  const isToday = weekPanelState.weekOffset === 0 && dayStr === todayStr;
  const isPast = dayStr < todayStr;

  return entries.map(({ item, course }) => {
    const isDone = !!state.done[item.id];
    let tag = '';
    if (!isDone && isToday) tag = '<span class="week-item-tag">Due today</span>';
    else if (!isDone && isPast) tag = '<span class="week-item-tag">Overdue</span>';
    return `<div class="week-item">
      <div class="week-item-checkbox${isDone ? ' checked' : ''}"
        onclick="weekPanelToggleDone('${item.id}','${course.id}')"></div>
      <div class="week-item-name${isDone ? ' done' : ''}">${item.name}</div>
      <div class="week-item-course">
        <div class="week-item-course-dot" style="background:${course.color}"></div>
        ${course.name}
      </div>
      ${tag}
    </div>`;
  }).join('');
}

function renderWeekPanelBody() {
  const bodyEl = document.getElementById('weekPanelBody');
  const tabsEl = document.getElementById('weekTabs');
  if (!bodyEl || !tabsEl) return;

  const mon = getWeekMonday(weekPanelState.weekOffset);
  const todayStr = getPanelDayStr(getWeekMonday(0), (new Date().getDay() + 6) % 7);
  const isCurrentWeek = weekPanelState.weekOffset === 0;
  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Update badges and weekend-tab opacity on all tabs
  tabsEl.querySelectorAll('.week-tab').forEach((tab, i) => {
    const badge = tab.querySelector('.week-tab-badge');
    if (!badge) return;
    const entries = getDayItems(mon, i);
    const total = entries.length;
    const incomplete = entries.filter(({ item }) => !state.done[item.id]).length;
    const isWeekend = i >= 5;
    // weekend-tab: half-opacity only when day has no items
    tab.classList.toggle('weekend-tab', isWeekend && total === 0);
    badge.className = 'week-tab-badge';
    if (total > 0 && incomplete === 0) { badge.classList.add('badge-done'); badge.textContent = '✓'; }
    else if (incomplete > 0) { badge.classList.add('badge-pending'); badge.textContent = String(incomplete); }
    else { badge.classList.add('badge-empty'); badge.textContent = '0'; }
  });

  bodyEl.innerHTML = renderWeekPanelBodyHtml(mon);
}
```

- [ ] **Step 2: Verify no JS syntax errors**

Reload the page. DevTools → Console. No errors.

---

## Chunk 3: Event Handlers + Wire-Up

### Task 5: Add event handler functions

**Files:**
- Modify: `index.html` — immediately after `renderWeekPanelBody()`

- [ ] **Step 1: Insert the four event handler functions**

Insert immediately after the closing `}` of `renderWeekPanelBody()`:

```js
function weekPanelSelectDay(idx) {
  weekPanelState.selectedDayIdx = idx;
  // Update active tab visually
  document.querySelectorAll('.week-tab').forEach((t, i) => {
    t.classList.toggle('active', i === idx);
  });
  renderWeekPanelBody();
}

function weekPanelNavigate(delta) {
  weekPanelState.weekOffset += delta;
  weekPanelState.selectedDayIdx = 0; // reset to Monday
  // Replace the panel element in-place
  const panel = document.getElementById('weekPanel');
  if (panel) {
    const tmp = document.createElement('div');
    tmp.innerHTML = renderWeekPanel();
    panel.replaceWith(tmp.firstElementChild);
  }
}

function weekPanelToggleCollapse() {
  const collapsed = localStorage.getItem('weekPanelCollapsed') === 'true';
  const next = !collapsed;
  localStorage.setItem('weekPanelCollapsed', String(next));
  const tabs = document.getElementById('weekTabs');
  const body = document.getElementById('weekPanelBody');
  const label = document.getElementById('weekCollapseLabel');
  const arrow = document.getElementById('weekCollapseArrow');
  if (tabs) tabs.style.display = next ? 'none' : '';
  if (body) body.style.display = next ? 'none' : '';
  if (label) label.textContent = next ? 'Show' : 'Hide';
  if (arrow) arrow.textContent = next ? '▼' : '▲';
}

function weekPanelToggleDone(id, courseId) {
  toggleDone(id, courseId);   // synchronously flips state.done[id], then async Supabase
  renderWeekPanelBody();      // re-render with updated state
}
```

- [ ] **Step 2: Verify no JS syntax errors**

Reload the page. DevTools → Console. No errors.

---

### Task 6: Wire renderWeekPanel() into renderAll()

**Files:**
- Modify: `index.html` — `renderAll()` function at line ~1726

- [ ] **Step 1: Prepend panel HTML in renderAll()**

Find:
```js
  main.innerHTML = COURSES.map(c => renderCourse(c)).join('') +
    `<div class="add-course-card" onclick="openAddCourseModal()">+ Add a Course</div>`;
```

Replace with:
```js
  main.innerHTML = renderWeekPanel() +
    COURSES.map(c => renderCourse(c)).join('') +
    `<div class="add-course-card" onclick="openAddCourseModal()">+ Add a Course</div>`;
```

- [ ] **Step 2: Reload and verify the panel appears**

Reload the page and log in. The "Due This Week" panel should appear above the course cards with:
- A header row showing "DUE THIS WEEK", the current week range (e.g. "Mar 10 – 16"), ‹ › buttons, and "Hide ▲"
- 7 day tabs (Mon–Sun), today's tab highlighted in red, badges showing counts
- A panel body showing today's assignments (or "Nothing due — enjoy the break." if none)

- [ ] **Step 3: Verify day tab switching**

Click a different day tab. The panel body should update to show that day's assignments.

- [ ] **Step 4: Verify week navigation**

Click ‹ to go back a week. The week label and tab dates should update. Click › to return to the current week. Today's tab should be highlighted again.

- [ ] **Step 5: Verify collapse**

Click "Hide ▲". The tabs and body should hide; only the header remains. Click "Show ▼". Tabs and body return. Reload the page — the collapsed state should be remembered (panel stays hidden if you collapsed it).

- [ ] **Step 6: Verify checkbox**

Check off an assignment in the panel. Confirm:
- The row strikes through in the panel
- The badge count on that day's tab decrements (or turns green ✓ if last item)
- The corresponding row in the course card below is also checked off (strikethrough)
- The "Missing" badge count in the header decrements if the item was overdue

- [ ] **Step 7: Verify weekend tab opacity**

If there is an assignment due on a Saturday or Sunday in any week: navigate to that week and confirm the weekend tab renders at full opacity (not dimmed). Confirm that a weekend tab with no assignments renders at half-opacity (dimmed). If you have no weekend assignments to test with, open DevTools Console and run:
```js
getDayItems(getWeekMonday(0), 5)  // returns [] if nothing due Saturday
```
Then navigate to a past or future week where Saturday is empty and confirm it appears dimmed.

- [ ] **Step 8: Verify dark mode**

Toggle dark mode (🌙 button in header). The panel should adopt dark colors cleanly — dark background, appropriate text colors, red/green badges still legible.

- [ ] **Step 9: Commit**

```bash
git add taft-dashboard/index.html
git commit -m "feat: add Due This Week panel with day tabs, week navigation, collapse, and inline checkboxes"
```
