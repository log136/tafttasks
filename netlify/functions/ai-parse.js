// Receives plain text from a Google Doc, calls Claude Haiku to extract
// a structured list of assignments, returns JSON.
// Requires ANTHROPIC_API_KEY env var set in Netlify dashboard.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function parseClaudeResponse(text) {
  try {
    const parsed = JSON.parse(text);
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

  const prompt = `You are extracting assignments from a class handout. Return ONLY valid JSON with this exact shape:
{"assignments":[{"name":"<assignment name>","type":"<reading|homework|quiz|project|classwork>","due":"<YYYY-MM-DD or null>"}]}

Rules:
- Include every distinct assignment, reading, or task mentioned.
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

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignments }),
    };
  } catch (err) {
    console.error('ai-parse error:', err);
    return { statusCode: 500, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'AI parsing failed. Please try again.' }) };
  }
};
