(function() {
'use strict';
// ─────────────────────────────────────────────
//  SUPABASE
// ─────────────────────────────────────────────
const SUPABASE_URL = 'https://pupqkuunekeeyfnfjpde.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1cHFrdXVuZWtlZXlmbmZqcGRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMTM2NzEsImV4cCI6MjA4ODU4OTY3MX0.ktUUhaqi3BO5wAr8kWaTqvoQ1fxRlitvD9hpIUXOUdU';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ─────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────
let currentUser = null;
let COURSES = [];
let state = { done: {} };
let currentFilter = 'all';
let massSelectMode = false;
let massSelected = new Set();
let currentSort = 'default';
let wizardCourses = [];
let authMode = 'signin';
let userSettings = {};  // populated by loadUserSettings() in afterAuth()
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

let BLOCK_SCHEDULE = {};      // { A: course_id|null, … }
let SCHEDULE_OVERRIDES = {};  // { 'YYYY-MM-DD': { label, entries } }
let APP_SETTINGS = {};        // { key: value }
let schedViewDate = new Date();
if (schedViewDate.getDay() === 0) schedViewDate.setDate(schedViewDate.getDate() + 1);
let schedEditMode = false;

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
  const y  = date.getFullYear();
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

const PRESET_COLORS = [
  '#c0392b','#e74c3c','#e91e8c','#be185d',
  '#7c3aed','#8e44ad','#6d28d9','#4f46e5',
  '#1d4ed8','#0e7490','#0891b2','#065f46',
  '#16a34a','#b45309','#d97706','#374151',
];

// ─────────────────────────────────────────────
//  ADMIN + SCHEDULE CONSTANTS
// ─────────────────────────────────────────────
function isAdmin() {
  return currentUser?.app_metadata?.role === 'admin';
}

async function adminAction(payload) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('Not signed in');
  const res = await fetch('/api/admin-action', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'Admin action failed');
  return result;
}

const BLOCK_COLORS = {
  A: '#e6a817', B: '#e87c7c', C: '#7c9de8',
  D: '#9b5de5', E: '#4caf6a', F: '#4f9ca8', G: '#a8c84f',
};

const TAFT_SCHEDULE = {
  monday: [
    { type: 'block',   block: 'A', label: null,                start: '8:15 am',  end: '9:15 am'  },
    { type: 'block',   block: 'C', label: null,                start: '9:20 am',  end: '10:05 am' },
    { type: 'block',   block: 'B', label: null,                start: '10:10 am', end: '11:25 am' },
    { type: 'special', block: null, label: 'Community Lunch',  start: '11:30 am', end: '12:10 pm' },
    { type: 'block',   block: 'D', label: null,                start: '12:15 pm', end: '1:00 pm'  },
    { type: 'block',   block: 'E', label: null,                start: '1:05 pm',  end: '1:50 pm'  },
    { type: 'block',   block: 'F', label: null,                start: '1:55 pm',  end: '2:40 pm'  },
  ],
  tuesday: [
    { type: 'block',   block: 'G', label: null,                start: '8:15 am',  end: '9:15 am'  },
    { type: 'special', block: null, label: 'School Meeting',   start: '9:20 am',  end: '10:00 am' },
    { type: 'block',   block: 'F', label: null,                start: '10:05 am', end: '11:20 am' },
    { type: 'block',   block: 'D', label: null,                start: '11:30 am', end: '12:30 pm' },
    { type: 'block',   block: 'C', label: null,                start: '12:35 pm', end: '1:50 pm'  },
    { type: 'block',   block: 'A', label: null,                start: '1:55 pm',  end: '2:40 pm'  },
  ],
  wednesday: [
    { type: 'block',   block: 'B', label: null,                start: '8:15 am',  end: '9:15 am'  },
    { type: 'special', block: null, label: 'Assembly',         start: '9:20 am',  end: '9:50 am'  },
    { type: 'block',   block: 'G', label: null,                start: '9:55 am',  end: '10:40 am' },
    { type: 'block',   block: 'E', label: null,                start: '10:45 am', end: '12:00 pm' },
  ],
  thursday: [
    { type: 'block',   block: 'F', label: null,                start: '8:15 am',  end: '9:15 am'  },
    { type: 'special', block: null, label: 'I-Block',          start: '9:20 am',  end: '10:00 am' },
    { type: 'block',   block: 'A', label: null,                start: '10:05 am', end: '11:20 am' },
    { type: 'block',   block: 'C', label: null,                start: '11:30 am', end: '12:30 pm' },
    { type: 'block',   block: 'D', label: null,                start: '12:35 pm', end: '1:50 pm'  },
    { type: 'block',   block: 'E', label: null,                start: '1:55 pm',  end: '2:40 pm'  },
  ],
  friday: [
    { type: 'block',   block: 'E', label: null,                 start: '8:15 am',  end: '9:15 am'  },
    { type: 'special', block: null, label: 'Dept./Faculty Mtg', start: '9:20 am',  end: '10:00 am' },
    { type: 'block',   block: 'G', label: null,                 start: '10:05 am', end: '11:20 am' },
    { type: 'block',   block: 'D', label: null,                 start: '11:25 am', end: '12:10 pm' },
    { type: 'block',   block: 'C', label: null,                 start: '12:15 pm', end: '1:00 pm'  },
    { type: 'block',   block: 'F', label: null,                 start: '1:05 pm',  end: '1:50 pm'  },
    { type: 'block',   block: 'B', label: null,                 start: '1:55 pm',  end: '2:40 pm'  },
  ],
  saturday: [
    { type: 'block',   block: 'A', label: null,                start: '9:00 am',  end: '9:45 am'  },
    { type: 'special', block: null, label: 'Assembly',         start: '9:50 am',  end: '10:20 am' },
    { type: 'block',   block: 'B', label: null,                start: '10:25 am', end: '11:10 am' },
    { type: 'block',   block: 'G', label: null,                start: '11:15 am', end: '12:00 pm' },
  ],
  alt_saturday: [
    { type: 'block',   block: 'A', label: null,                start: '9:00 am',  end: '10:00 am' },
    { type: 'special', block: null, label: 'Assembly',         start: '10:05 am', end: '10:35 am' },
    { type: 'block',   block: 'B', label: null,                start: '10:40 am', end: '11:55 am' },
  ],
};

// ─────────────────────────────────────────────
//  DARK MODE
// ─────────────────────────────────────────────
function toggleScheduleDrawer() {
  const sidebar = document.getElementById('scheduleSidebar');
  const overlay = document.getElementById('schedDrawerOverlay');
  const isOpen = sidebar.classList.contains('drawer-open');
  sidebar.classList.toggle('drawer-open');
  overlay.classList.toggle('visible');
  if (!isOpen) document.getElementById('schedMobileToggle').style.display = 'none';
  else document.getElementById('schedMobileToggle').style.display = '';
}

function toggleDarkMode() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const next = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
  const btn = document.getElementById('darkModeBtn');
  if (btn) btn.textContent = next === 'dark' ? '☀️' : '🌙';
}
// Apply saved theme immediately
(function() {
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', saved);
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('darkModeBtn');
    if (btn) btn.textContent = saved === 'dark' ? '☀️' : '🌙';
  });
})();

// ─────────────────────────────────────────────
//  SCREEN MANAGEMENT
// ─────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ─────────────────────────────────────────────
//  AUTH
// ─────────────────────────────────────────────
function toggleAuthMode() {
  authMode = authMode === 'signin' ? 'signup' : 'signin';
  const isSignin = authMode === 'signin';
  document.getElementById('authSubmitBtn').textContent = isSignin ? 'Sign In' : 'Create Account';
  document.getElementById('authToggleText').textContent = isSignin ? "Don't have an account?" : 'Already have an account?';
  document.getElementById('authToggleLink').textContent = isSignin ? 'Sign up' : 'Sign in';
  document.getElementById('authError').classList.remove('show');
}

function showAuthError(msg) {
  const el = document.getElementById('authError');
  el.textContent = msg;
  el.classList.add('show');
}

let authFailCount = 0;
let authCooldownUntil = 0;
let authCooldownTimer = null;
const AUTH_MAX_FAILS = 5;
const AUTH_COOLDOWN_SECS = 30;

function startAuthCooldown() {
  authCooldownUntil = Date.now() + AUTH_COOLDOWN_SECS * 1000;
  const btn = document.getElementById('authSubmitBtn');
  btn.disabled = true;

  function tick() {
    const remaining = Math.ceil((authCooldownUntil - Date.now()) / 1000);
    if (remaining <= 0) {
      clearInterval(authCooldownTimer);
      authCooldownTimer = null;
      btn.disabled = false;
      btn.textContent = authMode === 'signin' ? 'Sign In' : 'Create Account';
      showAuthError('You can try again now.');
      return;
    }
    btn.textContent = `Wait ${remaining}s`;
  }

  tick();
  authCooldownTimer = setInterval(tick, 1000);
}

async function handleAuthSubmit() {
  if (Date.now() < authCooldownUntil) return;

  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  if (!email || !password) { showAuthError('Email and password are required.'); return; }

  const btn = document.getElementById('authSubmitBtn');
  btn.textContent = '…'; btn.disabled = true;
  document.getElementById('authError').classList.remove('show');

  let result;
  if (authMode === 'signin') {
    result = await sb.auth.signInWithPassword({ email, password });
  } else {
    result = await sb.auth.signUp({ email, password });
  }

  if (result.error) {
    authFailCount++;
    if (authFailCount >= AUTH_MAX_FAILS) {
      showAuthError(`Too many failed attempts. Please wait ${AUTH_COOLDOWN_SECS} seconds.`);
      startAuthCooldown();
      return;
    }
    showAuthError(result.error.message);
    btn.textContent = authMode === 'signin' ? 'Sign In' : 'Create Account';
    btn.disabled = false;
    return;
  }

  authFailCount = 0;
  currentUser = result.data.user;
  await afterAuth();
}

async function signOut() {
  await sb.auth.signOut();
  currentUser = null; COURSES = []; state = { done: {} };
  const adminBtn = document.getElementById('adminBtn');
  if (adminBtn) adminBtn.style.display = 'none';
  showScreen('authScreen');
}

// ─────────────────────────────────────────────
//  DATA LOADING
// ─────────────────────────────────────────────
async function loadUserData() {
  // Load global/schedule data unconditionally (works for all users, even new ones)
  await Promise.all([loadScheduleOverrides(), loadAppSettings(), loadBlockAssignments()]);

  const { data: coursesData, error } = await sb
    .from('courses')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('sort_order', { ascending: true });

  if (error || !coursesData || coursesData.length === 0) return false;

  const courseIds = coursesData.map(c => c.id);

  const { data: groupsData } = await sb
    .from('assignment_groups')
    .select('*')
    .in('course_id', courseIds)
    .order('sort_order', { ascending: true });

  const groupIds = (groupsData || []).map(g => g.id);

  const { data: assignmentsData } = groupIds.length > 0
    ? await sb.from('assignments').select('*').in('group_id', groupIds).order('sort_order', { ascending: true })
    : { data: [] };

  COURSES = coursesData.map(course => {
    const groups = (groupsData || [])
      .filter(g => g.course_id === course.id)
      .map(group => ({
        id: group.id,
        label: group.label,
        items: (assignmentsData || [])
          .filter(a => a.group_id === group.id)
          .map(a => ({ id: a.id, name: a.name, due: a.due, pts: a.pts, type: a.type, url: a.url, notes: a.notes || null }))
      }));

    const links = Array.isArray(course.links) ? course.links : [];
    if (links.length === 0 && course.canvas_url) {
      links.push({ label: 'Canvas', href: course.canvas_url, primary: true });
    }

    return {
      id: course.id,
      name: course.name,
      teacher: course.teacher || '',
      color: course.color || '#8B0000',
      url: course.canvas_url || '',
      note: course.note || null,
      links,
      canvas_course_id: course.canvas_course_id || null,
      groups: groups.length > 0 ? groups : [{ id: null, label: 'Upcoming', items: [] }],
    };
  });

  state.done = {};
  (assignmentsData || []).forEach(a => { if (a.done) state.done[a.id] = true; });

  return true;
}

async function loadUserSettings() {
  const { data, error } = await sb
    .from('user_settings')
    .select('trial_started_at, paid_until, stripe_customer_id')
    .eq('user_id', currentUser.id)
    .single();
  if (!error) {
    userSettings = data ?? {};
  } else if (error.code === 'PGRST116') {
    // No row yet — genuine new user, treat as no-trial
    userSettings = {};
  } else {
    // Network/auth error — don't clobber existing state, don't trigger no-trial
    console.warn('loadUserSettings error:', error.message);
    // Leave userSettings unchanged (keeps previous state if this is a reload)
  }
}

function getAccessState() {
  if (!userSettings.trial_started_at) return 'no-trial';
  if (userSettings.paid_until && new Date(userSettings.paid_until) > new Date()) return 'active';
  const trialEnd = new Date(
    new Date(userSettings.trial_started_at).getTime() + 14 * 24 * 60 * 60 * 1000
  );
  if (new Date() < trialEnd) return 'active';
  return 'read-only';
}

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

// ─────────────────────────────────────────────
//  SYNC STATUS
// ─────────────────────────────────────────────
function setSyncStatus(mode) {
  const dot = document.getElementById('syncDot');
  const text = document.getElementById('syncText');
  if (!dot) return;
  dot.className = 'sync-dot';
  const map = {
    syncing: ['syncing', 'Syncing…'],
    ok:      ['',        '☁️ Synced'],
    offline: ['error',   '⚠️ Save failed — check connection'],
    local:   ['local',   'Loading…'],
  };
  const [cls, label] = map[mode] || map.local;
  if (cls) dot.classList.add(cls);
  text.textContent = label;
}

// ── Toast Notification System ──
function showToast(msg, type = 'error', duration = 4500) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  el.style.animationDuration = '0.25s, 0.3s';
  el.style.animationDelay = `0s, ${duration}ms`;
  container.appendChild(el);
  setTimeout(() => el.remove(), duration + 350);
}

function showPaymentToast(msg) { showToast(msg, 'success', 4000); }

// ── Inline Form Error ──
function showFormError(errorElId, msg) {
  const el = document.getElementById(errorElId);
  if (!el) { showToast(msg); return; }
  el.textContent = msg;
  el.classList.add('show');
}

function clearFormError(errorElId) {
  const el = document.getElementById(errorElId);
  if (el) { el.textContent = ''; el.classList.remove('show'); }
}

// ── Offline Detection ──
let _isOffline = !navigator.onLine;

function updateOfflineBanner() {
  const banner = document.getElementById('offlineBanner');
  if (!banner) return;
  _isOffline = !navigator.onLine;
  banner.classList.toggle('show', _isOffline);
  if (_isOffline) setSyncStatus('offline');
}
window.addEventListener('online', () => { updateOfflineBanner(); showToast('Back online.', 'success', 3000); });
window.addEventListener('offline', updateOfflineBanner);

// ── Retry with Exponential Backoff ──
async function retryOp(fn, { maxRetries = 3, baseDelay = 500 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      // Supabase returns { data, error } — treat error as failure
      if (result && result.error) {
        const msg = result.error.message || String(result.error);
        // Don't retry validation/auth errors (4xx)
        if (/permission|denied|violates|constraint|unauthorized|forbidden/i.test(msg)) {
          return result;
        }
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt)));
          continue;
        }
        return result;
      }
      return result;
    } catch (err) {
      if (attempt >= maxRetries) throw err;
      await new Promise(r => setTimeout(r, baseDelay * Math.pow(2, attempt)));
    }
  }
}

// ─────────────────────────────────────────────
//  COLOR PICKER
// ─────────────────────────────────────────────
function initColorPicker(pickerId, hiddenId, selectedColor) {
  const container = document.getElementById(pickerId);
  if (!container) return;
  const active = selectedColor || PRESET_COLORS[0];
  container.innerHTML = PRESET_COLORS.map(c =>
    `<div class="color-opt${c === active ? ' selected' : ''}" style="background:${c}" data-color="${c}"
      onclick="selectColor('${pickerId}','${hiddenId}','${c}',this)"></div>`
  ).join('');
  document.getElementById(hiddenId).value = active;
}

function selectColor(pickerId, hiddenId, color, el) {
  document.querySelectorAll(`#${pickerId} .color-opt`).forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById(hiddenId).value = color;
}

// ─────────────────────────────────────────────
//  WIZARD
// ─────────────────────────────────────────────
async function wizardAddCourse() {
  const name = document.getElementById('wizardCourseName').value.trim();
  const teacher = document.getElementById('wizardTeacher').value.trim();
  const color = document.getElementById('wizardColor').value;
  const canvasUrl = document.getElementById('wizardCanvasUrl').value.trim();
  const note = document.getElementById('wizardNote').value.trim();

  if (!validateFields([
    { value: name, label: 'Course name', required: true, maxLen: 100 },
    { value: teacher, label: 'Teacher', maxLen: 100 },
    { value: canvasUrl, label: 'Canvas URL', maxLen: 500, urlCheck: true },
    { value: note, label: 'Note', maxLen: 500 },
  ], 'wizardFormError')) return;
  const links = canvasUrl ? [{ label: 'Canvas', href: canvasUrl, primary: true }] : [];

  const btn = document.getElementById('wizardAddBtn');
  btn.textContent = 'Adding…'; btn.disabled = true;

  const { data: course, error } = await retryOp(() => sb.from('courses').insert({
    user_id: currentUser.id,
    name, teacher, color,
    canvas_url: canvasUrl,
    note: note || null,
    links,
    sort_order: Date.now(),
  }).select().single());

  if (error) {
    showFormError('wizardFormError', 'Failed to add course: ' + error.message);
    btn.textContent = '+ Add Course'; btn.disabled = false;
    return;
  }

  await sb.from('assignment_groups').insert({
    course_id: course.id,
    user_id: currentUser.id,
    label: 'Upcoming',
    sort_order: 0,
  });

  wizardCourses.push({ name, color });

  const list = document.getElementById('wizardCourseList');
  list.innerHTML = wizardCourses.map(c =>
    `<div class="wizard-list-item">
      <div class="wizard-list-dot" style="background:${escapeHtml(c.color)}"></div>
      <span>${escapeHtml(c.name)}</span>
    </div>`
  ).join('');

  // Clear form
  document.getElementById('wizardCourseName').value = '';
  document.getElementById('wizardTeacher').value = '';
  document.getElementById('wizardCanvasUrl').value = '';
  document.getElementById('wizardNote').value = '';
  // Reset color picker to first color
  initColorPicker('wizardColorPicker', 'wizardColor');

  document.getElementById('wizardGoBtn').style.display = 'block';
  btn.textContent = '+ Add Course'; btn.disabled = false;
  document.getElementById('wizardCourseName').focus();
}

async function finishWizard() {
  showScreen('app');
  document.getElementById('mainContent').innerHTML =
    '<div style="text-align:center;padding:80px 20px;color:#6b7280">⏳ Loading your dashboard…</div>';
  setSyncStatus('syncing');
  const hasData = await loadUserData();
  if (hasData) { renderAll(); updateMissingCount(); }
  else { document.getElementById('mainContent').innerHTML = '<div class="add-course-card" onclick="openAddCourseModal()">+ Add a Course</div>'; }
  renderScheduleSidebar();
  setSyncStatus('ok');
}

// ─────────────────────────────────────────────
//  ADD COURSE FROM DASHBOARD
// ─────────────────────────────────────────────
function openAddCourseModal() {
  clearFormError('addCourseFormError');
  initColorPicker('addCourseColorPicker', 'addCourseColor');
  document.getElementById('addCourseModal').classList.add('open');
  setTimeout(() => document.getElementById('addCourseName').focus(), 50);
}

function closeAddCourseModal() {
  document.getElementById('addCourseModal').classList.remove('open');
}

// ─────────────────────────────────────────────
//  EDIT COURSE
// ─────────────────────────────────────────────
function openEditCourseModal(courseId) {
  clearFormError('editCourseFormError');
  const course = COURSES.find(c => c.id === courseId);
  if (!course) return;
  document.getElementById('editCourseId').value = courseId;
  document.getElementById('editCourseName').value = course.name;
  document.getElementById('editCourseTeacher').value = course.teacher || '';
  initColorPicker('editCourseColorPicker', 'editCourseColor', course.color);
  document.getElementById('editCourseModal').classList.add('open');
  setTimeout(() => document.getElementById('editCourseName').focus(), 50);
}

function closeEditCourseModal() {
  document.getElementById('editCourseModal').classList.remove('open');
}

async function saveEditCourse() {
  const courseId = document.getElementById('editCourseId').value;
  const name     = document.getElementById('editCourseName').value.trim();
  const teacher  = document.getElementById('editCourseTeacher').value.trim();

  if (!validateFields([
    { value: name, label: 'Course name', required: true, maxLen: 100 },
    { value: teacher, label: 'Teacher', maxLen: 100 },
  ], 'editCourseFormError')) return;
  const color    = document.getElementById('editCourseColor').value;

  const btn = document.querySelector('#editCourseModal .modal-submit-btn');
  btn.textContent = 'Saving…'; btn.disabled = true;

  const { error } = await retryOp(() => sb.from('courses').update({ name, teacher, color }).eq('id', courseId));

  btn.textContent = 'Save Changes'; btn.disabled = false;

  if (error) { showFormError('editCourseFormError', 'Failed to save: ' + error.message); return; }

  const course = COURSES.find(c => c.id === courseId);
  if (course) { course.name = name; course.teacher = teacher; course.color = color; }

  closeEditCourseModal();
  renderAll();
  setSyncStatus('ok');
}


// ─────────────────────────────────────────────
//  EDIT ASSIGNMENT
// ─────────────────────────────────────────────
function openEditAssignmentModal(id, courseId, groupIdx) {
  clearFormError('editAssignmentFormError');
  const course = COURSES.find(c => c.id === courseId);
  if (!course) return;
  const item = course.groups[groupIdx].items.find(i => i.id === id);
  if (!item) return;

  document.getElementById('editAssignmentId').value = id;
  document.getElementById('editAssignmentCourseId').value = courseId;
  document.getElementById('editAssignmentGroupIdx').value = groupIdx;
  document.getElementById('editAssignmentName').value = item.name;
  document.getElementById('editAssignmentDue').value = item.due ? item.due.slice(0, 10) : '';
  document.getElementById('editAssignmentType').value = item.type || 'homework';
  document.getElementById('editAssignmentUrl').value = item.url || '';
  document.getElementById('editAssignmentNotes').value = item.notes || '';

  document.getElementById('editAssignmentModal').classList.add('open');
  setTimeout(() => document.getElementById('editAssignmentName').focus(), 50);
}

function closeEditAssignmentModal() {
  document.getElementById('editAssignmentModal').classList.remove('open');
}

async function saveEditAssignment() {
  const id       = document.getElementById('editAssignmentId').value;
  const courseId = document.getElementById('editAssignmentCourseId').value;
  const groupIdx = parseInt(document.getElementById('editAssignmentGroupIdx').value);
  const name     = document.getElementById('editAssignmentName').value.trim();
  const dateVal  = document.getElementById('editAssignmentDue').value;
  const due      = dateVal ? dateVal + 'T04:59:00Z' : null;
  const type     = document.getElementById('editAssignmentType').value;
  const url      = document.getElementById('editAssignmentUrl').value.trim() || null;
  const notes    = document.getElementById('editAssignmentNotes').value.trim() || null;

  if (!validateFields([
    { value: name, label: 'Assignment name', required: true, maxLen: 200 },
    { value: url, label: 'URL', maxLen: 500, urlCheck: true },
    { value: notes, label: 'Notes', maxLen: 1000 },
  ], 'editAssignmentFormError')) return;
  if (type && !VALID_TYPES.includes(type)) { showFormError('editAssignmentFormError', 'Invalid assignment type.'); return; }

  const btn = document.querySelector('#editAssignmentModal .modal-submit-btn');
  btn.textContent = 'Saving…'; btn.disabled = true;

  const { error } = await retryOp(() => sb.from('assignments').update({ name, due, type, url, notes }).eq('id', id));

  btn.textContent = 'Save Changes'; btn.disabled = false;
  if (error) { showFormError('editAssignmentFormError', 'Failed to save: ' + error.message); return; }

  const course = COURSES.find(c => c.id === courseId);
  const item = course.groups[groupIdx].items.find(i => i.id === id);
  if (item) { item.name = name; item.due = due; item.type = type; item.url = url; item.notes = notes; }

  closeEditAssignmentModal();
  renderAll();
  setSyncStatus('ok');
}


async function addCourseFromDashboard() {
  const name = document.getElementById('addCourseName').value.trim();
  const teacher = document.getElementById('addCourseTeacher').value.trim();
  const color = document.getElementById('addCourseColor').value;
  const canvasUrl = document.getElementById('addCourseUrl').value.trim();
  const note = document.getElementById('addCourseNote').value.trim();

  if (!validateFields([
    { value: name, label: 'Course name', required: true, maxLen: 100 },
    { value: teacher, label: 'Teacher', maxLen: 100 },
    { value: canvasUrl, label: 'Canvas URL', maxLen: 500, urlCheck: true },
    { value: note, label: 'Note', maxLen: 500 },
  ], 'addCourseFormError')) return;
  const links = canvasUrl ? [{ label: 'Canvas', href: canvasUrl, primary: true }] : [];

  const btn = document.querySelector('#addCourseModal .modal-submit-btn');
  btn.textContent = 'Adding…'; btn.disabled = true;

  const { data: course, error } = await retryOp(() => sb.from('courses').insert({
    user_id: currentUser.id, name, teacher, color,
    canvas_url: canvasUrl, note: note || null, links,
    sort_order: Date.now(),
  }).select().single());

  if (error) {
    showFormError('addCourseFormError', 'Failed to add course: ' + error.message);
    btn.textContent = 'Add Course'; btn.disabled = false;
    return;
  }

  const { data: group } = await sb.from('assignment_groups').insert({
    course_id: course.id, user_id: currentUser.id, label: 'Upcoming', sort_order: 0,
  }).select().single();

  COURSES.push({
    id: course.id, name, teacher, color, url: canvasUrl, note: note || null, links,
    groups: [{ id: group.id, label: 'Upcoming', items: [] }],
  });

  closeAddCourseModal();
  renderAll();
  setSyncStatus('ok');

  // Clear fields
  ['addCourseName','addCourseTeacher','addCourseUrl','addCourseNote'].forEach(id => {
    document.getElementById(id).value = '';
  });
  btn.textContent = 'Add Course'; btn.disabled = false;

  setTimeout(() => {
    document.getElementById('card_' + course.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

// ─────────────────────────────────────────────
//  DELETE COURSE
// ─────────────────────────────────────────────
async function deleteCourse(courseId) {
  const course = COURSES.find(c => c.id === courseId);
  if (!course) return;
  if (!confirm(`Delete "${course.name}" and all its assignments?\n\nThis cannot be undone.`)) return;

  setSyncStatus('syncing');
  const groupIds = course.groups.map(g => g.id).filter(Boolean);
  if (groupIds.length > 0) {
    await retryOp(() => sb.from('assignments').delete().in('group_id', groupIds));
  }
  await retryOp(() => sb.from('assignment_groups').delete().eq('course_id', courseId));
  const { error } = await retryOp(() => sb.from('courses').delete().eq('id', courseId));
  if (error) { setSyncStatus('offline'); showToast('Failed to delete course. Check your connection.'); return; }

  // Clean up local state
  course.groups.forEach(g => g.items.forEach(item => delete state.done[item.id]));
  COURSES = COURSES.filter(c => c.id !== courseId);
  renderAll();
  updateOverall();
}

// ─────────────────────────────────────────────
//  RENDER
// ─────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

const VALID_TYPES = ['reading','homework','project','quiz','classwork'];

function isValidUrl(str) {
  if (!str) return true; // optional
  try { const u = new URL(str); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}

function validateFields(fields, errorElId) {
  clearFormError(errorElId);
  for (const { value, label, required, maxLen, urlCheck } of fields) {
    if (required && !value) { showFormError(errorElId, `${label} is required.`); return false; }
    if (maxLen && value && value.length > maxLen) { showFormError(errorElId, `${label} is too long (max ${maxLen} characters).`); return false; }
    if (urlCheck && value && !isValidUrl(value)) { showFormError(errorElId, `${label} must be a valid URL (https://…).`); return false; }
  }
  return true;
}

function typeTag(type) {
  const label = { reading:'Reading', homework:'Homework', project:'Project', quiz:'Quiz/Test', classwork:'Classwork' };
  const cls = ['reading','homework','project','quiz','classwork'].includes(type) ? type : 'homework';
  return `<span class="tag tag-${cls}">${label[type] || type}</span>`;
}

function dueLabel(due, itemId) {
  if (!due) {
    if (!itemId) return '';
    return `<span class="due-add" onclick="event.stopPropagation();openInlineDatePicker(this,'${itemId}','')">+ date</span>`;
  }
  const d = new Date(due), now = new Date();
  const diff = (d - now) / 86400000;
  const fmt = d.toLocaleDateString('en-US', { month:'short', day:'numeric', timeZone:'UTC' });
  const dateStr = due.slice(0, 10);
  const clickHandler = `onclick="event.stopPropagation();openInlineDatePicker(this,'${itemId}','${dateStr}')"`;
  if (diff < 0) return `<span class="overdue-tag"><span class="tag tag-overdue">Overdue</span> <span class="due-label overdue" ${clickHandler}>${fmt}</span></span>`;
  if (diff < 3) return `<span class="due-label soon" ${clickHandler}>Due ${fmt}</span>`;
  return `<span class="due-label" ${clickHandler}>Due ${fmt}</span>`;
}

function openInlineDatePicker(el, itemId, currentDate) {
  // Remove any existing picker
  document.querySelectorAll('.due-picker').forEach(p => p.remove());

  const input = document.createElement('input');
  input.type = 'date';
  input.className = 'due-picker';
  input.value = currentDate;
  el.style.position = 'relative';
  el.appendChild(input);

  input.addEventListener('change', async () => {
    const newDate = input.value ? input.value + 'T04:59:00Z' : null;
    input.remove();

    // Update Supabase
    const { error } = await retryOp(() => sb.from('assignments').update({ due: newDate }).eq('id', itemId));
    if (error) { showToast('Failed to update date.'); console.error('Date update failed:', error); return; }

    // Update local state
    for (const course of COURSES) {
      for (const group of course.groups) {
        const item = group.items.find(i => i.id === itemId);
        if (item) { item.due = newDate; break; }
      }
    }

    renderAll();
    updateMissingCount();
    setSyncStatus('ok');
  });

  // Show native picker immediately
  input.showPicker?.();
  input.focus();

  // Close if clicked away
  input.addEventListener('blur', () => setTimeout(() => input.remove(), 200));
}

function renderItem(item, courseId, groupIdx, isReadOnly = false) {
  const isDone = !!state.done[item.id];
  const pts = item.pts != null && item.pts > 0 ? `<span class="points-label">${item.pts} pts</span>` : '';
  let urgencyClass = '';
  if (!isDone && item.due) {
    const diff = (new Date(item.due) - new Date()) / 86400000;
    if (diff < 1) urgencyClass = ' urgent-red';
    else if (diff < 2) urgencyClass = ' urgent-yellow';
  }
  const massCheckbox = massSelectMode
    ? `<div class="mass-select-checkbox${massSelected.has(item.id) ? ' checked' : ''}" onclick="event.stopPropagation();toggleMassItem('${item.id}')"></div>`
    : '';
  return `
    <div class="assignment-row${isDone ? ' completed' : ''}${urgencyClass}" id="row_${item.id}"${massSelectMode ? ` onclick="toggleMassItem('${item.id}')"` : ''}>
      ${massCheckbox}
      <div class="checkbox-wrap"${massSelectMode ? ' style="display:none"' : ''}>
        <div class="custom-checkbox${isDone ? ' checked' : ''}" onclick="toggleDone('${item.id}','${courseId}')"></div>
      </div>
      <div class="assignment-info">
        <div class="assignment-name">${escapeHtml(item.name)}</div>
        <div class="assignment-meta">
          ${typeTag(item.type)}
          ${dueLabel(item.due, isReadOnly ? null : item.id)}
          ${pts}
        </div>
        ${item.notes ? `<div class="assignment-note">${escapeHtml(item.notes)}</div>` : ''}
      </div>
      ${item.url ? `<a class="assignment-link" href="${escapeHtml(item.url)}" target="_blank" title="Open in Canvas">↗</a>` : ''}
      ${isReadOnly || massSelectMode
        ? (isReadOnly ? `<span style="font-size:0.8rem;color:var(--muted);padding:0 6px" title="Unlock to edit">🔒</span>` : '')
        : `<button class="edit-btn" onclick="openEditAssignmentModal('${item.id}','${courseId}',${groupIdx})" title="Edit">✎</button>
           <button class="delete-btn" onclick="deleteItem('${item.id}','${courseId}',${groupIdx})" title="Delete">✕</button>`
      }
    </div>`;
}

function getCourseProgress(course) {
  let total = 0, done = 0;
  course.groups.forEach(g => g.items.forEach(item => { total++; if (state.done[item.id]) done++; }));
  return { total, done };
}

function renderCourse(course, isReadOnly = false) {
  const { total, done } = getCourseProgress(course);
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const noteHtml = course.note ? `<div class="course-note">ℹ️ ${escapeHtml(course.note)}</div>` : '';
  const linksHtml = course.links.map(l =>
    `<a class="course-link${l.primary ? ' primary' : ''}" href="${escapeHtml(l.href)}" target="_blank">${escapeHtml(l.label)}</a>`
  ).join('');

  let groupsHtml = '';
  course.groups.forEach((group, gi) => {
    const itemsHtml = group.items.map(item => renderItem(item, course.id, gi, isReadOnly)).join('');
    groupsHtml += `
      <div class="group-label">${escapeHtml(group.label)}</div>
      <div id="group_${course.id}_${gi}">${itemsHtml}</div>
      ${isReadOnly ? '' : `<div class="add-row">
        <button class="add-btn" data-course="${course.id}" data-group="${gi}"
          onclick="openAddForm('${course.id}', ${gi})">+ Add assignment</button>
        <div class="add-form" id="addForm_${course.id}_${gi}">
          <input class="add-name" id="addName_${course.id}_${gi}" placeholder="Assignment name…" type="text" maxlength="200"
            onkeydown="if(event.key==='Enter')saveCustom('${course.id}',${gi})">
          <input class="add-due" id="addDue_${course.id}_${gi}" type="date">
          <select id="addType_${course.id}_${gi}">
            <option value="homework">Homework</option>
            <option value="reading">Reading</option>
            <option value="project">Project</option>
            <option value="quiz">Quiz/Test</option>
            <option value="classwork">Classwork</option>
          </select>
          <button class="btn-save" onclick="saveCustom('${course.id}', ${gi})">Add</button>
          <button class="btn-cancel" onclick="closeAddForm('${course.id}', ${gi})">Cancel</button>
        </div>
      </div>`}`;
  });

  return `
    <div class="course-card" id="card_${course.id}">
      <div class="course-header" onclick="toggleCollapse('${course.id}')">
        <div class="course-dot" style="background:${escapeHtml(course.color)}"></div>
        <div class="course-title">${escapeHtml(course.name)} <span class="course-subtitle">${escapeHtml(course.teacher)}</span></div>
        <div class="course-links" onclick="event.stopPropagation()">${linksHtml}</div>
        <div class="course-progress-mini">
          <div class="mini-bar-wrap"><div class="mini-bar" style="width:${pct}%;background:${escapeHtml(course.color)}"></div></div>
          <span class="mini-count">${done}/${total}</span>
        </div>
        ${isReadOnly ? '' : `<button class="course-edit-btn" title="Edit course"
          onclick="event.stopPropagation();openEditCourseModal('${course.id}')">✎</button>
        <button class="course-delete-btn" title="Delete course"
          onclick="event.stopPropagation();deleteCourse('${course.id}')">✕</button>`}
        <span class="collapse-icon">▼</span>
      </div>
      <div class="assignment-body">
        ${noteHtml}
        ${groupsHtml}
      </div>
    </div>`;
}

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
      <div class="week-item-name${isDone ? ' done' : ''}">${escapeHtml(item.name)}</div>
      <div class="week-item-course">
        <div class="week-item-course-dot" style="background:${escapeHtml(course.color)}"></div>
        ${escapeHtml(course.name)}
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

function renderAll() {
  const main = document.getElementById('mainContent');
  if (!main) return;
  const isReadOnly = getAccessState() === 'read-only';
  const bannerHtml = isReadOnly
    ? `<div class="paywall-banner">
         <span class="paywall-banner-text">Your 14-day trial has ended. Unlock full access for $0.99/month.</span>
         <button class="paywall-btn" onclick="startCheckout()">Unlock →</button>
       </div>`
    : '';
  const manageHtml = userSettings.stripe_customer_id
    ? `<div class="manage-sub-link"><a onclick="openCustomerPortal(); return false;">Manage subscription</a></div>`
    : '';
  main.innerHTML = bannerHtml +
    renderWeekPanel() +
    COURSES.map(c => renderCourse(c, isReadOnly)).join('') +
    (isReadOnly ? '' : `<div class="add-course-card" onclick="openAddCourseModal()">+ Add a Course</div>`) +
    manageHtml;
  renderJumps();
  updateOverall();
  applyFilter();
  renderScheduleSidebar();
  const sortEl = document.getElementById('sortSelect');
  if (sortEl) sortEl.value = currentSort;
}

// ─────────────────────────────────────────────
//  SCHEDULE SIDEBAR
// ─────────────────────────────────────────────
function renderScheduleSidebar() {
  const el = document.getElementById('scheduleSidebar');
  if (!el) return;

  const today    = new Date();
  const todayIso = localDateStr(today);
  const viewIso  = localDateStr(schedViewDate);
  const isToday  = viewIso === todayIso;
  const dow      = schedViewDate.getDay();

  const { entries, label } = getScheduleForDate(schedViewDate);

  const dayNames   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dayLabel   = dayNames[dow];
  const dateLabel  = `${monthNames[schedViewDate.getMonth()]} ${schedViewDate.getDate()}`;

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
        const current  = isToday && isCurrentBlock(entry);
        const color    = BLOCK_COLORS[entry.block] || '#6b7280';
        const courseId = BLOCK_SCHEDULE[entry.block];
        const course   = courseId ? COURSES.find(c => c.id === courseId) : null;
        const courseName = course?.name || null;

        let courseCell;
        if (schedEditMode) {
          const options = [
            `<option value="" ${!courseId ? 'selected' : ''}>Free block</option>`,
            ...COURSES.map(c =>
              `<option value="${c.id}" ${c.id === courseId ? 'selected' : ''}>${escapeHtml(c.name)}</option>`
            ),
          ].join('');
          courseCell = `<select class="sched-select" onchange="saveBlockAssignment('${escapeHtml(entry.block)}', this.value)">${options}</select>`;
        } else {
          courseCell = courseName
            ? `<div class="sched-block-course">${escapeHtml(courseName)}</div>`
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
    <div class="sched-drawer-handle"></div>
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
  const currentDow = schedViewDate.getDay();
  const targetDow  = advanceDay(currentDow, delta);
  const diff       = targetDow - currentDow;
  const daysDiff   = delta > 0
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

// ─────────────────────────────────────────────
//  ADMIN PANEL
// ─────────────────────────────────────────────
function openAdminModal() {
  const existing = APP_SETTINGS['alt_saturday_date'] || '';
  document.getElementById('adminAltSatDate').value = existing;
  document.getElementById('adminAltSatStatus').textContent =
    existing ? `Currently set to ${existing}` : 'Not set';
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
  if (!val) { showToast('Pick a date first.', 'warn'); return; }
  try {
    await adminAction({ action: 'upsert_setting', key: 'alt_saturday_date', value: val });
  } catch (e) { document.getElementById('adminAltSatStatus').textContent = '✗ ' + e.message; return; }
  APP_SETTINGS['alt_saturday_date'] = val;
  document.getElementById('adminAltSatStatus').textContent = `✓ Saved — ${val}`;
  renderScheduleSidebar();
}

async function clearAltSaturday() {
  try {
    await adminAction({ action: 'upsert_setting', key: 'alt_saturday_date', value: '' });
  } catch (e) { document.getElementById('adminAltSatStatus').textContent = '✗ ' + e.message; return; }
  APP_SETTINGS['alt_saturday_date'] = '';
  document.getElementById('adminAltSatDate').value = '';
  document.getElementById('adminAltSatStatus').textContent = 'Cleared.';
  renderScheduleSidebar();
}

let adminEntries = [];

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
    const moveUp   = i > 0
      ? `<button class="modal-secondary-btn" onclick="adminMoveEntry(${i},-1)" style="padding:2px 6px;font-size:0.7rem;">↑</button>`
      : '<span style="width:26px;display:inline-block;"></span>';
    const moveDown = i < adminEntries.length - 1
      ? `<button class="modal-secondary-btn" onclick="adminMoveEntry(${i},1)" style="padding:2px 6px;font-size:0.7rem;">↓</button>`
      : '<span style="width:26px;display:inline-block;"></span>';
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
      <button class="modal-secondary-btn" onclick="adminRemoveEntry(${i})" style="padding:2px 6px;font-size:0.7rem;color:#dc2626;">×</button>
    </div>`;
  }).join('');
}

async function saveOverride() {
  const date  = document.getElementById('adminOverrideDate').value;
  const label = document.getElementById('adminOverrideLabel').value.trim();
  if (!date)  { document.getElementById('adminOverrideStatus').textContent = '✗ Pick a date.'; return; }
  if (!label) { document.getElementById('adminOverrideStatus').textContent = '✗ Add a label.'; return; }
  if (!adminEntries.length) { document.getElementById('adminOverrideStatus').textContent = '✗ Add at least one entry.'; return; }
  try {
    await adminAction({ action: 'upsert_override', date, label, entries: adminEntries });
  } catch (e) { document.getElementById('adminOverrideStatus').textContent = '✗ ' + e.message; return; }
  SCHEDULE_OVERRIDES[date] = { label, entries: JSON.parse(JSON.stringify(adminEntries)) };
  document.getElementById('adminOverrideStatus').textContent = `✓ Saved override for ${date}`;
  renderScheduleSidebar();
}

async function deleteOverride() {
  const date = document.getElementById('adminOverrideDate').value;
  if (!date) { document.getElementById('adminOverrideStatus').textContent = '✗ Pick a date first.'; return; }
  if (!SCHEDULE_OVERRIDES[date]) { document.getElementById('adminOverrideStatus').textContent = 'No override exists for this date.'; return; }
  if (!confirm(`Delete the custom schedule for ${date}?`)) return;
  try {
    await adminAction({ action: 'delete_override', date });
  } catch (e) { document.getElementById('adminOverrideStatus').textContent = '✗ ' + e.message; return; }
  delete SCHEDULE_OVERRIDES[date];
  adminEntries = [];
  document.getElementById('adminOverrideLabel').value = '';
  renderAdminEntries();
  document.getElementById('adminOverrideStatus').textContent = `✓ Deleted override for ${date}`;
  renderScheduleSidebar();
}

function renderJumps() {
  const container = document.getElementById('courseJumps');
  if (!container) return;
  container.innerHTML = COURSES.map(c =>
    `<div class="jump-dot" style="background:${escapeHtml(c.color)};border-color:${escapeHtml(c.color)}" title="${escapeHtml(c.name)}"
      onclick="document.getElementById('card_${c.id}').scrollIntoView({behavior:'smooth',block:'start'})"></div>`
  ).join('');
}

// ─────────────────────────────────────────────
//  ACTIONS
// ─────────────────────────────────────────────
async function toggleDone(id, courseId) {
  state.done[id] = !state.done[id];
  const row = document.getElementById('row_' + id);
  const box = row?.querySelector('.custom-checkbox');
  if (state.done[id]) { row?.classList.add('completed'); box?.classList.add('checked'); }
  else { row?.classList.remove('completed'); box?.classList.remove('checked'); }
  updateCourseProgress(courseId);
  updateOverall();
  updateMissingCount();
  applyFilter();
  setSyncStatus('syncing');
  const { error } = await retryOp(() => sb.from('assignments').update({ done: state.done[id] }).eq('id', id));
  if (error) showToast('Failed to save — check your connection.');
  setSyncStatus(error ? 'offline' : 'ok');
}

async function deleteItem(id, courseId, groupIdx) {
  if (!confirm('Remove this assignment?')) return;
  await retryOp(() => sb.from('assignments').delete().eq('id', id));
  const course = COURSES.find(c => c.id === courseId);
  if (course) course.groups.forEach(g => { g.items = g.items.filter(i => i.id !== id); });
  delete state.done[id];
  document.getElementById('row_' + id)?.remove();
  updateCourseProgress(courseId);
  updateOverall();
}

function openAddForm(courseId, groupIdx) {
  document.querySelector(`.add-btn[data-course="${courseId}"][data-group="${groupIdx}"]`).style.display = 'none';
  document.getElementById(`addForm_${courseId}_${groupIdx}`).classList.add('open');
  document.getElementById(`addName_${courseId}_${groupIdx}`).focus();
}

function closeAddForm(courseId, groupIdx) {
  const btn = document.querySelector(`.add-btn[data-course="${courseId}"][data-group="${groupIdx}"]`);
  if (btn) btn.style.display = '';
  document.getElementById(`addForm_${courseId}_${groupIdx}`)?.classList.remove('open');
  document.getElementById(`addName_${courseId}_${groupIdx}`).value = '';
  document.getElementById(`addDue_${courseId}_${groupIdx}`).value = '';
}

async function saveCustom(courseId, groupIdx) {
  const name = document.getElementById(`addName_${courseId}_${groupIdx}`).value.trim();
  const due = document.getElementById(`addDue_${courseId}_${groupIdx}`).value || null;
  const type = document.getElementById(`addType_${courseId}_${groupIdx}`).value;

  if (!name) { showToast('Assignment name is required.'); return; }
  if (name.length > 200) { showToast('Assignment name is too long (max 200 characters).'); return; }

  const course = COURSES.find(c => c.id === courseId);
  const group = course?.groups[groupIdx];
  if (!group?.id) { showToast('Could not find group. Please refresh.'); return; }

  setSyncStatus('syncing');
  const { data: newAssignment, error } = await retryOp(() => sb.from('assignments').insert({
    group_id: group.id,
    user_id: currentUser.id,
    name,
    due: due ? due + 'T04:59:00Z' : null,
    type,
    is_custom: true,
    sort_order: Date.now(),
  }).select().single());

  if (error) { setSyncStatus('offline'); showToast('Failed to save. Check your connection.'); return; }

  const item = { id: newAssignment.id, name, due: newAssignment.due, pts: null, type, url: null };
  group.items.push(item);

  document.getElementById(`group_${courseId}_${groupIdx}`)
    ?.insertAdjacentHTML('beforeend', renderItem(item, courseId, groupIdx));
  closeAddForm(courseId, groupIdx);
  updateCourseProgress(courseId);
  updateOverall();
  setSyncStatus('ok');
}

function toggleCollapse(courseId) {
  document.getElementById('card_' + courseId)?.classList.toggle('collapsed');
}

// ─────────────────────────────────────────────
//  FILTER & SEARCH
// ─────────────────────────────────────────────
function setFilter(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  applyFilter();
}

function applyFilter(searchTerm) {
  const term = (searchTerm !== undefined ? searchTerm : document.getElementById('searchInput')?.value || '').toLowerCase();
  document.querySelectorAll('.assignment-row').forEach(row => {
    const isDone = row.classList.contains('completed');
    const name = row.querySelector('.assignment-name')?.textContent.toLowerCase() || '';
    let show = !term || name.includes(term);
    if (currentFilter === 'incomplete' && isDone) show = false;
    if (currentFilter === 'complete' && !isDone) show = false;
    row.classList.toggle('hidden', !show);
  });
}

function applySearch(val) { applyFilter(val); }

// ─────────────────────────────────────────────
//  SORT
// ─────────────────────────────────────────────
function applySort(sortKey) {
  currentSort = sortKey;
  if (sortKey === 'default') { renderAll(); return; }
  COURSES.forEach(course => {
    course.groups.forEach(g => {
      g.items.sort((a, b) => {
        if (sortKey === 'due-asc') {
          if (!a.due && !b.due) return 0;
          if (!a.due) return 1;
          if (!b.due) return -1;
          return a.due.localeCompare(b.due);
        }
        if (sortKey === 'due-desc') {
          if (!a.due && !b.due) return 0;
          if (!a.due) return 1;
          if (!b.due) return -1;
          return b.due.localeCompare(a.due);
        }
        if (sortKey === 'name-asc') return (a.name || '').localeCompare(b.name || '');
        if (sortKey === 'name-desc') return (b.name || '').localeCompare(a.name || '');
        if (sortKey === 'type') return (a.type || '').localeCompare(b.type || '');
        return 0;
      });
    });
  });
  renderAll();
}

// ─────────────────────────────────────────────
//  MASS SELECT
// ─────────────────────────────────────────────
function enterMassSelect() {
  massSelectMode = true;
  massSelected.clear();
  document.getElementById('massBar').classList.add('active');
  document.getElementById('controlsBar').style.display = 'none';
  renderAll();
}

function exitMassSelect() {
  massSelectMode = false;
  massSelected.clear();
  document.getElementById('massBar').classList.remove('active');
  document.getElementById('controlsBar').style.display = '';
  renderAll();
}

function toggleMassItem(id) {
  if (massSelected.has(id)) massSelected.delete(id);
  else massSelected.add(id);
  const row = document.getElementById('row_' + id);
  const cb = row?.querySelector('.mass-select-checkbox');
  if (cb) cb.classList.toggle('checked', massSelected.has(id));
  updateMassCount();
}

function updateMassCount() {
  const el = document.getElementById('massCount');
  if (el) el.textContent = `${massSelected.size} selected`;
}

function massSelectAll() {
  const visible = document.querySelectorAll('.assignment-row:not(.hidden)');
  if (massSelected.size === visible.length) {
    massSelected.clear();
  } else {
    visible.forEach(row => {
      const id = row.id.replace('row_', '');
      if (id) massSelected.add(id);
    });
  }
  document.querySelectorAll('.mass-select-checkbox').forEach(cb => {
    const row = cb.closest('.assignment-row');
    const id = row?.id.replace('row_', '');
    cb.classList.toggle('checked', massSelected.has(id));
  });
  updateMassCount();
}

async function massDelete() {
  if (massSelected.size === 0) return;
  if (!confirm(`Delete ${massSelected.size} assignment${massSelected.size > 1 ? 's' : ''}? This cannot be undone.`)) return;
  setSyncStatus('syncing');
  const ids = [...massSelected];
  const { error } = await retryOp(() => sb.from('assignments').delete().in('id', ids));
  if (error) { setSyncStatus('offline'); showToast('Failed to delete. Check your connection.'); return; }
  COURSES.forEach(c => c.groups.forEach(g => {
    g.items = g.items.filter(i => !massSelected.has(i.id));
  }));
  ids.forEach(id => delete state.done[id]);
  setSyncStatus('ok');
  exitMassSelect();
}

async function massMarkDone() {
  if (massSelected.size === 0) return;
  setSyncStatus('syncing');
  const ids = [...massSelected];
  const { error } = await retryOp(() => sb.from('assignments').update({ done: true }).in('id', ids));
  if (error) { setSyncStatus('offline'); showToast('Failed to update. Check your connection.'); return; }
  ids.forEach(id => { state.done[id] = true; });
  setSyncStatus('ok');
  exitMassSelect();
}

// ─────────────────────────────────────────────
//  PROGRESS
// ─────────────────────────────────────────────
function countAll() {
  let total = 0, done = 0;
  COURSES.forEach(c => c.groups.forEach(g => g.items.forEach(item => {
    total++; if (state.done[item.id]) done++;
  })));
  return { total, done };
}

function updateOverall() {
  const { total, done } = countAll();
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const bar = document.getElementById('overallBar');
  const count = document.getElementById('overallCount');
  if (bar) bar.style.width = pct + '%';
  if (count) count.textContent = `${done} / ${total} done`;
}

function updateCourseProgress(courseId) {
  const course = COURSES.find(c => c.id === courseId);
  if (!course) return;
  let total = 0, done = 0;
  course.groups.forEach(g => g.items.forEach(item => { total++; if (state.done[item.id]) done++; }));
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const card = document.getElementById('card_' + courseId);
  if (!card) return;
  card.querySelector('.mini-bar').style.width = pct + '%';
  card.querySelector('.mini-count').textContent = `${done}/${total}`;
}

// ─────────────────────────────────────────────
//  MISSING MODAL
// ─────────────────────────────────────────────
function getMissingItems() {
  const now = new Date();
  return COURSES.reduce((result, course) => {
    const items = [];
    course.groups.forEach(g => g.items.forEach(item => {
      if (!item.due || state.done[item.id]) return;
      if (new Date(item.due) < now) items.push(item);
    }));
    if (items.length) result.push({ course, items });
    return result;
  }, []);
}

function updateMissingCount() {
  const missing = getMissingItems();
  const total = missing.reduce((a, b) => a + b.items.length, 0);
  const count = document.getElementById('missingCount');
  const btn = document.getElementById('missingBtn');
  if (count) count.textContent = total;
  if (btn) btn.style.opacity = total > 0 ? '1' : '0.65';
}

function openMissingModal() {
  const missing = getMissingItems();
  const total = missing.reduce((a, b) => a + b.items.length, 0);
  const subtitle = document.getElementById('modalSubtitle');
  const body = document.getElementById('modalBody');
  if (subtitle) subtitle.textContent = total === 0
    ? "You're all caught up — nothing overdue!"
    : `${total} assignment${total !== 1 ? 's' : ''} past due and not yet submitted`;
  if (body) {
    body.innerHTML = total === 0
      ? `<div class="modal-empty"><span class="big-icon">✅</span>No missing assignments — great work!</div>`
      : missing.map(({ course, items }) => `
          <div class="modal-course-section">
            <div class="modal-course-label">
              <span class="modal-dot" style="background:${escapeHtml(course.color)}"></span>${escapeHtml(course.name)}
            </div>
            ${items.map(item => {
              const fmt = new Date(item.due).toLocaleDateString('en-US', { month:'short', day:'numeric', timeZone:'UTC' });
              return `<div class="modal-item">
                <div class="modal-item-checkbox" onclick="toggleMissingDone('${item.id}','${course.id}')"></div>
                <div style="flex:1">
                  <div class="modal-item-name">${escapeHtml(item.name)}</div>
                  <div class="modal-item-due">Was due ${fmt}</div>
                </div>
              </div>`;
            }).join('')}
          </div>`).join('');
  }
  document.getElementById('missingModal')?.classList.add('open');
}

function closeMissingModal() {
  document.getElementById('missingModal')?.classList.remove('open');
}

async function toggleMissingDone(id, courseId) {
  await toggleDone(id, courseId);
  openMissingModal();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeMissingModal(); closeAddCourseModal(); closeEditCourseModal(); closeAdminModal(); }
});

// ─────────────────────────────────────────────
//  AFTER AUTH
// ─────────────────────────────────────────────
async function afterAuth() {
  showScreen('app');
  document.getElementById('mainContent').innerHTML =
    '<div style="text-align:center;padding:80px 20px;color:#6b7280">⏳ Loading your dashboard…</div>';
  setSyncStatus('syncing');

  document.getElementById('userEmailDisplay').textContent = currentUser.email;

  const adminBtn = document.getElementById('adminBtn');
  if (adminBtn) adminBtn.style.display = isAdmin() ? 'inline-block' : 'none';

  // Load subscription state BEFORE rendering
  await loadUserSettings();

  // First-time user: set trial_started_at
  if (getAccessState() === 'no-trial') {
    const now = new Date().toISOString();
    await sb.from('user_settings').upsert(
      { user_id: currentUser.id, trial_started_at: now },
      { onConflict: 'user_id' }
    );
    userSettings.trial_started_at = now;
  }

  // Handle Stripe redirect query params
  const params = new URLSearchParams(window.location.search);
  if (params.has('payment')) {
    const result = params.get('payment');
    history.replaceState(null, '', window.location.pathname);
    if (result === 'success') {
      // Reload user_settings to pick up paid_until set by webhook.
      // Note: if the webhook hasn't fired yet, paid_until may still be null and the
      // paywall banner will briefly appear. This resolves on the next reload.
      // The checkout.session.completed handler writes paid_until optimistically,
      // so in practice this race is rare but not impossible.
      await loadUserSettings();
      showPaymentToast('Payment successful! Full access unlocked.');
    } else if (result === 'canceled') {
      showPaymentToast('Payment canceled.');
    }
  }

  const hasData = await loadUserData();

  if (!hasData) {
    wizardCourses = [];
    document.getElementById('wizardCourseList').innerHTML = '';
    document.getElementById('wizardGoBtn').style.display = 'none';
    initColorPicker('wizardColorPicker', 'wizardColor');
    showScreen('wizardScreen');
  } else {
    renderAll();
    updateMissingCount();
    setSyncStatus('ok');
  }
}

async function startCheckout() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { showToast('Please log in first.', 'warn'); return; }
  try {
    const res = await fetch('/api/create-checkout', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    const { url, error } = await res.json();
    if (error) { showToast('Could not start checkout: ' + error); return; }
    window.location.href = url;
  } catch (err) {
    showToast('Checkout failed. Please try again.');
    console.error('startCheckout error:', err);
  }
}

async function openCustomerPortal() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { showToast('Please log in first.', 'warn'); return; }
  try {
    const res = await fetch('/api/customer-portal', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    const { url, error } = await res.json();
    if (error) { showToast('Could not open portal: ' + error); return; }
    window.location.href = url;
  } catch (err) {
    showToast('Could not open subscription portal. Please try again.');
    console.error('openCustomerPortal error:', err);
  }
}

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────
async function init() {
  updateOfflineBanner();
  // Enter key handlers for auth
  document.getElementById('authEmail').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('authPassword').focus();
  });
  document.getElementById('authPassword').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleAuthSubmit();
  });
  document.getElementById('wizardCourseName').addEventListener('keydown', e => {
    if (e.key === 'Enter') wizardAddCourse();
  });

  // Check for existing session
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) {
    currentUser = session.user;
    await afterAuth();
  } else {
    showScreen('landingScreen');
  }

  // Listen for auth changes (e.g. token refresh, sign out from another tab)
  // Also handles mobile Safari where getSession() returns null on first load
  // and the session arrives asynchronously via SIGNED_IN / TOKEN_REFRESHED
  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_OUT' && !session) {
      showScreen('authScreen');
    } else if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session?.user) {
      currentUser = session.user;
      // Only run afterAuth if the main app screen isn't already visible
      if (!document.getElementById('app').classList.contains('active')) {
        await afterAuth();
      }
    }
  });
}

init();

// ─────────────────────────────────────────────
//  TAFT TEMPLATES
// ─────────────────────────────────────────────
const TAFT_TEMPLATES = {
  stats: {
    courseName: 'Honors Statistics',
    teacher: 'Statistics Teacher',
    color: '#1d4ed8',
    groups: [
      {
        name: 'Chapter 6',
        assignments: [
          { name: 'Assignment 32 – 6.1: Read pp. 360–370 · HW: 1,2,3,5,7,9,11,13,15,17', type: 'homework' },
          { name: 'Assignment 33 – 6.1: Read pp. 371–374 · HW: 25,26,27,29,31–34', type: 'homework' },
          { name: 'Assignment 34 – 6.2: Read pp. 381–387 · HW: 38,41,44,45,46,47', type: 'homework' },
          { name: 'Assignment 35 – 6.2: Read pp. 387–397 · HW: 50,51,54,55,59,60,65', type: 'homework' },
          { name: 'Assignment 36 – 6.3: Read pp. 402–417 · HW: 77,79,80,81,85,97,101,83,87', type: 'homework' },
          { name: 'Assignment 37 – 6.3: Read pp. 418–426 · HW: 91,94,95,97a,101–105', type: 'homework' },
          { name: 'TEST – Chapter 6', type: 'quiz' },
        ],
      },
      {
        name: 'Chapter 7',
        assignments: [
          { name: 'Assignment 38 – 7.1: Read pp. 440–454 · HW: 3,5,9,13,14,25,29,30', type: 'homework' },
          { name: 'Assignment 39 – 7.2: Read pp. 458–465 · HW: 33,35ab,37,41,43,45,47,49', type: 'homework' },
          { name: 'Assignment 40 – 7.3: Read pp. 468–479 · HW: 57,59,61,63,67,69,73', type: 'homework' },
        ],
      },
      {
        name: 'Chapter 8',
        assignments: [
          { name: 'Assignment 41 – 8.1: Read pp. 494–506 · HW: 1,5,7,9,11,15,17,19,23,25', type: 'homework' },
          { name: 'Assignment 42 – 8.2: Read pp. 510–519 · HW: 29–32,39,40,43a', type: 'homework' },
          { name: 'Assignment 43 – 8.2: Read pp. 519–521 · HW: 45,46,47,49,50,55,56,57', type: 'homework' },
          { name: 'Assignment 44 – 8.3: Read pp. 525–538 · HW: 61,63,64,65,70,71,72', type: 'homework' },
          { name: 'Assignment 45 – 8.3: Read pp. 538–541 · HW: 73,77,78,81–84', type: 'homework' },
          { name: 'Assignment 46 – Comp. Ex.: pp. 543,548,550 · HW: 73,74,R8.5,T8.13', type: 'homework' },
          { name: 'Assignment 47 – Project', type: 'project' },
          { name: 'TEST – Chapter 8', type: 'quiz' },
        ],
      },
      {
        name: 'Chapter 9',
        assignments: [
          { name: 'Assignment 48 – 9.1: Read pp. 552–560 · HW: 1,3,5,7,9,11,13,15,17,19', type: 'homework' },
          { name: 'Assignment 49 – 9.1: Read pp. 560–563 · HW: 21–25,29–32', type: 'homework' },
          { name: 'Assignment 50 – 9.2: Read pp. 568–577 · HW: 35,39,41ab,43,45', type: 'homework' },
          { name: 'Assignment 51 – 9.2: Read pp. 577–581 · HW: 49,51,53,55,59,60,61', type: 'homework' },
          { name: 'Assignment 52 – 9.3: Read pp. 585–594 · HW: 65,67,70,71,75', type: 'homework' },
          { name: 'Assignment 53 – 9.3: Read pp. 594–597 · HW: 69,72,73,81', type: 'homework' },
          { name: 'Assignment 54 – 9.3: Read pp. 597–604 · HW: 82,83,87,89,98,102–106', type: 'homework' },
          { name: 'Assignment 55 – Comp. Ex.: HW: 73a,74a,77,78,80', type: 'homework' },
          { name: 'Assignment 56 – Project', type: 'project' },
          { name: 'TEST – Chapter 9', type: 'quiz' },
        ],
      },
      {
        name: 'Chapter 10',
        assignments: [
          { name: 'Assignment 57 – 10.1: Read pp. 619–630 · HW: 5,7,9,11,13', type: 'homework' },
          { name: 'Assignment 58 – 10.1: Read pp. 630–639 · HW: 15,19,21,23,25', type: 'homework' },
          { name: 'Assignment 59 – 10.1 Review · HW: 29–34', type: 'homework' },
          { name: 'Assignment 60 – 10.2: Read pp. 645–655 · HW: 45–49', type: 'homework' },
          { name: 'Assignment 61 – 10.2: Read pp. 655–665 · HW: 37,53,55,59', type: 'homework' },
          { name: 'Assignment 62 – Comp. Ex.: HW: 41,42,46,57,58', type: 'homework' },
          { name: 'Assignment 63 – 10.2 Review · HW: 63,64,66,69–72', type: 'homework' },
          { name: 'Assignment 64 – 10.3: Read pp. 673–685 · HW: 81,82,87,89,95–98', type: 'homework' },
          { name: 'Assignment 65 – Project', type: 'project' },
          { name: 'TEST – Chapter 10', type: 'quiz' },
        ],
      },
      {
        name: 'Chapter 11',
        assignments: [
          { name: 'Assignment 66 – 11.1: Read pp. 708–722 · HW: 1,3,5,7,9,15a,19–22', type: 'homework' },
          { name: 'Assignment 67 – 11.2: Read pp. 726–740 · HW: 29,31,33,34,35', type: 'homework' },
          { name: 'Assignment 68 – 11.2: Read pp. 740–752 · HW: 41,42,43,46,47', type: 'homework' },
          { name: 'Assignment 69 – Project', type: 'project' },
        ],
      },
      {
        name: 'Chapter 12',
        assignments: [
          { name: 'Assignment 70 – 12.1: Read pp. 768–787 · HW: 11,13,15,19,21a', type: 'homework' },
          { name: 'Assignment 71 – 12.2: Read pp. 795–811 · HW: 33,35,37bc,43bc', type: 'homework' },
        ],
      },
    ],
  },
};

async function importTemplate(templateId) {
  const btn = document.getElementById(templateId === 'stats' ? 'templateBtnStats' : 'templateBtnSpanish');
  const statusEl = document.getElementById('templateStatus');
  btn.disabled = true;
  statusEl.textContent = 'Importing…';

  try {
    if (templateId === 'stats') {
      await importStatsTemplate();
    } else if (templateId === 'spanish') {
      await fetchAndImportSpanishDoc();
    }
    statusEl.textContent = '✓ Imported successfully!';
    document.getElementById('wizardGoBtn').style.display = 'block';
    await loadUserData();
    renderAll();
  } catch (err) {
    statusEl.textContent = '✗ Error: ' + err.message;
    btn.disabled = false;
  }
}

async function importStatsTemplate() {
  const tmpl = TAFT_TEMPLATES.stats;
  const statusEl = document.getElementById('templateStatus');

  // Create course
  statusEl.textContent = 'Creating Honors Statistics course…';
  const { data: course, error: ce } = await sb.from('courses').insert({
    user_id: currentUser.id,
    name: tmpl.courseName,
    teacher: tmpl.teacher,
    color: tmpl.color,
  }).select().single();
  if (ce) throw new Error('Course insert failed: ' + ce.message);

  // Create groups and assignments
  for (let gi = 0; gi < tmpl.groups.length; gi++) {
    const g = tmpl.groups[gi];
    statusEl.textContent = `Importing ${g.name}…`;
    const { data: group, error: ge } = await sb.from('assignment_groups').insert({
      course_id: course.id,
      user_id: currentUser.id,
      label: g.name,
      sort_order: gi,
    }).select().single();
    if (ge) throw new Error('Group insert failed: ' + ge.message);

    const rows = g.assignments.map((a, idx) => ({
      group_id: group.id,
      user_id: currentUser.id,
      name: a.name,
      type: a.type,
      done: false,
      sort_order: idx,
    }));
    const { error: ae } = await sb.from('assignments').insert(rows);
    if (ae) throw new Error('Assignment insert failed: ' + ae.message);
  }
}

async function fetchAndImportSpanishDoc() {
  const statusEl = document.getElementById('templateStatus');
  const docId = '1Pm852EkT3V5Sk2rmloqnHuU0lcqFTHNIHYvaRPz2Kpg';
  statusEl.textContent = 'Fetching Spanish IV assignment sheet…';

  const res = await fetch(`/api/doc-proxy?docId=${docId}`);
  if (!res.ok) throw new Error(`doc-proxy returned ${res.status}`);
  const text = await res.text();

  const groups = parseSpanishDoc(text);
  if (!groups.length) throw new Error('No assignments found in Spanish doc');

  // Create course
  statusEl.textContent = 'Creating Spanish IV course…';
  const { data: course, error: ce } = await sb.from('courses').insert({
    user_id: currentUser.id,
    name: 'Spanish IV — Historia de Arte',
    teacher: 'Spanish Teacher',
    color: '#b45309',
  }).select().single();
  if (ce) throw new Error('Course insert failed: ' + ce.message);

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    statusEl.textContent = `Importing ${g.name}…`;
    const { data: group, error: ge } = await sb.from('assignment_groups').insert({
      course_id: course.id,
      user_id: currentUser.id,
      label: g.name,
      sort_order: gi,
    }).select().single();
    if (ge) throw new Error('Group insert failed: ' + ge.message);

    const rows = g.assignments.map((a, idx) => ({
      group_id: group.id,
      user_id: currentUser.id,
      name: a,
      type: 'homework',
      done: false,
      sort_order: idx,
    }));
    if (rows.length) {
      const { error: ae } = await sb.from('assignments').insert(rows);
      if (ae) throw new Error('Assignment insert failed: ' + ae.message);
    }
  }
}

// Parse plain-text export of the Spanish IV Google Doc.
// Groups by "Bloque A - Day M/D" headers; collects "* text" bullets.
function parseSpanishDoc(text) {
  const lines = text.split('\n');
  const groups = [];
  let current = null;

  for (const raw of lines) {
    const line = raw.trim();

    // Match "Bloque A - Lunes 1/12" style headers
    const headerMatch = line.match(/Bloque\s+[AB]\s*[-–]\s*(.+)/i);
    if (headerMatch) {
      current = { name: headerMatch[1].trim(), assignments: [] };
      groups.push(current);
      continue;
    }

    // Bullet assignments: lines starting with "* " (not blank)
    if (current && /^\*\s+.+/.test(line)) {
      const text = line.replace(/^\*\s+/, '').trim();
      if (text.length > 3) current.assignments.push(text);
    }
  }

  // Drop empty groups
  return groups.filter(g => g.assignments.length > 0);
}

// ─────────────────────────────────────────────
//  EXPOSE FUNCTIONS REQUIRED BY HTML HANDLERS
// ─────────────────────────────────────────────
Object.assign(window, {
  showScreen,
  handleAuthSubmit,
  toggleAuthMode,
  signOut,
  wizardAddCourse,
  finishWizard,
  importTemplate,
  openAddCourseModal,
  closeAddCourseModal,
  addCourseFromDashboard,
  openEditCourseModal,
  closeEditCourseModal,
  saveEditCourse,
  openEditAssignmentModal,
  closeEditAssignmentModal,
  saveEditAssignment,
  deleteCourse,
  deleteItem,
  toggleDone,
  toggleMissingDone,
  openInlineDatePicker,
  openAddForm,
  closeAddForm,
  saveCustom,
  toggleCollapse,
  setFilter,
  applySearch,
  applySort,
  enterMassSelect,
  exitMassSelect,
  massSelectAll,
  massDelete,
  massMarkDone,
  toggleMassItem,
  openMissingModal,
  closeMissingModal,
  openAdminModal,
  closeAdminModal,
  saveAltSaturday,
  clearAltSaturday,
  loadOverrideForDate,
  adminAddEntry,
  adminRemoveEntry,
  adminMoveEntry,
  adminUpdateEntry,
  saveOverride,
  deleteOverride,
  selectColor,
  toggleDarkMode,
  schedNav,
  saveBlockAssignment,
  toggleSchedEditMode,
  toggleScheduleDrawer,
  weekPanelNavigate,
  weekPanelSelectDay,
  weekPanelToggleCollapse,
  weekPanelToggleDone,
  startCheckout,
  openCustomerPortal,
});

})();
