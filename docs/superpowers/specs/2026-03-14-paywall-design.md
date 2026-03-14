# Paywall Implementation Design

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan.

**Goal:** Gate access to the Taft Dashboard behind a $0.99/month Stripe subscription, with a 14-day free trial and read-only mode after expiry.

**Architecture:** Stripe Checkout (hosted) for payment, Cloudflare Pages Functions for backend, Supabase `user_settings` for subscription state. No new npm packages — Stripe API called via `fetch`.

**Tech Stack:** Stripe API (REST), Cloudflare Pages Functions, Supabase (existing), vanilla JS (existing `index.html`).

---

## 1. Data Model

Three new columns on the existing `user_settings` table:

| Column | Type | Default | Purpose |
|---|---|---|---|
| `trial_started_at` | `TIMESTAMPTZ` | `NULL` | Set once on first login. Never updated. |
| `stripe_customer_id` | `TEXT` | `NULL` | Stripe Customer ID, set after first successful checkout. Indexed. |
| `paid_until` | `TIMESTAMPTZ` | `NULL` | Set to `now() + 35 days` on each `invoice.paid` event (35 = 30-day cycle + 5-day retry grace). Cleared on cancellation. |

**Manual override (physical cash payments):** In the Supabase dashboard, set `paid_until = '2099-01-01'` for the user's row in `user_settings`. No code change needed.

**Account deletion note:** If a user deletes their Supabase account, their Stripe subscription must be canceled manually in the Stripe dashboard. The webhook will silently no-op on events for a deleted user (lookup by `stripe_customer_id` returns no row). This is an accepted limitation — out of scope for this implementation.

---

## 2. Access Control Logic

A single function `getAccessState()` returns one of three states:

- **`active`** — `paid_until` is in the future, OR trial is still running (`trial_started_at` within the last 14 days). Full access.
- **`read-only`** — Trial has expired AND `paid_until` is null or in the past. Dashboard visible, but write actions disabled.
- **`no-trial`** — `trial_started_at` is null (brand new user). Set it immediately, then treat as `active`.

`afterAuth()` calls `getAccessState()` after loading `user_settings`. If `no-trial`, upsert `trial_started_at = now()` to Supabase, then proceed as `active`.

---

## 3. Read-Only Mode UI

When `getAccessState()` returns `read-only`:

- A **sticky banner** appears at the top of `#app` (above the week panel):
  ```
  Your 14-day trial has ended. Unlock full access for $0.99/month.   [Unlock →]
  ```
- The following buttons get a `disabled` attribute and `cursor: not-allowed` style:
  - "Add assignment" buttons
  - "Edit" (✎) buttons
  - "Delete" (✕) buttons
- Background iCal sync still runs — read-only only blocks UI writes.

A **"Manage subscription"** link (calls `openCustomerPortal()`) is shown in a small footer area inside `#app` whenever `userSettings.stripe_customer_id` is set — regardless of access state. This lets active subscribers cancel, and lets users who previously canceled re-manage their subscription. It is NOT part of the paywall banner.

---

## 4. Stripe Setup (Manual Steps)

Before deployment, in the Stripe dashboard:
1. Create a Product: "Taft Dashboard"
2. Create a Price: $0.99 USD, recurring monthly → copy the `price_XXXX` ID
3. Enable the **Customer Portal** (Stripe dashboard → Settings → Billing → Customer portal)
4. Register webhook endpoint: `https://tafttasks.pages.dev/api/stripe-webhook`
   - Events to listen for: `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`, `invoice.payment_failed`
5. Copy the webhook signing secret → `STRIPE_WEBHOOK_SECRET`

---

## 5. Cloudflare Functions

All three functions use the Cloudflare Pages Functions export format. Each must export both `onRequestPost` and `onRequestOptions` (for CORS preflight) — same pattern as the existing `ai-parse.js`.

**Stripe API body encoding:** All POST calls to `https://api.stripe.com/v1/...` must use `Content-Type: application/x-www-form-urlencoded` with a URL-encoded body. Stripe's REST API does not accept JSON. Use `new URLSearchParams({ key: value }).toString()` to build the body.

### `functions/api/create-checkout.js`

- **Method:** POST
- **Auth:** Requires `Authorization: Bearer <token>` header. Validate via `fetch(SUPABASE_URL/auth/v1/user)` with `Authorization: Bearer <token>` and `apikey: SUPABASE_ANON_KEY` headers — same pattern as `ai-parse.js`. On success, response JSON contains `id` (user ID) and `email`.
- **Supabase data read:** To fetch `stripe_customer_id` from `user_settings`, call the Supabase REST API with the **user's Bearer token** as the `Authorization` header (not the anon key). This satisfies RLS (users can only read their own row). Alternatively, use the service role key which bypasses RLS — either approach works.
- **Logic:**
  1. Validate JWT → get `user.id`, `user.email`
  2. Fetch `user_settings` row to check if `stripe_customer_id` already exists
  3. Build Stripe Checkout Session params:
     - `mode=subscription`
     - `line_items[0][price]=STRIPE_PRICE_ID`, `line_items[0][quantity]=1`
     - `subscription_data[trial_period_days]=14` (Stripe enforces the trial; first `invoice.paid` fires after 14 days, not immediately)
     - `client_reference_id=user.id` (used by webhook to identify the user)
     - If `stripe_customer_id` exists: pass `customer=stripe_customer_id` (reuses Stripe customer on re-subscribe)
     - If no `stripe_customer_id`: pass `customer_email=user.email` (pre-fills Stripe form)
     - `success_url=https://tafttasks.pages.dev/?payment=success`
     - `cancel_url=https://tafttasks.pages.dev/?payment=canceled`
  4. POST to `https://api.stripe.com/v1/checkout/sessions` with `Authorization: Bearer STRIPE_SECRET_KEY` and `Content-Type: application/x-www-form-urlencoded`
  5. Return `{ url: session.url }`
- **Env vars:** `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

### `functions/api/stripe-webhook.js`

- **Method:** POST
- **Auth:** Stripe signature verification. **Critical implementation note:** Read the request body as raw text first with `await request.text()`, store it as a string, then `JSON.parse()` it. Do NOT call `request.json()` before verification — the body stream can only be read once and will be empty for the HMAC check.
- **Signature verification:** Use the Web Crypto API (`crypto.subtle`) to compute HMAC-SHA256 of the raw body using `STRIPE_WEBHOOK_SECRET`. Compare against the `t` timestamp and `v1` signature in the `Stripe-Signature` header. Reject requests that fail verification with a 400. (Cloudflare Workers have `crypto.subtle` globally; do not use Node's `crypto` module.)
- **Supabase writes:** Use `SUPABASE_SERVICE_ROLE_KEY` as the `apikey` header (bypasses RLS — required since webhook runs without a user session).

**Events handled:**

`checkout.session.completed` (only when `event.data.object.mode === 'subscription'`):
  1. Extract `client_reference_id` (= Supabase `user_id`) and `customer` (= Stripe customer ID) from the event
  2. Upsert `user_settings`: set `stripe_customer_id = customer` and `paid_until = now() + 35 days`
  3. Setting `paid_until` here is an optimistic write that prevents a read-only flash if `invoice.paid` arrives slightly later (race condition avoidance). Note: with `trial_period_days=14`, the first real `invoice.paid` fires 14 days later — but `checkout.session.completed` fires immediately at checkout. The optimistic `paid_until = now() + 35 days` written here is fine; `invoice.paid` will refresh it to `now() + 35 days` again after 14 days, which is correct.

`invoice.paid`:
  1. Extract `customer` (Stripe customer ID) from `event.data.object`
  2. Look up `user_settings` row WHERE `stripe_customer_id = customer`
  3. If found: update `paid_until = now() + 35 days` (idempotent — may already be set by `checkout.session.completed`)
  4. If not found: no-op (user deleted their account — accepted limitation)

`customer.subscription.deleted`:
  1. Extract `customer` from `event.data.object`
  2. Look up `user_settings` WHERE `stripe_customer_id = customer`
  3. If found: set `paid_until = null`

`invoice.payment_failed`:
  - No action. Let `paid_until` expire naturally on its own schedule.

- **Env vars:** `STRIPE_WEBHOOK_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

### `functions/api/customer-portal.js`

- **Method:** POST
- **Auth:** Requires JWT (same validation pattern as `create-checkout.js`)
- **Supabase read:** Use the user's Bearer token or service role key to fetch `stripe_customer_id` from `user_settings`
- **Logic:**
  1. Validate JWT → get `user.id`
  2. Fetch `stripe_customer_id` from `user_settings`
  3. If null: return 400 `{ error: 'No subscription found' }`
  4. POST to `https://api.stripe.com/v1/billing_portal/sessions` with `customer=stripe_customer_id` and `return_url=https://tafttasks.pages.dev/`
  5. Return `{ url: session.url }`
- **Env vars:** `STRIPE_SECRET_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

---

## 6. Frontend Changes (`index.html`)

### New global
```js
let userSettings = {};  // populated in afterAuth(); holds trial_started_at, paid_until, stripe_customer_id
```

### `getAccessState()`
```js
function getAccessState() {
  if (!userSettings.trial_started_at) return 'no-trial';
  if (userSettings.paid_until && new Date(userSettings.paid_until) > new Date()) return 'active';
  const trialEnd = new Date(new Date(userSettings.trial_started_at).getTime() + 14 * 24 * 60 * 60 * 1000);
  if (new Date() < trialEnd) return 'active';
  return 'read-only';
}
```

### `afterAuth()` changes
- Load `user_settings` and store in `userSettings` global
- Call `getAccessState()`
- If `no-trial`: upsert `{ trial_started_at: new Date().toISOString() }`, update `userSettings.trial_started_at`
- Check `window.location.search` for `?payment=success` → show toast "Payment successful! Full access unlocked." and call `history.replaceState` to strip the query param, then reload `user_settings`
- Check for `?payment=canceled` → show toast "Payment canceled." and strip query param

### `renderAll()` changes
- If `getAccessState() === 'read-only'`, prepend the paywall banner HTML to `main.innerHTML`
- Pass `isReadOnly` boolean into `renderCourse()` and down to `renderItem()` to disable edit/delete buttons
- If `userSettings.stripe_customer_id` is set, render a small "Manage subscription" link in a footer area inside `#app`

### `startCheckout()`
```js
async function startCheckout() {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch('/api/create-checkout', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const { url, error } = await res.json();
  if (error) { alert('Could not start checkout: ' + error); return; }
  window.location.href = url;
}
```

### `openCustomerPortal()`
Same structure as `startCheckout()` but calls `/api/customer-portal`.

---

## 7. New Environment Variables

Set in Cloudflare Pages → Settings → Environment Variables:

| Variable | Description |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_live_...`) |
| `STRIPE_PRICE_ID` | Stripe Price ID for the $0.99/month plan (`price_...`) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret from Stripe dashboard (`whsec_...`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (bypasses RLS — used by webhook and optionally by other functions for Supabase reads) |

---

## 8. Supabase SQL

```sql
ALTER TABLE user_settings
  ADD COLUMN trial_started_at TIMESTAMPTZ,
  ADD COLUMN stripe_customer_id TEXT,
  ADD COLUMN paid_until TIMESTAMPTZ;

CREATE INDEX ON user_settings (stripe_customer_id);
```

No new RLS policies needed — existing `user_settings` RLS covers `trial_started_at` and `paid_until`. The webhook uses the service role key which bypasses RLS entirely.

---

## 9. What Does NOT Change

- Login/auth flow
- Extension popup (paywall is web-only; extension sync still works)
- Background iCal sync
- All existing Cloudflare Functions
- Existing Supabase RLS policies
