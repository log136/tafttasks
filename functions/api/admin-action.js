/**
 * Cloudflare Pages Function: /api/admin-action
 *
 * Proxies admin writes to app_settings and schedule_overrides.
 * Verifies the caller's Supabase JWT and checks app_metadata.role === 'admin'.
 *
 * Required environment variables:
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *   SUPABASE_SERVICE_KEY  — service role key for admin writes
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

export async function onRequestOptions() {
  return new Response(null, { status: 200, headers: CORS });
}

/**
 * Verify JWT and check admin role.
 * Returns the user object if admin, or null.
 */
async function verifyAdmin(request, env) {
  const authHeader = request.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);

  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': env.SUPABASE_ANON_KEY,
    },
  });
  if (!userRes.ok) return null;

  const user = await userRes.json();
  if (user?.app_metadata?.role !== 'admin') return null;
  return user;
}

/**
 * Make a request to Supabase REST API using the service role key.
 */
async function supabaseAdmin(env, path, method, body) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'DELETE' ? '' : 'resolution=merge-duplicates,return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const admin = await verifyAdmin(request, env);
  if (!admin) {
    return json({ error: 'Forbidden: admin role required' }, 403);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { action } = payload;

  try {
    // ── app_settings: upsert ──
    if (action === 'upsert_setting') {
      const { key, value } = payload;
      if (!key || typeof key !== 'string') return json({ error: 'Missing key' }, 400);
      await supabaseAdmin(env, 'app_settings', 'POST', { key, value: value ?? '' });
      return json({ ok: true });
    }

    // ── schedule_overrides: upsert ──
    if (action === 'upsert_override') {
      const { date, label, entries } = payload;
      if (!date) return json({ error: 'Missing date' }, 400);
      if (!label) return json({ error: 'Missing label' }, 400);
      if (!Array.isArray(entries) || !entries.length) return json({ error: 'Missing entries' }, 400);
      await supabaseAdmin(env, 'schedule_overrides', 'POST', { date, label, entries });
      return json({ ok: true });
    }

    // ── schedule_overrides: delete ──
    if (action === 'delete_override') {
      const { date } = payload;
      if (!date) return json({ error: 'Missing date' }, 400);
      await supabaseAdmin(env, `schedule_overrides?date=eq.${encodeURIComponent(date)}`, 'DELETE');
      return json({ ok: true });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
}
