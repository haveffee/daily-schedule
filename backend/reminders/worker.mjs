import planner from '../../assistant-planner.js';

export const APP_ORIGIN = 'https://haveffee.github.io';
export const APP_URL = APP_ORIGIN + '/daily-schedule/';
export const FIREBASE_PROJECT = 'daily-schedule-sync-fc374';
export const GOOGLE_JWKS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
export const LIMITS = Object.freeze({ body: 131072, records: 1000, devices: 5, accounts: 20, occurrences: 200, jobs: 1000, claim: 4 });
const LEADS = new Set([0, 5, 10, 15, 30, 60, 1440]);
const MINUTE = 60000, DAY = 86400000, GRACE = 10 * MINUTE;
const encoder = new TextEncoder();

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function fail(status, code, message) { throw new ApiError(status, code, message); }
function plain(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function text(value, name, maximum = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) fail(400, 'invalid_record', 'Некорректное поле ' + name + '.');
  return value.trim();
}
function civil(value, name) {
  if (!planner.validDate(value) || value < '1900-01-01' || value > '2200-12-31') fail(400, 'invalid_record', 'Некорректная дата ' + name + '.');
  return value;
}
function base64Bytes(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
}
export function minskDate(now) { return new Date(now + 3 * 60 * MINUTE).toISOString().slice(0, 10); }
function jobTime(date, time) { return Date.parse(date + 'T' + time + ':00+03:00'); }
function stamp(value) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Only scheduling fields cross this boundary. Never retain finance or AI data. */
export function validateRecords(input) {
  if (!Array.isArray(input) || input.length > LIMITS.records) fail(400, 'invalid_plan', 'План должен содержать не более ' + LIMITS.records + ' записей.');
  const ids = new Set();
  return input.map(record => {
    if (!plain(record) || !['task', 'routine', 'routine-skip'].includes(record.kind)) fail(400, 'invalid_record', 'В плане допускаются только дела, повторы и пропуски.');
    const id = text(record.id, 'id', 180);
    if (ids.has(id)) fail(400, 'invalid_record', 'Повторяющийся id в плане.');
    ids.add(id);
    const clean = { id, kind: record.kind };
    if (record.deleted) fail(400, 'invalid_record', 'Удалённые записи не включаются в снимок.');
    if (record.kind === 'routine-skip') {
      clean.routineId = text(record.routineId, 'routineId', 180);
      clean.occurrenceDate = civil(record.occurrenceDate || record.date, 'occurrenceDate');
      clean.date = clean.occurrenceDate;
      return clean;
    }
    clean.title = text(record.title, 'title');
    clean.time = record.time == null ? '' : record.time;
    if (typeof clean.time !== 'string' || (clean.time !== '' && !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(clean.time))) fail(400, 'invalid_record', 'Время должно быть в формате ЧЧ:ММ.');
    const lead = record.reminderMinutes;
    clean.reminderMinutes = lead === undefined || lead === null || lead === 'off' ? null : lead;
    if (clean.reminderMinutes !== null && !LEADS.has(clean.reminderMinutes)) fail(400, 'invalid_record', 'Неподдерживаемое время напоминания.');
    if (clean.reminderMinutes !== null && !clean.time) fail(400, 'fixed_time_required', 'Для напоминания укажи точное время дела.');
    // Missing lead on a legacy materialized occurrence inherits its series. An
    // explicit null is an individual opt-out and must not inherit later.
    if (lead === undefined) delete clean.reminderMinutes;
    if (record.kind === 'task') {
      clean.date = civil(record.date, 'date');
      clean.done = record.done === true;
      if (record.routineId) {
        clean.routineId = text(record.routineId, 'routineId', 180);
        clean.occurrenceDate = civil(record.occurrenceDate, 'occurrenceDate');
      }
      clean.lastMovedAt = stamp(record.lastMovedAt);
      clean.updatedAt = stamp(record.updatedAt);
    } else {
      clean.startDate = civil(record.startDate, 'startDate');
      clean.untilDate = record.untilDate ? civil(record.untilDate, 'untilDate') : '';
      clean.weekdays = Array.isArray(record.weekdays) ? [...new Set(record.weekdays)] : [];
      clean.active = record.active !== false;
      if (!planner.validateRoutine(clean).valid) fail(400, 'invalid_record', 'Некорректное повторяющееся дело.');
    }
    return clean;
  });
}

export function trustedEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && (!url.port || url.port === '443') && !url.username && !url.password && !url.hash && url.pathname !== '/' &&
      (host === 'fcm.googleapis.com' || host.endsWith('.push.apple.com') || host === 'updates.push.services.mozilla.com' || host.endsWith('.notify.windows.com'));
  } catch { return false; }
}
export async function validateSubscription(value) {
  if (!plain(value) || !trustedEndpoint(value.endpoint) || !plain(value.keys)) fail(400, 'invalid_subscription', 'Неподдерживаемая подписка уведомлений.');
  try {
    const key = base64Bytes(value.keys.p256dh), auth = base64Bytes(value.keys.auth);
    if (key.length !== 65 || key[0] !== 4 || auth.length !== 16) throw new Error('Wrong key size');
    await crypto.subtle.importKey('raw', key, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  } catch { fail(400, 'invalid_subscription', 'Некорректные ключи подписки.'); }
  return { endpoint: value.endpoint, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
}
async function endpointId(endpoint) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(endpoint)))].map(x => x.toString(16).padStart(2, '0')).join('');
}

/** Reuse the app's occurrence composer, including globally moved overrides and
 * live skip records. The three-day horizon covers tomorrow's 24-hour leads. */
export function generateJobs(uid, revision, records, devices, now) {
  let date = minskDate(now);
  const rules = new Map(records.filter(r => r.kind === 'routine').map(r => [r.id, r]));
  const jobs = []; let occurrences = 0;
  for (let offset = 0; offset < 3; offset += 1) {
    for (const task of planner.tasksForDay(records, date)) {
      if (task.done || !task.time) continue;
      const rule = rules.get(task.routineId);
      const lead = task.reminderMinutes !== undefined ? task.reminderMinutes : rule?.reminderMinutes;
      if (!LEADS.has(lead)) continue;
      const due = jobTime(task.date, task.time) - lead * MINUTE;
      if (!Number.isFinite(due) || due + GRACE <= now) continue;
      if (++occurrences > LIMITS.occurrences) fail(400, 'too_many_reminders', 'На ближайшие три дня можно поставить до ' + LIMITS.occurrences + ' напоминаний.');
      const logical = task.routineId && task.occurrenceDate ? ['routine', task.routineId, task.occurrenceDate] : ['task', task.id];
      for (const device of devices) {
        jobs.push({
          id: JSON.stringify([uid, device.id, logical, task.date, task.time, lead, due]),
          uid, device_id: device.id, revision, task_id: task.id, task_date: task.date,
          task_time: task.time, title: task.title, due_at: due, expires_at: due + GRACE,
          next_attempt: due
        });
        if (jobs.length > LIMITS.jobs) fail(400, 'too_many_reminders', 'Слишком много напоминаний на ближайшие три дня.');
      }
    }
    date = planner.nextDate(date);
  }
  return jobs;
}

/** Google signs ID tokens. The worker only uses public verification keys; no
 * Firebase service-account credential is needed or accepted from the browser. */
export function tokenVerifier(fetcher = fetch) {
  let cached = null, expires = 0;
  return async (token, now) => {
    try {
      if (typeof token !== 'string' || token.length > 12000) throw new Error('Invalid token');
      const parts = token.split('.');
      if (parts.length !== 3) throw new Error('Invalid token');
      const header = JSON.parse(new TextDecoder().decode(base64Bytes(parts[0])));
      const claims = JSON.parse(new TextDecoder().decode(base64Bytes(parts[1])));
      const seconds = Math.floor(now / 1000);
      if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid || header.kid.length > 150 ||
          claims.aud !== FIREBASE_PROJECT || claims.iss !== 'https://securetoken.google.com/' + FIREBASE_PROJECT ||
          typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128 || /[\u0000-\u001f]/.test(claims.sub) ||
          !Number.isFinite(claims.exp) || claims.exp <= seconds || !Number.isFinite(claims.iat) || claims.iat > seconds + 30 ||
          !Number.isFinite(claims.auth_time) || claims.auth_time > seconds + 30) throw new Error('Invalid claims');
      if (!cached || expires <= now) {
        const response = await fetcher(GOOGLE_JWKS, { redirect: 'error' });
        if (!response.ok) throw new Error('Key service unavailable');
        const body = await response.json();
        if (!Array.isArray(body.keys) || body.keys.length > 20) throw new Error('Invalid key response');
        cached = new Map(body.keys.filter(k => k.kty === 'RSA' && typeof k.kid === 'string').map(k => [k.kid, k]));
        const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get('Cache-Control') || '')?.[1] || 3600);
        expires = now + Math.max(60, Math.min(21600, maxAge)) * 1000;
      }
      const jwk = cached.get(header.kid);
      if (!jwk) throw new Error('Unknown key');
      const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, base64Bytes(parts[2]), encoder.encode(parts[0] + '.' + parts[1]));
      if (!valid) throw new Error('Invalid signature');
      return claims.sub;
    } catch { fail(401, 'unauthorized', 'Войди в Google ещё раз, чтобы подключить напоминания.'); }
  };
}

export async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) fail(415, 'json_required', 'Нужен JSON.');
  const length = Number(request.headers.get('Content-Length'));
  if (length > LIMITS.body) fail(413, 'body_too_large', 'Слишком большой план.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'invalid_json', 'Пустой запрос.');
  const chunks = []; let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > LIMITS.body) { await reader.cancel(); fail(413, 'body_too_large', 'Слишком большой план.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!plain(value)) throw new Error('Object required');
    return value;
  } catch { fail(400, 'invalid_json', 'Некорректный JSON.'); }
}

/** D1 batches are transactions. Revisions prevent an older asynchronous rebuild
 * from reviving a cancelled job; device revisions cover registration/plan races. */
export class Repository {
  constructor(db) { this.db = db; }
  statement(sql, ...values) { return this.db.prepare(sql).bind(...values); }
  async account(uid) { return this.statement('SELECT * FROM accounts WHERE uid = ?', uid).first(); }
  async ensureAccount(uid, now) {
    await this.statement(`INSERT INTO accounts(uid, revision, updated_at)
      SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM accounts) < ? ON CONFLICT(uid) DO NOTHING`, uid, crypto.randomUUID(), now, LIMITS.accounts).run();
    const account = await this.account(uid);
    if (!account) fail(429, 'account_limit', 'Лимит подключённых аккаунтов достигнут.');
    return account;
  }
  async devices(uid) { return (await this.statement('SELECT * FROM devices WHERE uid = ? ORDER BY id', uid).all()).results; }
  async device(uid, endpoint) { return this.statement('SELECT * FROM devices WHERE uid = ? AND endpoint = ?', uid, endpoint).first(); }
  async replacePlan(uid, records, now) {
    const revision = crypto.randomUUID();
    await this.db.batch([
      this.statement("UPDATE accounts SET plan_json = ?, revision = ?, updated_at = ?, materialize_retry_at = 0, materialize_error = '' WHERE uid = ?", JSON.stringify(records), revision, now, uid),
      this.statement("DELETE FROM jobs WHERE uid = ? AND state != 'sent'", uid)
    ]);
    return revision;
  }
  async register(uid, subscription, now) {
    const id = await endpointId(subscription.endpoint);
    const owner = await this.statement('SELECT uid FROM devices WHERE id = ?', id).first();
    if (owner && owner.uid !== uid) fail(409, 'device_in_use', 'Отключи уведомления прежнего аккаунта на этом устройстве.');
    await this.db.batch([
      this.statement(`INSERT INTO devices(id, uid, endpoint, p256dh, auth, created_at, last_seen)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM devices WHERE uid = ?) < ? OR EXISTS(SELECT 1 FROM devices WHERE id = ? AND uid = ?)
        ON CONFLICT(id) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, last_seen = excluded.last_seen WHERE devices.uid = excluded.uid`,
      id, uid, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, now, now, uid, LIMITS.devices, id, uid),
      this.statement("UPDATE accounts SET device_revision = device_revision + 1, materialize_retry_at = 0, materialize_error = '' WHERE uid = ? AND EXISTS(SELECT 1 FROM devices WHERE id = ? AND uid = ?)", uid, id, uid)
    ]);
    if (!await this.device(uid, subscription.endpoint)) fail(429, 'device_limit', 'Можно подключить не более ' + LIMITS.devices + ' устройств.');
    return id;
  }
  async removeDevice(uid, endpoint) {
    const device = await this.device(uid, endpoint);
    if (!device) return;
    await this.db.batch([
      this.statement('DELETE FROM jobs WHERE uid = ? AND device_id = ?', uid, device.id),
      this.statement('DELETE FROM devices WHERE uid = ? AND id = ?', uid, device.id),
      this.statement("UPDATE accounts SET device_revision = device_revision + 1, materialize_retry_at = 0, materialize_error = '' WHERE uid = ?", uid)
    ]);
  }
  async materialize(uid, now, options = {}) {
    const account = await this.account(uid);
    if (!account) return 0;
    try {
    const devices = await this.devices(uid);
    const jobs = generateJobs(uid, account.revision, JSON.parse(account.plan_json), devices, now);
    const encoded = JSON.stringify(jobs);
    if (encoder.encode(encoded).length > 1900000) fail(400, 'too_many_reminders', 'Слишком большой объём напоминаний.');
    // JSON1 expands a bound array inside one statement: even a large snapshot
    // stays within the Free plan's 50 database queries per invocation.
    await this.db.batch([
      this.statement(`INSERT INTO jobs(id, uid, device_id, revision, task_id, task_date, task_time, title, due_at, expires_at, next_attempt)
        SELECT json_extract(value,'$.id'), json_extract(value,'$.uid'), json_extract(value,'$.device_id'), json_extract(value,'$.revision'),
          json_extract(value,'$.task_id'), json_extract(value,'$.task_date'), json_extract(value,'$.task_time'), json_extract(value,'$.title'),
          json_extract(value,'$.due_at'), json_extract(value,'$.expires_at'), json_extract(value,'$.next_attempt')
        FROM json_each(?) WHERE EXISTS(SELECT 1 FROM accounts WHERE uid = ? AND revision = ? AND device_revision = ?)
          AND EXISTS(SELECT 1 FROM devices WHERE devices.id = json_extract(value,'$.device_id') AND devices.uid = ?)
        ON CONFLICT(id) DO NOTHING`, encoded, uid, account.revision, account.device_revision, uid),
      this.statement(`UPDATE accounts SET materialized_day = ?, materialized_revision = ?, materialized_device_revision = ?, materialize_retry_at = 0, materialize_error = ''
        WHERE uid = ? AND revision = ? AND device_revision = ?`, minskDate(now), account.revision, account.device_revision, uid, account.revision, account.device_revision)
    ]);
    return jobs.length;
    } catch (error) {
      if (!options.deferFailure) throw error;
      const code = error instanceof ApiError ? error.code : 'materialization_failed';
      // Persist the delay: a new Worker isolate must also skip the failed
      // account. Revision guards avoid deferring a concurrently fixed plan.
      await this.statement(`UPDATE accounts SET materialize_retry_at = ?, materialize_error = ?
        WHERE uid = ? AND revision = ? AND device_revision = ?`, now + 60 * MINUTE, code, uid, account.revision, account.device_revision).run();
      return { deferred: true, code };
    }
  }
  async rollOne(now) {
    const account = await this.statement(`SELECT uid FROM accounts WHERE materialize_retry_at <= ? AND
      (materialized_day != ? OR materialized_revision != revision OR materialized_device_revision != device_revision)
      ORDER BY materialized_day, uid LIMIT 1`, now, minskDate(now)).first();
    if (account) return this.materialize(account.uid, now, { deferFailure: true });
  }
  async claim(now) {
    const token = crypto.randomUUID();
    // UPDATE ... RETURNING is one atomic claim, including recovery after a
    // crashed invocation. A second cron cannot acquire an unexpired lease.
    const result = await this.statement(`UPDATE jobs SET state = 'claimed', claim_token = ?, lock_until = ?, attempts = attempts + 1
      WHERE id IN (
        SELECT jobs.id FROM jobs JOIN accounts ON accounts.uid = jobs.uid JOIN devices ON devices.id = jobs.device_id AND devices.uid = jobs.uid
        WHERE jobs.revision = accounts.revision AND jobs.due_at <= ? AND jobs.next_attempt <= ? AND jobs.expires_at > ?
          AND (jobs.state = 'pending' OR (jobs.state = 'claimed' AND jobs.lock_until <= ?))
        ORDER BY jobs.due_at, jobs.id LIMIT ?
      ) RETURNING *`, token, now + 2 * MINUTE, now, now, now, now, LIMITS.claim).all();
    return result.results;
  }
  async delivery(job, now) {
    return this.statement(`SELECT jobs.*, devices.endpoint, devices.p256dh, devices.auth FROM jobs
      JOIN accounts ON accounts.uid = jobs.uid AND accounts.revision = jobs.revision
      JOIN devices ON devices.id = jobs.device_id AND devices.uid = jobs.uid
      WHERE jobs.id = ? AND jobs.claim_token = ? AND jobs.state = 'claimed' AND jobs.expires_at > ?`, job.id, job.claim_token, now).first();
  }
  async finish(job, state, now, delay = MINUTE) {
    await this.statement(`UPDATE jobs SET state = ?, sent_at = ?, lock_until = 0, claim_token = '', next_attempt = ?
      WHERE id = ? AND state = 'claimed' AND claim_token = ?`, state, state === 'sent' ? now : null, now + delay, job.id, job.claim_token).run();
  }
  async reserveTest(device, now) {
    const result = await this.statement('UPDATE devices SET last_test = ? WHERE id = ? AND uid = ? AND last_test <= ?', now, device.id, device.uid, now - 30000).run();
    if (!result.meta.changes) fail(429, 'test_rate_limit', 'Подожди 30 секунд перед повторной проверкой.');
  }
  async cleanup(now) {
    await this.statement('DELETE FROM jobs WHERE id IN (SELECT id FROM jobs WHERE expires_at < ? LIMIT 200)', now - 7 * DAY).run();
  }
}

function configured(env) {
  try { return base64Bytes(env.VAPID_PUBLIC_KEY).length === 65 && base64Bytes(env.VAPID_PRIVATE_KEY).length === 32 && /^https:\/\//.test(env.VAPID_SUBJECT || ''); }
  catch { return false; }
}
export async function sendWebPush(subscription, payload, env, ttl = 600) {
  const { buildPushPayload } = await import('@block65/webcrypto-web-push');
  const request = await buildPushPayload({ data: JSON.stringify(payload), options: { ttl, urgency: 'high' } }, subscription, {
    subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY
  });
  return fetch(subscription.endpoint, { ...request, redirect: 'error', signal: AbortSignal.timeout(10000) });
}

export function createWorker(dependencies = {}) {
  const clock = dependencies.now || Date.now;
  const verifyToken = dependencies.verifyToken || tokenVerifier(dependencies.fetch || fetch);
  const send = dependencies.sendPush || sendWebPush;
  const repository = env => dependencies.repository || new Repository(env.DB);
  async function fetchHandler(request, env) {
    const origin = request.headers.get('Origin');
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' };
    const respond = (value, status = 200) => new Response(JSON.stringify(value), { status, headers });
    try {
      if (origin && origin !== APP_ORIGIN) fail(403, 'origin_not_allowed', 'Этот источник не разрешён.');
      if (origin === APP_ORIGIN) headers['Access-Control-Allow-Origin'] = APP_ORIGIN;
      if (request.method === 'OPTIONS') {
        headers['Access-Control-Allow-Methods'] = 'GET,PUT,POST,DELETE,OPTIONS';
        headers['Access-Control-Allow-Headers'] = 'Authorization,Content-Type';
        headers['Access-Control-Max-Age'] = '600';
        return new Response(null, { status: 204, headers });
      }
      const url = new URL(request.url), path = url.pathname;
      if (request.method === 'GET' && path === '/v1/health') {
        if (!configured(env) || !env.DB) return respond({ ok: false, configured: false }, 503);
        await env.DB.prepare('SELECT 1 AS ready').first();
        return respond({ ok: true, configured: true });
      }
      if (request.method === 'GET' && path === '/v1/config') {
        if (!configured(env)) fail(503, 'not_configured', 'Напоминания пока не подключены.');
        return respond({ publicKey: env.VAPID_PUBLIC_KEY });
      }
      if (!['PUT /v1/plan', 'POST /v1/devices', 'DELETE /v1/devices', 'POST /v1/test'].includes(request.method + ' ' + path)) fail(404, 'not_found', 'Маршрут не найден.');
      if (!configured(env) || !env.DB) fail(503, 'not_configured', 'Напоминания пока не подключены.');
      const token = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(request.headers.get('Authorization') || '')?.[1];
      const now = clock(), uid = await verifyToken(token, now), body = await readJson(request), repo = repository(env);
      if (path === '/v1/plan') {
        const records = validateRecords(body.records);
        await repo.ensureAccount(uid, now);
        // Reject excessive queue fan-out before replacing the last working plan.
        generateJobs(uid, 'validation', records, await repo.devices(uid), now);
        await repo.replacePlan(uid, records, now);
        const jobs = await repo.materialize(uid, now);
        return respond({ ok: true, records: records.length, jobs });
      }
      if (path === '/v1/devices' && request.method === 'POST') {
        const subscription = await validateSubscription(body.subscription);
        await repo.ensureAccount(uid, now);
        const deviceId = await repo.register(uid, subscription, now);
        await repo.materialize(uid, now);
        return respond({ ok: true, deviceId });
      }
      if (!trustedEndpoint(body.endpoint)) fail(400, 'invalid_subscription', 'Неподдерживаемая подписка уведомлений.');
      if (path === '/v1/devices') {
        await repo.removeDevice(uid, body.endpoint);
        return respond({ ok: true });
      }
      const device = await repo.device(uid, body.endpoint);
      if (!device) fail(404, 'device_not_found', 'Сначала включи уведомления на этом устройстве.');
      await repo.reserveTest(device, now);
      let response;
      try {
        response = await send({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, {
          title: 'HVF · Проверка', body: 'Напоминания подключены. Так будут приходить дела.', url: APP_URL + '#day', tag: 'hvf-test'
        }, env, 60);
      } catch { fail(502, 'push_unavailable', 'Сервис уведомлений временно недоступен. Попробуй позже.'); }
      if (response.status === 404 || response.status === 410) {
        await repo.removeDevice(uid, device.endpoint);
        fail(410, 'subscription_expired', 'Подписка устарела. Включи уведомления заново.');
      }
      if (!response.ok) fail(502, 'push_unavailable', 'Сервис уведомлений пока не принял проверку. Попробуй позже.');
      return respond({ ok: true, accepted: true });
    } catch (error) {
      if (error instanceof ApiError) return respond({ error: error.message, code: error.code }, error.status);
      return respond({ error: 'Сервис временно недоступен. Попробуй позже.', code: 'service_unavailable' }, 503);
    }
  }
  async function scheduledHandler(_controller, env) {
    if (!configured(env) || !env.DB) return;
    const repo = repository(env), now = clock();
    // A broken plan or a transient rebuilding error must not abort delivery of
    // already valid jobs. Only generic codes are logged, never user plan data.
    try {
      const rolled = await repo.rollOne(now);
      if (rolled?.deferred) console.warn('HVF reminder rebuild deferred: ' + rolled.code);
    } catch { console.warn('HVF reminder rebuild deferred: database_unavailable'); }
    await repo.cleanup(now);
    const jobs = await repo.claim(now);
    await Promise.all(jobs.map(async job => {
      const current = await repo.delivery(job, clock());
      if (!current) return;
      if (!trustedEndpoint(current.endpoint)) { await repo.removeDevice(current.uid, current.endpoint); return; }
      try {
        const tag = 'hvf-' + (await endpointId(job.id)).slice(0, 32);
        const response = await send({ endpoint: current.endpoint, keys: { p256dh: current.p256dh, auth: current.auth } }, {
          title: 'HVF · Напоминание', body: current.task_time + ' · ' + current.title,
          url: APP_URL + '#day', date: current.task_date, taskId: current.task_id, tag
        }, env, Math.max(1, Math.floor((current.expires_at - clock()) / 1000)));
        if (response.ok) await repo.finish(job, 'sent', clock());
        else if (response.status === 404 || response.status === 410) await repo.removeDevice(current.uid, current.endpoint);
        else if (response.status === 429 || response.status >= 500) await repo.finish(job, current.attempts >= 5 ? 'dead' : 'pending', clock());
        else await repo.finish(job, 'dead', clock());
      } catch { await repo.finish(job, current.attempts >= 5 ? 'dead' : 'pending', clock()); }
    }));
  }
  return { fetch: fetchHandler, scheduled: scheduledHandler };
}

export default createWorker();
