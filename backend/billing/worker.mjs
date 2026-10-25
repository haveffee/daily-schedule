import { tokenVerifier } from '../reminders/worker.mjs';

export const PLANS = Object.freeze([
  Object.freeze({ id: 'monthly', title: 'HVF Plus · месяц', amount: 800, currency: 'BYN', interval: 'month' }),
  Object.freeze({ id: 'yearly', title: 'HVF Plus · год', amount: 7200, currency: 'BYN', interval: 'year' })
]);
export const DISABLED_MESSAGE = 'Оплата ещё не подключена. Сейчас HVF работает в бесплатном бета-режиме.';
const API = 'https://api.bepaid.by', DAY = 86400000, encoder = new TextEncoder();
const OPEN = ['creating', 'pending', 'active'];
class BillingError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function fail(status, code, message) { throw new BillingError(status, code, message); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function identifier(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,180}$/.test(value); }
function configuredText(value) { return typeof value === 'string' && value.length > 0 && value.length <= 12000 && !/[\u0000-\u001f\u007f]/.test(value); }
function appUrl(env) {
  try {
    const url = new URL(env.APP_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch { return null; }
}
export function paymentsReady(env = {}) {
  return env.BILLING_MODE === 'live' && env.BILLING_MERCHANT_APPROVED === 'true' &&
    /^\d{1,20}$/.test(env.BEPAID_SHOP_ID || '') && configuredText(env.BEPAID_SECRET_KEY) &&
    identifier(env.BEPAID_MONTHLY_PLAN_ID) && identifier(env.BEPAID_YEARLY_PLAN_ID) &&
    env.BEPAID_MONTHLY_PLAN_ID !== env.BEPAID_YEARLY_PLAN_ID &&
    typeof env.BEPAID_WEBHOOK_PUBLIC_KEY === 'string' && env.BEPAID_WEBHOOK_PUBLIC_KEY.includes('BEGIN PUBLIC KEY') &&
    !!env.BILLING_DB?.prepare && !!appUrl(env);
}
function catalog(env) {
  const ready = paymentsReady(env);
  return { mode: ready ? 'live' : 'disabled', paymentsReady: ready, currency: 'BYN', plans: PLANS, message: ready ? 'Подписка продлевается автоматически. Её можно отменить в любой момент.' : DISABLED_MESSAGE };
}
function response(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
async function bytes(request, maximum) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) fail(415, 'json_required', 'Нужен JSON.');
  if (Number(request.headers.get('Content-Length')) > maximum) fail(413, 'body_too_large', 'Слишком большой запрос.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'invalid_json', 'Пустой запрос.');
  const chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > maximum) { await reader.cancel(); fail(413, 'body_too_large', 'Слишком большой запрос.'); }
    chunks.push(value);
  }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}
function json(raw) {
  try { const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); if (object(value)) return value; } catch { /* fail below */ }
  fail(400, 'invalid_json', 'Некорректный JSON.');
}
function checkoutUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://checkout.bepaid.by' && !url.username && !url.password && url.pathname.startsWith('/v2/') ? url.href : null;
  } catch { return null; }
}
function time(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  return Date.parse(value);
}
function planId(env, id) { return id === 'monthly' ? env.BEPAID_MONTHLY_PLAN_ID : env.BEPAID_YEARLY_PLAN_ID; }
function validatePlan(value, expected, providerId) {
  if (!object(value) || value.id !== providerId || value.currency !== 'BYN' || value.test !== false ||
    value.plan?.amount !== expected.amount || value.plan?.interval_unit !== 'month' ||
    value.plan?.interval !== (expected.id === 'monthly' ? 1 : 12) ||
    (value.amount !== undefined && value.amount !== expected.amount) ||
    (value.trial?.interval != null && value.trial.interval !== 0)) {
    fail(502, 'provider_mismatch', 'Платёжный план не соответствует выбранному тарифу. Оплата остановлена.');
  }
}
function canonical(value, order, now) {
  const expected = PLANS.find(p => p.id === order.plan_id);
  if (!object(value) || !identifier(value.id) || value.id !== order.provider_id || value.tracking_id !== order.id || value.test === true) fail(502, 'provider_mismatch', 'Не удалось подтвердить данные подписки.');
  validatePlan(value.plan, expected, order.provider_plan_id);
  const until = time(value.active_to), renewal = time(value.renew_at);
  const maximum = now + (order.plan_id === 'monthly' ? 45 : 400) * DAY;
  if (!Number.isFinite(until) || !Number.isFinite(renewal) || until < 0 || renewal < 0 || until > maximum || renewal > maximum) fail(502, 'invalid_period', 'Не удалось подтвердить срок подписки.');
  const paid = value.state === 'active' && value.last_transaction?.status === 'successful' && Number.isInteger(value.paid_billing_cycles) && value.paid_billing_cycles > 0 && until > 0;
  // Only an authoritative successful live payment may extend access. Canceling
  // or a failed renewal retains only the already verified paid period.
  const paidUntil = paid ? Math.max(order.paid_until, until) : order.paid_until;
  const canceled = value.state === 'canceled' || order.canceled === 1;
  const terminal = ['failed', 'error', 'expired'].includes(value.state);
  const state = canceled ? 'canceled' : terminal ? 'failed' : paid || order.paid_until > now ? 'active' : 'pending';
  return { state, providerState: String(value.state || '').slice(0, 50), paidUntil, renewAt: canceled || terminal ? 0 : renewal, canceled: canceled ? 1 : 0 };
}
function status(env, orders, now) {
  const ready = paymentsReady(env);
  const base = { mode: ready ? 'live' : 'disabled', paymentsReady: ready, plan: 'free', status: ready ? 'free' : 'beta', periodEnd: null, renewAt: null, billingPlan: null, cancelAtPeriodEnd: false };
  if (!ready) return base;
  const paid = orders.filter(order => order.paid_until > now).sort((a, b) => b.paid_until - a.paid_until)[0];
  const order = paid || orders.find(row => OPEN.includes(row.state)) || orders[0];
  if (!order) return base;
  return { ...base, plan: paid ? 'plus' : 'free', status: paid ? order.canceled ? 'canceled' : 'active' : order.paid_until ? 'expired' : OPEN.includes(order.state) ? 'pending' : 'free',
    periodEnd: order.paid_until ? new Date(order.paid_until).toISOString() : null,
    renewAt: order.renew_at ? new Date(order.renew_at).toISOString() : null,
    billingPlan: order.plan_id, cancelAtPeriodEnd: !!paid && order.canceled === 1 };
}
async function digest(raw) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', raw))].map(n => n.toString(16).padStart(2, '0')).join(''); }
async function equal(a, b) {
  const [left, right] = await Promise.all([digest(encoder.encode(a)), digest(encoder.encode(b))]);
  let mismatch = 0; for (let i = 0; i < left.length; i++) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}
async function verifyWebhook(request, raw, env) {
  const basic = 'Basic ' + btoa(env.BEPAID_SHOP_ID + ':' + env.BEPAID_SECRET_KEY);
  if (!await equal(request.headers.get('Authorization') || '', basic)) fail(401, 'unauthorized_webhook', 'Не удалось проверить отправителя.');
  try {
    const encoded = env.BEPAID_WEBHOOK_PUBLIC_KEY.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, '');
    const keyBytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const signature = request.headers.get('Content-Signature') || '';
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signature) || signature.length > 1500) throw new Error('signature');
    const key = await crypto.subtle.importKey('spki', keyBytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const signatureBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
    if (await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signatureBytes, raw)) return;
  } catch { /* Do not expose key or parsing details. */ }
  fail(401, 'invalid_signature', 'Не удалось проверить подпись уведомления.');
}

export function createBilling({ verifyToken, fetcher = globalThis.fetch.bind(globalThis), now = Date.now, uuid = () => crypto.randomUUID() } = {}) {
  const verify = verifyToken || tokenVerifier(fetcher);
  async function provider(env, path, method = 'GET', body) {
    let result;
    try {
      result = await fetcher(API + path, { method, redirect: 'manual', signal: AbortSignal.timeout(12000), headers: {
        Authorization: 'Basic ' + btoa(env.BEPAID_SHOP_ID + ':' + env.BEPAID_SECRET_KEY), Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { fail(502, 'provider_unavailable', 'Платёжный сервис временно недоступен. Подписка не подтверждена.'); }
    if (!result.ok || !/^application\/json(?:\s*;|$)/i.test(result.headers.get('Content-Type') || '')) fail(502, 'provider_unavailable', 'Не удалось подтвердить ответ платёжного сервиса.');
    return json(await bytes(result, 65536));
  }
  async function orders(env, uid) { return (await env.BILLING_DB.prepare('SELECT * FROM billing_orders WHERE uid = ? ORDER BY created_at DESC LIMIT 50').bind(uid).all()).results; }
  async function update(env, order, snapshot, timestamp, eventId) {
    const next = canonical(snapshot, order, timestamp);
    // Optimistic version prevents overlapping stale provider reads from
    // resurrecting an order after cancellation or overwriting a later update.
    const statements = [env.BILLING_DB.prepare('UPDATE billing_orders SET state = ?, provider_state = ?, paid_until = ?, renew_at = ?, canceled = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?').bind(next.state, next.providerState, next.paidUntil, next.renewAt, next.canceled, timestamp, order.id, order.version)];
    const changed = await statements[0].run();
    if (changed.meta.changes !== 1) fail(409, 'retry_update', 'Подписка обновляется. Повтори проверку.');
    if (eventId) await env.BILLING_DB.prepare('INSERT OR IGNORE INTO billing_events (id, order_id, provider_id, received_at) VALUES (?, ?, ?, ?)').bind(eventId, order.id, order.provider_id, timestamp).run();
    return { ...order, state: next.state, provider_state: next.providerState, paid_until: next.paidUntil, renew_at: next.renewAt, canceled: next.canceled, updated_at: timestamp, version: order.version + 1 };
  }
  async function handle(request, env = {}) {
    const url = new URL(request.url), path = url.pathname, method = request.method;
    const known = new Map([['/api/billing/catalog', 'GET'], ['/api/billing/status', 'GET'], ['/api/billing/checkout', 'POST'], ['/api/billing/cancel', 'POST'], ['/api/billing/webhook', 'POST']]);
    if (!known.has(path)) fail(404, 'not_found', 'Страница не найдена.');
    if (known.get(path) !== method) fail(405, 'method_not_allowed', 'Метод не поддерживается.');
    if (path.endsWith('/catalog')) return response(catalog(env));
    if (path.endsWith('/webhook')) {
      if (!paymentsReady(env)) fail(503, 'payments_not_ready', DISABLED_MESSAGE);
      const raw = await bytes(request, 65536);
      await verifyWebhook(request, raw, env);
      const payload = json(raw), eventId = await digest(raw), timestamp = now();
      if (!identifier(payload.id) || !identifier(payload.tracking_id)) fail(400, 'invalid_event', 'Некорректное уведомление.');
      if (await env.BILLING_DB.prepare('SELECT id FROM billing_events WHERE id = ?').bind(eventId).first()) return response({ received: true, duplicate: true });
      let order = await env.BILLING_DB.prepare('SELECT * FROM billing_orders WHERE id = ?').bind(payload.tracking_id).first();
      if (!order || (order.provider_id && order.provider_id !== payload.id)) fail(404, 'unknown_subscription', 'Подписка не найдена.');
      if (!order.provider_id) {
        // A provider callback can arrive before checkout creation finishes.
        // Re-read the canonical provider object before binding its identifier.
        const initial = await provider(env, '/subscriptions/' + encodeURIComponent(payload.id));
        if (initial.tracking_id !== order.id || initial.id !== payload.id) fail(502, 'provider_mismatch', 'Не удалось подтвердить данные подписки.');
        canonical(initial, { ...order, provider_id: payload.id }, timestamp);
        await env.BILLING_DB.prepare('UPDATE billing_orders SET provider_id = ? WHERE id = ? AND provider_id IS NULL').bind(payload.id, order.id).run();
        order = await env.BILLING_DB.prepare('SELECT * FROM billing_orders WHERE id = ?').bind(order.id).first();
      }
      await update(env, order, await provider(env, '/subscriptions/' + encodeURIComponent(order.provider_id)), timestamp, eventId);
      return response({ received: true });
    }
    const origin = request.headers.get('Origin');
    if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') fail(403, 'origin_not_allowed', 'Открой подписку из приложения HVF.');
    const match = /^Bearer ([^\s]+)$/.exec(request.headers.get('Authorization') || '');
    if (!match) fail(401, 'unauthorized', 'Войди в аккаунт, чтобы управлять подпиской.');
    let uid;
    try { uid = await verify(match[1], now()); } catch { fail(401, 'unauthorized', 'Войди в аккаунт, чтобы управлять подпиской.'); }
    if (typeof uid !== 'string' || !uid || uid.length > 128 || /[\u0000-\u001f]/.test(uid)) fail(401, 'unauthorized', 'Войди в аккаунт.');
    const ready = paymentsReady(env), timestamp = now();
    if (path.endsWith('/status')) return response(status(env, ready ? await orders(env, uid) : [], timestamp));
    if (!ready) fail(503, 'payments_not_ready', DISABLED_MESSAGE);
    if (appUrl(env).origin !== url.origin) fail(503, 'invalid_app_url', 'Адрес оплаты ещё не настроен.');
    const body = json(await bytes(request, 4096));
    if (path.endsWith('/checkout')) {
      if (Object.keys(body).length !== 1 || !PLANS.some(p => p.id === body.plan)) fail(400, 'invalid_plan', 'Выбери месяц или год подписки.');
      const history = await orders(env, uid);
      if (history.some(order => order.paid_until > timestamp)) fail(409, 'subscription_active', 'Подписка уже оплачена. Новый платёж сейчас не нужен.');
      const existing = history.find(order => OPEN.includes(order.state));
      if (existing) {
        if (existing.state === 'pending' && existing.plan_id === body.plan && checkoutUrl(existing.checkout_url)) return response({ checkoutUrl: existing.checkout_url, orderId: existing.id }, 200);
        fail(409, 'checkout_pending', 'Предыдущая подписка ещё обрабатывается. Проверь её состояние или отмени перед новой оплатой.');
      }
      const selected = PLANS.find(p => p.id === body.plan), providerPlanId = planId(env, selected.id);
      const providerPlan = await provider(env, '/plans/' + encodeURIComponent(providerPlanId));
      validatePlan(providerPlan, selected, providerPlanId);
      const orderId = uuid();
      if (!identifier(orderId)) fail(500, 'invalid_order', 'Не удалось подготовить оплату.');
      try {
        await env.BILLING_DB.prepare("INSERT INTO billing_orders (id, uid, plan_id, amount, currency, provider_plan_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, 'BYN', ?, 'creating', ?, ?)").bind(orderId, uid, selected.id, selected.amount, providerPlanId, timestamp, timestamp).run();
      } catch { fail(409, 'checkout_pending', 'Предыдущая подписка ещё обрабатывается.'); }
      // Never retry an ambiguous subscription-creation request automatically:
      // bePaid only documents RequestID idempotency for transaction endpoints.
      const returnUrl = new URL(appUrl(env)); returnUrl.hash = 'plans';
      const created = await provider(env, '/subscriptions', 'POST', { plan: { id: providerPlanId }, tracking_id: orderId, return_url: returnUrl.href, notification_url: url.origin + '/api/billing/webhook', settings: { language: 'ru' } });
      const target = checkoutUrl(created.redirect_url);
      if (!identifier(created.id) || created.tracking_id !== orderId || !target) fail(502, 'provider_mismatch', 'Не удалось подготовить безопасную страницу оплаты.');
      await env.BILLING_DB.prepare("UPDATE billing_orders SET provider_id = COALESCE(provider_id, ?), checkout_url = ?, state = CASE WHEN state = 'creating' THEN 'pending' ELSE state END, updated_at = ?, version = version + 1 WHERE id = ? AND (provider_id IS NULL OR provider_id = ?)").bind(created.id, target, timestamp, orderId, created.id).run();
      return response({ checkoutUrl: target, orderId }, 201);
    }
    if (Object.keys(body).length) fail(400, 'invalid_request', 'Некорректный запрос отмены.');
    const history = await orders(env, uid), order = history.find(row => OPEN.includes(row.state)) || history.find(row => row.canceled && row.provider_id);
    if (!order?.provider_id) fail(409, 'no_subscription', 'Нет подключённой подписки.');
    if (order.canceled) return response({ canceled: true, periodEnd: order.paid_until ? new Date(order.paid_until).toISOString() : null });
    const canceled = await provider(env, '/subscriptions/' + encodeURIComponent(order.provider_id) + '/cancel', 'POST', { cancel_reason: 'Customer request in HVF' });
    if (canceled.id !== order.provider_id || canceled.tracking_id !== order.id || canceled.state !== 'canceled') fail(502, 'cancellation_unconfirmed', 'Отмена пока не подтверждена платёжным сервисом.');
    // A fresh authenticated GET also checks tariff, test flag and ownership.
    const latest = await provider(env, '/subscriptions/' + encodeURIComponent(order.provider_id));
    if (latest.state !== 'canceled') fail(502, 'cancellation_unconfirmed', 'Отмена пока не подтверждена платёжным сервисом.');
    const updated = await update(env, order, latest, timestamp);
    return response({ canceled: true, periodEnd: updated.paid_until ? new Date(updated.paid_until).toISOString() : null });
  }
  return { async fetch(request, env) {
    try { return await handle(request, env); }
    catch (error) {
      const expected = error instanceof BillingError;
      return response({ error: { code: expected ? error.code : 'billing_unavailable', message: expected ? error.message : 'Не удалось проверить подписку. Попробуй позже.' } }, expected ? error.status : 503);
    }
  } };
}

export default createBilling();
