(function (root, factory) {
  'use strict';
  var api = factory(root || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HVFFocus = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var STORAGE_PREFIX = 'hvf-focus-device-v1:';
  var MAX_FOCUS_MINUTES = 480;
  var MAX_BREAK_MINUTES = 60;

  function scopeKey(value) {
    return typeof value === 'string' && value.trim() ? 'user:' + value.trim() : 'guest';
  }

  function emptyState() {
    return { sessionId: '', phase: 'idle', mode: 'focus', taskId: '', title: '', durationMs: 0,
      remainingMs: 0, startedAt: 0, deadline: 0, pausedAt: 0, finishedAt: 0 };
  }

  function duration(minutes, maximum) {
    var value = Number(minutes);
    if (!Number.isFinite(value) || value < 1 || value > maximum) {
      throw new RangeError('Укажи длительность от 1 до ' + maximum + ' минут.');
    }
    return Math.round(value * 60000);
  }

  function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
  function label(value, limit) { return typeof value === 'string' ? value.slice(0, limit) : ''; }

  function restore(value) {
    if (!value || value.version !== 1 || typeof value.sessionId !== 'string' || !value.sessionId ||
        !['running', 'paused', 'finished'].includes(value.phase) ||
        !['focus', 'break'].includes(value.mode) ||
        !finite(value.durationMs) || value.durationMs < 60000 ||
        value.durationMs > (value.mode === 'break' ? MAX_BREAK_MINUTES : MAX_FOCUS_MINUTES) * 60000 ||
        !finite(value.remainingMs) || value.remainingMs < 0 || value.remainingMs > value.durationMs ||
        !finite(value.startedAt) || value.startedAt < 0 ||
        !finite(value.deadline) || value.deadline < 0 ||
        !finite(value.pausedAt) || value.pausedAt < 0 ||
        !finite(value.finishedAt) || value.finishedAt < 0 ||
        (value.phase === 'running' && value.deadline === 0)) return emptyState();
    return {
      sessionId: label(value.sessionId, 160), phase: value.phase, mode: value.mode,
      taskId: value.mode === 'focus' ? label(value.taskId, 500) : '',
      title: value.mode === 'focus' ? label(value.title, 300) : 'Перерыв',
      durationMs: value.durationMs, remainingMs: value.phase === 'finished' ? 0 : value.remainingMs,
      startedAt: value.startedAt, deadline: value.deadline,
      pausedAt: value.pausedAt, finishedAt: value.finishedAt,
    };
  }

  function createTimer(options) {
    options = options || {};
    var now = typeof options.now === 'function' ? options.now : Date.now;
    var schedule = Object.prototype.hasOwnProperty.call(options, 'setInterval') ? options.setInterval : root.setInterval;
    var cancel = Object.prototype.hasOwnProperty.call(options, 'clearInterval') ? options.clearInterval : root.clearInterval;
    var storage;
    try { storage = Object.prototype.hasOwnProperty.call(options, 'storage') ? options.storage : root.localStorage; }
    catch (_) { storage = null; }
    var scope = scopeKey(options.scope);
    var state = emptyState();
    var initialized = false;
    var interval = null;
    var listeners = new Set();
    var storageAvailable = Boolean(storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function');
    var sessionCounter = 0;

    function timestamp() {
      var value = Number(now());
      if (!Number.isFinite(value) || value < 0) throw new RangeError('Не удалось определить текущее время.');
      return value;
    }

    function storageKey() { return STORAGE_PREFIX + encodeURIComponent(scope); }

    function snapshot() {
      var result = Object.assign({}, state);
      if (state.phase === 'running') result.remainingMs = Math.max(0, Math.min(state.durationMs, state.deadline - timestamp()));
      result.scope = scope === 'guest' ? null : scope.slice(5);
      result.storageAvailable = storageAvailable;
      return result;
    }

    function emit(type) {
      var value = snapshot();
      var event = { type: type, sessionId: value.sessionId, mode: value.mode };
      listeners.forEach(function (listener) {
        try { listener(Object.assign({}, value), Object.assign({}, event)); }
        catch (error) {
          // A UI listener must not stop the clock or prevent persistence.
          if (root.console && typeof root.console.error === 'function') root.console.error('HVF focus listener:', error);
        }
      });
    }

    function haltInterval() {
      if (interval !== null && typeof cancel === 'function') cancel(interval);
      interval = null;
    }

    function runInterval() {
      if (!initialized || state.phase !== 'running' || interval !== null || typeof schedule !== 'function') return;
      interval = schedule(function () {
        if (!advance(true) && state.phase === 'running') emit('tick');
      }, 1000);
      if (interval && typeof interval.unref === 'function') interval.unref();
    }

    function persist() {
      if (!storageAvailable) return;
      try {
        if (state.phase === 'idle') {
          if (typeof storage.removeItem === 'function') storage.removeItem(storageKey());
          else storage.setItem(storageKey(), JSON.stringify({ version: 1, phase: 'idle' }));
        } else storage.setItem(storageKey(), JSON.stringify(Object.assign({ version: 1 }, state)));
      } catch (_) { storageAvailable = false; }
    }

    function load() {
      state = emptyState();
      if (storageAvailable) {
        var raw;
        try {
          raw = storage.getItem(storageKey());
        } catch (_) { storageAvailable = false; }
        // A corrupt entry is ignored; unavailable storage keeps a live in-memory timer.
        if (raw) { try { state = restore(JSON.parse(raw)); } catch (_) { state = emptyState(); } }
      }
      advance(false);
    }

    function advance(notify) {
      if (state.phase !== 'running' || state.deadline > timestamp()) return false;
      state = Object.assign({}, state, { phase: 'finished', remainingMs: 0, pausedAt: 0, finishedAt: state.deadline });
      haltInterval();
      persist();
      if (notify) emit('finished');
      return true;
    }

    function init() {
      if (!initialized) {
        initialized = true;
        load();
      }
      advance(true);
      runInterval();
      return snapshot();
    }

    function getState() { init(); return snapshot(); }

    function begin(mode, task, minutes) {
      var durationMs = duration(minutes, mode === 'break' ? MAX_BREAK_MINUTES : MAX_FOCUS_MINUTES);
      init();
      haltInterval();
      var startedAt = timestamp();
      state = {
        sessionId: startedAt.toString(36) + '-' + (++sessionCounter).toString(36) + '-' + Math.random().toString(36).slice(2, 10),
        phase: 'running', mode: mode,
        taskId: mode === 'focus' ? label(task.taskId, 500) : '',
        title: mode === 'focus' ? label(task.title, 300) || 'Фокус' : 'Перерыв',
        durationMs: durationMs, remainingMs: durationMs, startedAt: startedAt,
        deadline: startedAt + durationMs, pausedAt: 0, finishedAt: 0,
      };
      persist();
      runInterval();
      emit('start');
      return snapshot();
    }

    function start(task) {
      task = task || {};
      return begin('focus', task, task.minutes === undefined ? 25 : task.minutes);
    }

    function startBreak(minutes) { return begin('break', {}, minutes === undefined ? 5 : minutes); }

    function pause() {
      init();
      if (state.phase !== 'running') return snapshot();
      var at = timestamp();
      state = Object.assign({}, state, { phase: 'paused', remainingMs: Math.min(state.durationMs, Math.max(0, state.deadline - at)), deadline: 0, pausedAt: at });
      haltInterval();
      persist();
      emit('pause');
      return snapshot();
    }

    function resume() {
      init();
      if (state.phase !== 'paused') return snapshot();
      state = Object.assign({}, state, { phase: 'running', deadline: timestamp() + state.remainingMs, pausedAt: 0 });
      persist();
      runInterval();
      emit('resume');
      return snapshot();
    }

    function stop() {
      init();
      haltInterval();
      state = emptyState();
      persist();
      emit('stop');
      return snapshot();
    }

    function setScope(value) {
      var next = scopeKey(value);
      if (next === scope) return getState();
      haltInterval();
      scope = next;
      initialized = true;
      load();
      runInterval();
      emit('scope');
      return snapshot();
    }

    function subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Нужна функция подписки.');
      init();
      listeners.add(listener);
      listener(snapshot(), { type: 'state', sessionId: state.sessionId, mode: state.mode });
      return function () { listeners.delete(listener); };
    }

    function destroy() {
      haltInterval();
      listeners.clear();
      initialized = false;
    }

    return { init: init, getState: getState, subscribe: subscribe, start: start, startBreak: startBreak,
      pause: pause, resume: resume, stop: stop, setScope: setScope, destroy: destroy };
  }

  return Object.assign(createTimer(), { createTimer: createTimer, STORAGE_PREFIX: STORAGE_PREFIX,
    MAX_FOCUS_MINUTES: MAX_FOCUS_MINUTES, MAX_BREAK_MINUTES: MAX_BREAK_MINUTES });
}));
