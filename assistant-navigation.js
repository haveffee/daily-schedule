(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HVFNavigation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ROUTES = Object.freeze(['overview', 'day', 'goals', 'money', 'settings']);
  const INTERACTIVE = 'a,button,input,select,textarea,label,summary,video,audio,[contenteditable]:not([contenteditable="false"]),[draggable="true"],[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="textbox"],[role="combobox"],[role="spinbutton"],[role="menuitem"],[data-no-swipe],[data-swipe-ignore],[role="tablist"],[role="slider"],[aria-roledescription="carousel"],.carousel';
  const THRESHOLD = 76;
  const EDGE = 24;
  const MAX_DURATION = 1000;
  const EASING = 'cubic-bezier(.23,1,.32,1)';
  const DURATION = 260;
  const SNAPSHOT_BUDGET = 320;

  function route(value) {
    return String(value || '').replace(/^#\/?/, '').split(/[/?]/)[0];
  }

  function neighbor(value, direction) {
    const index = ROUTES.indexOf(route(value));
    if (index < 0 || (direction !== 1 && direction !== -1)) return null;
    return ROUTES[index + direction] || null;
  }

  function gesture(start, end) {
    if (!start || !end) return 0;
    const numbers = [start.x, start.y, start.time, end.x, end.y, end.time];
    if (!numbers.every(Number.isFinite)) return 0;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const elapsed = end.time - start.time;
    const flick = elapsed > 0 && elapsed <= 260 && Math.abs(dx) >= 32 && Math.abs(dx) / elapsed >= .5;
    if (elapsed < 0 || elapsed > MAX_DURATION || (!flick && Math.abs(dx) < THRESHOLD) || Math.abs(dx) < Math.abs(dy) * 1.7) return 0;
    return dx < 0 ? 1 : -1;
  }

  // The page follows the finger directly, then gently resists a very long drag.
  function displacement(dx, hasNeighbor, width = 390) {
    if (!Number.isFinite(dx)) return 0;
    const distance = Math.abs(dx);
    const direct = Math.max(160, width * .8);
    const resistance = Math.max(40, width * .15);
    const amount = hasNeighbor ? (distance <= direct ? distance : direct + resistance * (1 - Math.exp(-(distance - direct) / resistance))) : 22 * (1 - Math.exp(-distance / 80));
    return Math.sign(dx) * amount;
  }

  function create(options) {
    options = options || {};
    const surface = options.root;
    const win = options.window || (typeof window !== 'undefined' ? window : null);
    const doc = options.document || (win && win.document);
    const motionPreference = win && typeof win.matchMedia === 'function' ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const getRoute = typeof options.getRoute === 'function' ? options.getRoute : () => win && win.location && win.location.hash;
    const navigate = typeof options.navigate === 'function' ? options.navigate : function () {};
    const listeners = [];
    let active = null;
    let pending = null;
    let prepared = null;
    let scene = null;
    let returnMotion = null;
    let frame = null;
    let dragOffset = 0;
    let scheduledOffset = 0;
    let initialized = false;
    let keyboardInput = false;
    let capturedPointer = null;

    function media(query) {
      return !!(win && typeof win.matchMedia === 'function' && win.matchMedia(query).matches);
    }

    function reduced() { return !!(motionPreference && motionPreference.matches); }
    function mobile() { return media('(max-width: 800px)') && media('(pointer: coarse)'); }
    function later(callback, ms) { return win && typeof win.setTimeout === 'function' ? win.setTimeout(callback, ms) : null; }
    function clearLater(id) { if (id !== null && win && typeof win.clearTimeout === 'function') win.clearTimeout(id); }
    function translate(value) { return 'translate3d(' + value.toFixed(2) + 'px,0,0)'; }
    function style(node, name, value) { if (node && node.style) node.style.setProperty(name, value); }
    function unstyle(node, name) { if (node && node.style) node.style.removeProperty(name); }

    function blocked() {
      if (!mobile() || (options.isBlocked && options.isBlocked())) return true;
      if (doc && doc.visibilityState === 'hidden') return true;
      if (doc && typeof doc.querySelector === 'function' && doc.querySelector('dialog[open],[aria-modal="true"]')) return true;
      const selection = win && typeof win.getSelection === 'function' ? win.getSelection() : null;
      return !!(selection && !selection.isCollapsed && String(selection).trim());
    }

    function ignored(target) {
      const element = target && (target.nodeType === 3 ? target.parentElement : target);
      if (!element) return true;
      if (typeof element.closest === 'function' && element.closest(INTERACTIVE)) return true;
      let current = element;
      while (current) {
        if (current.scrollWidth > current.clientWidth + 2 && win && typeof win.getComputedStyle === 'function') {
          const overflow = win.getComputedStyle(current).overflowX;
          if (overflow === 'auto' || overflow === 'scroll') return true;
        }
        if (current === surface) break;
        current = current.parentElement;
      }
      return false;
    }

    function timestamp(event) {
      if (Number.isFinite(event.timeStamp)) return event.timeStamp;
      return win && win.performance ? win.performance.now() : Date.now();
    }

    function point(event, contact) { return { x: contact.clientX, y: contact.clientY, time: timestamp(event) }; }

    function cancelFrame() {
      if (frame !== null && win && typeof win.cancelAnimationFrame === 'function') win.cancelAnimationFrame(frame);
      frame = null;
    }

    function paintDrag(offset) {
      dragOffset = reduced() ? 0 : offset;
      style(surface, 'transform', translate(dragOffset));
    }

    // Read an interrupted compositor position before cancelling it. The next
    // gesture starts at that pixel, rather than snapping the page back to zero.
    function presentationOffset() {
      if (!win || typeof win.getComputedStyle !== 'function') return dragOffset;
      const value = win.getComputedStyle(surface).transform || '';
      const matrix = value.match(/^matrix(3d)?\(([^)]+)\)$/);
      if (matrix) {
        const values = matrix[2].split(',').map(Number);
        const offset = values[matrix[1] ? 12 : 4];
        if (Number.isFinite(offset)) return offset;
      }
      const translate = value.match(/translate(?:3d|X)?\(\s*([-\d.]+)px/);
      return translate && Number.isFinite(Number(translate[1])) ? Number(translate[1]) : dragOffset;
    }

    function releasePointer() {
      if (capturedPointer !== null && surface && typeof surface.releasePointerCapture === 'function') {
        try { surface.releasePointerCapture(capturedPointer); } catch (_) { /* The browser may already have released it. */ }
      }
      capturedPointer = null;
    }

    function queueDrag(offset) {
      scheduledOffset = offset;
      if (frame !== null) return;
      if (!win || typeof win.requestAnimationFrame !== 'function') return paintDrag(offset);
      frame = win.requestAnimationFrame(() => { frame = null; paintDrag(scheduledOffset); });
    }

    function resetDrag() {
      cancelFrame();
      dragOffset = scheduledOffset = 0;
      if (surface && surface.classList) surface.classList.remove('hvf-is-dragging');
      unstyle(surface, 'transform');
    }

    // Each motion has one cleanup path, including interrupted transitions and suspended tabs.
    function motion(node, frames, duration, cssClass, finish, easing = EASING) {
      let animation = null;
      let timer = null;
      let done = false;
      const end = event => { if (!event || event.target === node) complete(); };
      const cleanup = () => {
        if (done) return;
        done = true;
        clearLater(timer);
        node.removeEventListener('animationend', end);
        node.classList.remove(cssClass);
        if (animation) { animation.onfinish = null; animation.cancel(); }
      };
      const complete = () => { if (done) return; cleanup(); finish(); };
      if (typeof node.animate === 'function') {
        try {
          animation = node.animate(frames, { duration, easing, fill: 'both' });
          animation.onfinish = complete;
        } catch (_) { /* CSS and the cleanup deadline remain available. */ }
      }
      if (!animation) {
        node.addEventListener('animationend', end);
        node.classList.add(cssClass);
      }
      timer = later(complete, duration + 100);
      return cleanup;
    }

    function discardPrepared() {
      if (prepared && prepared.snapshot && typeof prepared.snapshot.remove === 'function') prepared.snapshot.remove();
      prepared = null;
    }

    function finishScene() {
      const current = scene;
      scene = null;
      if (current) {
        current.cleanups.forEach(clear => clear());
        if (current.snapshot && typeof current.snapshot.remove === 'function') current.snapshot.remove();
        current.content.classList.remove('hvf-route-enter');
        ['transform', 'opacity', '--hvf-route-start', '--hvf-route-duration', '--hvf-route-opacity'].forEach(name => unstyle(current.content, name));
      }
    }

    function clearReturn() {
      if (returnMotion) returnMotion();
      returnMotion = null;
      if (surface && surface.classList) surface.classList.remove('hvf-route-return');
      unstyle(surface, '--hvf-drag-start');
    }

    function clearPending() {
      if (pending) clearLater(pending.timer);
      pending = null;
    }

    function settle() {
      if (returnMotion && !active && !pending) return;
      const velocity = active && active.velocity || 0;
      active = null;
      releasePointer();
      clearPending();
      cancelFrame();
      clearReturn();
      const offset = dragOffset;
      if (!surface || !surface.classList || !offset || reduced()) return resetDrag();
      surface.classList.remove('hvf-is-dragging');
      style(surface, '--hvf-drag-start', offset.toFixed(2) + 'px');
      // Sample the duration .5 / bounce .2 spring once, then hand it to WAAPI.
      // No per-frame JavaScript runs while the compositor settles the gesture.
      const bounce = .2, seconds = .5;
      const ratio = -Math.log(bounce) / Math.sqrt(Math.PI ** 2 + Math.log(bounce) ** 2);
      const natural = -Math.log(.001) / (ratio * seconds);
      const damped = natural * Math.sqrt(1 - ratio ** 2);
      const frames = Array.from({ length: 31 }, (_, index) => {
        const time = seconds * index / 30;
        const position = Math.exp(-ratio * natural * time) * (offset * Math.cos(damped * time) + (velocity * 1000 + ratio * natural * offset) / damped * Math.sin(damped * time));
        return { transform: translate(index === 30 ? 0 : position), offset: index / 30 };
      });
      returnMotion = motion(surface, frames, 500, 'hvf-route-return', () => { returnMotion = null; resetDrag(); unstyle(surface, '--hvf-drag-start'); }, 'linear');
    }

    function cancel() {
      active = null;
      releasePointer();
      clearPending();
      clearReturn();
      finishScene();
      discardPrepared();
      resetDrag();
    }

    function begin(event, contact, id) {
      if (active || pending) return;
      if (blocked() || ignored(event.target)) return;
      const from = route(getRoute());
      if (!ROUTES.includes(from)) return;
      const width = Number(win.innerWidth) || (doc && doc.documentElement && doc.documentElement.clientWidth) || 0;
      const start = point(event, contact);
      if (!width || start.x <= EDGE || start.x >= width - EDGE) return;
      const origin = reduced() ? 0 : returnMotion || scene ? presentationOffset() : dragOffset;
      clearReturn();
      finishScene();
      resetDrag();
      if (origin) paintDrag(origin);
      active = { ...start, id, from, origin, last: start, velocity: 0, locked: false };
    }

    function offsetFor(from, dx) { return displacement(dx, !!neighbor(from, dx < 0 ? 1 : -1), Number(win && win.innerWidth) || 390); }

    function move(event, contact) {
      if (!active) return;
      const next = point(event, contact);
      const dx = next.x - active.x;
      const dy = next.y - active.y;
      if (blocked() || next.time - active.time > MAX_DURATION || (!active.locked && Math.abs(dy) > 16 && Math.abs(dy) > Math.abs(dx) * 0.8)) return settle();
      if (!active.locked && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.25) {
        active.locked = true;
        surface.classList.remove('view-enter');
        surface.classList.add('hvf-is-dragging');
        if (win.PointerEvent && typeof surface.setPointerCapture === 'function') {
          try { surface.setPointerCapture(active.id); capturedPointer = active.id; } catch (_) { /* Window listeners retain the fallback. */ }
        }
      }
      const interval = next.time - active.last.time;
      if (interval > 0) active.velocity = (next.x - active.last.x) / interval;
      active.last = next;
      if (active.locked) queueDrag(active.origin + offsetFor(active.from, dx));
    }

    function finish(event, contact) {
      const start = active;
      if (!start || blocked() || route(getRoute()) !== start.from) return settle();
      const end = point(event, contact);
      const direction = gesture(start, end);
      const next = neighbor(start.from, direction);
      if (end.time - start.last.time > 100) start.velocity = 0;
      // Reversing the finger at release means keep this section, even if an
      // earlier part of the drag happened to cross the distance threshold.
      if (direction && start.velocity * direction > .35) return settle();
      if (!next) return settle();
      active = null;
      releasePointer();
      cancelFrame();
      paintDrag(start.origin + offsetFor(start.from, end.x - start.x));
      pending = { from: start.from, to: next, offset: dragOffset, velocity: start.velocity, timer: null };
      pending.timer = later(() => { if (pending) settle(); }, 650);
      // Keep the last finger position until the synchronous render captures it.
      try { navigate(next); } catch (error) { settle(); throw error; }
    }

    function updateSurfaceRoute(value) {
      if (!surface || !surface.classList) return;
      surface.classList[ROUTES.includes(route(value)) ? 'add' : 'remove']('hvf-swipe-surface');
    }

    function listen(target, name, handler) {
      target.addEventListener(name, handler, { passive: true });
      listeners.push(() => target.removeEventListener(name, handler));
    }

    function init() {
      if (initialized || !surface || !win || typeof surface.addEventListener !== 'function') return;
      initialized = true;
      updateSurfaceRoute(getRoute());
      listen(win, 'keydown', event => { if (['Enter', ' ', 'Spacebar'].includes(event.key)) keyboardInput = true; });
      listen(win, 'pointerdown', () => { keyboardInput = false; });
      if (win.PointerEvent) {
        listen(surface, 'pointerdown', event => {
          if (event.pointerType !== 'touch') return;
          if (event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return settle();
          begin(event, event, event.pointerId);
        });
        listen(win, 'pointerdown', event => { if (event.pointerType === 'touch' && event.isPrimary === false) settle(); });
        listen(win, 'pointermove', event => { if (active && event.pointerId === active.id) move(event, event); });
        listen(win, 'pointerup', event => { if (active && event.pointerId === active.id) finish(event, event); });
        listen(win, 'pointercancel', settle);
      } else {
        listen(surface, 'touchstart', event => {
          keyboardInput = false;
          if (!event.touches || event.touches.length !== 1) return settle();
          begin(event, event.touches[0], event.touches[0].identifier);
        });
        listen(win, 'touchstart', event => { if (!event.touches || event.touches.length !== 1) settle(); });
        listen(win, 'touchmove', event => {
          if (!active) return;
          if (!event.touches || event.touches.length !== 1) return settle();
          const contact = event.touches[0];
          if (contact.identifier === active.id) move(event, contact);
          else settle();
        });
        listen(win, 'touchend', event => {
          if (!active) return;
          if (event.touches && event.touches.length) return settle();
          const contact = Array.from(event.changedTouches || []).find(item => item.identifier === active.id);
          if (contact) finish(event, contact);
          else settle();
        });
        listen(win, 'touchcancel', settle);
      }
      listen(win, 'blur', cancel);
      listen(win, 'resize', cancel);
      if (doc && typeof doc.addEventListener === 'function') listen(doc, 'visibilitychange', cancel);
      if (motionPreference && typeof motionPreference.addEventListener === 'function') listen(motionPreference, 'change', () => { if (reduced()) cancel(); });
    }

    // The outgoing scene is transient and inert. Strip identifiers and action hooks so
    // background form queries and delegated events can never treat it as live UI.
    function snapshot(content, offset) {
      if (!doc || !doc.body || typeof doc.createElement !== 'function' || typeof content.cloneNode !== 'function' || typeof content.getBoundingClientRect !== 'function') return null;
      // Do not duplicate a long financial history or a busy dashboard just for
      // decoration. Those routes use the cheap incoming layer on their own.
      const descendants = typeof content.getElementsByTagName === 'function' ? content.getElementsByTagName('*') : content.querySelectorAll('*');
      if (descendants.length > SNAPSHOT_BUDGET) return null;
      const rect = content.getBoundingClientRect();
      let opacity = '1';
      if (scene && scene.content === content && win && typeof win.getComputedStyle === 'function') {
        const currentOpacity = Number.parseFloat(win.getComputedStyle(content).opacity);
        if (Number.isFinite(currentOpacity)) opacity = String(Math.max(0, Math.min(1, currentOpacity)));
      }
      const height = Number(win.innerHeight) || (doc.documentElement && doc.documentElement.clientHeight) || 0;
      const top = Math.max(0, rect.top);
      if (!rect.width || !height || top >= height || rect.bottom <= 0) return null;
      const wrapper = doc.createElement('div');
      const copy = content.cloneNode(true);
      wrapper.className = 'hvf-route-snapshot';
      wrapper.setAttribute('aria-hidden', 'true');
      wrapper.setAttribute('inert', '');
      wrapper.inert = true;
      const nodes = [copy, ...Array.from(copy.querySelectorAll('*'))];
      nodes.forEach(node => {
        Array.from(node.attributes || []).forEach(attribute => {
          if (attribute.name === 'id' || attribute.name === 'name' || attribute.name === 'for' || attribute.name.startsWith('data-')) node.removeAttribute(attribute.name);
        });
        if ('disabled' in node) node.disabled = true;
        if (typeof node.removeAttribute === 'function') node.removeAttribute('autofocus');
      });
      Array.from(copy.querySelectorAll('script,iframe,object,embed')).forEach(node => node.remove());
      const liveControls = Array.from(content.querySelectorAll('input,textarea,select'));
      Array.from(copy.querySelectorAll('input,textarea,select')).forEach((control, index) => {
        const live = liveControls[index];
        if (!live) return;
        const type = String(live.type || (typeof live.getAttribute === 'function' && live.getAttribute('type')) || '').toLowerCase();
        if (type === 'file' || type === 'password') {
          control.value = '';
          if (typeof control.removeAttribute === 'function') control.removeAttribute('value');
          return;
        }
        control.value = live.value;
        if ('checked' in control) control.checked = live.checked;
      });
      copy.classList.remove('view-enter', 'hvf-route-enter', 'hvf-is-dragging', 'hvf-css-enter', 'hvf-route-return');
      style(wrapper, 'left', (rect.left - offset) + 'px');
      style(wrapper, 'top', top + 'px');
      style(wrapper, 'width', rect.width + 'px');
      style(wrapper, 'height', Math.min(height - top, rect.bottom - top) + 'px');
      style(wrapper, 'transform', translate(offset));
      style(copy, 'position', 'absolute');
      style(copy, 'top', (rect.top - top) + 'px');
      style(copy, 'left', '0');
      style(copy, 'margin', '0');
      style(copy, 'width', '100%');
      style(copy, 'max-width', 'none');
      style(copy, 'transform', 'none');
      style(copy, 'opacity', opacity);
      wrapper.appendChild(copy);
      doc.body.appendChild(wrapper);
      return wrapper;
    }

    function prepare(content, from, to, intent) {
      const previous = route(from);
      const next = route(to);
      const refresh = !!(intent && intent.refresh);
      discardPrepared();
      if (!content || !content.classList || !previous || (previous === next && !refresh)) return false;
      const offset = refresh ? 0 : pending && pending.from === previous && pending.to === next ? pending.offset : dragOffset;
      const handoff = !refresh && pending && pending.from === previous && pending.to === next ? { velocity: pending.velocity } : null;
      const image = reduced() || keyboardInput || refresh ? null : snapshot(content, offset);
      active = null;
      releasePointer();
      clearPending();
      clearReturn();
      finishScene();
      resetDrag();
      prepared = { content, from: previous, to: next, offset, snapshot: image, refresh, handoff };
      return !!image;
    }

    function enter(content, from, to, intent) {
      if (!content || !content.classList) return false;
      const previous = route(from);
      const next = route(to);
      const refresh = !!(intent && intent.refresh);
      updateSurfaceRoute(next);
      if (!previous || (previous === next && !refresh)) return false;
      const captured = prepared && prepared.content === content && prepared.from === previous && prepared.to === next && prepared.refresh === refresh ? prepared : null;
      if (!captured) { discardPrepared(); finishScene(); resetDrag(); clearPending(); active = null; }
      prepared = null;
      content.classList.remove('view-enter', 'hvf-route-enter');
      // The old scene is fixed to its original viewport; scrolling never teleports it.
      if (!refresh && win && typeof win.scrollTo === 'function') win.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      if (reduced() || keyboardInput) {
        if (captured && captured.snapshot) captured.snapshot.remove();
        return false;
      }
      const oldIndex = ROUTES.indexOf(previous);
      const newIndex = ROUTES.indexOf(next);
      const requestedDirection = intent && intent.direction;
      const direction = refresh ? (requestedDirection === -1 || requestedDirection === 1 ? requestedDirection : 0) : oldIndex >= 0 && newIndex >= 0 ? Math.sign(newIndex - oldIndex) : 0;
      const width = Number(win && win.innerWidth) || 390;
      const handoff = captured && captured.handoff && captured.snapshot;
      const velocity = captured && captured.handoff ? Math.abs(captured.handoff.velocity) : 0;
      const duration = refresh ? 160 : handoff && velocity > 0 ? Math.max(180, Math.min(DURATION, (width - Math.abs(captured.offset)) / velocity)) : DURATION;
      const opacity = handoff ? 1 : refresh ? .78 : .72;
      const start = refresh ? 0 : handoff ? direction * width + captured.offset : direction * 24;
      const oldStart = captured ? captured.offset : 0;
      const oldEnd = -direction * (handoff ? width : 24);
      const current = { content, snapshot: captured && captured.snapshot, cleanups: [] };
      scene = current;
      style(content, '--hvf-route-start', start.toFixed(2) + 'px');
      style(content, '--hvf-route-duration', duration + 'ms');
      style(content, '--hvf-route-opacity', String(opacity));
      content.classList.add('hvf-route-enter');
      current.cleanups.push(motion(content, [{ opacity, transform: translate(start) }, { opacity: 1, transform: translate(0) }], duration, 'hvf-css-enter', () => { if (scene === current) finishScene(); }));
      if (current.snapshot) {
        style(current.snapshot, '--hvf-old-start', oldStart.toFixed(2) + 'px');
        style(current.snapshot, '--hvf-old-end', oldEnd.toFixed(2) + 'px');
        style(current.snapshot, '--hvf-route-duration', duration + 'ms');
        current.cleanups.push(motion(current.snapshot, [{ opacity: 1, transform: translate(oldStart) }, { opacity: 0, transform: translate(oldEnd) }], duration, 'hvf-css-leave', () => {}));
      }
      return true;
    }

    function getState() { return { dragging: !!(active && active.locked), pending: !!pending, transitioning: !!(scene || prepared || returnMotion) }; }

    function destroy() {
      cancel();
      listeners.splice(0).forEach(remove => remove());
      if (surface && surface.classList) surface.classList.remove('hvf-swipe-surface');
      initialized = false;
    }

    return Object.freeze({ init, destroy, prepare, enter, cancel, settle, getState });
  }

  return Object.freeze({ routes: ROUTES, route, neighbor, gesture, displacement, create });
});
