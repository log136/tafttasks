/**
 * TaftTasks background service worker
 * Syncs Canvas assignments via iCal every 6 hours using chrome.alarms.
 * Also updates the extension badge with overdue assignment count.
 */

const SUPABASE_URL = 'https://pupqkuunekeeyfnfjpde.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1cHFrdXVuZWtlZXlmbmZqcGRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMTM2NzEsImV4cCI6MjA4ODU4OTY3MX0.ktUUhaqi3BO5wAr8kWaTqvoQ1fxRlitvD9hpIUXOUdU';
const BASE_URL = 'https://tafttasks.pages.dev';
const ALARM_NAME = 'ical-sync';
const SYNC_PERIOD_MINUTES = 360; // 6 hours

// ── Lifecycle ──

chrome.runtime.onInstalled.addListener(() => {
  setupAlarm();
  console.log('[TaftTasks] Background worker installed');
});

chrome.runtime.onStartup.addListener(() => {
  setupAlarm();
});

function setupAlarm() {
  chrome.alarms.get(ALARM_NAME, existing => {
    if (!existing) {
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: SYNC_PERIOD_MINUTES });
      console.log('[TaftTasks] Alarm created — syncing every', SYNC_PERIOD_MINUTES, 'minutes');
    }
  });
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) {
    console.log('[TaftTasks] Alarm fired — starting background sync');
    syncFromICal();
  }
});

// Allow the popup to trigger an immediate sync
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'SYNC_NOW') {
    syncFromICal()
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // keep message channel open for async response
  }
});

// ── Main sync ──

async function syncFromICal() {
  const { session, icalUrl } = await chrome.storage.local.get(['session', 'icalUrl']);

  if (!session?.access_token || !icalUrl) {
    console.log('[TaftTasks] No session or iCal URL — skipping sync');
    return;
  }

  const token = session.access_token;
  const userId = session.user?.id;
  if (!userId) return;

  try {
    // 1. Fetch iCal feed
    const icalRes = await fetch(`${BASE_URL}/api/ical-proxy?url=${encodeURIComponent(icalUrl)}`);
    if (!icalRes.ok) throw new Error(`iCal fetch failed: ${icalRes.status}`);
    const icalText = await icalRes.text();

    // 2. Parse and group by course
    const events = parseICal(icalText);
    const freshCourses = groupICalByCourse(events);
    if (!freshCourses.length) return;

    // 3. Get user's courses from Supabase
    const coursesRes = await sbFetch(token, `/rest/v1/courses?user_id=eq.${userId}&select=id,canvas_course_id`);
    const localCourses = await coursesRes.json();
    if (!Array.isArray(localCourses)) return;

    // 4. Get assignment groups for existing courses
    let localGroups = [];
    if (localCourses.length) {
      const courseIds = localCourses.map(c => c.id).join(',');
      const groupsRes = await sbFetch(token, `/rest/v1/assignment_groups?course_id=in.(${courseIds})&select=id,course_id`);
      localGroups = await groupsRes.json();
    }

    // 5. Upsert assignments course by course, creating missing courses on the fly
    const colors = ['#1d4ed8', '#065f46', '#7c3aed', '#b45309', '#0e7490', '#be123c'];
    let totalUpserted = 0;
    for (const fc of freshCourses) {
      if (!fc.canvas_course_id) continue;

      let localCourse = localCourses.find(c => c.canvas_course_id === fc.canvas_course_id);

      // Create course if it doesn't exist yet
      if (!localCourse) {
        const color = colors[Math.floor(Math.random() * colors.length)];
        const createRes = await fetch(`${SUPABASE_URL}/rest/v1/courses`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'apikey': SUPABASE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({
            user_id: userId,
            name: fc.name,
            color,
            canvas_course_id: fc.canvas_course_id,
          }),
        });
        const created = await createRes.json();
        if (!createRes.ok || !Array.isArray(created) || !created.length) {
          console.error('[TaftTasks] Failed to create course:', fc.name, created);
          continue;
        }
        localCourse = created[0];
        localCourses.push(localCourse);
        console.log(`[TaftTasks] Created course: ${fc.name}`);
      }

      let group = localGroups.find(g => g.course_id === localCourse.id);

      // Create default assignment group if missing
      if (!group) {
        const grpRes = await fetch(`${SUPABASE_URL}/rest/v1/assignment_groups`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'apikey': SUPABASE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation',
          },
          body: JSON.stringify({
            course_id: localCourse.id,
            user_id: userId,
            label: 'Assignments',
            sort_order: 0,
          }),
        });
        const grpCreated = await grpRes.json();
        if (!grpRes.ok || !Array.isArray(grpCreated) || !grpCreated.length) {
          console.error('[TaftTasks] Failed to create group for:', fc.name, grpCreated);
          continue;
        }
        group = grpCreated[0];
        localGroups.push(group);
      }

      const rows = fc.assignments
        .filter(a => a.canvasAssignmentId)
        .map((a, idx) => ({
          group_id: group.id,
          user_id: userId,
          canvas_assignment_id: a.canvasAssignmentId,
          name: a.name,
          due: a.due,
          type: a.type,
          url: a.url || '',
          done: false,
          sort_order: idx,
        }));

      if (!rows.length) continue;

      await fetch(`${SUPABASE_URL}/rest/v1/assignments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'apikey': SUPABASE_KEY,
          'Content-Type': 'application/json',
          // merge-duplicates upserts on canvas_assignment_id conflict
          'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(rows),
      });
      totalUpserted += rows.length;
    }

    console.log(`[TaftTasks] Background sync complete — ${totalUpserted} assignments upserted`);

    // 6. Update badge with overdue count
    await updateBadge(token, userId);

  } catch (err) {
    console.error('[TaftTasks] Background sync error:', err);
  }
}

// ── Badge ──

async function updateBadge(token, userId) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const res = await sbFetch(token,
      `/rest/v1/assignments?user_id=eq.${userId}&done=eq.false&due=lt.${today}&select=id`
    );
    const overdue = await res.json();
    const count = Array.isArray(overdue) ? overdue.length : 0;
    chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
  } catch {
    // badge update is best-effort
  }
}

// ── Supabase REST helper ──

function sbFetch(token, path) {
  return fetch(`${SUPABASE_URL}${path}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': SUPABASE_KEY,
    },
  });
}

// ── iCal parser (mirrors index.html) ──

function parseICal(text) {
  const unfolded = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const lines = unfolded.split('\n');
  const events = [];
  let current = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { current = {}; }
    else if (line === 'END:VEVENT') { if (current) events.push(current); current = null; }
    else if (current) {
      const colon = line.indexOf(':');
      if (colon === -1) continue;
      const key = line.substring(0, colon).split(';')[0];
      const val = line.substring(colon + 1)
        .replace(/\\n/g, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
      current[key] = val;
    }
  }
  return events;
}

function parseICalDate(s) {
  if (!s) return null;
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
  const d = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (d) return `${d[1]}-${d[2]}-${d[3]}T23:59:00Z`;
  return null;
}

function guessType(name) {
  const l = name.toLowerCase();
  if (/\b(quiz|test|exam|midterm|final)\b/.test(l)) return 'quiz';
  if (/\b(read|reading)\b/.test(l)) return 'reading';
  if (/\b(project|presentation|essay|paper|report)\b/.test(l)) return 'project';
  return 'homework';
}

function groupICalByCourse(events) {
  const map = {};
  for (const ev of events) {
    const uid = ev['UID'] || '';
    if (!uid.includes('assignment')) continue;

    const url = ev['URL'] || '';
    const summary = ev['SUMMARY'] || '';
    const location = ev['LOCATION'] || '';
    const dtstart = ev['DTSTART'] || '';

    const urlMatch = url.match(/\/courses\/(\d+)\/assignments\/(\d+)/);
    const canvasCourseId = urlMatch ? parseInt(urlMatch[1]) : null;
    const canvasAssignmentId = urlMatch ? parseInt(urlMatch[2]) : null;

    let courseName = location;
    if (!courseName) {
      const bm = summary.match(/\[([^\]]+)\]\s*$/);
      courseName = bm ? bm[1] : 'Unknown Course';
    }

    const name = summary.replace(/\s*\[[^\]]+\]\s*$/, '').trim() || summary;
    const due = parseICalDate(dtstart);
    const key = canvasCourseId || courseName;

    if (!map[key]) {
      map[key] = { name: courseName, canvas_course_id: canvasCourseId, assignments: [] };
    }
    map[key].assignments.push({ name, due, url, canvasAssignmentId, type: guessType(name) });
  }
  return Object.values(map);
}
