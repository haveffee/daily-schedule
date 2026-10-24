/* Browser push client. Scheduling and delivery run on the hosted reminder service. */
(function (root, factory) {
  "use strict";
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.HVFReminders = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";

  const OWNER_KEY = "hvf-reminders-device-v1";
  const PUSH_WORKER_VERSION = "reminders-1";
  const ALLOWED_MINUTES = new Set([0, 5, 10, 15, 30, 60, 1440]);
  const SERVICE_ERROR_CODES = new Set(["invalid_record", "invalid_plan", "fixed_time_required", "invalid_subscription", "too_many_reminders", "unauthorized", "json_required", "body_too_large", "invalid_json", "account_limit", "device_in_use", "device_limit", "test_rate_limit", "origin_not_allowed", "not_configured", "not_found", "device_not_found", "push_unavailable", "subscription_expired", "service_unavailable"]);
  const FIELDS = ["id", "kind", "month", "date", "title", "duration", "time", "priority", "done", "routineId", "occurrenceDate", "lastMovedAt", "updatedAt", "active", "weekdays", "startDate", "untilDate", "reminderMinutes"];
  const listeners = new Set();
  const cachedTokens = new Map();
  let store = null, initialized = false;
  let snapshot = { records: {}, user: null, status: "loading" };
  let uid = "", identityKnown = false, epoch = 0, deviceEpoch = 0;
  let enabled = false, busy = false, error = "", planError = "", message = "", activeSubscription = null;
  let configPromise = null, reconciliation = Promise.resolve(), retiring = Promise.resolve();
  let syncTimer = null, retryTimer = null, desiredPlan = null, planRunning = null;
  let sentFingerprint = "", lastSyncedAt = "";

  function browser() { return root.navigator || (typeof navigator !== "undefined" ? navigator : {}); }
  function endpoint() {
    try {
      const value = new URL(root.HVF_REMINDERS_CONFIG?.endpoint || "");
      return value.protocol === "https:" && !value.username && !value.password && !value.search && !value.hash
        ? value.href.replace(/\/$/, "") : "";
    } catch (_) { return ""; }
  }
  function deviceSupport() {
    const nav = browser();
    const ios = /iPhone|iPad|iPod/i.test(nav.userAgent || "") || (/Macintosh/i.test(nav.userAgent || "") && Number(nav.maxTouchPoints) > 1);
    const installed = Boolean(nav.standalone || root.matchMedia?.("(display-mode: standalone)").matches);
    return {
      supported: root.isSecureContext !== false && Boolean(nav.serviceWorker && root.PushManager && root.Notification),
      needsInstall: ios && !installed,
    };
  }
  function getStatus() {
    const support = deviceSupport();
    const permission = root.Notification?.permission || "unsupported";
    return {
      ...support, configured: Boolean(endpoint()), initialized, uid, user: uid ? { uid } : null,
      enabled: enabled && permission === "granted", permission, busy, error: error || planError,
      message: planError ? "Изменения дел пока не переданы сервису напоминаний." : message, lastSyncedAt,
    };
  }
  function emit() {
    const status = getStatus();
    for (const callback of listeners) { try { callback(status); } catch (_) {} }
  }
  function readOwner() {
    try {
      const value = JSON.parse(root.localStorage?.getItem(OWNER_KEY) || "null");
      return value && typeof value.uid === "string" && typeof value.endpoint === "string" ? value : null;
    } catch (_) { return null; }
  }
  function writeOwner(value) {
    try {
      if (value) root.localStorage?.setItem(OWNER_KEY, JSON.stringify(value));
      else root.localStorage?.removeItem(OWNER_KEY);
    } catch (_) {}
  }
  function staleError() { const value = new Error("Аккаунт изменился."); value.stale = true; return value; }
  function current(context) { return context.epoch === epoch && context.uid === uid && Boolean(uid); }
  function check(context) { if (!current(context)) throw staleError(); }
  function actionCurrent(context, operation) { check(context); if (operation !== deviceEpoch) throw staleError(); }
  function contextNow() { return { uid, epoch }; }
  function readableError(value) {
    if (value?.name === "TypeError" || value?.name === "AbortError") return "Нет связи с сервисом напоминаний. Проверьте интернет и попробуйте ещё раз.";
    return value && value.message || "Не удалось связаться с сервисом напоминаний. Попробуйте ещё раз.";
  }
  async function rawRequest(path, method, payload, token) {
    const controller = typeof root.AbortController === "function" ? new root.AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 15000) : null;
    let response;
    try {
      response = await root.fetch(endpoint() + path, {
        method, mode: "cors", credentials: "omit", cache: "no-store", redirect: "error",
        headers: { ...(payload === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: "Bearer " + token } : {}) },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
        ...(controller ? { signal: controller.signal } : {}),
      });
    } finally { if (timeout !== null) clearTimeout(timeout); }
    if (!response.ok) {
      let reason = "", code = "";
      try {
        const failure = await response.json();
        if (failure && typeof failure === "object" && !Array.isArray(failure) && SERVICE_ERROR_CODES.has(failure.code) &&
            typeof failure.error === "string" && failure.error.trim() && failure.error.length <= 500 && !/[\u0000-\u001f\u007f]/.test(failure.error)) {
          reason = failure.error.trim(); code = failure.code;
        }
      } catch (_) {}
      let detail;
      if (response.status === 401 || response.status === 403) detail = "Сервис не подтвердил вход (HTTP " + response.status + "). " + (reason || "Войдите в Google заново и повторите попытку.");
      else if (reason) detail = reason + " (HTTP " + response.status + ")";
      else if (response.status === 429) detail = "Слишком много запросов (HTTP 429). Повторите попытку немного позже.";
      else detail = "Сервис напоминаний временно недоступен (HTTP " + response.status + "). Попробуйте ещё раз.";
      const failure = new Error(detail);
      failure.status = response.status;
      if (code) failure.code = code;
      throw failure;
    }
    if (response.status === 204) return {};
    return response.json();
  }
  async function request(path, method, payload, context) {
    check(context);
    if (!endpoint()) throw new Error("Сервис напоминаний ещё не подключён.");
    if (typeof store?.getIdToken !== "function") throw new Error("Обновите приложение, чтобы подключить напоминания.");
    const token = await store.getIdToken();
    check(context);
    if (!token) throw new Error("Сначала войдите через Google.");
    cachedTokens.set(context.uid, token);
    const result = await rawRequest(path, method, payload, token);
    check(context);
    return result;
  }
  function planRecords(records) {
    return Object.values(records || {}).filter(value => value && ["task", "routine", "routine-skip"].includes(value.kind))
      .filter(value => value.kind !== "task" || value.routineId || value.active === true || (Number.isInteger(value.reminderMinutes) && ALLOWED_MINUTES.has(value.reminderMinutes)))
      .map(value => {
        const result = {};
        for (const field of FIELDS) {
          const item = value[field];
          if (field === "reminderMinutes") {
            if (item === null || (Number.isInteger(item) && ALLOWED_MINUTES.has(item))) result[field] = item;
          } else if (field === "weekdays") {
            if (Array.isArray(item)) result[field] = [...new Set(item.filter(day => Number.isInteger(day) && day >= 1 && day <= 7))].sort();
          } else if (typeof item === "string" || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))) result[field] = item;
        }
        return result;
      }).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }
  function clearPlanTimers() { clearTimeout(syncTimer); clearTimeout(retryTimer); syncTimer = null; retryTimer = null; }
  function queuePlan() {
    if (!endpoint() || !uid || snapshot.status !== "synced") { clearTimeout(syncTimer); desiredPlan = null; return false; }
    const records = planRecords(snapshot.records);
    const fingerprint = JSON.stringify(records);
    if (fingerprint === sentFingerprint && !planRunning) { desiredPlan = null; return false; }
    desiredPlan = { ...contextNow(), records, fingerprint };
    return true;
  }
  function schedulePlan() {
    clearTimeout(syncTimer);
    if (!queuePlan()) return;
    syncTimer = setTimeout(() => { syncTimer = null; void flushPlan(); }, 450);
  }
  async function flushPlan() {
    if (planRunning) return planRunning;
    planRunning = (async () => {
      let success = true;
      while (desiredPlan) {
        const plan = desiredPlan;
        desiredPlan = null;
        if (!current(plan) || snapshot.status !== "synced") continue;
        if (plan.fingerprint === sentFingerprint) continue;
        try {
          await request("/v1/plan", "PUT", { records: plan.records }, plan);
          sentFingerprint = plan.fingerprint;
          lastSyncedAt = new Date().toISOString();
          planError = "";
          emit();
        } catch (failure) {
          if (failure.stale || !current(plan)) continue;
          success = false;
          planError = readableError(failure);
          emit();
          clearTimeout(retryTimer);
          retryTimer = setTimeout(() => { retryTimer = null; if (queuePlan()) void flushPlan(); }, 30000);
          break;
        }
      }
      return success;
    })();
    try { return await planRunning; }
    finally {
      planRunning = null;
      // A new cloud snapshot can arrive while an earlier account's request finishes.
      if (desiredPlan && current(desiredPlan)) schedulePlan();
    }
  }
  async function sync() {
    if (!initialized) init();
    clearTimeout(syncTimer);
    const context = contextNow();
    while (current(context) && snapshot.status === "synced" && endpoint()) {
      if (!queuePlan()) return true;
      if (!(await flushPlan())) return false;
      if (!current(context)) return false;
      if (!desiredPlan) return true;
    }
    return false;
  }
  async function registration(requirePushVersion = true) {
    const ready = browser().serviceWorker?.ready;
    if (!ready) throw new Error("В этом браузере уведомления недоступны.");
    const value = await ready;
    if (!value?.pushManager) throw new Error("Браузер не поддерживает push-уведомления.");
    if (requirePushVersion && value.active?.scriptURL) {
      let version = "";
      try { version = new URL(value.active.scriptURL).searchParams.get("v") || ""; } catch (_) {}
      if (version !== PUSH_WORKER_VERSION) throw new Error("Закройте все окна HVF и откройте приложение снова, чтобы активировать обновление с напоминаниями.");
    }
    return value;
  }
  async function retire(previous, oldOwner, oldUid) {
    let subscription = previous;
    if (!subscription && browser().serviceWorker) {
      try { subscription = await (await registration(false)).pushManager.getSubscription(); } catch (_) {}
    }
    if (!subscription) return;
    const address = subscription.endpoint;
    const token = cachedTokens.get(oldUid || oldOwner?.uid);
    // Do not wait for the network: stop delivery on this browser during account changes.
    if (token && endpoint()) void rawRequest("/v1/devices", "DELETE", { endpoint: address }, token).catch(() => {});
    try { await subscription.unsubscribe(); } catch (_) {}
  }
  async function reconcile(context) {
    if (!deviceSupport().supported) return;
    try {
      await retiring;
      if (context.epoch !== epoch) return;
      const subscription = await (await registration(false)).pushManager.getSubscription();
      if (context.epoch !== epoch) return;
      const owner = readOwner();
      if (!subscription) { if (owner) writeOwner(null); return; }
      if (!context.uid || !owner || owner.uid !== context.uid || owner.endpoint !== subscription.endpoint) {
        retiring = retire(subscription, owner, owner?.uid);
        writeOwner(null);
        await retiring;
        return;
      }
      if (!endpoint() || root.Notification.permission !== "granted") return;
      await registration();
      const operation = deviceEpoch;
      await request("/v1/devices", "POST", { subscription: subscription.toJSON() }, context);
      actionCurrent(context, operation);
      activeSubscription = subscription;
      enabled = true;
      message = "Напоминания включены на этом устройстве.";
      error = ""; emit();
    } catch (failure) {
      if (!failure.stale && context.epoch === epoch) { error = readableError(failure); emit(); }
    }
  }
  function onStore(value) {
    snapshot = value || { records: {}, user: null, status: "local" };
    const nextUid = snapshot.user?.uid || "";
    // Firebase may still be restoring its session when the page starts.
    if (!identityKnown && !nextUid && snapshot.status === "loading") return;
    if (!identityKnown || nextUid !== uid) {
      const previousUid = uid;
      const previous = activeSubscription;
      const owner = readOwner();
      const changingKnownAccount = identityKnown;
      identityKnown = true;
      uid = nextUid; epoch++; deviceEpoch++;
      enabled = false; busy = false; activeSubscription = null;
      error = ""; planError = ""; message = ""; sentFingerprint = ""; lastSyncedAt = "";
      desiredPlan = null; clearPlanTimers();
      if (changingKnownAccount) {
        writeOwner(null);
        retiring = retire(previous, owner, previousUid);
      }
      reconciliation = reconcile(contextNow());
      emit();
    }
    schedulePlan();
  }
  function init(options = {}) {
    if (initialized) return reconciliation;
    store = options.store || root.HVFStore;
    if (!store || typeof store.subscribe !== "function") return Promise.resolve(false);
    initialized = true;
    store.subscribe(onStore);
    root.addEventListener?.("online", () => { schedulePlan(); });
    return reconciliation;
  }
  function applicationKey(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Сервис вернул неверный ключ уведомлений.");
    const decoded = root.atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4));
    const result = Uint8Array.from(decoded, character => character.charCodeAt(0));
    if (result.length !== 65 || result[0] !== 4) throw new Error("Сервис вернул неверный ключ уведомлений.");
    return result;
  }
  async function publicKey() {
    if (!configPromise) configPromise = rawRequest("/v1/config", "GET").then(value => applicationKey(value.publicKey)).catch(failure => { configPromise = null; throw failure; });
    return configPromise;
  }
  function enable() {
    if (!initialized) init();
    const status = getStatus();
    let problem = "";
    if (!status.configured) problem = "Сервис напоминаний ещё не подключён.";
    else if (!uid) problem = "Сначала войдите через Google, чтобы синхронизировать напоминания.";
    else if (status.needsInstall) problem = "На iPhone откройте приложение в Safari → Поделиться → На экран Домой. Затем откройте его с главного экрана и включите напоминания.";
    else if (!status.supported) problem = "Этот браузер не поддерживает push-уведомления. Попробуйте Safari на iPhone из приложения на главном экране или современный браузер на компьютере.";
    else if (snapshot.status !== "synced") problem = "Дождитесь синхронизации данных и повторите попытку.";
    else if (busy) return Promise.resolve(false);
    if (problem) { error = problem; emit(); return Promise.reject(new Error(problem)); }
    const context = contextNow();
    const operation = ++deviceEpoch;
    busy = true; error = ""; message = "Подключаем напоминания…"; emit();
    let permission;
    try {
      // Must run directly in the button's user gesture, before any await or fetch.
      permission = root.Notification.permission === "granted" ? Promise.resolve("granted") : root.Notification.requestPermission();
    } catch (failure) { permission = Promise.reject(failure); }
    return (async () => {
      let subscription = null, registered = false;
      try {
        const result = await permission;
        actionCurrent(context, operation);
        if (result !== "granted") throw new Error("Уведомления не разрешены. Разрешите их в настройках браузера или iPhone и повторите попытку.");
        await reconciliation;
        actionCurrent(context, operation);
        await retiring;
        actionCurrent(context, operation);
        const key = await publicKey();
        actionCurrent(context, operation);
        const worker = await registration();
        actionCurrent(context, operation);
        subscription = await worker.pushManager.getSubscription();
        actionCurrent(context, operation);
        if (!subscription) subscription = await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        actionCurrent(context, operation);
        activeSubscription = subscription;
        const synced = await sync();
        actionCurrent(context, operation);
        if (!synced) throw new Error(planError || "Не удалось передать дела сервису напоминаний. Попробуйте ещё раз.");
        await request("/v1/devices", "POST", { subscription: subscription.toJSON() }, context);
        registered = true;
        actionCurrent(context, operation);
        writeOwner({ uid: context.uid, endpoint: subscription.endpoint });
        enabled = true; error = ""; message = "Напоминания включены на этом устройстве.";
        return true;
      } catch (failure) {
        if (subscription && !registered) { try { await subscription.unsubscribe(); } catch (_) {} }
        if (!failure.stale && current(context) && operation === deviceEpoch) {
          enabled = false; activeSubscription = null; error = readableError(failure); message = "";
          throw new Error(error);
        }
        return false;
      } finally {
        if (current(context) && operation === deviceEpoch) { busy = false; emit(); }
      }
    })();
  }
  async function disable() {
    if (!initialized) init();
    const context = contextNow();
    const operation = ++deviceEpoch;
    busy = true; error = ""; emit();
    let remoteFailure = null;
    try {
      await retiring;
      if (operation !== deviceEpoch || context.epoch !== epoch) return false;
      const subscription = activeSubscription || (deviceSupport().supported ? await (await registration(false)).pushManager.getSubscription() : null);
      if (operation !== deviceEpoch || context.epoch !== epoch) return false;
      enabled = false; activeSubscription = null; writeOwner(null);
      if (subscription) {
        const remote = uid && endpoint() ? request("/v1/devices", "DELETE", { endpoint: subscription.endpoint }, context).catch(failure => { remoteFailure = failure; }) : Promise.resolve();
        await subscription.unsubscribe();
        await remote;
      }
      if (operation !== deviceEpoch || context.epoch !== epoch) return false;
      message = "Напоминания выключены на этом устройстве.";
      if (remoteFailure && !remoteFailure.stale) error = "Подписка в браузере удалена. Сервис пока не подтвердил отключение; повторная доставка на эту подписку будет отклонена браузером.";
      return !remoteFailure;
    } catch (failure) {
      if (operation === deviceEpoch && context.epoch === epoch) { error = readableError(failure); throw new Error(error); }
      return false;
    } finally { if (operation === deviceEpoch && context.epoch === epoch) { busy = false; emit(); } }
  }
  async function test() {
    const context = contextNow();
    if (!enabled || !activeSubscription || !uid) throw new Error("Сначала включите напоминания на этом устройстве.");
    if (busy) return false;
    const operation = ++deviceEpoch;
    busy = true; error = ""; emit();
    try {
      await request("/v1/test", "POST", { endpoint: activeSubscription.endpoint }, context);
      actionCurrent(context, operation);
      message = "Проверочное уведомление отправлено. Его показ зависит от настроек уведомлений и режима фокусирования.";
      return true;
    } catch (failure) {
      if (!failure.stale && current(context) && operation === deviceEpoch) { error = readableError(failure); throw new Error(error); }
      return false;
    } finally { if (current(context) && operation === deviceEpoch) { busy = false; emit(); } }
  }
  return Object.freeze({ init, getStatus, enable, disable, test, sync,
    subscribe(callback) {
      if (typeof callback !== "function") throw new Error("Нужна функция подписки.");
      listeners.add(callback); callback(getStatus()); return () => listeners.delete(callback);
    },
  });
});
