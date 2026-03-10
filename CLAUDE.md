# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Taft School assignment dashboard — a multi-user web app where students aggregate assignments from Canvas LMS and manual sources into one place. Deployed on Netlify at https://graceful-cupcake-2e9b61.netlify.app/.

## Architecture

**No build step.** The entire frontend is `index.html` — vanilla JS, HTML, and CSS in a single file. There is no `package.json`, no bundler, no framework. Supabase JS is loaded from CDN.

**Netlify Functions** in `netlify/functions/` are the only server-side code:
- `ical-proxy.js` — CORS proxy for Canvas iCal calendar feeds (only allows `*.instructure.com/feeds/calendars/` URLs)
- `doc-proxy.js` — CORS proxy for public Google Docs (accepts a `docId`, exports as plain text via Google's export URL)

Functions are deployed automatically by Netlify when pushed. No local function runner is set up.

## Supabase Data Model

Tables (all have `user_id` with RLS policies so users only see their own data):

```
courses          id, user_id, name, teacher, color, canvas_course_id, canvas_url, note
assignment_groups  id, course_id, user_id, name, sort_order
assignments      id, group_id, user_id, name, type, due, done, url, sort_order,
                 canvas_assignment_id
user_settings    user_id, canvas_token (stores iCal URL, not a token — legacy column name)
```

**In-memory state:** `COURSES` is the global array holding the full nested structure (`course.groups[].assignments[]`) loaded by `loadUserData()` on every auth event.

## Key Gotchas

- **`upsert` with `onConflict` does not work on partial indexes** (indexes with a `WHERE` clause). Use plain `insert` when the conflict target is a partial index. Use `upsert` only for `user_settings` (which has a full unique constraint on `user_id`).
- **`assignment_groups` not `groups`** — the Supabase table is `assignment_groups`. Don't use `sb.from('groups')`.
- **`canvas_token` column stores the iCal URL**, not a Canvas API token. Taft School blocks personal API token generation, so the app uses the Canvas iCal calendar feed instead.

## Three Screens

1. `#authScreen` — email/password auth via Supabase Auth
2. `#wizardScreen` — first-run setup: Canvas iCal import, Taft Templates (Stats + Spanish IV), or manual course creation
3. `#app` — the main dashboard

`showScreen(id)` switches between them. `afterAuth()` decides which screen to show based on whether the user already has courses.

## iCal Import Flow

1. User pastes their Canvas calendar feed URL into the wizard
2. `fetchICalCourses()` fetches it via `ical-proxy`, parses with `parseICal()`, groups events by Canvas course ID (extracted from assignment URLs matching `/courses/(\d+)/assignments/(\d+)`)
3. User selects which courses to import
4. `importSelectedICalCourses()` creates `courses` + `assignment_groups` + `assignments` rows

## Taft Templates

`TAFT_TEMPLATES` constant holds hardcoded Stats assignment data (Chapters 6–12). The Spanish IV template fetches live from a public Google Doc via `doc-proxy`, then `parseSpanishDoc()` parses "Bloque A - Day M/D" headers and `*` bullet assignments.

## Deployment

Push to the connected GitHub repo — Netlify auto-deploys. No build command needed (`netlify.toml` sets `publish = "."`).
