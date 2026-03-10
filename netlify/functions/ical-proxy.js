// Fetches a Canvas iCal feed server-side to avoid CORS restrictions.
// Only allows URLs from instructure.com calendar feeds.

exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  const { url } = event.queryStringParameters || {};

  if (!url) {
    return { statusCode: 400, headers: corsHeaders, body: 'Missing url parameter' };
  }

  // Security: only allow Canvas iCal feed URLs
  if (!url.match(/^https:\/\/[a-z0-9.-]+\.instructure\.com\/feeds\/calendars\//)) {
    return { statusCode: 403, headers: corsHeaders, body: 'Only Canvas iCal feed URLs are permitted' };
  }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Canvas returned HTTP ${res.status}`);
    const text = await res.text();
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
      body: text,
    };
  } catch (err) {
    return { statusCode: 500, headers: corsHeaders, body: err.message };
  }
};
