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
  const REPEAT_DELAY = 450;

  function route(value) {
    return String(value || '').replace(/^#\/?/, '').split(/[/?]/)[0];
  }

  function neighbor(value, direction) {
    const index = ROUTES.indexOf(route(value));
    if (index < 0 || (direction !== 1 && direction !== -1)) return null;
    return ROUTES[index + direction] || null;
  }

  // Deliberate horizontal movement is required; time alone cannot turn a tap into a swipe.
  function gesture(start, end) {
    if (!start || !end) return 0;
    const numbers = [start.x, start.y, start.time, end.x, end.y, end.time];
    if (!numbers.every(Number.isFinite)) return 0;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const elapsed = end.time - start.time;
    if (elapsed < 0 || elapsed > MAX_DURATION || Math.abs(dx) < THRESHOLD || Math.abs(dx) < Math.abs(dy) * 1.7) return 0;
    return dx < 0 ? 1 : -1;
  }

  function create(options) {
    options = options || {};
    const surface = options.root;
    const win = options.window || (typeof window !== 'undefined' ? window : null);
    const doc = options.document || (win && win.document);
    const getRoute = typeof options.getRoute === 'function' ? options.getRoute : () => win && win.location && win.location.hash;
    const navigate = typeof options.navigate === 'function' ? options.navigate : function () {};
    const listeners = [];
    const animations = new Map();
    let active = null;
    let initialized = false;
    let lastNavigationAt = -Infinity;

    function media(query) {
      return !!(win && typeof win.matchMedia === 'function' && win.matchMedia(query).matches);
    }

    function mobile() {
      return media('(max-width: 800px)') && media('(pointer: coarse)');
    }

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

    function point(event, contact) {
      return { x: contact.clientX, y: contact.clientY, time: timestamp(event) };
    }

    function begin(event, contact, id) {
      active = null;
      if (blocked() || ignored(event.target)) return;
      const from = route(getRoute());
      if (!ROUTES.includes(from)) return;
      const width = Number(win.innerWidth) || (doc && doc.documentElement && doc.documentElement.clientWidth) || 0;
      const start = point(event, contact);
      if (!width || start.x <= EDGE || start.x >= width - EDGE || start.time - lastNavigationAt < REPEAT_DELAY) return;
      active = { ...start, id, from };
    }

    function move(event, contact) {
      if (!active) return;
      const next = point(event, contact);
      const dx = Math.abs(next.x - active.x);
      const dy = Math.abs(next.y - active.y);
      // Once scrolling vertically, the same finger must not later switch a section.
      if (blocked() || next.time - active.time > MAX_DURATION || (dy > 16 && dy > dx * 0.8)) active = null;
    }

    function finish(event, contact) {
      const start = active;
      active = null;
      if (!start || blocked() || route(getRoute()) !== start.from) return;
      const end = point(event, contact);
      const direction = gesture(start, end);
      const next = neighbor(start.from, direction);
      if (!next || end.time - lastNavigationAt < REPEAT_DELAY) return;
      lastNavigationAt = end.time;
      navigate(next);
    }

    function cancel() { active = null; }

    function updateSurfaceRoute(value) {
      if (!surface || !surface.classList) return;
      // Auxiliary views can contain native horizontal charts, so do not restrict their panning.
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
      if (win.PointerEvent) {
        listen(surface, 'pointerdown', event => {
          if (event.pointerType !== 'touch') return;
          if (event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return cancel();
          begin(event, event, event.pointerId);
        });
        listen(win, 'pointerdown', event => {
          if (event.pointerType === 'touch' && event.isPrimary === false) cancel();
        });
        listen(win, 'pointermove', event => {
          if (active && event.pointerId === active.id) move(event, event);
        });
        listen(win, 'pointerup', event => {
          if (active && event.pointerId === active.id) finish(event, event);
        });
        listen(win, 'pointercancel', cancel);
      } else {
        listen(surface, 'touchstart', event => {
          if (!event.touches || event.touches.length !== 1) return cancel();
          begin(event, event.touches[0], event.touches[0].identifier);
        });
        listen(win, 'touchstart', event => {
          if (!event.touches || event.touches.length !== 1) cancel();
        });
        listen(win, 'touchmove', event => {
          if (!active) return;
          if (!event.touches || event.touches.length !== 1) return cancel();
          const contact = event.touches[0];
          if (contact.identifier === active.id) move(event, contact);
          else cancel();
        });
        listen(win, 'touchend', event => {
          if (!active) return;
          if (event.touches && event.touches.length) return cancel();
          const contact = Array.from(event.changedTouches || []).find(item => item.identifier === active.id);
          if (contact) finish(event, contact);
          else cancel();
        });
        listen(win, 'touchcancel', cancel);
      }
      listen(win, 'blur', cancel);
      listen(win, 'resize', cancel);
      if (doc && typeof doc.addEventListener === 'function') listen(doc, 'visibilitychange', cancel);
    }

    function enter(content, from, to) {
      if (!content || !content.classList) return false;
      const previous = route(from);
      const next = route(to);
      updateSurfaceRoute(next);
      const cleanup = animations.get(content);
      if (cleanup) cleanup();
      content.classList.remove('view-enter', 'hvf-route-enter');
      if (!previous || previous === next || media('(prefers-reduced-motion: reduce)')) return false;
      const oldIndex = ROUTES.indexOf(previous);
      const newIndex = ROUTES.indexOf(next);
      const offset = oldIndex >= 0 && newIndex >= 0 ? (newIndex > oldIndex ? 26 : -26) : 0;
      content.style.setProperty('--hvf-route-offset', offset + 'px');
      // Restart only for explicit route changes, including a second navigation during an animation.
      void content.offsetWidth;
      content.classList.add('hvf-route-enter');
      const onEnd = event => { if (event.target === content) clear(); };
      const clear = () => {
        content.classList.remove('hvf-route-enter');
        content.style.removeProperty('--hvf-route-offset');
        content.removeEventListener('animationend', onEnd);
        animations.delete(content);
      };
      animations.set(content, clear);
      content.addEventListener('animationend', onEnd);
      return true;
    }

    function destroy() {
      cancel();
      listeners.splice(0).forEach(remove => remove());
      Array.from(animations.values()).forEach(clear => clear());
      if (surface && surface.classList) surface.classList.remove('hvf-swipe-surface');
      initialized = false;
    }

    return Object.freeze({ init, destroy, enter });
  }

  return Object.freeze({ routes: ROUTES, route, neighbor, gesture, create });
});
