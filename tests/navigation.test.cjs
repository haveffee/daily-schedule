const test = require('node:test');
const assert = require('node:assert/strict');
const navigation = require('../assistant-navigation.js');

function eventTarget() {
  const handlers = new Map();
  const classes = new Set();
  const properties = new Map();
  return {
    classList: { add: (...items) => items.forEach(item => classes.add(item)), remove: (...items) => items.forEach(item => classes.delete(item)), contains: item => classes.has(item) },
    style: { setProperty: (key, value) => properties.set(key, value), removeProperty: key => properties.delete(key), getPropertyValue: key => properties.get(key) || '' },
    addEventListener(name, handler, options) { if (!handlers.has(name)) handlers.set(name, new Set()); handlers.get(name).add(handler); if (options) assert.equal(options.passive, true); },
    removeEventListener(name, handler) { if (handlers.has(name)) handlers.get(name).delete(handler); },
    emit(name, values = {}) { for (const handler of Array.from(handlers.get(name) || [])) handler({ target: this, ...values }); },
    closest() { return null; },
    parentElement: null, scrollWidth: 0, clientWidth: 0, offsetWidth: 390
  };
}

function element(tag = 'div') {
  const node = eventTarget();
  const attributes = new Map();
  node.tagName = tag.toUpperCase();
  node.children = [];
  node.setAttribute = (name, value) => attributes.set(name, String(value));
  node.getAttribute = name => attributes.has(name) ? attributes.get(name) : null;
  node.removeAttribute = name => attributes.delete(name);
  Object.defineProperty(node, 'attributes', { get: () => Array.from(attributes, ([name, value]) => ({ name, value })) });
  node.appendChild = child => { child.parentElement = node; node.children.push(child); return child; };
  node.remove = () => { if (node.parentElement) node.parentElement.children = node.parentElement.children.filter(child => child !== node); node.parentElement = null; };
  node.querySelectorAll = selector => {
    const tags = selector.split(',').map(item => item.toUpperCase());
    const found = [];
    const visit = item => { item.children.forEach(child => { if (selector === '*' || tags.includes(child.tagName)) found.push(child); visit(child); }); };
    visit(node);
    return found;
  };
  node.cloneNode = deep => {
    const copy = element(tag);
    attributes.forEach((value, name) => copy.setAttribute(name, value));
    ['disabled', 'value', 'checked', 'className'].forEach(key => { if (key in node) copy[key] = node[key]; });
    if (deep) node.children.forEach(child => copy.appendChild(child.cloneNode(true)));
    return copy;
  };
  node.getBoundingClientRect = () => {
    const match = node.style.getPropertyValue('transform').match(/translate3d\(([-.\d]+)px/);
    return { left: Number(match && match[1]) || 0, top: -240, width: 390, bottom: 1600 };
  };
  return node;
}

function setup(options = {}) {
  const surface = options.dom ? element('main') : eventTarget();
  const doc = Object.assign(eventTarget(), { visibilityState: 'visible', querySelector: () => null });
  if (options.dom) { doc.body = element('body'); doc.createElement = element; }
  let selection = '';
  let current = options.route || '#day/2026-10-25';
  let nextId = 1;
  const frames = new Map();
  const timers = new Map();
  const preference = Object.assign(eventTarget(), { matches: !!options.reduced });
  const visits = [];
  const scrolls = [];
  const win = Object.assign(eventTarget(), {
    innerWidth: 390, innerHeight: 844, PointerEvent: options.touchFallback ? undefined : function () {}, document: doc,
    matchMedia: query => query.includes('reduced-motion') ? preference : { matches: !options.desktop },
    getSelection: () => ({ isCollapsed: !selection, toString: () => selection }),
    getComputedStyle: item => ({ overflowX: item.overflowX || 'visible' }),
    requestAnimationFrame: callback => { const id = nextId++; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: (callback, ms) => { const id = nextId++; timers.set(id, { callback, ms }); return id; },
    clearTimeout: id => timers.delete(id),
    scrollTo: value => scrolls.push(value)
  });
  const controller = navigation.create({ root: surface, window: win, document: doc, getRoute: () => current, navigate: next => { current = next; visits.push(next); }, isBlocked: () => !!options.blocked });
  controller.init();
  function pointer(name, x, y = 200, time = 0, extra = {}) {
    (name === 'pointerdown' ? surface : win).emit(name, { clientX: x, clientY: y, timeStamp: time, pointerType: 'touch', pointerId: 1, isPrimary: true, button: 0, target: surface, ...extra });
  }
  function swipe(start = 280, end = 120, time = 0, extra = {}) {
    pointer('pointerdown', start, 200, time, extra);
    pointer('pointermove', end, 208, time + 200);
    pointer('pointerup', end, 208, time + 250);
  }
  function flushFrame() { const callbacks = Array.from(frames.values()); frames.clear(); callbacks.forEach(callback => callback(16)); }
  function runTimers(ms = Infinity) { Array.from(timers).forEach(([id, item]) => { if (item.ms <= ms && timers.delete(id)) item.callback(); }); }
  return { surface, doc, win, controller, visits, pointer, swipe, scrolls, flushFrame, runTimers, frames, timers, preference, setRoute: value => { current = value; }, select: value => { selection = value; } };
}

test('only ordered main sections are adjacent, and date-specific day routes normalize', () => {
  assert.equal(navigation.neighbor('#day/2026-10-25', 1), 'goals');
  assert.equal(navigation.neighbor('#money', -1), 'goals');
  assert.equal(navigation.neighbor('overview', -1), null);
  assert.equal(navigation.neighbor('settings', 1), null);
  assert.equal(navigation.neighbor('week', 1), null);
  assert.equal(navigation.neighbor('focus', -1), null);
  assert.equal(navigation.neighbor('day', 0), null);
});

test('gesture intent rejects taps, diagonal scrolling, stale drags, and invalid coordinates', () => {
  const start = { x: 250, y: 200, time: 100 };
  assert.equal(navigation.gesture(start, { x: 100, y: 220, time: 900 }), 1);
  assert.equal(navigation.gesture(start, { x: 350, y: 200, time: 900 }), -1);
  assert.equal(navigation.gesture(start, { x: 200, y: 200, time: 300 }), 0);
  assert.equal(navigation.gesture(start, { x: 212, y: 200, time: 160 }), 1, 'a short deliberate flick has enough velocity');
  assert.equal(navigation.gesture(start, { x: 228, y: 200, time: 120 }), 0, 'a tiny movement remains a tap even at high velocity');
  assert.equal(navigation.gesture(start, { x: 100, y: 310, time: 200 }), 0);
  assert.equal(navigation.gesture(start, { x: 100, y: 200, time: 1400 }), 0);
  assert.equal(navigation.gesture(start, { x: 100, y: 200, time: 50 }), 0);
  assert.equal(navigation.gesture(start, { x: NaN, y: 200, time: 200 }), 0);
});

test('touch navigation advances once and accepts deliberate reverse swipes after a pause', () => {
  const ui = setup();
  ui.swipe();
  assert.deepEqual(ui.visits, ['goals']);
  ui.pointer('pointerup', 120, 208, 260);
  ui.controller.prepare(ui.surface, 'day', 'goals');
  ui.controller.enter(ui.surface, 'day', 'goals');
  ui.swipe(120, 280, 800);
  assert.deepEqual(ui.visits, ['goals', 'day']);
});

test('quick repeated gestures cannot accidentally skip a section', () => {
  const ui = setup();
  ui.swipe();
  ui.swipe(280, 120, 300);
  assert.deepEqual(ui.visits, ['goals']);
});

test('vertical intent stays cancelled even when the finger later moves sideways', () => {
  const ui = setup();
  ui.pointer('pointerdown', 280, 200, 0);
  ui.pointer('pointermove', 275, 250, 80);
  ui.pointer('pointerup', 100, 220, 250);
  assert.deepEqual(ui.visits, []);
});

test('native back and forward screen edges are reserved for the browser', () => {
  for (const start of [0, 15, 24, 366, 380, 390]) {
    const ui = setup();
    ui.swipe(start, 180);
    assert.deepEqual(ui.visits, [], 'edge ' + start);
  }
});

test('mouse dragging and desktop touch do not change sections', () => {
  const mouse = setup();
  mouse.swipe(280, 120, 0, { pointerType: 'mouse' });
  assert.deepEqual(mouse.visits, []);
  const desktop = setup({ desktop: true });
  desktop.swipe();
  assert.deepEqual(desktop.visits, []);
});

test('form controls, selected text, open dialogs, and blocked editing states do not navigate', () => {
  const control = setup();
  const input = Object.assign(eventTarget(), { closest: () => ({ tagName: 'INPUT' }) });
  control.swipe(280, 120, 0, { target: input });
  assert.deepEqual(control.visits, []);
  const selected = setup();
  selected.select('Выделенный текст');
  selected.swipe();
  assert.deepEqual(selected.visits, []);
  const dialog = setup();
  dialog.doc.querySelector = () => ({});
  dialog.swipe();
  assert.deepEqual(dialog.visits, []);
  const blocked = setup({ blocked: true });
  blocked.swipe();
  assert.deepEqual(blocked.visits, []);
});

test('a horizontal inner scroller keeps its gesture', () => {
  const ui = setup();
  const scroller = Object.assign(eventTarget(), { scrollWidth: 800, clientWidth: 300, overflowX: 'auto', parentElement: ui.surface });
  const label = Object.assign(eventTarget(), { parentElement: scroller });
  ui.swipe(280, 120, 0, { target: label });
  assert.deepEqual(ui.visits, []);
});

test('pinch, pointer cancellation, and loss of visibility clear pending navigation', () => {
  for (const kind of ['multitouch', 'cancel', 'hidden']) {
    const ui = setup();
    ui.pointer('pointerdown', 280, 200, 0);
    if (kind === 'multitouch') ui.win.emit('pointerdown', { pointerType: 'touch', isPrimary: false, pointerId: 2 });
    if (kind === 'cancel') ui.win.emit('pointercancel', {});
    if (kind === 'hidden') ui.doc.emit('visibilitychange');
    ui.pointer('pointerup', 120, 200, 250);
    assert.deepEqual(ui.visits, [], kind);
  }
});

test('the first and last sections never wrap, and auxiliary routes remain explicit', () => {
  const first = setup({ route: '#overview' });
  first.swipe(120, 280);
  assert.deepEqual(first.visits, []);
  const last = setup({ route: '#settings' });
  last.swipe();
  assert.deepEqual(last.visits, []);
  const week = setup({ route: '#week' });
  week.swipe();
  assert.deepEqual(week.visits, []);
  assert.equal(week.surface.classList.contains('hvf-swipe-surface'), false);
});

test('entering the weekly chart preserves native horizontal panning, including reduced motion', () => {
  for (const reduced of [false, true]) {
    const ui = setup({ reduced });
    assert.equal(ui.surface.classList.contains('hvf-swipe-surface'), true);
    ui.controller.enter(ui.surface, 'day', 'week');
    assert.equal(ui.surface.classList.contains('hvf-swipe-surface'), false);
    ui.controller.enter(ui.surface, 'week', 'day');
    assert.equal(ui.surface.classList.contains('hvf-swipe-surface'), true);
  }
});

test('a route change while touching cancels the original section gesture', () => {
  const ui = setup();
  ui.pointer('pointerdown', 280, 200, 0);
  ui.setRoute('money');
  ui.pointer('pointerup', 120, 200, 250);
  assert.deepEqual(ui.visits, []);
});

test('touch fallback follows the same intent rules and rejects multiple fingers', () => {
  const ui = setup({ touchFallback: true });
  const finger = (x, y = 200, identifier = 3) => ({ clientX: x, clientY: y, identifier });
  ui.surface.emit('touchstart', { timeStamp: 0, touches: [finger(280)] });
  ui.win.emit('touchmove', { timeStamp: 100, touches: [finger(170)] });
  ui.win.emit('touchend', { timeStamp: 250, touches: [], changedTouches: [finger(120)] });
  assert.deepEqual(ui.visits, ['goals']);
  ui.surface.emit('touchstart', { timeStamp: 1000, touches: [finger(280)] });
  ui.win.emit('touchstart', { timeStamp: 1010, touches: [finger(280), finger(150, 200, 4)] });
  ui.win.emit('touchend', { timeStamp: 1250, touches: [], changedTouches: [finger(120)] });
  assert.deepEqual(ui.visits, ['goals']);
});

test('explicit section entry animates in direction without forcing a layout or replaying synced updates', () => {
  const ui = setup();
  Object.defineProperty(ui.surface, 'offsetWidth', { get() { throw new Error('Forced layout is not needed'); } });
  assert.equal(ui.controller.enter(ui.surface, 'day', 'goals'), true);
  assert.ok(parseFloat(ui.surface.style.getPropertyValue('--hvf-route-start')) > 0);
  assert.equal(ui.surface.classList.contains('hvf-route-enter'), true);
  ui.surface.emit('animationend', { target: {} });
  assert.equal(ui.surface.classList.contains('hvf-route-enter'), true);
  assert.equal(ui.controller.enter(ui.surface, 'goals', 'day'), true);
  assert.ok(parseFloat(ui.surface.style.getPropertyValue('--hvf-route-start')) < 0);
  ui.surface.emit('animationend');
  assert.equal(ui.surface.classList.contains('hvf-route-enter'), false);
  assert.equal(ui.surface.style.getPropertyValue('--hvf-route-start'), '');
  assert.equal(ui.controller.enter(ui.surface, '#day/2026-10-25', '#day/2026-10-26'), false);
  assert.equal(ui.scrolls.length, 2, 'same section refresh must not reset scrolling');
});

test('frequent same-section refreshes avoid cloning the page and preserve native scrolling', () => {
  const ui = setup({ dom: true });
  const intent = { refresh: true, direction: 1 };
  ui.surface.setAttribute('id', 'content');
  const action = element('button');
  action.setAttribute('id', 'nextDay');
  action.setAttribute('data-action', 'next-day');
  ui.surface.appendChild(action);
  ui.surface.cloneNode = () => { throw new Error('A date change must not duplicate a long task list'); };
  assert.equal(ui.controller.prepare(ui.surface, '#day/2026-10-25', '#day/2026-10-26', intent), false);
  assert.equal(ui.doc.body.children.length, 0);
  assert.equal(ui.controller.enter(ui.surface, '#day/2026-10-25', '#day/2026-10-26', intent), true);
  assert.equal(ui.scrolls.length, 0, 'day, month, and filter changes never force the page to the top');
  assert.equal(ui.surface.style.getPropertyValue('--hvf-route-start'), '0.00px');
  assert.equal(ui.surface.style.getPropertyValue('--hvf-route-duration'), '160ms');
  ui.surface.emit('animationend');
  assert.equal(ui.doc.body.children.length, 0);
  assert.equal(ui.surface.style.getPropertyValue('--hvf-route-opacity'), '');
  assert.equal(ui.timers.size, 0);
});

test('date, month, currency and filter changes use one subtle opacity layer without moving readable data', () => {
  for (const direction of [-1, 0, 1, undefined, 100]) {
    const ui = setup({ dom: true });
    const intent = { refresh: true, direction };
    const frames = [];
    ui.surface.animate = (keyframes, options) => {
      frames.push({ keyframes, options });
      return { cancel() {}, onfinish: null };
    };
    ui.controller.prepare(ui.surface, 'money', 'money', intent);
    ui.controller.enter(ui.surface, 'money', 'money', intent);
    assert.equal(ui.surface.style.getPropertyValue('--hvf-route-start'), '0.00px');
    assert.equal(frames[0].options.duration, 160);
    assert.equal(frames[0].keyframes[0].transform, frames[0].keyframes[1].transform);
    assert.ok(frames[0].keyframes[0].opacity >= .75, 'functional content never disappears into a white frame');
    assert.deepEqual(Object.keys(frames[0].keyframes[0]).sort(), ['opacity', 'transform']);
    assert.equal(ui.scrolls.length, 0);
    ui.controller.cancel();
    assert.equal(ui.doc.body.children.length, 0);
  }
});

test('ordinary same-route store acknowledgements do not create snapshots or animations', () => {
  const ui = setup({ dom: true });
  assert.equal(ui.controller.prepare(ui.surface, 'money', 'money'), false);
  assert.equal(ui.controller.enter(ui.surface, 'money', 'money'), false);
  assert.equal(ui.doc.body.children.length, 0);
  assert.equal(ui.surface.classList.contains('hvf-route-enter'), false);
  assert.equal(ui.controller.getState().transitioning, false);
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.scrolls.length, 0);
});

test('rapid deliberate refreshes keep a single incoming motion and account cancellation removes it synchronously', () => {
  const ui = setup({ dom: true });
  for (const direction of [1, -1, 0, 1]) {
    const intent = { refresh: true, direction };
    ui.controller.prepare(ui.surface, 'day', 'day', intent);
    ui.controller.enter(ui.surface, 'day', 'day', intent);
    assert.equal(ui.doc.body.children.length, 0);
    assert.equal(ui.timers.size, 1);
    assert.equal(ui.scrolls.length, 0);
  }
  ui.controller.cancel();
  assert.equal(ui.doc.body.children.length, 0);
  assert.equal(ui.controller.getState().transitioning, false);
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.surface.style.getPropertyValue('--hvf-route-duration'), '');
});

test('reduced motion changes a same-route date without motion, snapshots, or scroll resets', () => {
  const ui = setup({ reduced: true, dom: true });
  const intent = { refresh: true, direction: -1 };
  assert.equal(ui.controller.prepare(ui.surface, 'day', 'day', intent), false);
  assert.equal(ui.controller.enter(ui.surface, 'day', 'day', intent), false);
  assert.equal(ui.doc.body.children.length, 0);
  assert.equal(ui.surface.classList.contains('hvf-route-enter'), false);
  assert.equal(ui.controller.getState().transitioning, false);
  assert.equal(ui.scrolls.length, 0);
  assert.equal(ui.timers.size, 0);
});

test('one animation frame coalesces finger positions and movement stays bounded', () => {
  const ui = setup();
  ui.pointer('pointerdown', 280, 200, 0);
  ui.pointer('pointermove', 250, 200, 50);
  ui.pointer('pointermove', 220, 200, 70);
  assert.equal(ui.surface.style.getPropertyValue('transform'), '');
  assert.equal(ui.frames.size, 1);
  assert.equal(ui.controller.getState().dragging, true);
  ui.flushFrame();
  assert.equal(ui.surface.style.getPropertyValue('transform'), 'translate3d(-60.00px,0,0)');
  assert.equal(navigation.displacement(40, true), 40);
  assert.equal(navigation.displacement(220, true), 220, 'normal navigation follows the finger one to one');
  assert.ok(navigation.displacement(100000, true) <= 390 * .95);
  assert.ok(navigation.displacement(100000, false) <= 22);
  assert.ok(navigation.displacement(-100000, false) >= -22);
});

test('an incomplete swipe and an edge resistance settle to rest without navigation', () => {
  for (const options of [{}, { route: '#overview' }]) {
    const ui = setup(options);
    ui.pointer('pointerdown', 180, 200, 0);
    ui.pointer('pointermove', 220, 200, 70);
    ui.flushFrame();
    assert.notEqual(ui.surface.style.getPropertyValue('transform'), '');
    ui.pointer('pointerup', 220, 200, 110);
    assert.deepEqual(ui.visits, []);
    assert.equal(ui.controller.getState().dragging, false);
    assert.equal(ui.controller.getState().transitioning, true);
    ui.surface.emit('animationend');
    assert.equal(ui.surface.style.getPropertyValue('transform'), '');
    assert.equal(ui.controller.getState().transitioning, false);
  }
});

test('horizontal lock captures one pointer and releases it without touching native vertical scrolling', () => {
  const ui = setup();
  const captures = [], releases = [];
  ui.surface.setPointerCapture = id => captures.push(id);
  ui.surface.releasePointerCapture = id => releases.push(id);
  ui.pointer('pointerdown', 260, 200, 0);
  ui.pointer('pointermove', 256, 205, 20);
  assert.deepEqual(captures, []);
  ui.pointer('pointermove', 200, 208, 100);
  assert.deepEqual(captures, [1]);
  ui.pointer('pointermove', 170, 208, 150);
  assert.deepEqual(captures, [1], 'pointer capture is not repeated every frame');
  ui.pointer('pointerup', 170, 208, 200);
  assert.deepEqual(releases, [1]);
  const vertical = setup();
  vertical.surface.setPointerCapture = () => { throw new Error('Vertical scrolling belongs to the browser'); };
  vertical.pointer('pointerdown', 220, 200, 0);
  vertical.pointer('pointermove', 215, 250, 50);
  assert.equal(vertical.controller.getState().dragging, false);
});

test('a short quick flick navigates but a last-moment reversal returns to the current section', () => {
  const flick = setup();
  flick.pointer('pointerdown', 240, 200, 0);
  flick.pointer('pointermove', 202, 201, 50);
  flick.pointer('pointerup', 200, 201, 65);
  assert.deepEqual(flick.visits, ['goals']);
  const reverse = setup();
  reverse.pointer('pointerdown', 280, 200, 0);
  reverse.pointer('pointermove', 120, 200, 130);
  reverse.pointer('pointermove', 175, 200, 180);
  reverse.flushFrame();
  reverse.pointer('pointerup', 175, 200, 190);
  assert.deepEqual(reverse.visits, []);
  assert.equal(reverse.controller.getState().transitioning, true);
});

test('an interrupted return starts the next drag at the visible compositor position', () => {
  const ui = setup();
  const motions = [];
  ui.surface.animate = (frames, options) => {
    const item = { frames, options, cancelled: false, cancel() { this.cancelled = true; } };
    motions.push(item);
    return item;
  };
  ui.pointer('pointerdown', 180, 200, 0);
  ui.pointer('pointermove', 220, 200, 70);
  ui.flushFrame();
  ui.pointer('pointerup', 220, 200, 130);
  assert.equal(motions[0].options.easing, 'linear');
  assert.equal(motions[0].options.duration, 500);
  assert.ok(motions[0].frames.length > 2, 'a sampled spring is handed to the compositor');
  assert.equal(motions[0].frames.at(-1).transform, 'translate3d(0.00px,0,0)');
  ui.win.getComputedStyle = () => {
    assert.equal(motions[0].cancelled, false, 'read the current visual frame before cancelling it');
    return { transform: 'matrix(1, 0, 0, 1, 14, 0)' };
  };
  ui.pointer('pointerdown', 220, 200, 160);
  assert.equal(ui.surface.style.getPropertyValue('transform'), 'translate3d(14.00px,0,0)');
  assert.equal(motions[0].cancelled, true);
  ui.pointer('pointermove', 200, 200, 210);
  ui.flushFrame();
  assert.equal(ui.surface.style.getPropertyValue('transform'), 'translate3d(-6.00px,0,0)');
});

test('a committed swipe holds its last painted position until prepare captures the old scene', () => {
  const ui = setup({ dom: true });
  ui.swipe();
  const held = ui.surface.style.getPropertyValue('transform');
  assert.notEqual(held, '');
  assert.equal(ui.controller.getState().pending, true);
  ui.flushFrame();
  assert.equal(ui.surface.style.getPropertyValue('transform'), held, 'late frame must not jump back');
  assert.equal(ui.controller.prepare(ui.surface, 'day', 'goals'), true);
  const snapshot = ui.doc.body.children[0];
  assert.equal(snapshot.style.getPropertyValue('transform'), held);
  assert.ok(Math.abs(parseFloat(snapshot.style.getPropertyValue('left'))) < 0.01);
  assert.equal(ui.surface.style.getPropertyValue('transform'), '');
  ui.controller.enter(ui.surface, 'day', 'goals');
  assert.equal(ui.surface.style.getPropertyValue('--hvf-route-start'), '230.00px', 'the incoming page starts one viewport beyond the finger offset');
  assert.equal(ui.surface.style.getPropertyValue('--hvf-route-opacity'), '1', 'a swipe keeps the adjacent page solid');
  assert.equal(snapshot.style.getPropertyValue('--hvf-old-end'), '-390.00px');
  assert.equal(ui.controller.getState().pending, false);
  assert.equal(snapshot.classList.contains('hvf-css-leave'), true);
  ui.surface.emit('animationend');
  assert.equal(ui.doc.body.children.length, 0);
});

test('a deliberate next swipe can interrupt the previous page entry without a fixed cooldown', () => {
  const ui = setup({ dom: true });
  ui.swipe();
  ui.controller.prepare(ui.surface, 'day', 'goals');
  ui.controller.enter(ui.surface, 'day', 'goals');
  assert.equal(ui.controller.getState().transitioning, true);
  ui.swipe(280, 120, 300);
  assert.deepEqual(ui.visits, ['goals', 'money']);
  assert.equal(ui.doc.body.children.length, 0, 'the interrupted old scene is removed before the new drag');
});

test('large pages avoid a cloned layer and use the same bounded incoming fallback', () => {
  const ui = setup({ dom: true });
  for (let index = 0; index < 321; index++) ui.surface.appendChild(element('article'));
  ui.surface.cloneNode = () => { throw new Error('Never duplicate an unbounded history for an animation'); };
  assert.equal(ui.controller.prepare(ui.surface, 'money', 'day'), false);
  assert.equal(ui.doc.body.children.length, 0);
  assert.equal(ui.surface.children.length, 321);
  assert.equal(ui.controller.enter(ui.surface, 'money', 'day'), true);
  assert.equal(ui.surface.style.getPropertyValue('--hvf-route-start'), '-24.00px');
  assert.ok(Number(ui.surface.style.getPropertyValue('--hvf-route-opacity')) >= .7);
});

test('keyboard navigation skips decoration and pointer navigation restores it', () => {
  const ui = setup({ dom: true });
  ui.win.emit('keydown', { key: 'Enter' });
  assert.equal(ui.controller.prepare(ui.surface, 'day', 'goals'), false);
  assert.equal(ui.controller.enter(ui.surface, 'day', 'goals'), false);
  assert.equal(ui.doc.body.children.length, 0);
  assert.equal(ui.timers.size, 0);
  ui.win.emit('pointerdown', { pointerType: 'mouse', isPrimary: true });
  assert.equal(ui.controller.prepare(ui.surface, 'goals', 'day'), true);
  assert.equal(ui.controller.enter(ui.surface, 'goals', 'day'), true);
});

test('changing reduced motion clears active compositor scenes immediately', () => {
  const ui = setup({ dom: true });
  ui.controller.prepare(ui.surface, 'day', 'goals');
  ui.controller.enter(ui.surface, 'day', 'goals');
  ui.preference.matches = true;
  ui.preference.emit('change');
  assert.equal(ui.doc.body.children.length, 0);
  assert.equal(ui.timers.size, 0);
  assert.equal(ui.controller.getState().transitioning, false);
  assert.equal(ui.surface.style.getPropertyValue('transform'), '');
});

test('outgoing scene is clipped, inert and detached from forms, actions and identifiers', () => {
  const ui = setup({ dom: true });
  ui.surface.setAttribute('id', 'content');
  const input = element('input');
  input.setAttribute('id', 'privateDate');
  input.setAttribute('name', 'date');
  input.setAttribute('data-action', 'save');
  input.setAttribute('autofocus', '');
  input.disabled = false;
  input.value = '2026-10-25';
  input.checked = true;
  ui.surface.appendChild(input);
  ui.surface.appendChild(element('iframe'));
  assert.equal(ui.controller.prepare(ui.surface, 'day', 'money'), true);
  const snapshot = ui.doc.body.children[0];
  assert.equal(snapshot.inert, true);
  assert.equal(snapshot.getAttribute('aria-hidden'), 'true');
  assert.equal(snapshot.style.getPropertyValue('top'), '0px');
  assert.equal(snapshot.style.getPropertyValue('height'), '844px');
  const copy = snapshot.children[0];
  assert.equal(copy.style.getPropertyValue('top'), '-240px');
  assert.equal(copy.getAttribute('id'), null);
  const copyInput = copy.querySelectorAll('input')[0];
  assert.equal(copyInput.getAttribute('id'), null);
  assert.equal(copyInput.getAttribute('name'), null);
  assert.equal(copyInput.getAttribute('data-action'), null);
  assert.equal(copyInput.getAttribute('autofocus'), null);
  assert.equal(copyInput.disabled, true);
  assert.equal(copyInput.value, input.value);
  assert.equal(copyInput.checked, true);
  assert.equal(copy.querySelectorAll('iframe').length, 0);
  assert.equal(input.getAttribute('id'), 'privateDate', 'live UI must not be stripped');
  ui.controller.cancel();
  assert.equal(ui.doc.body.children.length, 0, 'account changes can discard every old pixel synchronously');
  assert.equal(ui.controller.getState().transitioning, false);
});

test('a rapid tab switch preserves incoming opacity and the current transformed viewport position', () => {
  const ui = setup({ dom: true });
  ui.controller.prepare(ui.surface, 'day', 'goals');
  ui.controller.enter(ui.surface, 'day', 'goals');
  ui.win.getComputedStyle = () => ({ opacity: '0.42', overflowX: 'visible' });
  ui.surface.getBoundingClientRect = () => ({ left: 27, top: -240, width: 390, bottom: 1600 });
  ui.controller.prepare(ui.surface, 'goals', 'money');
  const snapshot = ui.doc.body.children[0];
  assert.equal(snapshot.children[0].style.getPropertyValue('opacity'), '0.42', 'mid-fade content must not flash to full opacity');
  assert.equal(snapshot.style.getPropertyValue('left'), '27px', 'the measured rectangle already includes the current compositor transform');
  assert.equal(snapshot.children[0].style.getPropertyValue('transform'), 'none', 'do not apply the current transform a second time');
  ui.controller.enter(ui.surface, 'goals', 'money');
  ui.runTimers(1000);
  assert.equal(ui.doc.body.children.length, 0);
});

test('snapshots never assign file paths or preserve password values', () => {
  const ui = setup({ dom: true });
  const file = element('input');
  file.setAttribute('type', 'file');
  file.value = 'C:\\fakepath\\backup.json';
  file.cloneNode = () => {
    const copy = element('input');
    copy.setAttribute('type', 'file');
    let value = '';
    Object.defineProperty(copy, 'value', {
      get: () => value,
      set: next => { if (next !== '') throw new Error('InvalidStateError: file paths cannot be assigned'); value = next; }
    });
    return copy;
  };
  const password = element('input');
  password.setAttribute('type', 'password');
  password.setAttribute('value', 'example-only');
  password.value = 'example-only';
  ui.surface.appendChild(file);
  ui.surface.appendChild(password);
  assert.doesNotThrow(() => ui.controller.prepare(ui.surface, 'settings', 'day'));
  const copied = ui.doc.body.children[0].children[0].querySelectorAll('input');
  assert.equal(copied[0].value, '');
  assert.equal(copied[1].value, '');
  assert.equal(copied[1].getAttribute('value'), null);
  assert.equal(password.value, 'example-only', 'live forms remain untouched');
  assert.equal(file.value, 'C:\\fakepath\\backup.json');
  ui.controller.cancel();
});

test('rapid section changes keep one old scene and timer cleanup handles suspended animations', () => {
  const ui = setup({ dom: true });
  ui.controller.prepare(ui.surface, 'day', 'goals');
  ui.controller.enter(ui.surface, 'day', 'goals');
  ui.controller.prepare(ui.surface, 'goals', 'money');
  ui.controller.enter(ui.surface, 'goals', 'money');
  assert.equal(ui.doc.body.children.length, 1);
  ui.runTimers(1000);
  assert.equal(ui.doc.body.children.length, 0);
  assert.equal(ui.controller.getState().transitioning, false);
  ui.swipe(280, 120, 2000);
  assert.equal(ui.controller.getState().pending, true);
  ui.runTimers(1000);
  ui.runTimers(1000);
  assert.equal(ui.surface.style.getPropertyValue('transform'), '');
});

test('Web Animations uses compositor properties and cancellation releases animations and snapshots', () => {
  const ui = setup({ dom: true });
  const motions = [];
  ui.surface.animate = (keyframes, options) => {
    const item = { keyframes, options, cancelled: false, cancel() { this.cancelled = true; } };
    motions.push(item);
    return item;
  };
  ui.controller.prepare(ui.surface, 'day', 'money');
  ui.controller.enter(ui.surface, 'day', 'money');
  assert.deepEqual(Object.keys(motions[0].keyframes[0]).sort(), ['opacity', 'transform']);
  assert.equal(motions[0].options.fill, 'both');
  ui.controller.cancel();
  assert.equal(motions[0].cancelled, true);
  assert.equal(motions[0].onfinish, null);
  assert.equal(ui.doc.body.children.length, 0);
  assert.equal(ui.timers.size, 0);
});

test('reduced motion keeps swipe navigation but skips spatial motion and snapshots', () => {
  const reduced = setup({ reduced: true, dom: true });
  reduced.swipe();
  assert.deepEqual(reduced.visits, ['goals']);
  assert.equal(reduced.surface.style.getPropertyValue('transform'), 'translate3d(0.00px,0,0)');
  assert.equal(reduced.controller.prepare(reduced.surface, 'day', 'goals'), false);
  assert.equal(reduced.controller.enter(reduced.surface, 'day', 'goals'), false);
  assert.equal(reduced.doc.body.children.length, 0);
  assert.equal(reduced.surface.classList.contains('hvf-route-enter'), false);
  assert.equal(reduced.surface.style.getPropertyValue('transform'), '');
});

test('destroy removes gestures, pending frames and transient scenes, and can be initialized again', () => {
  const ui = setup({ dom: true });
  ui.controller.init();
  ui.swipe();
  ui.controller.prepare(ui.surface, 'day', 'goals');
  ui.controller.enter(ui.surface, 'day', 'goals');
  ui.controller.destroy();
  assert.equal(ui.doc.body.children.length, 0);
  assert.equal(ui.frames.size, 0);
  assert.equal(ui.timers.size, 0);
  const count = ui.visits.length;
  ui.swipe(280, 120, 800);
  assert.equal(ui.visits.length, count);
  assert.equal(ui.surface.classList.contains('hvf-swipe-surface'), false);
  ui.controller.init();
  ui.swipe(280, 120, 1600);
  assert.equal(ui.visits.length, count + 1);
});
