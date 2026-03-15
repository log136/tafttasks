# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Taft School assignment dashboard — a multi-user web app where students aggregate assignments from Canvas LMS and manual sources into one place. Deployed on Cloudflare Pages at https://tafttasks.pages.dev/ and https://tafttasks.com/.

## Architecture

**No build step.** The entire frontend is `index.html` — vanilla JS, HTML, and CSS in a single file. There is no `package.json`, no bundler, no framework. Supabase JS is loaded from CDN.

**Cloudflare Pages Functions** in `functions/api/` are the only server-side code:
- `doc-proxy.js` — CORS proxy for public Google Docs (accepts a `docId`, exports as plain text via Google's export URL)
- `ai-parse.js` — Calls Gemini 2.0 Flash to extract structured assignments from document text. Requires a valid Supabase Bearer token in the `Authorization` header.

Functions use Cloudflare Pages Functions format (`onRequestGet`, `onRequestPost`, `onRequestOptions`).
Environment variables are set in Cloudflare Pages → Settings → Environment Variables:
- `GEMINI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

## Extension

The Chrome MV3 extension lives in `extension/`. Key points:
- `manifest.json` — no `"type": "module"` in content_scripts (Chrome MV3 doesn't support it)
- `content.js` — passive message listener, wrapped in IIFE, no ES module exports
- `popup.js` — primary scraping happens via `chrome.scripting.executeScript` inline function. Uses `BASE_URL = 'https://tafttasks.pages.dev'` for all API calls. Sends `Authorization: Bearer <token>` on ai-parse requests.
- Two-phase flow: "Find Courses" discovers Canvas courses → user selects → "Scrape Selected" imports assignments
- "Refresh All Courses" re-scrapes all existing Canvas courses in the dashboard for new assignments
- `background.js` — badge-only service worker, updates overdue count every 6 hours

## Supabase Data Model

Tables (all have `user_id` with RLS policies so users only see their own data):

```
courses          id, user_id, name, teacher, color, canvas_course_id, canvas_url, note
assignment_groups  id, course_id, user_id, label, sort_order
assignments      id, group_id, user_id, name, type, due, done, url, sort_order,
                 canvas_assignment_id
user_settings    user_id, canvas_token (stores iCal URL, not a token — legacy column name)
```

**In-memory state:** `COURSES` is the global array holding the full nested structure (`course.groups[].assignments[]`) loaded by `loadUserData()` on every auth event.

## Key Gotchas

- **`upsert` with `onConflict` does not work on partial indexes** (indexes with a `WHERE` clause). Use plain `insert` when the conflict target is a partial index. Use `upsert` only for `user_settings` (which has a full unique constraint on `user_id`).
- **`assignment_groups` not `groups`** — the Supabase table is `assignment_groups`. Don't use `sb.from('groups')`.
- **`canvas_token` column in `user_settings`** is a legacy column name — no longer used for iCal. May be repurposed or removed.
- **Assignment deduplication** uses `canvas_assignment_id` (preferred) or name fallback. Do not rely on name-only dedup.

## Three Screens

1. `#authScreen` — email/password auth via Supabase Auth
2. `#wizardScreen` — first-run setup: Taft Templates (Stats + Spanish IV) or manual course creation (Canvas import handled by extension)
3. `#app` — the main dashboard

`showScreen(id)` switches between them. `afterAuth()` decides which screen to show based on whether the user already has courses.

## Extension Scrape Flow

1. User clicks "Find Courses" → extension opens hidden Canvas `/courses` tab, scrapes course list
2. Courses split into current vs past enrollments; user selects which to import
3. "Scrape Selected" opens each course's `/modules` and `/assignments` pages, extracts assignment items
4. Fallback chain: wiki pages → embedded Google Docs → AI parse (Gemini Flash via `/api/ai-parse`)
5. "Refresh All Courses" re-scrapes all existing courses for new assignments

## Taft Templates

`TAFT_TEMPLATES` constant holds hardcoded Stats assignment data (Chapters 6–12). The Spanish IV template fetches live from a public Google Doc via `/api/doc-proxy`, then `parseSpanishDoc()` parses "Bloque A - Day M/D" headers and `*` bullet assignments.

## Deployment

Push to https://github.com/log136/taft-dashboard — Cloudflare Pages auto-deploys. No build command needed (publish directory is `/`).
