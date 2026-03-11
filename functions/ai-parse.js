// Receives plain text from a Google Doc, calls Claude Haiku to extract
// a structured list of assignments, returns JSON.
// Requires ANTHROPIC_API_KEY env var and PARSE_USAGE KV binding set in Cloudflare dashboard.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = 'https://pupqkuunekeeyfnfjpde.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1cHFrdXVuZWtlZXlmbmZqcGRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMTM2NzEsImV4cCI6MjA4ODU4OTY3MX0.ktUUhaqi3BO5wAr8kWaTqvoQ1fxRlitvD9hpIUXOUdU';
const DAILY_LIMIT = 10;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function parseClaudeResponse(text) {
  try {
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const parsed = JSON.parse(stripped);
    if (!Array.isArray(parsed.assignments)) return [];
    return parsed.assignments;
  } catch {
    return [];
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response('', { headers: CORS });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // Authenticate user via Supabase token
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return json({ error: 'Authentication required' }, 401);
  }
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY },
  });
  if (!userRes.ok) {
    return json({ error: 'Invalid or expired session' }, 401);
  }
  const { id: userId } = await userRes.json();

  // Rate limiting via Cloudflare KV
  const today = new Date().toISOString().slice(0, 10);
  const storeKey = `${userId}:${today}`;
  const current = parseInt(await env.PARSE_USAGE.get(storeKey) || '0');
  if (current >= DAILY_LIMIT) {
    return json({ error: `Daily limit of ${DAILY_LIMIT} document parses reached. Try again tomorrow.` }, 429);
  }

  let docText;
  try {
    ({ docText } = await request.json());
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!docText || typeof docText !== 'string') {
    return json({ error: 'Missing docText' }, 400);
  }

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json({ error: 'ANTHROPIC_API_KEY not set' }, 500);
  }

  const prompt = `You are extracting assignments from a class handout or assignment sheet. Return ONLY valid JSON with this exact shape:
{"assignments":[{"name":"<assignment name>","type":"<reading|homework|quiz|project|classwork>","due":"<YYYY-MM-DD or null>"}]}

Rules:
- The document may be in any language (English, Spanish, etc.). Extract assignments regardless of language.
- Include: readings (lectura), homework (tarea), quizzes (prueba), tests (examen), projects (proyecto), essays, and labs.
- For tables with columns like "Section / Reading / Homework" or "Bloque / Tarea": create one entry per non-empty work cell, named descriptively using the section/chapter/topic context (e.g. "Ch.1 Section 1.1 Reading pp.1-12", "Bloque A Tarea: write paragraph").
- For module/page lists: include items that are clearly assignments or required readings; skip items that are just resource links or videos.
- EXCLUDE only: bare URLs, YouTube/video links with no associated task, and items explicitly marked as optional or supplementary.
- "type" must be one of: reading, homework, quiz, project, classwork.
- "due" is null unless an explicit date is mentioned.
- No extra keys, no markdown, no explanation.

Document text:
${docText.slice(0, 8000)}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${err}`);
    }

    const data = await res.json();
    const rawText = data.content?.[0]?.text ?? '{}';
    const assignments = parseClaudeResponse(rawText);

    // Increment usage counter (expires after 24h)
    await env.PARSE_USAGE.put(storeKey, String(current + 1), { expirationTtl: 86400 });

    return json({ assignments, parsesRemaining: DAILY_LIMIT - current - 1 });
  } catch (err) {
    return json({ error: 'AI parsing failed. Please try again.' }, 500);
  }
}
