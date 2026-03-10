// Supabase loaded from CDN inline — inject it dynamically
const SUPABASE_URL = 'https://pupqkuunekeeyfnfjpde.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1cHFrdXVuZWtlZXlmbmZqcGRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMTM2NzEsImV4cCI6MjA4ODU4OTY3MX0.ktUUhaqi3BO5wAr8kWaTqvoQ1fxRlitvD9hpIUXOUdU';
const NETLIFY_BASE = 'https://graceful-cupcake-2e9b61.netlify.app';

let sb = null;
let currentUser = null;
let pageData = null; // { assignments, googleDocIds } from content script

// ── Init ──
window.addEventListener('DOMContentLoaded', async () => {
  // Load Supabase SDK
  await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // Restore session from chrome.storage
  const { session } = await chrome.storage.local.get('session');
  if (session) {
    const { data } = await sb.auth.setSession(session);
    if (data.user) {
      currentUser = data.user;
    }
  }

  // Ask content script for page data
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    pageData = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_DATA' });
  } catch {
    pageData = null;
  }

  render();
});

function loadScript(src) {
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve;
    document.head.appendChild(s);
  });
}

function render() {
  const loggedIn = !!currentUser;
  const onCanvas = pageData && (pageData.assignments.length > 0 || pageData.googleDocIds.length > 0);

  document.getElementById('loginSection').style.display = loggedIn ? 'none' : 'block';
  document.getElementById('importSection').style.display = (loggedIn && onCanvas) ? 'block' : 'none';
  document.getElementById('notCanvasSection').style.display = (loggedIn && !onCanvas) ? 'block' : 'none';

  if (loggedIn && onCanvas) {
    const a = pageData.assignments.length;
    const g = pageData.googleDocIds.length;
    const parts = [];
    if (a > 0) parts.push(`<strong>${a}</strong> Canvas assignment${a !== 1 ? 's' : ''}`);
    if (g > 0) parts.push(`<strong>${g}</strong> Google Doc${g !== 1 ? 's' : ''} detected`);
    document.getElementById('foundSummary').innerHTML = 'Found on this page:<br>' + parts.join('<br>');
    document.getElementById('userLine').textContent = `✓ Signed in as ${currentUser.email}`;
  }
  if (loggedIn && !onCanvas) {
    document.getElementById('userLine2').textContent = `✓ Signed in as ${currentUser.email}`;
  }
}

// ── Auth ──
async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPassword').value;
  const statusEl = document.getElementById('loginStatus');
  const btn = document.getElementById('loginBtn');

  btn.disabled = true;
  statusEl.textContent = 'Signing in…';
  statusEl.className = 'status';

  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) {
    statusEl.textContent = error.message;
    statusEl.className = 'status error';
    btn.disabled = false;
    return;
  }

  await chrome.storage.local.set({ session: data.session });
  currentUser = data.user;
  render();
}

// ── Import ──
async function doImport() {
  const btn = document.getElementById('importBtn');
  const statusEl = document.getElementById('importStatus');
  btn.disabled = true;

  try {
    let allAssignments = [...pageData.assignments];

    // Fetch + AI-parse any Google Docs
    for (const docId of pageData.googleDocIds) {
      statusEl.textContent = `Parsing Google Doc…`;
      const docText = await fetchDocText(docId);
      const aiAssignments = await aiParseDoc(docText);
      allAssignments = allAssignments.concat(
        aiAssignments.map(a => ({ ...a, canvasCourseId: null, canvasAssignmentId: null, googleDocId: docId }))
      );
    }

    if (!allAssignments.length) {
      statusEl.textContent = 'No assignments found to import.';
      btn.disabled = false;
      return;
    }

    statusEl.textContent = `Saving ${allAssignments.length} assignments…`;

    // Group by canvasCourseId (null = from Google Doc)
    const courseGroups = groupByCourse(allAssignments);
    let saved = 0;

    for (const [courseId, items] of Object.entries(courseGroups)) {
      const course = await getOrCreateCourse(courseId, items[0]);
      const group = await getOrCreateGroup(course.id, 'Imported');
      const rows = items.map((a, i) => ({
        group_id: group.id,
        user_id: currentUser.id,
        name: a.name,
        type: a.type,
        due: a.due || null,
        url: a.url || null,
        canvas_assignment_id: a.canvasAssignmentId || null,
        done: false,
        sort_order: i,
      }));
      await sb.from('assignments').insert(rows);
      saved += rows.length;
    }

    statusEl.textContent = `✓ Imported ${saved} assignment${saved !== 1 ? 's' : ''}!`;
  } catch (err) {
    statusEl.textContent = '✗ ' + err.message;
    statusEl.className = 'status error';
  }

  btn.disabled = false;
}

function groupByCourse(assignments) {
  const map = {};
  for (const a of assignments) {
    const key = a.canvasCourseId ?? 'google-doc';
    if (!map[key]) map[key] = [];
    map[key].push(a);
  }
  return map;
}

async function getOrCreateCourse(canvasCourseId, sampleAssignment) {
  if (canvasCourseId !== 'google-doc') {
    const { data } = await sb.from('courses')
      .select('*').eq('user_id', currentUser.id).eq('canvas_course_id', parseInt(canvasCourseId)).single();
    if (data) return data;
  }

  // Use page title as course name
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const courseName = canvasCourseId === 'google-doc'
    ? 'Imported Course'
    : (tab.title?.replace(/\s*[-|].*$/, '').trim() || `Course ${canvasCourseId}`);

  const colors = ['#1d4ed8', '#065f46', '#7c3aed', '#b45309', '#0e7490', '#be123c'];
  const color = colors[Math.floor(Math.random() * colors.length)];

  const { data, error } = await sb.from('courses').insert({
    user_id: currentUser.id,
    name: courseName,
    color,
    canvas_course_id: canvasCourseId === 'google-doc' ? null : parseInt(canvasCourseId),
  }).select().single();

  if (error) throw new Error('Course create failed: ' + error.message);
  return data;
}

async function getOrCreateGroup(courseId, groupName) {
  const { data } = await sb.from('assignment_groups')
    .select('*').eq('course_id', courseId).eq('user_id', currentUser.id).limit(1).single();
  if (data) return data;

  const { data: group, error } = await sb.from('assignment_groups').insert({
    course_id: courseId,
    user_id: currentUser.id,
    name: groupName,
    sort_order: 0,
  }).select().single();

  if (error) throw new Error('Group create failed: ' + error.message);
  return group;
}

async function fetchDocText(docId) {
  const res = await fetch(`${NETLIFY_BASE}/.netlify/functions/doc-proxy?docId=${docId}`);
  if (!res.ok) throw new Error(`doc-proxy failed: ${res.status}`);
  return res.text();
}

async function aiParseDoc(docText) {
  const res = await fetch(`${NETLIFY_BASE}/.netlify/functions/ai-parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ docText }),
  });
  if (!res.ok) throw new Error(`ai-parse failed: ${res.status}`);
  const { assignments } = await res.json();
  return assignments;
}
