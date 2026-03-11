// Receives plain text from a Google Doc, calls Claude Haiku to extract
// a structured list of assignments, returns JSON.
// Requires ANTHROPIC_API_KEY env var set in Netlify dashboard.

import { getStore } from '@netlify/blobs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = 'https://pupqkuunekeeyfnfjpde.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1cHFrdXVuZWtlZXlmbmZqcGRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMTM2NzEsImV4cCI6MjA4ODU4OTY3MX0.ktUUhaqi3BO5wAr8kWaTqvoQ1fxRlitvD9hpIUXOUdU';
const DAILY_LIMIT = 10;

export function parseClaudeResponse(text) {
  try {
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const parsed = JSON.parse(stripped);
    if (!Array.isArray(parsed.assignments)) return [];
    return parsed.assignments;
  } catch {
    return [];
  }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Authenticate user via Supabase token
  const token = (event.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return { statusCode: 401, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Authentication required' }) };
  }
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON_KEY },
  });
  if (!userRes.ok) {
    return { statusCode: 401, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid or expired session' }) };
  }
  const { id: userId } = await userRes.json();

  // Rate limiting: 10 parses per user per day
  const today = new Date().toISOString().slice(0, 10);
  const store = getStore('parse-usage');
  const storeKey = `${userId}:${today}`;
  const current = parseInt(await store.get(storeKey) || '0');
  if (current >= DAILY_LIMIT) {
    return { statusCode: 429, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `Daily limit of ${DAILY_LIMIT} document parses reached. Try again tomorrow.` }) };
  }

  let docText;
  try {
    ({ docText } = JSON.parse(event.body ?? '{}'));
  } catch {
    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }
  if (!docText || typeof docText !== 'string') {
    return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Missing docText' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'ANTHROPIC_API_KEY not set' }) };
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
    console.log('ai-parse rawText:', rawText.slice(0, 500));
    const assignments = parseClaudeResponse(rawText);

    // Increment usage counter
    await store.set(storeKey, String(current + 1));

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignments, parsesRemaining: DAILY_LIMIT - current - 1 }),
    };
  } catch (err) {
    console.error('ai-parse error:', err);
    return { statusCode: 500, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'AI parsing failed. Please try again.' }) };
  }
};
