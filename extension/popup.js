// Supabase loaded from CDN inline — inject it dynamically
const SUPABASE_URL = 'https://pupqkuunekeeyfnfjpde.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1cHFrdXVuZWtlZXlmbmZqcGRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMTM2NzEsImV4cCI6MjA4ODU4OTY3MX0.ktUUhaqi3BO5wAr8kWaTqvoQ1fxRlitvD9hpIUXOUdU';
const CF_BASE = 'https://tafttasks.pages.dev';

let sb = null;
let currentUser = null;
let pageData = null; // { assignments, googleDocIds } from content script

// ── Init ──
window.addEventListener('DOMContentLoaded', async () => {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  // Restore session from chrome.storage
  const { session } = await chrome.storage.local.get('session');
  if (session) {
    const { data } = await sb.auth.setSession(session);
    if (data.user) {
      currentUser = data.user;
    }
  }

  // Scan the live page DOM directly
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // Extract Canvas module items (supports both selector variants)
        const assignments = [];
        const itemAnchors = [
          ...document.querySelectorAll('.ig-row[data-module-type] .ig-title a'),
          ...document.querySelectorAll('li.context_module_item a.ig-title'),
        ];
        for (const anchor of itemAnchors) {
          const href = anchor.getAttribute('href') || '';
          const fullUrl = href.startsWith('http') ? href : location.origin + href;
          const gdoc = fullUrl.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
          if (gdoc) continue; // handled below
          const li = anchor.closest('li.context_module_item');
          const typeClass = li?.classList;
          let type = 'homework';
          if (typeClass?.contains('quiz')) type = 'quiz';
          else if (typeClass?.contains('discussion_topic')) type = 'classwork';
          else if (typeClass?.contains('wiki_page') || typeClass?.contains('attachment')) type = 'reading';
          const dueEl = li?.querySelector('.due_date_display');
          let due = null;
          if (dueEl) {
            const cleaned = dueEl.textContent.trim().replace(/\s+at\s+\d+:\d+\s*[ap]m/i, '');
            const d = new Date(cleaned);
            if (!isNaN(d)) due = d.toISOString().slice(0, 10);
          }
          const idMatch = href.match(/\/courses\/(\d+)\/(?:assignments|quizzes)\/(\d+)/);
          assignments.push({
            name: anchor.textContent.trim(),
            url: fullUrl,
            type,
            due,
            canvasCourseId: idMatch ? parseInt(idMatch[1]) : null,
            canvasAssignmentId: idMatch ? parseInt(idMatch[2]) : null,
          });
        }
        // Extract Google Doc and Drive file IDs from links and iframes
        const googleDocIds = [];   // { id, driveFile }
        const seen = new Set();
        const addDoc = (src, driveFile = false) => {
          const m = driveFile
            ? (src || '').match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/)
            : (src || '').match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
          if (m && !seen.has(m[1])) { seen.add(m[1]); googleDocIds.push({ id: m[1], driveFile }); }
        };
        document.querySelectorAll('a[href*="docs.google.com/document"]').forEach(a => addDoc(a.href, false));
        document.querySelectorAll('iframe').forEach(f => {
          const src = f.src || f.getAttribute('src') || '';
          addDoc(src, false);
          addDoc(src, true);
        });
        return { assignments, googleDocIds };
      },
    });
    pageData = result.result;
  } catch {
    pageData = null;
  }

  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('importBtn').addEventListener('click', doImport);

  render();
});


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
    if (g > 0) parts.push(`<strong>${g}</strong> document${g !== 1 ? 's' : ''} detected`);
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

    // Fetch + AI-parse any Google Docs / Drive files
    for (const doc of pageData.googleDocIds) {
      statusEl.textContent = `Parsing document…`;
      const docText = await fetchDocText(doc.id, doc.driveFile);
      const aiAssignments = await aiParseDoc(docText);
      allAssignments = allAssignments.concat(
        aiAssignments.map(a => ({ ...a, canvasCourseId: null, canvasAssignmentId: null }))
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
      const { data: existing } = await sb.from('assignments')
        .select('name').eq('group_id', group.id).eq('user_id', currentUser.id);
      const existingNames = new Set((existing || []).map(a => a.name));

      const rows = items
        .filter(a => !existingNames.has(a.name))
        .map((a, i) => ({
          group_id: group.id,
          user_id: currentUser.id,
          name: a.name,
          type: a.type,
          due: a.due || null,
          url: a.url || null,
          canvas_assignment_id: a.canvasAssignmentId || null,
          done: false,
          sort_order: existingNames.size + i,
        }));

      if (rows.length > 0) {
        const { error: insertError } = await sb.from('assignments').insert(rows);
        if (insertError) throw new Error('Assignment insert failed: ' + insertError.message);
      }
      saved += rows.length;
    }

    const total = allAssignments.length;
    const skipped = total - saved;
    statusEl.textContent = skipped > 0
      ? `✓ Imported ${saved} new, ${skipped} already existed.`
      : `✓ Imported ${saved} assignment${saved !== 1 ? 's' : ''}!`;
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
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const courseName = canvasCourseId === 'google-doc'
    ? (tab.title?.replace(/\s*[-|].*$/, '').trim() || 'Imported Course')
    : (tab.title?.replace(/\s*[-|].*$/, '').trim() || `Course ${canvasCourseId}`);

  if (canvasCourseId !== 'google-doc') {
    const { data } = await sb.from('courses')
      .select('*').eq('user_id', currentUser.id).eq('canvas_course_id', parseInt(canvasCourseId)).single();
    if (data) return data;
  } else {
    // Match Google Doc courses by name to prevent duplicates
    const { data } = await sb.from('courses')
      .select('*').eq('user_id', currentUser.id).eq('name', courseName).is('canvas_course_id', null).maybeSingle();
    if (data) return data;
  }

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
    label: groupName,
    sort_order: 0,
  }).select().single();

  if (error) throw new Error('Group create failed: ' + error.message);
  return group;
}

async function fetchDocText(docId, driveFile = false) {
  if (driveFile) {
    // Fetch directly from browser — user is already authenticated with Google
    const res = await fetch(`https://docs.google.com/document/d/${docId}/export?format=txt`);
    if (!res.ok) throw new Error(`Drive export failed: ${res.status}`);
    return res.text();
  }
  const res = await fetch(`${CF_BASE}/doc-proxy?docId=${docId}`);
  if (!res.ok) throw new Error(`doc-proxy failed: ${res.status}`);
  return res.text();
}

async function aiParseDoc(docText) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(`${CF_BASE}/ai-parse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ docText }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `ai-parse failed: ${res.status}`);
  }
  const { assignments } = await res.json();
  return assignments;
}
