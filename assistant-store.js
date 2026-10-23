/* HVF assistant storage. Firebase rules already allow users/{uid}/planning/{month}. */
(function () {
  "use strict";

  const PREFIX = "hvf-assistant-v2:";
  const listeners = new Set();
  const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
  const datePattern = /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/;
  const today = new Date();
  let period = {
    month: today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0"),
    date: today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0"),
  };
  let user = null;
  let owner = "anonymous";
  let cache = readCache(owner);
  let api = null;
  let auth = null;
  let initPromise = null;
  let authKnown = false;
  let generation = 0;
  let stopCloud = null;
  let cloudReady = false;
  let fromCache = true;
  let flushing = false;
  let loading = false;
  let lastError = "";
  let retryTimer = null;
  const legacyReads = new Set();

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const token = () => window.crypto && typeof window.crypto.randomUUID === "function"
    ? window.crypto.randomUUID() : Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  function cacheKey(scope) { return PREFIX + scope; }
  function emptyCache() {
    return { version: 2, entries: {}, pending: {}, acknowledged: {}, migrations: {}, claimedBy: "" };
  }
  function readJSON(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); }
    catch (_) { return null; }
  }
  function validEnvelope(value) {
    return value && typeof value === "object" && typeof value.id === "string" &&
      monthPattern.test(value.month) && typeof value.operation === "string" &&
      (value.deleted === true || (value.value && value.value.id === value.id));
  }
  function readCache(scope) {
    const saved = readJSON(cacheKey(scope));
    const result = emptyCache();
    if (!saved || saved.version !== 2) return result;
    for (const key of ["entries", "pending"]) {
      for (const [id, envelope] of Object.entries(saved[key] || {})) {
        if (validEnvelope(envelope) && id === envelope.id) {
          Object.defineProperty(result[key], id, { value: envelope, enumerable: true, writable: true, configurable: true });
        }
      }
    }
    result.migrations = saved.migrations && typeof saved.migrations === "object" ? saved.migrations : {};
    result.acknowledged = saved.acknowledged && typeof saved.acknowledged === "object" ? saved.acknowledged : {};
    result.claimedBy = typeof saved.claimedBy === "string" ? saved.claimedBy : "";
    return result;
  }
  function save(target = cache, scope = owner) {
    try { localStorage.setItem(cacheKey(scope), JSON.stringify(target)); return true; }
    catch (_) {
      lastError = "Не удалось сохранить данные в браузере. Освободите место или разрешите хранилище для сайта.";
      return false;
    }
  }
  function status() {
    if (lastError) return "error";
    if (!user) return loading ? "loading" : "local";
    if (navigator.onLine === false || (cloudReady && fromCache)) return "offline";
    if (!cloudReady) return "loading";
    if (Object.keys(cache.pending).length) return "syncing";
    return fromCache ? "offline" : "synced";
  }
  function getState() {
    const records = {};
    for (const [id, envelope] of Object.entries(cache.entries)) {
      if (!envelope.deleted && envelope.value) {
        Object.defineProperty(records, id, { value: clone(envelope.value), enumerable: true, writable: true, configurable: true });
      }
    }
    return { records, status: status(), user: user ? { ...user } : null, error: lastError };
  }
  function emit() {
    const state = getState();
    for (const callback of listeners) {
      try { callback(state); } catch (error) { console.error("HVF subscriber:", error); }
    }
  }
  function envelopeFor(record, deleted, migration) {
    const previous = own(cache.entries, record.id) ? cache.entries[record.id] : null;
    return {
      id: record.id, month: record.month, operation: token(),
      updatedAt: Math.max(Date.now(), Number(previous?.updatedAt || 0) + 1), deleted: Boolean(deleted),
      ...(!migration && previous ? { baseOperation: previous.operation } : {}),
      ...(deleted ? {} : { value: clone(record) }),
      ...(migration ? { migration: true } : {}),
    };
  }
  function queue(envelope, target = cache) {
    Object.defineProperty(target.entries, envelope.id, { value: envelope, enumerable: true, writable: true, configurable: true });
    Object.defineProperty(target.pending, envelope.id, { value: envelope, enumerable: true, writable: true, configurable: true });
  }
  function put(record) {
    if (!record || typeof record.id !== "string" || !record.id || record.id.length > 500 ||
        typeof record.kind !== "string" || !record.kind) throw new Error("У записи должны быть id и kind.");
    const value = clone(record);
    value.month = value.month || (datePattern.test(value.date || "") ? value.date.slice(0, 7) : period.month);
    if (!monthPattern.test(value.month)) throw new Error("Месяц должен иметь формат ГГГГ-ММ.");
    const previous = own(cache.entries, value.id) ? cache.entries[value.id] : null;
    if (previous && previous.month !== value.month) {
      throw new Error("Для переноса записи в другой месяц создайте новый id и удалите прежнюю запись.");
    }
    queue(envelopeFor(value, false, false));
    lastError = "";
    save(); emit(); void flush();
    return clone(value);
  }
  function remove(id) {
    const current = own(cache.entries, id) ? cache.entries[id] : null;
    if (!current || current.deleted) return;
    queue(envelopeFor({ id, month: current.month }, true, false));
    lastError = "";
    save(); emit(); void flush();
  }
  function documentFor(uid, month) {
    return api.doc(api.db, "users", uid, "planning", month);
  }
  function retryLater() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { lastError = ""; void flush(); emit(); }, 30000);
  }
  function blockedByRemote(pending, remote) {
    if (!validEnvelope(remote)) return false;
    if (pending.migration && remote.operation !== pending.operation) return true;
    // An edit based on an older live record cannot restore a deletion made elsewhere.
    // An explicit undo made after observing the tombstone carries its operation as the base.
    return remote.deleted && !pending.deleted && pending.baseOperation !== remote.operation;
  }
  async function flush() {
    if (flushing || !api || !user || !cloudReady || fromCache || navigator.onLine === false) return;
    const uid = user.uid;
    const activeGeneration = generation;
    const activeCache = cache;
    flushing = true;
    try {
      for (const pending of Object.values(activeCache.pending)) {
        if (activeGeneration !== generation) break;
        if (activeCache.pending[pending.id]?.operation !== pending.operation) continue;
        const payload = { assistantV2: { [pending.id]: pending } };
        const reference = documentFor(uid, pending.month);
        const options = { mergeFields: [new api.FieldPath("assistantV2", pending.id)] };
        let skipped = null;
        if (typeof api.runTransaction === "function") {
          skipped = await api.runTransaction(api.db, async (transaction) => {
            const snapshot = await transaction.get(reference);
            const remote = snapshot.exists() && snapshot.data().assistantV2?.[pending.id];
            if (blockedByRemote(pending, remote) || remote?.operation === pending.operation) return remote;
            // Replace only this field; concurrent changes to other records remain intact.
            transaction.set(reference, payload, options);
            return null;
          });
        } else await api.setDoc(reference, payload, options);
        if (activeCache.pending[pending.id]?.operation === pending.operation) delete activeCache.pending[pending.id];
        Object.defineProperty(activeCache.acknowledged, pending.id, {
          value: { operation: pending.operation, updatedAt: pending.updatedAt },
          enumerable: true, writable: true, configurable: true,
        });
        if (skipped && activeCache.entries[pending.id]?.operation === pending.operation) activeCache.entries[pending.id] = skipped;
        save(activeCache, uid);
        if (activeGeneration === generation) { lastError = ""; emit(); }
      }
    } catch (error) {
      if (activeGeneration === generation) {
        lastError = errorMessage(error);
        emit(); retryLater();
      }
    } finally {
      flushing = false;
      if (activeGeneration !== generation) void flush();
      else if (!lastError && !fromCache && Object.keys(cache.pending).length && navigator.onLine !== false) {
        // A change made while another write awaited acknowledgement still has to be sent.
        queueMicrotask(() => { void flush(); });
      }
    }
  }
  function errorMessage(error) {
    const code = error && error.code || "";
    if (/permission-denied/.test(code)) return "Облако отклонило доступ. Проверьте вход и правила Firebase; изменения сохранены на устройстве.";
    if (/unauthorized-domain/.test(code)) return "Разрешите адрес этого сайта в Firebase Authentication → Authorized domains.";
    if (/operation-not-allowed/.test(code)) return "Включите вход через Google в Firebase Authentication.";
    if (/network|unavailable/.test(code)) return "Нет связи с облаком. Изменения сохраняются на устройстве и отправятся после подключения.";
    return "Не удалось подключиться к синхронизации. Данные и ожидающие изменения сохранены на устройстве.";
  }

  function importRecord(record, target) {
    if (!record.id || own(target.entries, record.id) || own(target.pending, record.id)) return;
    queue(envelopeFor(record, false, true), target);
  }
  function importPlanning(value, month, target) {
    if (!value || typeof value !== "object") return;
    const goalIds = new Set();
    for (const goal of Array.isArray(value.goals) ? value.goals : []) {
      if (!goal || typeof goal.id !== "string" || typeof goal.title !== "string" || !goal.title.trim()) continue;
      goalIds.add(goal.id);
      importRecord({
        ...goal, id: "legacy-goal-" + goal.id, kind: "goal", month,
        outcome: typeof goal.outcome === "string" ? goal.outcome : "",
        target: Number(goal.target) || 0, saved: Number(goal.saved) || 0,
        priority: Number(goal.priority) || 2,
      }, target);
    }
    for (const task of Array.isArray(value.tasks) ? value.tasks : []) {
      if (!task || typeof task.id !== "string" || typeof task.title !== "string" ||
          !datePattern.test(task.date || "") || task.date.slice(0, 7) !== month) continue;
      importRecord({
        ...task, id: "legacy-plan-" + task.id, kind: "task", month,
        duration: Math.max(5, Math.round(Number(task.duration) || 30)), time: task.time || "", done: Boolean(task.done),
        goalId: goalIds.has(task.goalId) ? "legacy-goal-" + task.goalId : "",
      }, target);
    }
  }
  function importDay(tasks, date, target) {
    for (const task of Array.isArray(tasks) ? tasks : []) {
      if (!task || typeof task.id !== "string" || task.id.startsWith("__schedule_done__") ||
          typeof task.title !== "string" || !task.title.trim()) continue;
      importRecord({
        id: "legacy-day-" + date + "-" + task.id, kind: "task", month: date.slice(0, 7), date,
        title: task.title, duration: Math.max(5, Math.round(Number(task.duration) || 30)),
        time: typeof task.time === "string" ? task.time : "", done: Boolean(task.done),
      }, target);
    }
  }
  function migrateLocal(target, uid) {
    const suffix = uid ? "-user-" + uid : "";
    const monthMark = "local-month-" + period.month;
    if (!target.migrations[monthMark]) {
      importPlanning(readJSON("daily-schedule-planning-" + period.month + suffix), period.month, target);
      target.migrations[monthMark] = true;
    }
    const dayMark = "local-day-" + period.date;
    if (!target.migrations[dayMark]) {
      importDay(readJSON("daily-schedule-" + period.date + suffix), period.date, target);
      target.migrations[dayMark] = true;
    }
  }
  function claimAnonymous(uid) {
    const anonymous = readCache("anonymous");
    if (anonymous.claimedBy && anonymous.claimedBy !== uid) return;
    migrateLocal(anonymous, null);
    for (const envelope of Object.values(anonymous.entries)) {
      if (!own(cache.entries, envelope.id)) queue({ ...envelope, operation: token(), migration: true });
    }
    // Persist the destination first: an interrupted sign-in cannot lose the anonymous data.
    if (save(cache, uid)) {
      anonymous.claimedBy = uid;
      anonymous.entries = {}; anonymous.pending = {};
      save(anonymous, "anonymous");
    }
  }
  async function migrateCloudDay() {
    if (!user || !api || !cloudReady) return;
    const date = period.date;
    const uid = user.uid;
    const mark = "cloud-day-" + date;
    const readKey = uid + "/" + date;
    if (cache.migrations[mark] || legacyReads.has(readKey)) return;
    const activeGeneration = generation;
    legacyReads.add(readKey);
    try {
      const snapshot = await api.getDocs(api.collection(api.db, "users", uid, "days", date, "tasks"));
      if (generation !== activeGeneration) return;
      importDay(snapshot.docs.map((doc) => ({ ...doc.data(), id: doc.id })), date, cache);
      if (!snapshot.metadata.fromCache) cache.migrations[mark] = true;
      save(); emit(); void flush();
    } catch (_) {
      // Legacy import can be retried; it must not block the new assistant's data.
    } finally { legacyReads.delete(readKey); }
  }
  function attachCloud(activeGeneration) {
    const uid = user.uid;
    stopCloud = api.onSnapshot(api.collection(api.db, "users", uid, "planning"),
      { includeMetadataChanges: true }, (snapshot) => {
        if (generation !== activeGeneration) return;
        const remote = {};
        for (const document of snapshot.docs) {
          const data = document.data();
          for (const [id, envelope] of Object.entries(data.assistantV2 || {})) {
            if (!validEnvelope(envelope) || id !== envelope.id || envelope.month !== document.id) continue;
            Object.defineProperty(remote, id, { value: envelope, enumerable: true, writable: true, configurable: true });
          }
        }
        // A cached snapshot may contain only some months. A server snapshot is authoritative.
        const next = snapshot.metadata.fromCache ? { ...cache.entries, ...remote } : remote;
        for (const [id, pending] of Object.entries(cache.pending)) {
          if (own(remote, id) && blockedByRemote(pending, remote[id])) delete cache.pending[id];
          else Object.defineProperty(next, id, { value: pending, enumerable: true, writable: true, configurable: true });
        }
        cache.entries = next;
        cloudReady = true; fromCache = snapshot.metadata.fromCache; loading = false;
        if (!fromCache) lastError = "";
        // Only the requested legacy month is imported; built-in daily events never enter the store.
        const legacy = snapshot.docs.find((doc) => doc.id === period.month);
        const mark = "cloud-month-" + period.month;
        if (legacy && !cache.migrations[mark]) {
          importPlanning(legacy.data(), period.month, cache);
          cache.migrations[mark] = true;
        }
        save(); emit(); void migrateCloudDay(); void flush();
      }, (error) => {
        if (generation !== activeGeneration) return;
        loading = false; lastError = errorMessage(error); emit();
      });
  }
  function onUserChanged(firebaseUser) {
    const nextOwner = firebaseUser ? firebaseUser.uid : "anonymous";
    if (authKnown && nextOwner === owner) return;
    generation += 1;
    const activeGeneration = generation;
    if (stopCloud) stopCloud();
    stopCloud = null;
    clearTimeout(retryTimer);
    cloudReady = false; fromCache = true; lastError = ""; authKnown = true;
    user = firebaseUser ? {
      uid: firebaseUser.uid, email: firebaseUser.email || "",
      displayName: firebaseUser.displayName || "", photoURL: firebaseUser.photoURL || "",
    } : null;
    owner = nextOwner; cache = readCache(owner); loading = Boolean(user);
    if (user) claimAnonymous(user.uid);
    migrateLocal(cache, user && user.uid);
    save(); emit();
    if (user) attachCloud(activeGeneration);
  }
  function setPeriod(month, date) {
    if (!monthPattern.test(month || "")) throw new Error("Некорректный месяц.");
    period = { month, date: datePattern.test(date || "") && date.startsWith(month) ? date : month + "-01" };
    if (authKnown) {
      migrateLocal(cache, user && user.uid); save(); emit();
      // Reattach to obtain the requested month's legacy planning document as well.
      if (user && api) {
        if (stopCloud) stopCloud();
        stopCloud = null; attachCloud(generation);
        void migrateCloudDay();
      }
    }
  }
  async function init() {
    if (initPromise) return initPromise;
    loading = true; emit();
    initPromise = (async () => {
      const config = window.SCHEDULE_FIREBASE_CONFIG || {};
      if (!config.apiKey || !config.authDomain || !config.projectId || !config.appId) {
        onUserChanged(null); return;
      }
      try {
        const [appModule, authModule, storeModule] = await Promise.all([
          import("https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js"),
          import("https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js"),
          import("https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js"),
        ]);
        const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(config);
        auth = authModule.getAuth(app);
        const db = storeModule.getFirestore(app);
        api = { ...storeModule, ...authModule, db };
        if (typeof storeModule.enableMultiTabIndexedDbPersistence === "function") {
          // localStorage remains the durable outbox when IndexedDB is unavailable.
          storeModule.enableMultiTabIndexedDbPersistence(db).catch(() => {});
        }
        await authModule.setPersistence(auth, authModule.browserLocalPersistence);
        authModule.onAuthStateChanged(auth, onUserChanged, (error) => {
          loading = false; lastError = errorMessage(error); emit();
        });
        await authModule.getRedirectResult(auth).catch((error) => {
          if (!/cancelled-popup-request|popup-closed-by-user/.test(error.code || "")) {
            lastError = errorMessage(error); emit();
          }
        });
      } catch (error) {
        if (!authKnown) onUserChanged(null);
        loading = false; lastError = errorMessage(error); emit();
        initPromise = null;
      }
    })();
    return initPromise;
  }
  async function signInOut() {
    await init();
    if (!api || !auth) throw new Error("Синхронизация пока недоступна. Проверьте подключение к интернету.");
    if (typeof auth.authStateReady === "function") await auth.authStateReady();
    lastError = "";
    if (auth.currentUser) {
      await api.signOut(auth);
      return;
    }
    const provider = new api.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    try {
      // The popup keeps the current page open and works on desktop and modern mobile browsers.
      await api.signInWithPopup(auth, provider);
    } catch (error) {
      if (/popup-blocked|operation-not-supported-in-this-environment/.test(error.code || "")) {
        await api.signInWithRedirect(auth, provider);
      } else if (!/popup-closed-by-user|cancelled-popup-request/.test(error.code || "")) {
        lastError = errorMessage(error); emit(); throw new Error(lastError);
      }
    }
  }
  window.addEventListener("online", () => { lastError = ""; emit(); void flush(); void migrateCloudDay(); });
  window.addEventListener("offline", emit);
  window.addEventListener("storage", (event) => {
    if (event.key !== cacheKey(owner)) return;
    const incoming = readCache(owner);
    // Preserve this tab's unsent edits, then include edits queued by another tab.
    for (const [id, pending] of Object.entries(cache.pending)) {
      const acknowledged = incoming.acknowledged[id];
      if (acknowledged && (acknowledged.operation === pending.operation ||
          Number(acknowledged.updatedAt) >= Number(pending.updatedAt))) continue;
      const other = incoming.pending[id];
      if (blockedByRemote(pending, incoming.entries[id])) continue;
      if (!other || Number(pending.updatedAt) > Number(other.updatedAt)) {
        incoming.pending[id] = pending; incoming.entries[id] = pending;
      }
    }
    // Keep the cache identity while an asynchronous write is using it.
    cache.entries = incoming.entries; cache.pending = incoming.pending;
    cache.migrations = incoming.migrations; cache.claimedBy = incoming.claimedBy; cache.acknowledged = incoming.acknowledged;
    emit(); void flush();
  });
  window.HVFStore = Object.freeze({
    init, getState, put, remove, signInOut, setPeriod,
    subscribe(callback) {
      if (typeof callback !== "function") throw new Error("Нужна функция подписки.");
      listeners.add(callback); callback(getState());
      return () => listeners.delete(callback);
    },
  });
})();
