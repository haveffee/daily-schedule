const test = require('node:test');
const assert = require('node:assert/strict');
const motion = require('../assistant-motion.js');

function element(tagName = 'DIV') {
  const handlers = new Map();
  const classes = new Set();
  const animations = [];
  const node = {
    tagName, style: { overflow: '' }, parentElement: null, open: false, disabled: false, inert: false,
    classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
    addEventListener(type, callback) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(callback);
    },
    removeEventListener(type, callback) { if (handlers.has(type)) handlers.get(type).delete(callback); },
    emit(type, extra = {}) {
      let prevented = false;
      const event = { target: node, ...extra, preventDefault() { prevented = true; } };
      for (const callback of Array.from(handlers.get(type) || [])) callback(event);
      return prevented;
    },
    closest(selector) {
      if (selector === 'summary') return tagName === 'SUMMARY' ? node : node.parentElement && node.parentElement.closest(selector);
      if (selector === 'a,button,input,select,textarea') return ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(tagName) ? node : node.parentElement && node.parentElement.closest(selector);
      return ['BUTTON', 'A', 'SUMMARY', 'INPUT'].includes(tagName) ? node : node.parentElement && node.parentElement.closest(selector);
    },
    querySelector: () => null,
    getAttribute: () => null,
    showModal() { node.open = true; node.shows = (node.shows || 0) + 1; },
    close() { node.open = false; node.closes = (node.closes || 0) + 1; node.emit('close'); },
    getBoundingClientRect: () => ({ height: node.open ? 240 : 44 }),
    animate(frames, options) {
      let finish, reject;
      const animation = {
        frames, options, cancelled: false,
        finished: new Promise((resolve, failure) => { finish = resolve; reject = failure; }),
        complete: () => finish(),
        cancel() { animation.cancelled = true; reject(new Error('cancelled')); }
      };
      animations.push(animation);
      return animation;
    },
    animations
  };
  return node;
}

function setup(options = {}) {
  const doc = Object.assign(element(), { documentElement: element('HTML'), visibilityState: 'visible' });
  const preference = Object.assign(element(), { matches: !!options.reduced });
  const timers = new Map();
  let clock = 0;
  const win = Object.assign(element(), {
    document: doc, matchMedia: () => preference,
    setTimeout(callback) { const id = ++clock; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  const controller = motion.create({ window: win, document: doc }).init();
  function flushTimers() {
    for (const [id, callback] of Array.from(timers)) { timers.delete(id); callback(); }
  }
  return { doc, win, preference, timers, controller, flushTimers };
}

test('press feedback is immediate and does not prevent the control action', () => {
  const ui = setup();
  const button = element('BUTTON');
  assert.equal(ui.doc.emit('pointerdown', { target: button, pointerId: 1, button: 0, clientX: 10, clientY: 20 }), false);
  assert.equal(button.classList.contains('hvf-pressed'), true);
  assert.equal(ui.doc.emit('pointerup', { target: button, pointerId: 1 }), false);
  assert.equal(button.classList.contains('hvf-pressed'), false);
  assert.equal(ui.timers.size, 0, 'button actions never wait for a timer');
});

test('vertical scrolling and pointer cancellation release a pressed control', () => {
  const ui = setup();
  const button = element('BUTTON');
  ui.doc.emit('pointerdown', { target: button, pointerId: 1, clientX: 20, clientY: 20 });
  ui.doc.emit('pointermove', { pointerId: 1, clientX: 22, clientY: 60 });
  assert.equal(button.classList.contains('hvf-pressed'), false);
  ui.doc.emit('pointerdown', { target: button, pointerId: 2 });
  ui.doc.emit('pointercancel', { pointerId: 2 });
  assert.equal(button.classList.contains('hvf-pressed'), false);
});

test('disabled buttons and secondary pointers never acquire press feedback', () => {
  const ui = setup();
  const disabled = Object.assign(element('BUTTON'), { disabled: true });
  const button = element('BUTTON');
  ui.doc.emit('pointerdown', { target: disabled, pointerId: 1 });
  ui.doc.emit('pointerdown', { target: button, pointerId: 2, isPrimary: false });
  ui.doc.emit('pointerdown', { target: button, pointerId: 3, button: 2 });
  assert.equal(disabled.classList.contains('hvf-pressed'), false);
  assert.equal(button.classList.contains('hvf-pressed'), false);
});

test('keyboard interaction stays instant with native focus and no decorative press or modal delays', () => {
  const ui = setup();
  const button = element('BUTTON');
  assert.equal(ui.doc.emit('keydown', { target: button, key: 'Enter' }), false);
  assert.equal(button.classList.contains('hvf-pressed'), false);
  assert.equal(ui.doc.emit('keyup', { target: button, key: 'Enter' }), false);
  assert.equal(button.classList.contains('hvf-pressed'), false);
  ui.doc.emit('keydown', { target: button, key: ' ', repeat: true });
  assert.equal(button.classList.contains('hvf-pressed'), false);
  const dialog = element('DIALOG');
  ui.controller.open(dialog);
  assert.equal(dialog.animations.length, 0);
  ui.controller.close(dialog);
  assert.equal(dialog.open, false);
  assert.equal(ui.timers.size, 0);
  ui.doc.emit('pointerdown', { target: button, pointerId: 1 });
  ui.controller.open(dialog);
  assert.equal(dialog.animations.length, 1, 'pointer interaction restores the ordinary modal feedback');
});

test('backup labels receive pointer feedback without acquiring invented keyboard actions', () => {
  const ui = setup();
  const label = element('LABEL');
  label.closest = selector => selector.includes('.backup-file-label') ? label : null;
  assert.equal(ui.doc.emit('pointerdown', { target: label, pointerId: 1 }), false);
  assert.equal(label.classList.contains('hvf-pressed'), true);
  ui.doc.emit('pointerup', { target: label, pointerId: 1 });
  assert.equal(ui.doc.emit('keydown', { target: label, key: 'Enter' }), false);
  assert.equal(label.classList.contains('hvf-pressed'), false);
  assert.equal(ui.doc.emit('click', { target: label }), false);
});

test('blur, hidden tabs, and destruction cannot leave a control depressed', () => {
  for (const reset of ['blur', 'hidden', 'destroy']) {
    const ui = setup();
    const button = element('BUTTON');
    ui.doc.emit('pointerdown', { target: button, pointerId: 1 });
    if (reset === 'blur') ui.win.emit('blur');
    if (reset === 'hidden') { ui.doc.visibilityState = 'hidden'; ui.doc.emit('visibilitychange'); }
    if (reset === 'destroy') ui.controller.destroy();
    assert.equal(button.classList.contains('hvf-pressed'), false, reset);
  }
});

test('opening a modal shows it synchronously and cleans its compositor animation', async () => {
  const ui = setup();
  const dialog = element('DIALOG');
  ui.controller.open(dialog);
  assert.equal(dialog.open, true);
  assert.equal(dialog.shows, 1);
  assert.equal(dialog.animations.length, 1);
  dialog.animations[0].complete();
  await Promise.resolve();
  assert.equal(dialog.animations[0].cancelled, true);
  assert.equal(ui.timers.size, 0);
});

test('onboarding steps animate only the form after entry, without calling showModal twice', async () => {
  const ui = setup();
  const dialog = element('DIALOG');
  const fields = element();
  dialog.querySelector = selector => selector === '#dialogFields' ? fields : null;
  ui.controller.open(dialog);
  dialog.animations[0].complete();
  await Promise.resolve();
  ui.controller.open(dialog);
  assert.equal(dialog.shows, 1);
  assert.equal(dialog.animations.length, 1);
  assert.equal(dialog.animations[0].cancelled, true);
  assert.equal(fields.animations.length, 1);
});

test('advancing onboarding before entry finishes retargets the visible whole dialog without a jump', () => {
  const ui = setup();
  const dialog = element('DIALOG');
  const fields = element();
  dialog.querySelector = () => fields;
  ui.controller.open(dialog);
  ui.win.getComputedStyle = target => {
    assert.equal(target, dialog);
    assert.equal(dialog.animations[0].cancelled, false);
    return { opacity: '0.65', transform: 'matrix(.985,0,0,.985,0,5)' };
  };
  ui.controller.open(dialog);
  assert.equal(dialog.shows, 1);
  assert.equal(dialog.animations.length, 2);
  assert.equal(fields.animations.length, 0);
  assert.deepEqual(dialog.animations[1].frames[0], { opacity: .65, transform: 'matrix(.985,0,0,.985,0,5)' });
});

test('deliberate modal dismissal defers native close, then invokes cleanup once', async () => {
  const ui = setup();
  const dialog = element('DIALOG');
  let closed = 0;
  ui.controller.open(dialog);
  assert.equal(ui.controller.close(dialog, { onClosed: () => closed++ }), true);
  assert.equal(dialog.open, true);
  assert.equal(ui.controller.close(dialog, { onClosed: () => closed++ }), false);
  dialog.animations.at(-1).complete();
  await Promise.resolve();
  ui.flushTimers();
  assert.equal(dialog.open, false);
  assert.equal(dialog.closes, 1);
  assert.equal(closed, 1);
});

test('closing during entry continues from the current compositor frame before cancellation', () => {
  const ui = setup();
  const dialog = element('DIALOG');
  ui.controller.open(dialog);
  const entry = dialog.animations[0];
  let reads = 0;
  ui.win.getComputedStyle = target => {
    assert.equal(target, dialog);
    assert.equal(entry.cancelled, false, 'measure before cancelling, otherwise the modal jumps to its resting frame');
    reads++;
    return { opacity: '0.37', transform: 'matrix(0.982, 0, 0, 0.982, 0, 13)' };
  };
  ui.controller.close(dialog);
  assert.equal(reads, 1);
  assert.equal(entry.cancelled, true);
  assert.deepEqual(dialog.animations.at(-1).frames[0], { opacity: 0.37, transform: 'matrix(0.982, 0, 0, 0.982, 0, 13)' });
});

test('reopening during exit restores the whole modal from its current frame instead of jumping to full opacity', () => {
  const ui = setup();
  const dialog = element('DIALOG');
  const fields = element();
  dialog.querySelector = () => fields;
  ui.controller.open(dialog);
  ui.controller.close(dialog);
  const exit = dialog.animations.at(-1);
  let reads = 0;
  ui.win.getComputedStyle = () => {
    assert.equal(exit.cancelled, false);
    reads++;
    return { opacity: '0.24', transform: 'matrix(0.989, 0, 0, 0.989, 0, 8)' };
  };
  ui.controller.open(dialog);
  assert.equal(reads, 1);
  assert.equal(exit.cancelled, true);
  assert.deepEqual(dialog.animations.at(-1).frames[0], { opacity: 0.24, transform: 'matrix(0.989, 0, 0, 0.989, 0, 8)' });
  assert.equal(fields.animations.length, 0, 'an interrupted whole-modal exit needs a whole-modal return');
  assert.equal(dialog.inert, false);
});

test('reopening an exiting modal invalidates every stale delayed close', async () => {
  const ui = setup();
  const dialog = element('DIALOG');
  let staleCleanup = 0;
  ui.controller.open(dialog);
  ui.controller.close(dialog, { onClosed: () => staleCleanup++ });
  const oldExit = dialog.animations.at(-1);
  ui.controller.open(dialog);
  oldExit.complete();
  await Promise.resolve();
  ui.flushTimers();
  assert.equal(dialog.open, true);
  assert.equal(dialog.closes || 0, 0);
  assert.equal(staleCleanup, 0);
});

test('save and account changes can close immediately and discard stale callbacks', async () => {
  const ui = setup();
  const dialog = element('DIALOG');
  let stale = 0, current = 0;
  ui.controller.open(dialog);
  ui.controller.close(dialog, { onClosed: () => stale++ });
  const oldExit = dialog.animations.at(-1);
  ui.controller.close(dialog, { immediate: true, onClosed: () => current++ });
  assert.equal(dialog.open, false);
  oldExit.complete();
  await Promise.resolve();
  ui.flushTimers();
  assert.equal(stale, 0);
  assert.equal(current, 1);
  assert.equal(dialog.closes, 1);
});

test('an exiting modal is inert and restores its previous state on completion or reopen', async () => {
  const ui = setup();
  const dialog = element('DIALOG');
  ui.controller.open(dialog);
  ui.controller.close(dialog);
  assert.equal(dialog.inert, true);
  ui.controller.open(dialog);
  assert.equal(dialog.inert, false, 'reopened controls are immediately usable');
  ui.controller.close(dialog);
  dialog.animations.at(-1).complete();
  await Promise.resolve();
  assert.equal(dialog.inert, false);
  ui.controller.open(dialog);
  dialog.inert = true;
  ui.controller.close(dialog);
  ui.controller.destroy();
  assert.equal(dialog.inert, true, 'an externally inert dialog retains that state');
});

test('missing Web Animations support and reduced motion close without delay', () => {
  for (const reduced of [false, true]) {
    const ui = setup({ reduced });
    const dialog = element('DIALOG');
    if (!reduced) delete dialog.animate;
    ui.controller.open(dialog);
    ui.controller.close(dialog);
    assert.equal(dialog.open, false);
    assert.equal(ui.timers.size, 0);
    assert.equal(dialog.animations.length, 0);
    const button = element('BUTTON');
    if (reduced) {
      ui.doc.emit('pointerdown', { target: button });
      assert.equal(button.classList.contains('hvf-pressed'), false);
    }
  }
});

test('turning reduced motion on or hiding the page settles an exiting modal', () => {
  for (const change of ['preference', 'visibility']) {
    const ui = setup();
    const dialog = element('DIALOG');
    ui.controller.open(dialog);
    ui.controller.close(dialog);
    if (change === 'preference') { ui.preference.matches = true; ui.preference.emit('change'); }
    else { ui.doc.visibilityState = 'hidden'; ui.doc.emit('visibilitychange'); }
    assert.equal(dialog.open, false);
    assert.equal(ui.timers.size, 0);
  }
});

test('modal fallback deadline releases a dialog when no animation event arrives', () => {
  const ui = setup();
  const dialog = element('DIALOG');
  ui.controller.open(dialog);
  ui.controller.close(dialog);
  ui.flushTimers();
  assert.equal(dialog.open, false);
  assert.equal(ui.timers.size, 0);
});

test('details expand and collapse smoothly while keeping content until exit finishes', async () => {
  const ui = setup();
  const details = element('DETAILS');
  const summary = Object.assign(element('SUMMARY'), { parentElement: details });
  assert.equal(ui.doc.emit('click', { target: summary }), true);
  assert.equal(details.open, true);
  assert.equal(details.style.overflow, 'hidden');
  assert.equal(details.animations[0].frames[0].height, '44px');
  assert.equal(details.animations[0].frames[1].height, '240px');
  details.animations[0].complete();
  await Promise.resolve();
  assert.equal(details.style.overflow, '');
  ui.doc.emit('click', { target: summary });
  assert.equal(details.open, true, 'native details stays open while its content leaves');
  details.animations.at(-1).complete();
  await Promise.resolve();
  assert.equal(details.open, false);
  assert.equal(details.style.overflow, '');
});

test('rapid details reversals cancel stale collapse and finish at the last intent', async () => {
  const ui = setup();
  const details = element('DETAILS');
  const summary = Object.assign(element('SUMMARY'), { parentElement: details });
  ui.doc.emit('click', { target: summary });
  ui.doc.emit('click', { target: summary });
  const stale = details.animations.at(-1);
  ui.doc.emit('click', { target: summary });
  stale.complete();
  await Promise.resolve();
  ui.flushTimers();
  assert.equal(details.open, true);
  assert.equal(details.style.overflow, '');
});

test('controls inside summaries and reduced-motion disclosures retain native actions', () => {
  const ui = setup();
  const details = element('DETAILS');
  const summary = Object.assign(element('SUMMARY'), { parentElement: details });
  const link = Object.assign(element('A'), { parentElement: summary });
  assert.equal(ui.doc.emit('click', { target: link }), false);
  assert.equal(details.animations.length, 0);
  ui.preference.matches = true;
  assert.equal(ui.doc.emit('click', { target: summary }), false);
  assert.equal(details.animations.length, 0);
});

test('destroy settles disclosure intent, removes listeners, and permits a clean reinitialization', () => {
  const ui = setup();
  const details = Object.assign(element('DETAILS'), { open: true });
  const summary = Object.assign(element('SUMMARY'), { parentElement: details });
  ui.doc.emit('click', { target: summary });
  ui.controller.destroy();
  assert.equal(details.open, false);
  assert.equal(details.style.overflow, '');
  assert.equal(ui.timers.size, 0);
  const button = element('BUTTON');
  ui.doc.emit('pointerdown', { target: button });
  assert.equal(button.classList.contains('hvf-pressed'), false);
  ui.controller.init();
  ui.controller.init();
  ui.doc.emit('pointerdown', { target: button });
  assert.equal(button.classList.contains('hvf-pressed'), true);
  ui.controller.destroy();
  assert.equal(button.classList.contains('hvf-pressed'), false);
});
