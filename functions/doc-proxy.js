// Fetches a public Google Doc as plain text to avoid CORS.
// Only accepts Google Doc IDs (alphanumeric + hyphens/underscores).

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
  const docId = url.searchParams.get('docId');

  if (!docId || !/^[a-zA-Z0-9_-]+$/.test(docId)) {
    return new Response('Invalid or missing docId', { status: 400, headers: CORS });
  }

  const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;

  try {
    const res = await fetch(exportUrl);
    if (!res.ok) throw new Error(`Google returned HTTP ${res.status}`);
    const text = await res.text();
    return new Response(text, {
      headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (err) {
    return new Response(err.message, { status: 500, headers: CORS });
  }
}
