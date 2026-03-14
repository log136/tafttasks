const SUPABASE_URL = 'https://pupqkuunekeeyfnfjpde.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1cHFrdXVuZWtlZXlmbmZqcGRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMTM2NzEsImV4cCI6MjA4ODU4OTY3MX0.ktUUhaqi3BO5wAr8kWaTqvoQ1fxRlitvD9hpIUXOUdU';

// ── UPDATE THIS to your Cloudflare Pages domain ──
// e.g. 'https://tafttasks.pages.dev' or your custom domain
const BASE_URL = 'https://tafttasks.pages.dev';

let sb = null;
let currentUser = null;
let currentSession = null;

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

  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('syncAllBtn').addEventListener('click', doFullSync);

  render();
  if (currentUser) doFullSync();
});


function render() {
  const loggedIn = !!currentUser;
  document.getElementById('loginSection').style.display = loggedIn ? 'none' : 'block';
  document.getElementById('notCanvasSection').style.display = loggedIn ? 'block' : 'none';
  if (loggedIn) {
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
  doFullSync();
}

// ── Full Sync: iCal + per-course module page scraping ──
async function doFullSync() {
  const btn = document.getElementById('syncAllBtn');
  const statusEl = document.getElementById('syncAllStatus');
  btn.disabled = true;
  statusEl.className = 'status';

  try {
    // Step 1: iCal sync — creates/updates courses in Supabase
    let { icalUrl } = await chrome.storage.local.get('icalUrl');

    if (!icalUrl) {
      statusEl.textContent = 'Finding your Canvas calendar…';
      icalUrl = await discoverICalUrl();
      if (!icalUrl) {
        statusEl.textContent = '✗ Could not find Canvas calendar. Make sure you\'re logged into Canvas.';
        btn.disabled = false;
        return;
      }
      await chrome.storage.local.set({ icalUrl });
      await sb.from('user_settings').upsert({
        user_id: currentUser.id,
        canvas_token: icalUrl,
      });
    }

    statusEl.textContent = 'Syncing iCal…';
    const icalResult = await chrome.runtime.sendMessage({ type: 'SYNC_NOW' });

    if (!icalResult?.ok) {
      statusEl.textContent = '✗ iCal sync failed — ' + (icalResult?.error || 'unknown error');
      btn.disabled = false;
      return;
    }

    // Step 2: Query courses now in Supabase (created by iCal sync above — works for new users)
    const { data: courses } = await sb.from('courses')
      .select('id, name, canvas_course_id')
      .eq('user_id', currentUser.id)
      .not('canvas_course_id', 'is', null);

    if (!courses?.length) {
      statusEl.textContent = '✓ iCal synced! (No Canvas courses found to scrape.)';
      btn.disabled = false;
      return;
    }

    // Step 3: Scrape each course's modules + assignments pages in hidden tabs
    let totalSaved = 0;
    for (let i = 0; i < courses.length; i++) {
      const course = courses[i];
      statusEl.textContent = `Scraping ${course.name} (${i + 1}/${courses.length})…`;

      const base = `https://taftschool.instructure.com/courses/${course.canvas_course_id}`;
      const [modulesData, assignmentsData] = await Promise.all([
        scrapeTab(`${base}/modules`),
        scrapeTab(`${base}/assignments`),
      ]);
      const data = mergePageData(modulesData, assignmentsData);

      if (data.assignments.length || data.googleDocIds.length) {
        const { saved } = await importFromPageData(data);
        totalSaved += saved;
      }
    }

    statusEl.textContent = totalSaved > 0
      ? `✓ All done! Imported ${totalSaved} new assignment${totalSaved !== 1 ? 's' : ''}.`
      : '✓ All done! Everything was already up to date.';

  } catch (err) {
    statusEl.textContent = '✗ ' + err.message;
    statusEl.className = 'status error';
  }

  btn.disabled = false;
}

// Opens a hidden Canvas modules page tab, waits for load, scrapes assignments.
function scrapeTab(url) {
  return new Promise(resolve => {
    chrome.tabs.create({ url, active: false }, tab => {
      let resolved = false;

      function finish(data) {
        if (resolved) return;
        resolved = true;
        chrome.tabs.remove(tab.id).catch(() => {});
        resolve(data || null);
      }

      function tryExtract() {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const assignments = [];
            const googleDocIds = [];
            const seen = new Set();

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

            document.querySelectorAll('iframe').forEach(f => {
              const src = f.src || f.getAttribute('src') || '';
              const m = src.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
              if (m && !seen.has(m[1])) { seen.add(m[1]); googleDocIds.push({ id: m[1], driveFile: false }); }
            });

            const courseIdFromUrl = location.pathname.match(/\/courses\/(\d+)/)?.[1] ?? null;
            const courseNameFromPage = document.querySelector('.ic-app-crumbs li:nth-child(2) a')?.textContent?.trim()
              ?? document.title.replace(/\s*[-|].*$/, '').trim()
              ?? null;

            return { assignments, googleDocIds, courseIdFromUrl, courseNameFromPage };
          },
        }, results => {
          const data = results?.[0]?.result;
          if (data) finish(data);
        });
      }

      const listener = (tabId, info) => {
        if (tabId !== tab.id || info.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(listener);
        tryExtract();
        setTimeout(tryExtract, 1500);
      };
      chrome.tabs.onUpdated.addListener(listener);

      // Hard timeout after 12 s
      setTimeout(() => finish(null), 12000);
    });
  });
}

// ── Import assignments from a scraped page data object ──
async function importFromPageData(data) {
  if (!data) return { saved: 0, total: 0 };

  let allAssignments = [...(data.assignments || [])];

  for (const doc of (data.googleDocIds || [])) {
    const docText = await fetchDocText(doc.id, doc.driveFile);
    const aiAssignments = await aiParseDoc(docText);
    allAssignments = allAssignments.concat(
      aiAssignments.map(a => ({ ...a, canvasCourseId: null, canvasAssignmentId: null }))
    );
  }

  if (!allAssignments.length) return { saved: 0, total: 0 };

  const courseGroups = groupByCourse(allAssignments);
  let saved = 0;
  const total = allAssignments.length;

  for (const [courseId, items] of Object.entries(courseGroups)) {
    const course = await getOrCreateCourse(courseId, items[0], data);
    const group = await getOrCreateGroup(course.id, 'Imported');

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

  return { saved, total };
}

// Merge two scraped page data objects, deduplicating by canvasAssignmentId then name.
function mergePageData(a, b) {
  const assignments = [...(a?.assignments || [])];
  const seenIds = new Set(assignments.map(x => x.canvasAssignmentId).filter(Boolean));
  const seenNames = new Set(assignments.map(x => x.name));
  for (const item of (b?.assignments || [])) {
    if (item.canvasAssignmentId && seenIds.has(item.canvasAssignmentId)) continue;
    if (!item.canvasAssignmentId && seenNames.has(item.name)) continue;
    assignments.push(item);
    if (item.canvasAssignmentId) seenIds.add(item.canvasAssignmentId);
    seenNames.add(item.name);
  }
  const seenDocIds = new Set((a?.googleDocIds || []).map(d => d.id));
  const googleDocIds = [...(a?.googleDocIds || [])];
  for (const doc of (b?.googleDocIds || [])) {
    if (!seenDocIds.has(doc.id)) { seenDocIds.add(doc.id); googleDocIds.push(doc); }
  }
  return {
    assignments,
    googleDocIds,
    courseIdFromUrl: a?.courseIdFromUrl ?? b?.courseIdFromUrl ?? null,
    courseNameFromPage: a?.courseNameFromPage ?? b?.courseNameFromPage ?? null,
  };
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

async function getOrCreateCourse(canvasCourseId, sampleAssignment, data) {
  const courseName = canvasCourseId === 'google-doc'
    ? (data?.courseNameFromPage || 'Imported Course')
    : (data?.courseNameFromPage || `Course ${canvasCourseId}`);

  if (canvasCourseId !== 'google-doc') {
    const { data: existing } = await sb.from('courses')
      .select('*').eq('user_id', currentUser.id).eq('canvas_course_id', parseInt(canvasCourseId)).single();
    if (existing) return existing;
  } else {
    const { data: existing } = await sb.from('courses')
      .select('*').eq('user_id', currentUser.id).eq('name', courseName).is('canvas_course_id', null).maybeSingle();
    if (existing) return existing;
  }

  const colors = ['#1d4ed8', '#065f46', '#7c3aed', '#b45309', '#0e7490', '#be123c'];
  const color = colors[Math.floor(Math.random() * colors.length)];

  const { data: created, error } = await sb.from('courses').insert({
    user_id: currentUser.id,
    name: courseName,
    color,
    canvas_course_id: canvasCourseId === 'google-doc' ? null : parseInt(canvasCourseId),
  }).select().single();

  if (error) throw new Error('Course create failed: ' + error.message);
  return created;
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

// Opens a hidden Canvas calendar tab, waits for load, extracts the iCal feed URL.
function discoverICalUrl() {
  return new Promise(resolve => {
    chrome.tabs.create({ url: 'https://taftschool.instructure.com/calendar', active: false }, tab => {
      let resolved = false;

      function finish(url) {
        if (resolved) return;
        resolved = true;
        chrome.tabs.remove(tab.id).catch(() => {});
        resolve(url || null);
      }

      function tryExtract() {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => document.querySelector('a[href*="/feeds/calendars/"]')?.href || null,
        }, results => {
          const url = results?.[0]?.result;
          if (url) finish(url);
        });
      }

      const listener = (tabId, info) => {
        if (tabId !== tab.id || info.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(listener);
        tryExtract();
        // Retry once after 1.5 s in case Canvas renders the link via JS
        setTimeout(tryExtract, 1500);
      };
      chrome.tabs.onUpdated.addListener(listener);

      // Hard timeout after 12 s
      setTimeout(() => finish(null), 12000);
    });
  });
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
