// Runs on every *.instructure.com page.
// Scans for Canvas module/checklist assignment rows and notifies the popup.

/**
 * Scan the current document for Canvas module assignment rows.
 * Pure function — accepts a document-like object for testability.
 * @param {Document} doc
 * @returns {{ assignments: Array, googleDocIds: string[] }}
 */
export function extractAssignments(doc) {
  const rows = doc.querySelectorAll('.ig-row[data-module-type]');
  const assignments = [];
  const googleDocIds = [];

  for (const row of rows) {
    const typeRaw = row.getAttribute('data-module-type') || 'Assignment';
    const anchor = row.querySelector('.ig-title a');
    if (!anchor) continue;

    const name = anchor.textContent.trim();
    const href = anchor.getAttribute('href') || '';
    const origin = typeof location !== 'undefined' ? location.origin : 'https://taftschool.instructure.com';
    const fullUrl = href.startsWith('http') ? href : origin + href;

    // Detect Google Doc links
    const gdocMatch = fullUrl.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (gdocMatch) {
      googleDocIds.push(gdocMatch[1]);
      continue;
    }

    // Extract Canvas IDs
    const idMatch = href.match(/\/courses\/(\d+)\/(?:assignments|quizzes)\/(\d+)/);
    const canvasCourseId = idMatch ? parseInt(idMatch[1]) : null;
    const canvasAssignmentId = idMatch ? parseInt(idMatch[2]) : null;

    // Due date
    const dueEl = row.querySelector('.due_date_display');
    const due = dueEl ? parseDue(dueEl.textContent.trim()) : null;

    assignments.push({
      name,
      url: fullUrl,
      type: mapType(typeRaw),
      due,
      canvasCourseId,
      canvasAssignmentId,
    });
  }

  return { assignments, googleDocIds };
}

function mapType(canvasType) {
  const t = canvasType.toLowerCase();
  if (t.includes('quiz')) return 'quiz';
  if (t.includes('discussion')) return 'classwork';
  if (t.includes('file') || t.includes('page')) return 'reading';
  return 'homework';
}

function parseDue(text) {
  if (!text) return null;
  // Canvas appends "at HH:MMam/pm" which Date cannot parse
  const cleaned = text.replace(/\s+at\s+\d+:\d+\s*[ap]m/i, '').trim();
  const d = new Date(cleaned);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

export function extractEmbeddedDocIds(doc) {
  const ids = [];
  for (const iframe of doc.querySelectorAll('iframe')) {
    const src = iframe.src || iframe.getAttribute('src') || '';
    const m = src.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (m) ids.push(m[1]);
  }
  return ids;
}

// ── Runtime: runs in actual Chrome extension context ──
if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'GET_PAGE_DATA') {
      const base = extractAssignments(document);
      const embeddedDocIds = extractEmbeddedDocIds(document);
      sendResponse({
        ...base,
        googleDocIds: [...base.googleDocIds, ...embeddedDocIds],
        pageText: null,
      });
    }
    return true;
  });
}
