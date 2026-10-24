(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HVFMotion = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CONTROL = 'button,a[href],summary,[role="button"],.backup-file-label,input[type="checkbox"],input[type="radio"]';
  const EASE = 'cubic-bezier(.22,1,.36,1)';

  // Feedback never postpones a click or a model write. The only deferred native
  // action is closing a dialog deliberately dismissed by the user.
  function create(options) {
    options = options || {};
    const win = options.window || (typeof window !== 'undefined' ? window : null);
    const doc = options.document || (win && win.document);
    const surface = options.root || doc;
    const listeners = [];
    const pressed = new Map();
    const pending = new Set();
    const dialogs = new Map();
    const details = new Map();
    const timeout = options.setTimeout || (win && typeof win.setTimeout === 'function' ? win.setTimeout.bind(win) : setTimeout);
    const clear = options.clearTimeout || (win && typeof win.clearTimeout === 'function' ? win.clearTimeout.bind(win) : clearTimeout);
    const preference = win && typeof win.matchMedia === 'function' ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let initialized = false;
    let destroyed = false;

    function reduced() { return !!(preference && preference.matches); }
    function quiet() { return reduced() || !!(doc && doc.visibilityState === 'hidden'); }
    function classAdd(element, name) { if (element && element.classList) element.classList.add(name); }
    function classRemove(element, name) { if (element && element.classList) element.classList.remove(name); }
    function listen(target, type, callback, settings) {
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(type, callback, settings);
      listeners.push(() => target.removeEventListener(type, callback, settings));
    }

    function animate(element, frames, duration, complete) {
      if (destroyed || quiet() || !element || typeof element.animate !== 'function') {
        if (complete) complete();
        return null;
      }
      let animation, timer, live = true;
      function dispose(finish) {
        if (!live) return;
        live = false;
        if (timer !== undefined) clear(timer);
        pending.delete(handle);
        if (animation && typeof animation.cancel === 'function') animation.cancel();
        if (finish && complete) complete();
      }
      const handle = { cancel: () => dispose(false), finish: () => dispose(true) };
      try {
        animation = element.animate(frames, { duration, easing: EASE, fill: 'both' });
      } catch (_) {
        live = false;
        if (complete) complete();
        return null;
      }
      pending.add(handle);
      // A hidden tab or an interrupted compositor must never trap a modal open.
      timer = timeout(handle.finish, duration + 90);
      if (animation.finished && typeof animation.finished.then === 'function') animation.finished.then(handle.finish, () => {});
      else animation.onfinish = handle.finish;
      return handle;
    }

    function control(target) {
      const element = target && (target.nodeType === 3 ? target.parentElement : target);
      if (!element || typeof element.closest !== 'function') return null;
      const result = element.closest(CONTROL);
      if (!result || result.disabled || (typeof result.getAttribute === 'function' && result.getAttribute('aria-disabled') === 'true')) return null;
      return result;
    }
    function release(key) {
      const held = pressed.get(key);
      if (!held) return;
      pressed.delete(key);
      if (!Array.from(pressed.values()).some(item => item.element === held.element)) classRemove(held.element, 'hvf-pressed');
    }
    function releaseAll() {
      for (const key of Array.from(pressed.keys())) release(key);
    }
    function onDown(event) {
      if (quiet() || event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
      const element = control(event.target);
      if (!element) return;
      const key = event.pointerId === undefined ? 1 : event.pointerId;
      release(key);
      pressed.set(key, { element, x: event.clientX, y: event.clientY });
      classAdd(element, 'hvf-pressed');
    }
    function onMove(event) {
      const key = event.pointerId === undefined ? 1 : event.pointerId;
      const held = pressed.get(key);
      if (held && Math.hypot(event.clientX - held.x, event.clientY - held.y) > 14) release(key);
    }
    function onUp(event) { release(event.pointerId === undefined ? 1 : event.pointerId); }
    function onKeyDown(event) {
      if (event.repeat || quiet() || !['Enter', ' ', 'Spacebar'].includes(event.key)) return;
      const element = control(event.target);
      if (!element) return;
      if (String(element.tagName).toLowerCase() === 'label') return;
      const key = 'key:' + event.key;
      release(key);
      pressed.set(key, { element });
      classAdd(element, 'hvf-pressed');
    }
    function onKeyUp(event) { release('key:' + event.key); }

    function currentDialogFrame(dialog) {
      const frame = { opacity: 1, transform: 'translateY(0) scale(1)' };
      if (!win || typeof win.getComputedStyle !== 'function') return frame;
      try {
        const computed = win.getComputedStyle(dialog);
        const opacity = Number.parseFloat(computed.opacity);
        if (Number.isFinite(opacity)) frame.opacity = Math.max(0, Math.min(1, opacity));
        if (typeof computed.transform === 'string' && computed.transform.trim()) frame.transform = computed.transform;
      } catch (_) { /* Detached or unsupported surfaces use the resting frame. */ }
      return frame;
    }
    function restoreDialogInert(dialog, state) {
      if (!state.ownsInert) return;
      dialog.inert = state.previousInert;
      state.ownsInert = false;
    }
    function trackDialog(dialog) {
      if (dialogs.has(dialog)) return dialogs.get(dialog);
      const state = { generation: 0, run: null, closing: false, complete: null, ownsInert: false, previousInert: false };
      dialogs.set(dialog, state);
      listen(dialog, 'close', () => {
        state.generation += 1;
        if (state.run) state.run.cancel();
        state.run = null;
        state.closing = false;
        state.complete = null;
        restoreDialogInert(dialog, state);
        classRemove(dialog, 'hvf-dialog-exiting');
      });
      return state;
    }
    function open(dialog) {
      if (!dialog || typeof dialog.showModal !== 'function') return;
      const state = trackDialog(dialog);
      const wasOpen = !!dialog.open;
      const reopening = wasOpen && state.closing;
      // Read the current compositor frame before cancelling its animation.
      const resumeFrame = reopening && !quiet() ? currentDialogFrame(dialog) : null;
      state.generation += 1;
      if (state.run) state.run.cancel();
      restoreDialogInert(dialog, state);
      state.run = null;
      state.closing = false;
      state.complete = null;
      classRemove(dialog, 'hvf-dialog-exiting');
      classAdd(dialog, 'hvf-dialog-motion');
      if (!wasOpen) dialog.showModal();
      // Stepping through onboarding keeps the same dialog in place.
      const stage = wasOpen && !reopening && typeof dialog.querySelector === 'function' ? dialog.querySelector('#dialogFields') : null;
      const generation = state.generation;
      state.run = animate(stage || dialog, stage ? [
        { opacity: .6, transform: 'translateY(7px)' }, { opacity: 1, transform: 'translateY(0)' }
      ] : [
        resumeFrame || { opacity: 0, transform: 'translateY(22px) scale(.975)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }
      ], stage ? 230 : 340, () => { if (state.generation === generation) state.run = null; });
    }
    function close(dialog, settings) {
      settings = settings || {};
      if (!dialog) return false;
      const state = trackDialog(dialog);
      if (state.closing && !settings.immediate) return false;
      const fromFrame = dialog.open && !settings.immediate && !quiet() && !destroyed ? currentDialogFrame(dialog) : null;
      state.generation += 1;
      const generation = state.generation;
      if (state.run) state.run.cancel();
      restoreDialogInert(dialog, state);
      state.run = null;
      state.closing = true;
      state.complete = typeof settings.onClosed === 'function' ? settings.onClosed : null;
      function finish() {
        if (state.generation !== generation) return;
        const callback = state.complete;
        state.complete = null;
        state.closing = false;
        state.run = null;
        restoreDialogInert(dialog, state);
        classRemove(dialog, 'hvf-dialog-exiting');
        if (dialog.open && typeof dialog.close === 'function') dialog.close();
        if (callback) callback();
      }
      if (!dialog.open || settings.immediate || quiet() || destroyed) { finish(); return true; }
      state.previousInert = dialog.inert;
      state.ownsInert = true;
      dialog.inert = true;
      classAdd(dialog, 'hvf-dialog-exiting');
      state.run = animate(dialog, [
        fromFrame || { opacity: 1, transform: 'translateY(0) scale(1)' }, { opacity: 0, transform: 'translateY(12px) scale(.985)' }
      ], 170, finish);
      return true;
    }

    function toggleDetails(event) {
      if (event.defaultPrevented || quiet()) return;
      const target = event.target && (event.target.nodeType === 3 ? event.target.parentElement : event.target);
      const summary = target && typeof target.closest === 'function' ? target.closest('summary') : null;
      const element = summary && summary.parentElement;
      if (!element || String(element.tagName).toLowerCase() !== 'details' || typeof element.animate !== 'function' || typeof element.getBoundingClientRect !== 'function') return;
      // Links and controls nested in a summary retain their own native action.
      const nested = target && typeof target.closest === 'function' ? target.closest('a,button,input,select,textarea') : null;
      if (nested && nested !== summary) return;
      const old = details.get(element);
      const nextOpen = old ? !old.nextOpen : !element.open;
      const from = element.getBoundingClientRect().height;
      const overflow = old ? old.overflow : element.style.overflow;
      if (old && old.run) old.run.cancel();
      element.open = nextOpen;
      const to = element.getBoundingClientRect().height;
      if (!nextOpen) element.open = true;
      if (!Number.isFinite(from) || !Number.isFinite(to) || Math.abs(from - to) < 1) {
        element.open = nextOpen;
        element.style.overflow = overflow;
        details.delete(element);
        event.preventDefault();
        return;
      }
      event.preventDefault();
      element.style.overflow = 'hidden';
      const state = { nextOpen, overflow, run: null };
      details.set(element, state);
      state.run = animate(element, [{ height: from + 'px' }, { height: to + 'px' }], nextOpen ? 320 : 240, () => {
        if (details.get(element) !== state) return;
        element.open = nextOpen;
        element.style.overflow = overflow;
        details.delete(element);
      });
    }

    function settle() {
      releaseAll();
      for (const handle of Array.from(pending)) handle.finish();
    }
    function init() {
      if (initialized) return api;
      initialized = true;
      destroyed = false;
      classAdd(doc && doc.documentElement, 'hvf-motion-ready');
      listen(surface, 'pointerdown', onDown, { capture: true, passive: true });
      listen(doc, 'pointermove', onMove, { capture: true, passive: true });
      listen(doc, 'pointerup', onUp, { capture: true, passive: true });
      listen(doc, 'pointercancel', onUp, { capture: true, passive: true });
      listen(surface, 'keydown', onKeyDown, true);
      listen(doc, 'keyup', onKeyUp, true);
      listen(surface, 'click', toggleDetails);
      listen(win, 'blur', releaseAll);
      listen(doc, 'visibilitychange', () => { if (doc.visibilityState === 'hidden') settle(); });
      if (preference && typeof preference.addEventListener === 'function') listen(preference, 'change', () => { if (reduced()) settle(); });
      else if (preference && typeof preference.addListener === 'function') {
        const changed = () => { if (reduced()) settle(); };
        preference.addListener(changed);
        listeners.push(() => preference.removeListener(changed));
      }
      return api;
    }
    function destroy() {
      destroyed = true;
      settle();
      initialized = false;
      listeners.splice(0).forEach(remove => remove());
      classRemove(doc && doc.documentElement, 'hvf-motion-ready');
      for (const dialog of dialogs.keys()) {
        restoreDialogInert(dialog, dialogs.get(dialog));
        classRemove(dialog, 'hvf-dialog-motion');
        classRemove(dialog, 'hvf-dialog-exiting');
      }
      dialogs.clear();
      details.clear();
    }
    const api = { init, destroy, open, close };
    return api;
  }
  return { create };
});
