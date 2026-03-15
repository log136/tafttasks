const SUPABASE_URL = 'https://pupqkuunekeeyfnfjpde.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1cHFrdXVuZWtlZXlmbmZqcGRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMTM2NzEsImV4cCI6MjA4ODU4OTY3MX0.ktUUhaqi3BO5wAr8kWaTqvoQ1fxRlitvD9hpIUXOUdU';

// ── UPDATE THIS to your Cloudflare Pages domain ──
// e.g. 'https://tafttasks.pages.dev' or your custom domain
const BASE_URL = 'https://tafttasks.pages.dev';

let sb = null;
let currentUser = null;
let currentSession = null;
let discoveredCourses = []; // populated by doFullSync, consumed by doScrapeSelected

// Simple string hash for content-cache keying
async function hashText(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// AI parse with content-hash cache — skips the API call if page text hasn't changed
async function cachedAiParse(courseId, pageText) {
  const cacheKey = `aiCache_${courseId}`;
  const hash = await hashText(pageText);

  const stored = (await chrome.storage.local.get(cacheKey))[cacheKey];
  if (stored?.hash === hash) {
    return stored.assignments; // page unchanged, reuse cached result
  }

  const assignments = await aiParseDoc(pageText);
  await chrome.storage.local.set({ [cacheKey]: { hash, assignments } });
  return assignments;
}

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
  document.getElementById('scrapeSelectedBtn').addEventListener('click', doScrapeSelected);

  render();
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

// ── Phase 1: Discover courses, show checkboxes ──
async function doFullSync() {
  const btn = document.getElementById('syncAllBtn');
  const statusEl = document.getElementById('syncAllStatus');
  btn.disabled = true;
  statusEl.className = 'status';
  document.getElementById('courseSelectSection').style.display = 'none';

  try {
    statusEl.textContent = 'Finding your Canvas courses…';
    const canvasCourses = await scrapeCanvasCourses();

    if (!canvasCourses?.length) {
      statusEl.textContent = '✗ No courses found. Make sure you\'re logged into Canvas.';
      btn.disabled = false;
      return;
    }

    // Check which courses the user already has in Supabase
    const { data: existingCourses } = await sb.from('courses')
      .select('canvas_course_id')
      .eq('user_id', currentUser.id)
      .not('canvas_course_id', 'is', null);
    const existingIds = new Set((existingCourses || []).map(c => String(c.canvas_course_id)));

    // Store for Phase 2
    discoveredCourses = canvasCourses;

    // Split into current and past courses
    const currentCourses = canvasCourses.filter(c => !c.past);
    const pastCourses = canvasCourses.filter(c => c.past);

    // Render checkboxes — current courses shown normally, past greyed out
    const listEl = document.getElementById('courseCheckList');
    let html = currentCourses.map((c) => {
      const i = canvasCourses.indexOf(c);
      const exists = existingIds.has(String(c.id));
      return `<label class="course-item">
        <input type="checkbox" value="${i}">
        <span class="course-item-name">${c.name}</span>
        ${exists ? '<span class="course-item-badge">already added</span>' : ''}
      </label>`;
    }).join('');

    if (pastCourses.length) {
      html += `<div class="past-courses-toggle" style="margin:8px 0 4px;font-size:0.8rem;color:#888;cursor:pointer;" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none';this.textContent=this.nextElementSibling.style.display==='none'?'▸ Past courses (${pastCourses.length})':'▾ Past courses (${pastCourses.length})'">▸ Past courses (${pastCourses.length})</div>`;
      html += `<div style="display:none;opacity:0.5">`;
      html += pastCourses.map((c) => {
        const i = canvasCourses.indexOf(c);
        const exists = existingIds.has(String(c.id));
        return `<label class="course-item">
          <input type="checkbox" value="${i}">
          <span class="course-item-name">${c.name}</span>
          ${exists ? '<span class="course-item-badge">already added</span>' : ''}
        </label>`;
      }).join('');
      html += `</div>`;
    }
    listEl.innerHTML = html;

    statusEl.textContent = `Found ${currentCourses.length} current course${currentCourses.length !== 1 ? 's' : ''}.`;
    document.getElementById('courseSelectSection').style.display = 'block';
    document.getElementById('scrapeStatus').textContent = '';

  } catch (err) {
    statusEl.textContent = '✗ ' + err.message;
    statusEl.className = 'status error';
  }

  btn.disabled = false;
}

// ── Phase 2: Scrape only selected courses ──
async function doScrapeSelected() {
  const checked = [...document.querySelectorAll('#courseCheckList input:checked')];
  if (!checked.length) { alert('Select at least one course.'); return; }

  const btn = document.getElementById('scrapeSelectedBtn');
  const statusEl = document.getElementById('scrapeStatus');
  btn.disabled = true;
  statusEl.className = 'status';

  // Kick off iCal sync in the background (best-effort)
  let { icalUrl } = await chrome.storage.local.get('icalUrl');
  if (icalUrl) {
    chrome.runtime.sendMessage({ type: 'SYNC_NOW' }).catch(() => {});
  }

  try {
    let totalSaved = 0;
    const selected = checked.map(cb => discoveredCourses[parseInt(cb.value)]);

    for (let i = 0; i < selected.length; i++) {
      const cc = selected[i];
      statusEl.textContent = `Scraping ${cc.name} (${i + 1}/${selected.length})…`;

      const base = `https://taftschool.instructure.com/courses/${cc.id}`;
      const [modulesData, assignmentsData] = await Promise.all([
        scrapeTab(`${base}/modules`),
        scrapeTab(`${base}/assignments`),
      ]);
      const data = mergePageData(modulesData, assignmentsData);
      data.courseIdFromUrl = cc.id;
      data.courseNameFromPage = cc.name;

      for (const a of data.assignments) {
        if (!a.canvasCourseId) a.canvasCourseId = parseInt(cc.id);
      }

      // AI fallback: if selectors found nothing, try wiki pages then page text
      if (!data.assignments.length && !data.googleDocIds.length) {
        // Check course home for links to assignment-related wiki pages
        statusEl.textContent = `Checking ${cc.name} home page…`;
        const homeData = await scrapeTab(base);
        const wikiLinks = (homeData?.wikiLinks || []).filter(l =>
          /assign|syllab|homework|schedule/i.test(l.text + ' ' + l.href)
        );

        // Scrape the first matching wiki page for embedded docs/text
        let pageText = '';
        let wikiData = null;
        if (wikiLinks.length > 0) {
          const wikiUrl = wikiLinks[0].href.startsWith('http') ? wikiLinks[0].href : `https://taftschool.instructure.com${wikiLinks[0].href}`;
          wikiData = await scrapeTab(wikiUrl);
          pageText = wikiData?.pageText || '';
          // Merge any Google Doc IDs or assignments found on the wiki page
          if (wikiData?.googleDocIds?.length) {
            for (const doc of wikiData.googleDocIds) {
              if (!data.googleDocIds.some(d => d.id === doc.id)) data.googleDocIds.push(doc);
            }
          }
          if (wikiData?.assignments?.length) {
            for (const a of wikiData.assignments) {
              if (!a.canvasCourseId) a.canvasCourseId = parseInt(cc.id);
              data.assignments.push(a);
            }
          }
        }

        // If we found Google Docs on the wiki page, skip AI — importFromPageData will fetch & parse them
        if (!data.assignments.length && !data.googleDocIds.length) {
          if (pageText.length < 50) {
            pageText = modulesData?.pageText || assignmentsData?.pageText || '';
          }
          if (pageText.length > 50) {
            statusEl.textContent = `AI-parsing ${cc.name} (${i + 1}/${selected.length})…`;
            try {
              const aiAssignments = await cachedAiParse(cc.id, pageText);
              for (const a of aiAssignments) {
                a.canvasCourseId = parseInt(cc.id);
                a.canvasAssignmentId = null;
              }
              data.assignments = aiAssignments;
            } catch (err) {
              console.error('AI parse failed for', cc.name, err);
            }
          }
        }
      }

      if (data.assignments.length || data.googleDocIds.length) {
        const { saved } = await importFromPageData(data);
        totalSaved += saved;
      }
    }

    statusEl.textContent = totalSaved > 0
      ? `✓ Imported ${totalSaved} new assignment${totalSaved !== 1 ? 's' : ''}.`
      : '✓ Everything was already up to date.';

  } catch (err) {
    statusEl.textContent = '✗ ' + err.message;
    statusEl.className = 'status error';
  }

  btn.disabled = false;
}

// Scrape the Canvas courses page for enrolled course IDs and names
function scrapeCanvasCourses() {
  return new Promise(resolve => {
    chrome.tabs.create({ url: 'https://taftschool.instructure.com/courses', active: false }, tab => {
      let resolved = false;

      function finish(data) {
        if (resolved) return;
        resolved = true;
        chrome.tabs.remove(tab.id).catch(() => {});
        resolve(data || []);
      }

      function tryExtract() {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            const courses = [];
            const seen = new Set();

            // Find the "Past Enrollments" heading to split current vs past
            const pastHeading = [...document.querySelectorAll('h2')].find(h => /past enrollments/i.test(h.textContent));
            const pastTable = pastHeading?.nextElementSibling?.tagName === 'TABLE' ? pastHeading.nextElementSibling : null;
            const pastRows = pastTable ? new Set(pastTable.querySelectorAll('tr')) : new Set();

            // All table rows with course links
            document.querySelectorAll('td a[href*="/courses/"]').forEach(a => {
              const m = (a.getAttribute('href') || '').match(/\/courses\/(\d+)/);
              if (!m || seen.has(m[1])) return;
              seen.add(m[1]);
              const row = a.closest('tr');
              const isPast = pastRows.has(row);
              const cells = row ? [...row.querySelectorAll('td')] : [];
              const term = cells[3]?.textContent?.trim() || '';
              const published = cells[5]?.textContent?.trim()?.startsWith('Yes');
              courses.push({ id: m[1], name: a.textContent.trim(), past: isPast, term, published });
            });

            // Fallback: any course link on the page
            if (!courses.length) {
              document.querySelectorAll('a[href*="/courses/"]').forEach(a => {
                const m = (a.getAttribute('href') || '').match(/\/courses\/(\d+)$/);
                if (m && !seen.has(m[1])) {
                  seen.add(m[1]);
                  const name = a.textContent.trim();
                  if (name && name.length > 1) courses.push({ id: m[1], name, past: false, term: '', published: true });
                }
              });
            }
            return courses;
          },
        }, results => {
          const data = results?.[0]?.result;
          if (data?.length) finish(data);
        });
      }

      const listener = (tabId, info) => {
        if (tabId !== tab.id || info.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(listener);
        tryExtract();
        setTimeout(tryExtract, 1500);
      };
      chrome.tabs.onUpdated.addListener(listener);

      setTimeout(() => finish(null), 12000);
    });
  });
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
              let isAssignment = false;

              if (typeClass?.contains('assignment')) { isAssignment = true; }
              if (typeClass?.contains('quiz')) { type = 'quiz'; isAssignment = true; }
              else if (typeClass?.contains('discussion_topic')) { type = 'classwork'; isAssignment = true; }
              else if (typeClass?.contains('wiki_page') || typeClass?.contains('attachment') || typeClass?.contains('external_url')) {
                type = 'reading';
                // wiki pages, files, and external links are NOT assignments unless they have a due date
              }

              const dueEl = li?.querySelector('.due_date_display');
              let due = null;
              if (dueEl) {
                const cleaned = dueEl.textContent.trim().replace(/\s+at\s+\d+:\d+\s*[ap]m/i, '');
                const d = new Date(cleaned);
                if (!isNaN(d)) { due = d.toISOString().slice(0, 10); isAssignment = true; }
              }

              const idMatch = href.match(/\/courses\/(\d+)\/(?:assignments|quizzes)\/(\d+)/);
              if (idMatch) isAssignment = true;

              // Extract assignment ID from li class (e.g. "Assignment_74568") when URL doesn't contain it
              let assignmentIdFromClass = null;
              const classMatch = li?.className?.match(/Assignment_(\d+)/);
              if (classMatch) { assignmentIdFromClass = parseInt(classMatch[1]); isAssignment = true; }

              // Skip non-assignment items (pages, files, external links without due dates)
              if (!isAssignment) continue;

              assignments.push({
                name: anchor.textContent.trim(),
                url: fullUrl,
                type,
                due,
                canvasCourseId: idMatch ? parseInt(idMatch[1]) : null,
                canvasAssignmentId: idMatch ? parseInt(idMatch[2]) : assignmentIdFromClass,
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

            // Collect wiki page links from course home pages
            const wikiLinks = [];
            document.querySelectorAll('a[href*="/pages/"]').forEach(a => {
              const href = a.getAttribute('href') || '';
              const text = a.textContent.trim() || a.getAttribute('title') || '';
              if (href.includes('/pages/') && text) wikiLinks.push({ href, text });
            });

            // Capture page text for AI fallback — include embedded doc viewer text
            const mainEl = document.querySelector('#content') || document.querySelector('.ic-Layout-contentMain') || document.body;
            let pageText = mainEl?.innerText?.slice(0, 8000) || '';

            // Also grab text from embedded Canvas file viewer iframes
            document.querySelectorAll('iframe').forEach(f => {
              try {
                const iDoc = f.contentDocument || f.contentWindow?.document;
                if (iDoc) {
                  const iText = iDoc.body?.innerText || '';
                  if (iText.length > 50) pageText += '\n' + iText.slice(0, 8000);
                }
              } catch (e) { /* cross-origin, skip */ }
            });
            pageText = pageText.slice(0, 8000);

            return { assignments, googleDocIds, courseIdFromUrl, courseNameFromPage, pageText, wikiLinks };
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
