/**
 * Cloudflare Pages Function: /api/create-checkout
 *
 * Creates a Stripe Checkout Session for the $0.99/month subscription.
 * Returns { url } to redirect the user to Stripe's hosted payment page.
 *
 * Required environment variables:
 *   STRIPE_SECRET_KEY    — Stripe secret key (sk_live_... or sk_test_...)
 *   STRIPE_PRICE_ID      — Stripe Price ID for the $0.99/month plan (price_...)
 *   SUPABASE_URL         — e.g. https://pupqkuunekeeyfnfjpde.supabase.co
 *   SUPABASE_ANON_KEY    — Supabase anon/public key
 *   SUPABASE_SERVICE_ROLE_KEY — Supabase service role key (for reading user_settings)
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

  // ── Auth: validate Supabase JWT ──
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

  // ── Validate required env vars ──
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'Server configuration incomplete' }, 500);
  }

  // ── Check for existing Stripe customer ID ──
  const settingsRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${user.id}&select=stripe_customer_id`,
    {
      headers: {
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
      },
    }
  );
  let settings = [];
  if (settingsRes.ok) {
    settings = await settingsRes.json();
  } else {
    console.error('Failed to fetch user settings:', settingsRes.status);
  }
  const existingCustomerId = settings[0]?.stripe_customer_id;

  // ── Build Stripe Checkout Session ──
  const params = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': env.STRIPE_PRICE_ID,
    'line_items[0][quantity]': '1',
    'subscription_data[trial_period_days]': '14',
    client_reference_id: user.id,
    success_url: 'https://tafttasks.pages.dev/?payment=success',
    cancel_url: 'https://tafttasks.pages.dev/?payment=canceled',
  });

  if (existingCustomerId) {
    params.set('customer', existingCustomerId);
  } else {
    params.set('customer_email', user.email);
  }

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!stripeRes.ok) {
    const err = await stripeRes.text();
    console.error('Stripe create-checkout error:', err);
    return json({ error: 'Failed to create checkout session' }, 500);
  }

  const session = await stripeRes.json();
  return json({ url: session.url });
}
