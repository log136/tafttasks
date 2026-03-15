/**
 * Cloudflare Pages Function: /api/ai-parse
 *
 * Receives plain text from a document or Canvas page, calls Gemini Flash
 * to extract structured assignments, and returns JSON.
 *
 * Required environment variables (set in Cloudflare Pages → Settings → Environment variables):
 *   GEMINI_API_KEY      — your Google AI Studio API key
 *   SUPABASE_URL        — e.g. https://pupqkuunekeeyfnfjpde.supabase.co
 *   SUPABASE_ANON_KEY   — your Supabase anon/public key
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

export function parseGeminiResponse(text) {
  try {
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const parsed = JSON.parse(stripped);
    if (!Array.isArray(parsed.assignments)) return [];
    return parsed.assignments;
  } catch {
    return [];
  }
}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, { status: 200, headers: CORS });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // ── Auth: verify a valid Supabase session token is present ──
  const authHeader = request.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401);
  }
  const token = authHeader.slice(7);

  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': env.SUPABASE_ANON_KEY,
    },
  });
  if (!userRes.ok) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // ── Parse request body ──
  let docText;
  try {
    ({ docText } = await request.json());
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!docText || typeof docText !== 'string') {
    return json({ error: 'Missing docText' }, 400);
  }

  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) {
    return json({ error: 'GEMINI_API_KEY not configured' }, 500);
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
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 2048,
            temperature: 0.1,
          },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${err}`);
    }

    const data = await res.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
    const assignments = parseGeminiResponse(rawText);
    return json({ assignments });
  } catch (err) {
    console.error('ai-parse error:', err);
    return json({ error: 'AI parsing failed. Please try again.' }, 500);
  }
}
