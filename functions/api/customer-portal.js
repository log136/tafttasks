/**
 * Cloudflare Pages Function: /api/customer-portal
 *
 * Creates a Stripe Billing Portal session for subscription management.
 * Returns { url } to redirect the user.
 *
 * Required environment variables:
 *   STRIPE_SECRET_KEY         — Stripe secret key
 *   SUPABASE_URL              — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY — Supabase service role key
 *   SUPABASE_ANON_KEY         — Supabase anon key (for JWT validation)
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

export async function onRequestPost(context) {
  const { request, env } = context;

  // ── Auth ──
  const authHeader = request.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = authHeader.slice(7);

  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': env.SUPABASE_ANON_KEY,
    },
  });
  if (!userRes.ok) return json({ error: 'Unauthorized' }, 401);
  const user = await userRes.json();

  // ── Fetch stripe_customer_id ──
  const settingsRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${user.id}&select=stripe_customer_id`,
    {
      headers: {
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
      },
    }
  );
  const settings = settingsRes.ok ? await settingsRes.json() : [];
  const stripeCustomerId = settings[0]?.stripe_customer_id;

  if (!stripeCustomerId) {
    return json({ error: 'No subscription found' }, 400);
  }

  // ── Create Stripe Billing Portal session ──
  const portalRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      customer: stripeCustomerId,
      return_url: 'https://tafttasks.pages.dev/',
    }).toString(),
  });

  if (!portalRes.ok) {
    const err = await portalRes.text();
    console.error('Stripe portal error:', err);
    return json({ error: 'Failed to open subscription portal' }, 500);
  }

  const portal = await portalRes.json();
  return json({ url: portal.url });
}
