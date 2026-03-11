// Fetches a Canvas iCal feed server-side to avoid CORS restrictions.
// Only allows URLs from instructure.com calendar feeds.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export async function onRequest(context) {
  const { request } = context;

  if (request.method === 'OPTIONS') {
    return new Response('', { headers: CORS });
  }

  const url = new URL(request.url);
  const feedUrl = url.searchParams.get('url');

  if (!feedUrl) {
    return new Response('Missing url parameter', { status: 400, headers: CORS });
  }

  if (!feedUrl.match(/^https:\/\/[a-z0-9.-]+\.instructure\.com\/feeds\/calendars\//)) {
    return new Response('Only Canvas iCal feed URLs are permitted', { status: 403, headers: CORS });
  }

  try {
    const res = await fetch(feedUrl);
    if (!res.ok) throw new Error(`Canvas returned HTTP ${res.status}`);
    const text = await res.text();
    return new Response(text, {
      headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (err) {
    return new Response(err.message, { status: 500, headers: CORS });
  }
}
