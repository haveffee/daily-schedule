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

function setup(options = {}) {
  const surface = eventTarget();
  const doc = Object.assign(eventTarget(), { visibilityState: 'visible', querySelector: () => null });
  let selection = '';
  let current = options.route || '#day/2026-10-25';
  const visits = [];
  const win = Object.assign(eventTarget(), {
    innerWidth: 390, PointerEvent: options.touchFallback ? undefined : function () {}, document: doc,
    matchMedia: query => ({ matches: query.includes('reduced-motion') ? !!options.reduced : !options.desktop }),
    getSelection: () => ({ isCollapsed: !selection, toString: () => selection }),
    getComputedStyle: item => ({ overflowX: item.overflowX || 'visible' })
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
  return { surface, doc, win, controller, visits, pointer, swipe, setRoute: value => { current = value; }, select: value => { selection = value; } };
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
  assert.equal(navigation.gesture(start, { x: 200, y: 200, time: 200 }), 0);
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
    ui.swipe(start, start < 100 ? 180 : 180);
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

test('explicit route entry uses direction, skips same-view refresh, and cleans up safely', () => {
  const ui = setup();
  assert.equal(ui.controller.enter(ui.surface, 'day', 'goals'), true);
  assert.equal(ui.surface.style.getPropertyValue('--hvf-route-offset'), '26px');
  assert.equal(ui.surface.classList.contains('hvf-route-enter'), true);
  ui.surface.emit('animationend', { target: {} });
  assert.equal(ui.surface.classList.contains('hvf-route-enter'), true);
  assert.equal(ui.controller.enter(ui.surface, 'goals', 'day'), true);
  assert.equal(ui.surface.style.getPropertyValue('--hvf-route-offset'), '-26px');
  ui.surface.emit('animationend');
  assert.equal(ui.surface.classList.contains('hvf-route-enter'), false);
  assert.equal(ui.surface.style.getPropertyValue('--hvf-route-offset'), '');
  assert.equal(ui.controller.enter(ui.surface, '#day/2026-10-25', '#day/2026-10-26'), false);
});

test('reduced motion disables route animation and destroy removes gesture listeners', () => {
  const reduced = setup({ reduced: true });
  assert.equal(reduced.controller.enter(reduced.surface, 'day', 'goals'), false);
  assert.equal(reduced.surface.classList.contains('hvf-route-enter'), false);
  const ui = setup();
  ui.controller.init();
  ui.controller.destroy();
  ui.swipe();
  assert.deepEqual(ui.visits, []);
  assert.equal(ui.surface.classList.contains('hvf-swipe-surface'), false);
  ui.controller.init();
  ui.swipe(280, 120, 800);
  assert.deepEqual(ui.visits, ['goals']);
});
