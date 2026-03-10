# Chrome Extension: Canvas Assignment Scraper

**Date:** 2026-03-10
**Status:** Approved

## Problem

The Canvas iCal feed only exposes assignments with calendar due dates. Assignments in Canvas Modules and Checklists — and courses whose assignments live in Google Docs — are invisible to the current dashboard.

## Approach

A Chrome extension running in the user's already-authenticated browser scrapes Canvas module/checklist pages and detects linked Google Docs. It auto-detects Canvas pages and shows a badge count; the user confirms before importing.

## Architecture

```
Chrome Extension
  ├── manifest.json    MV3, runs on *.instructure.com
  ├── content.js       Scans Canvas DOM, messages popup
  ├── popup.html       Import UI + login form
  └── popup.js        Orchestrates scrape → parse → Supabase save

Netlify Function (new)
  └── ai-parse.js      Receives Google Doc text → Claude Haiku → JSON assignments

Existing (unchanged)
  ├── doc-proxy.js     Fetches public Google Doc as plain text
  └── Supabase         courses / assignment_groups / assignments tables
```

## Data Extraction

**Canvas DOM targets** (consistent across all Canvas LMS schools):
- `.ig-title` — assignment name
- `.ig-details` — due date text
- `data-module-type` or `.type_icon` — assignment vs quiz vs file vs page
- `<a href>` on each row — URL parsed for `/courses/(\d+)/assignments/(\d+)` to get IDs

**Google Doc detection:** If any item's href contains `docs.google.com`, the Doc ID is extracted and sent through `doc-proxy` → `ai-parse`.

## New Netlify Function: `ai-parse`

- Receives: `{ text: string }` (plain text of a Google Doc)
- Calls: Claude Haiku (`claude-haiku-4-5-20251001`) — chosen for cost (~10x cheaper than Sonnet for simple extraction)
- Returns: `{ assignments: [{ name, type, due }] }`
- Auth: `CLAUDE_API_KEY` environment variable set in Netlify dashboard

## Extension Auth

The popup contains a small email/password login form that authenticates against the same Supabase project as the dashboard. The session token is stored in `chrome.storage.local`. Once logged in, the popup shows the user's email and an Import button instead.

## Popup UI States

**Logged out:** Email + password fields, Sign In button.

**Logged in, on a Canvas module page:**
```
Found on this page:
• N Canvas assignments
• N Google Doc(s) detected     ← only shown if present

[   Import to Dashboard   ]
✓ Logged in as user@taftschool.edu
```

**Logged in, not on a Canvas page:**
```
Navigate to a Canvas module or
checklist page to import assignments.

✓ Logged in as user@taftschool.edu
```

**Importing:** Progress text ("Importing…", "Parsing Google Doc…"), spinner.

## Data Flow

1. `content.js` scans page on load → sends `{ assignments: [...], googleDocIds: [...] }` to popup via `chrome.runtime.sendMessage`
2. Extension icon badge updates to show assignment count
3. User clicks Import in popup
4. For each Google Doc ID: fetch via `doc-proxy` → send to `ai-parse` → receive structured assignments
5. All assignments saved to Supabase under the authenticated user's account using the existing table schema (`courses` → `assignment_groups` → `assignments`)
6. Popup shows success count

## Course Matching

When saving, the extension matches Canvas course IDs (from assignment URLs) against existing `courses.canvas_course_id` values in Supabase. If a course isn't found, it creates a new one with a default color and the Canvas course name from the page `<title>` or breadcrumb.

## Constraints

- Extension targets Chrome/Chromium (Manifest V3)
- Only runs on `*://*.instructure.com/*`
- `ai-parse` is only called when a Google Doc is detected — not on every Canvas page visit
- No Canvas credentials are stored; the extension relies on the browser's existing Canvas session
