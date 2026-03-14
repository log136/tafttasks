/**
 * Cloudflare Pages Function: /api/stripe-webhook
 *
 * Handles Stripe webhook events:
 *   - checkout.session.completed  → store stripe_customer_id + optimistic paid_until
 *   - invoice.paid                → extend paid_until by 35 days
 *   - customer.subscription.deleted → clear paid_until
 *   - invoice.payment_failed      → no-op (let paid_until expire naturally)
 *
 * Required environment variables:
 *   STRIPE_WEBHOOK_SECRET     — webhook signing secret (whsec_...)
 *   SUPABASE_URL              — e.g. https://pupqkuunekeeyfnfjpde.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY — Supabase service role key (bypasses RLS)
 */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Decode a hex string to Uint8Array (needed for timing-safe HMAC verify).
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

// Verify Stripe webhook signature using Web Crypto API (HMAC-SHA256).
// Uses crypto.subtle.verify for timing-safe comparison — do NOT use string equality (timing leak).
// Stripe-Signature header format: t=<timestamp>,v1=<hex_signature>[,...]
async function verifyStripeSignature(rawBody, sigHeader, secret) {
  const parts = Object.fromEntries(
    sigHeader.split(',').map(p => p.split('=', 2))
  );
  const timestamp = parts['t'];
  const v1 = parts['v1'];
  if (!timestamp || !v1) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const keyData = new TextEncoder().encode(secret);
  const key = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );
  return await crypto.subtle.verify(
    'HMAC', key, hexToBytes(v1), new TextEncoder().encode(signedPayload)
  );
}

// Compute paid_until = now + 35 days (30-day cycle + 5-day retry grace)
function paidUntilDate() {
  return new Date(Date.now() + 35 * 24 * 60 * 60 * 1000).toISOString();
}

// Look up user_settings by stripe_customer_id. Returns user_id or null.
async function findUserByCustomer(customerId, env) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_settings?stripe_customer_id=eq.${customerId}&select=user_id`,
    {
      headers: {
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
      },
    }
  );
  const rows = res.ok ? await res.json() : [];
  return rows[0]?.user_id ?? null;
}

// Update paid_until for a user (by user_id).
// Throws on failure so the outer try/catch returns 500 → Stripe retries.
async function setPaidUntil(userId, value, env) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ paid_until: value }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`setPaidUntil failed (${res.status}): ${text}`);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 200 });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // ── CRITICAL: read raw body BEFORE any JSON parsing ──
  const rawBody = await request.text();
  const sigHeader = request.headers.get('Stripe-Signature') ?? '';

  const valid = await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    console.error('Stripe webhook signature verification failed');
    return json({ error: 'Invalid signature' }, 400);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const obj = event.data?.object;

  try {
    if (event.type === 'checkout.session.completed' && obj.mode === 'subscription') {
      // Upsert stripe_customer_id + optimistic paid_until
      // client_reference_id = Supabase user_id (set in create-checkout.js)
      const userId = obj.client_reference_id;
      const customerId = obj.customer;
      if (!userId || !customerId) return json({ received: true });

      await fetch(`${env.SUPABASE_URL}/rest/v1/user_settings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify({
          user_id: userId,
          stripe_customer_id: customerId,
          paid_until: paidUntilDate(),
        }),
      });

    } else if (event.type === 'invoice.paid') {
      const customerId = obj.customer;
      const userId = await findUserByCustomer(customerId, env);
      if (userId) await setPaidUntil(userId, paidUntilDate(), env);

    } else if (event.type === 'customer.subscription.deleted') {
      const customerId = obj.customer;
      const userId = await findUserByCustomer(customerId, env);
      if (userId) await setPaidUntil(userId, null, env);

    }
    // invoice.payment_failed: no-op — let paid_until expire naturally
  } catch (err) {
    console.error('Webhook handler error:', err);
    return json({ error: 'Internal error' }, 500);
  }

  return json({ received: true });
}
