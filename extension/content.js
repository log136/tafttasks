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
    const fullUrl = href.startsWith('http') ? href : 'https://taftschool.instructure.com' + href;

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
  const d = new Date(text);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
}

// ── Runtime: runs in actual Chrome extension context ──
if (typeof chrome !== 'undefined' && chrome.runtime) {
  // Send initial scan to background on page load
  const result = extractAssignments(document);
  const total = result.assignments.length + result.googleDocIds.length;
  if (total > 0) {
    chrome.action.setBadgeText({ text: String(total) }).catch(() => {});
  }

  // Respond to popup requesting page data
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'GET_PAGE_DATA') {
      sendResponse(extractAssignments(document));
    }
    return true;
  });
}
