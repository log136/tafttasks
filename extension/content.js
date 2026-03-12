// Runs on every *.instructure.com page.
// Listens for GET_PAGE_DATA messages from popup.js.
// Note: popup.js uses chrome.scripting.executeScript for the primary import flow.
// This listener is available as a fallback / future use.

(function () {
  if (typeof chrome === 'undefined' || !chrome.runtime) return;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== 'GET_PAGE_DATA') return;

    const assignments = [];
    const googleDocIds = [];
    const seen = new Set();

    // Primary selector: Canvas module rows
    const rows = document.querySelectorAll('.ig-row[data-module-type]');
    for (const row of rows) {
      const anchor = row.querySelector('.ig-title a');
      if (!anchor) continue;

      const href = anchor.getAttribute('href') || '';
      const fullUrl = href.startsWith('http') ? href : location.origin + href;

      const gdocMatch = fullUrl.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
      if (gdocMatch) {
        if (!seen.has(gdocMatch[1])) { seen.add(gdocMatch[1]); googleDocIds.push({ id: gdocMatch[1], driveFile: false }); }
        continue;
      }

      const idMatch = href.match(/\/courses\/(\d+)\/(?:assignments|quizzes)\/(\d+)/);
      const dueEl = row.querySelector('.due_date_display');
      let due = null;
      if (dueEl) {
        const cleaned = dueEl.textContent.trim().replace(/\s+at\s+\d+:\d+\s*[ap]m/i, '');
        const d = new Date(cleaned);
        if (!isNaN(d)) due = d.toISOString().slice(0, 10);
      }

      assignments.push({
        name: anchor.textContent.trim(),
        url: fullUrl,
        type: mapType(row.getAttribute('data-module-type') || ''),
        due,
        canvasCourseId: idMatch ? parseInt(idMatch[1]) : null,
        canvasAssignmentId: idMatch ? parseInt(idMatch[2]) : null,
      });
    }

    // Also scan for embedded doc iframes
    for (const iframe of document.querySelectorAll('iframe')) {
      const src = iframe.src || iframe.getAttribute('src') || '';
      const m = src.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
      if (m && !seen.has(m[1])) { seen.add(m[1]); googleDocIds.push({ id: m[1], driveFile: false }); }
    }

    sendResponse({ assignments, googleDocIds });
    return true;
  });

  function mapType(canvasType) {
    const t = canvasType.toLowerCase();
    if (t.includes('quiz')) return 'quiz';
    if (t.includes('discussion')) return 'classwork';
    if (t.includes('file') || t.includes('page')) return 'reading';
    return 'homework';
  }
})();
