# Taft Dashboard

An assignment dashboard for Taft School students. Pulls assignments from Canvas LMS automatically and organizes them in one place across all your devices.

**Live at [tafttasks.pages.dev](https://tafttasks.pages.dev)**

## Features

- **Canvas auto-import** — Chrome extension scrapes your Canvas courses, modules, and assignment pages
- **AI fallback** — when Canvas pages don't have structured assignment data, Gemini Flash extracts assignments from embedded docs and page text
- **Cross-device sync** — check off work on your laptop, it's done on your phone (powered by Supabase)
- **Overdue alerts** — overdue and missing assignments are flagged automatically
- **Dark mode** — clean, minimal interface with full dark mode support

## How It Works

1. Sign up at [tafttasks.pages.dev](https://tafttasks.pages.dev)
2. Install the Chrome extension
3. Click **Find Courses** in the extension while logged into Canvas
4. Select which courses to import
5. Your assignments appear on the dashboard

The extension also has a **Refresh All Courses** button to re-scrape existing courses for new assignments.

## Architecture

**No build step.** The frontend is a single `index.html` file — vanilla JS, HTML, and CSS. No bundler, no framework.

```
index.html              ← entire frontend (single file)
functions/api/
  ai-parse.js           ← Gemini Flash assignment extraction
  doc-proxy.js          ← CORS proxy for Google Docs
extension/
  popup.html/js         ← Chrome extension UI + Canvas scraping
  background.js         ← badge updates (overdue count)
  content.js            ← passive message listener
  manifest.json         ← Chrome MV3 manifest
```

**Backend:** Supabase (auth + Postgres with RLS) + Cloudflare Pages Functions

## Chrome Extension

The extension uses `chrome.scripting.executeScript` to scrape Canvas pages in hidden tabs:

1. Opens `/courses` to discover enrolled courses (current vs past)
2. For each selected course, scrapes `/modules` and `/assignments`
3. Falls back to wiki pages, embedded Google Docs, then AI parsing
4. Deduplicates by `canvas_assignment_id` or assignment name

### Install (developer mode)

1. Download or clone this repo
2. Open `chrome://extensions` → enable Developer Mode
3. Click "Load unpacked" → select the `extension/` folder
4. Sign in with your Taft Dashboard account

## Deployment

Push to `main` → Cloudflare Pages auto-deploys. No build command needed.

### Environment Variables (Cloudflare Pages)

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Google AI Studio API key for assignment extraction |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon/public key |

## Data Model

All tables use Row Level Security — users only see their own data.

| Table | Key Columns |
|-------|-------------|
| `courses` | `name`, `color`, `canvas_course_id` |
| `assignment_groups` | `course_id`, `label`, `sort_order` |
| `assignments` | `group_id`, `name`, `type`, `due`, `done`, `canvas_assignment_id` |
| `user_settings` | `user_id` (unique) |

## License

Private project — not open source.
