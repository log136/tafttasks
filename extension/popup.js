const SUPABASE_URL = 'https://pupqkuunekeeyfnfjpde.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1cHFrdXVuZWtlZXlmbmZqcGRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMTM2NzEsImV4cCI6MjA4ODU4OTY3MX0.ktUUhaqi3BO5wAr8kWaTqvoQ1fxRlitvD9hpIUXOUdU';

// ── UPDATE THIS to your Cloudflare Pages domain ──
// e.g. 'https://tafttasks.pages.dev' or your custom domain
const BASE_URL = 'https://tafttasks.pages.dev';

let sb = null;
let currentUser = null;
let currentSession = null;
let pageData = null;

// ── Init ──
window.addEventListener('DOMContentLoaded', async () => {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  const { session } = await chrome.storage.local.get('session');
  if (session) {
    const { data } = await sb.auth.setSession(session);
    if (data.user) {
      // Cache iCal URL so background.js can sync without opening the app
      const { data: settings } = await sb.from('user_settings').select('canvas_token').eq('user_id', data.user.id).single();
      if (settings?.canvas_token) await chrome.storage.local.set({ icalUrl: settings.canvas_token });
      currentUser = data.user;
      currentSession = data.session;
    }
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const assignments = [];
        const googleDocIds = [];
        const seen = new Set();

        // Collect assignment anchors from both selector variants
        const itemAnchors = [
          ...document.querySelectorAll('.ig-row[data-module-type] .ig-title a'),
          ...document.querySelectorAll('li.context_module_item a.ig-title'),
        ];

        for (const anchor of itemAnchors) {
          const href = anchor.getAttribute('href') || '';
          const fullUrl = href.startsWith('http') ? href : location.origin + href;

          const gdoc = fullUrl.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
          if (gdoc) {
            if (!seen.has(gdoc[1])) { seen.add(gdoc[1]); googleDocIds.push({ id: gdoc[1], driveFile: false }); }
            continue;
          }

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

          // Extract Canvas course and assignment IDs from the URL path
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

        // Collect embedded Google Doc iframes
        document.querySelectorAll('iframe').forEach(f => {
          const src = f.src || f.getAttribute('src') || '';
          const m = src.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
          if (m && !seen.has(m[1])) { seen.add(m[1]); googleDocIds.push({ id: m[1], driveFile: false }); }
        });

        // Pull course ID and name directly from the URL and page — more reliable than tab title
        const courseIdFromUrl = location.pathname.match(/\/courses\/(\d+)/)?.[1] ?? null;
        const courseNameFromPage = document.querySelector('.ic-app-crumbs li:nth-child(2) a')?.textContent?.trim()
          ?? document.title.replace(/\s*[-|].*$/, '').trim()
          ?? null;

        return { assignments, googleDocIds, courseIdFromUrl, courseNameFromPage };
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
  currentSession = data.session;
  render();
}

// ── Import ──
async function doImport() {
  const btn = document.getElementById('importBtn');
  const statusEl = document.getElementById('importStatus');
  btn.disabled = true;

  try {
    let allAssignments = [...pageData.assignments];

    for (const doc of pageData.googleDocIds) {
      statusEl.textContent = 'Parsing document…';
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

    const courseGroups = groupByCourse(allAssignments);
    let saved = 0;

    for (const [courseId, items] of Object.entries(courseGroups)) {
      const course = await getOrCreateCourse(courseId, items[0]);
      const group = await getOrCreateGroup(course.id, 'Imported');

      // ── Improved deduplication: check both name and canvas_assignment_id ──
      const { data: existing } = await sb.from('assignments')
        .select('name, canvas_assignment_id')
        .eq('group_id', group.id)
        .eq('user_id', currentUser.id);

      const existingNames = new Set((existing || []).map(a => a.name));
      const existingCanvasIds = new Set(
        (existing || []).filter(a => a.canvas_assignment_id).map(a => a.canvas_assignment_id)
      );

      const rows = items
        .filter(a => {
          // Prefer ID-based dedup for Canvas assignments; fall back to name for AI-parsed ones
          if (a.canvasAssignmentId && existingCanvasIds.has(a.canvasAssignmentId)) return false;
          if (!a.canvasAssignmentId && existingNames.has(a.name)) return false;
          return true;
        })
        .map((a, i) => ({
          group_id: group.id,
          user_id: currentUser.id,
          name: a.name,
          type: a.type,
          due: a.due || null,
          url: a.url || null,
          canvas_assignment_id: a.canvasAssignmentId || null,
          done: false,
          sort_order: (existing?.length ?? 0) + i,
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
  // Use the course name scraped from the page breadcrumb (more reliable than tab title)
  const courseName = canvasCourseId === 'google-doc'
    ? (pageData?.courseNameFromPage || 'Imported Course')
    : (pageData?.courseNameFromPage || `Course ${canvasCourseId}`);

  if (canvasCourseId !== 'google-doc') {
    const { data } = await sb.from('courses')
      .select('*').eq('user_id', currentUser.id).eq('canvas_course_id', parseInt(canvasCourseId)).single();
    if (data) return data;
  } else {
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
    const res = await fetch(`https://docs.google.com/document/d/${docId}/export?format=txt`);
    if (!res.ok) throw new Error(`Drive export failed: ${res.status}`);
    return res.text();
  }
  const res = await fetch(`${BASE_URL}/api/doc-proxy?docId=${docId}`);
  if (!res.ok) throw new Error(`doc-proxy failed: ${res.status}`);
  return res.text();
}

async function aiParseDoc(docText) {
  // Send the user's auth token so the function can verify the caller is a real user
  const token = currentSession?.access_token;

  const res = await fetch(`${BASE_URL}/api/ai-parse`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ docText }),
  });
  if (!res.ok) throw new Error(`ai-parse failed: ${res.status}`);
  const { assignments } = await res.json();
  return assignments;
}
