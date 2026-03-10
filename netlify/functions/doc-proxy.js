// Fetches a public Google Doc as plain text to avoid CORS.
// Only accepts Google Doc IDs (alphanumeric + hyphens/underscores).

export const handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders, body: '' };
  }

  const { docId } = event.queryStringParameters || {};

  if (!docId || !/^[a-zA-Z0-9_-]+$/.test(docId)) {
    return { statusCode: 400, headers: corsHeaders, body: 'Invalid or missing docId' };
  }

  const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;

  try {
    const res = await fetch(exportUrl);
    if (!res.ok) throw new Error(`Google returned HTTP ${res.status}`);
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
