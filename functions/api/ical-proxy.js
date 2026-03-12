/**
 * Cloudflare Pages Function: /api/ical-proxy
 *
 * Fetches a Canvas iCal feed server-side to avoid CORS restrictions.
 * Only allows URLs from *.instructure.com calendar feeds.
 *
 * Usage: GET /api/ical-proxy?url=https://taftschool.instructure.com/feeds/calendars/...
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export async function onRequestOptions() {
  return new Response(null, { status: 200, headers: CORS });
}

export async function onRequestGet(context) {
  const { request } = context;
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return new Response('Missing url parameter', { status: 400, headers: CORS });
  }

  // Security: only allow Canvas iCal feed URLs
  if (!url.match(/^https:\/\/[a-z0-9.-]+\.instructure\.com\/feeds\/calendars\//)) {
    return new Response('Only Canvas iCal feed URLs are permitted', { status: 403, headers: CORS });
  }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Canvas returned HTTP ${res.status}`);
    const text = await res.text();
    return new Response(text, {
      status: 200,
      headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (err) {
    return new Response(err.message, { status: 500, headers: CORS });
  }
}
