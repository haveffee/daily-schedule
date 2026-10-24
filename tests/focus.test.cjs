const test = require('node:test');
const assert = require('node:assert/strict');
const focus = require('../assistant-focus.js');

function memory() {
  const values = new Map();
  return {
    values,
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

function clock(options = {}) {
  let at = options.at ?? 1000000;
  let nextId = 0;
  const scheduled = new Map();
  const storage = options.storage || memory();
  const timer = focus.createTimer({
    now: () => at, storage, scope: options.scope,
    setInterval: callback => { const id = ++nextId; scheduled.set(id, callback); return id; },
    clearInterval: id => scheduled.delete(id),
  });
  return {
    timer, storage, scheduled,
    elapse: ms => { at += ms; },
    tick: () => [...scheduled.values()].forEach(callback => callback()),
    at: () => at,
  };
}

test('focus countdown uses a deadline, not the number of ticks', () => {
  const c = clock();
  const state = c.timer.start({ taskId: 'task', title: 'Решить задачи', minutes: 25 });
  assert.equal(state.phase, 'running');
  assert.equal(state.remainingMs, 25 * 60000);
  assert.equal(state.deadline, c.at() + 25 * 60000);
  c.elapse(17 * 60000 + 1234);
  c.tick();
  assert.equal(c.timer.getState().remainingMs, 8 * 60000 - 1234);
  assert.equal(c.scheduled.size, 1);
});

test('pause freezes remaining time, including after reload, and resume starts a new deadline', () => {
  const c = clock({ scope: 'alice' });
  c.timer.start({ taskId: 'one', title: 'Читать', minutes: 25 });
  c.elapse(2 * 60000);
  const paused = c.timer.pause();
  assert.equal(paused.phase, 'paused');
  assert.equal(paused.remainingMs, 23 * 60000);
  assert.equal(c.scheduled.size, 0);
  c.elapse(60 * 60000);
  assert.equal(c.timer.getState().remainingMs, 23 * 60000);
  const reloaded = clock({ storage: c.storage, scope: 'alice', at: c.at() });
  assert.equal(reloaded.timer.getState().phase, 'paused');
  assert.equal(reloaded.timer.getState().remainingMs, 23 * 60000);
  reloaded.timer.resume();
  reloaded.elapse(60000);
  assert.equal(reloaded.timer.getState().remainingMs, 22 * 60000);
});

test('running timer recovers elapsed time when the app reopens', () => {
  const c = clock({ scope: 'alice' });
  c.timer.start({ taskId: 'one', title: 'Готовить доклад', minutes: 50 });
  c.timer.destroy();
  c.elapse(40 * 60000);
  const reloaded = clock({ storage: c.storage, scope: 'alice', at: c.at() });
  const state = reloaded.timer.init();
  assert.equal(state.phase, 'running');
  assert.equal(state.remainingMs, 10 * 60000);
  assert.equal(state.title, 'Готовить доклад');
  assert.equal(reloaded.scheduled.size, 1);
});

test('an expired hidden session finishes once, without silently starting a break or completing a task', () => {
  const c = clock();
  const events = [];
  c.timer.subscribe((state, event) => events.push({ ...event, phase: state.phase }));
  c.timer.start({ taskId: 'one', title: 'Дело', minutes: 1 });
  c.elapse(90 * 60000);
  c.tick();
  c.tick();
  const result = c.timer.getState();
  assert.equal(result.phase, 'finished');
  assert.equal(result.mode, 'focus');
  assert.equal(result.remainingMs, 0);
  assert.equal(result.finishedAt, result.startedAt + 60000);
  assert.equal(result.taskId, 'one');
  assert.equal(result.done, undefined);
  assert.equal(events.filter(event => event.type === 'finished').length, 1);
  assert.equal(c.scheduled.size, 0);
});

test('reopening an already elapsed session shows its completion without a new running countdown', () => {
  const c = clock({ scope: 'alice' });
  c.timer.start({ minutes: 1 });
  const reloaded = clock({ storage: c.storage, scope: 'alice', at: c.at() + 120000 });
  const state = reloaded.timer.getState();
  assert.equal(state.phase, 'finished');
  assert.equal(state.remainingMs, 0);
  assert.equal(reloaded.scheduled.size, 0);
  const again = clock({ storage: c.storage, scope: 'alice', at: c.at() + 180000 });
  assert.equal(again.timer.getState().phase, 'finished');
});

test('manual break has its own timer and never retains the prior task identifier', () => {
  const c = clock();
  c.timer.start({ taskId: 'one', title: 'Дело', minutes: 25 });
  const result = c.timer.startBreak(10);
  assert.equal(result.mode, 'break');
  assert.equal(result.taskId, '');
  assert.equal(result.title, 'Перерыв');
  assert.equal(result.durationMs, 10 * 60000);
  assert.equal(c.scheduled.size, 1);
  c.elapse(600000);
  assert.equal(c.timer.getState().phase, 'finished');
});

test('switching accounts restores only that account timer and leaves outgoing countdown intact', () => {
  const c = clock({ scope: 'alice' });
  c.timer.start({ taskId: 'private-a', title: 'Личное дело А', minutes: 25 });
  c.elapse(60000);
  const bob = c.timer.setScope('bob');
  assert.equal(bob.phase, 'idle');
  assert.equal(bob.taskId, '');
  assert.equal(bob.title, '');
  assert.equal(bob.scope, 'bob');
  assert.equal(c.scheduled.size, 0);
  c.timer.start({ taskId: 'private-b', title: 'Личное дело Б', minutes: 50 });
  c.elapse(60000);
  const alice = c.timer.setScope('alice');
  assert.equal(alice.taskId, 'private-a');
  assert.equal(alice.remainingMs, 23 * 60000);
  assert.equal(c.scheduled.size, 1);
  const guest = c.timer.setScope(null);
  assert.equal(guest.phase, 'idle');
  assert.equal(guest.scope, null);
  assert.equal(c.timer.setScope('bob').taskId, 'private-b');
});

test('anonymous timer is separate from signed-in timers, including a user named guest', () => {
  const c = clock();
  c.timer.start({ title: 'Гость', minutes: 25 });
  assert.equal(c.timer.setScope('guest').phase, 'idle');
  c.timer.start({ title: 'Аккаунт', minutes: 50 });
  assert.equal(c.timer.setScope(null).title, 'Гость');
});

test('stop clears persisted session and a reload cannot resurrect it', () => {
  const c = clock({ scope: 'alice' });
  c.timer.start({ title: 'Отменённое', minutes: 25 });
  assert.equal(c.storage.values.size, 1);
  assert.equal(c.timer.stop().phase, 'idle');
  assert.equal(c.storage.values.size, 0);
  assert.equal(c.scheduled.size, 0);
  const reloaded = clock({ storage: c.storage, scope: 'alice' });
  assert.equal(reloaded.timer.getState().phase, 'idle');
});

test('corrupt persisted sessions are ignored', () => {
  const storage = memory();
  const key = focus.STORAGE_PREFIX + encodeURIComponent('user:alice');
  storage.values.set(key, '{broken');
  assert.equal(clock({ storage, scope: 'alice' }).timer.getState().phase, 'idle');
  storage.values.set(key, JSON.stringify({ version: 1, phase: 'running', durationMs: Infinity, remainingMs: 5000 }));
  assert.equal(clock({ storage, scope: 'alice' }).timer.getState().phase, 'idle');
});

test('storage denial and quota errors leave a working in-memory countdown', () => {
  const c = clock({ storage: {
    getItem: () => null,
    setItem: () => { throw new Error('quota'); },
    removeItem: () => { throw new Error('denied'); },
  } });
  const state = c.timer.start({ minutes: 25 });
  assert.equal(state.storageAvailable, false);
  c.elapse(60000);
  assert.equal(c.timer.getState().remainingMs, 24 * 60000);
  assert.equal(c.timer.pause().phase, 'paused');
  assert.equal(c.timer.resume().phase, 'running');
  assert.equal(c.timer.stop().phase, 'idle');
});

test('out-of-range durations fail before replacing an existing session', () => {
  const c = clock();
  const state = c.timer.start({ minutes: 25 });
  for (const minutes of [0, -1, 481, Infinity, NaN, 'invalid', null]) {
    assert.throws(() => c.timer.start({ minutes }), RangeError);
    assert.equal(c.timer.getState().sessionId, state.sessionId);
  }
  assert.throws(() => c.timer.startBreak(61), RangeError);
  assert.equal(c.timer.start({ minutes: 480 }).durationMs, 480 * 60000);
});

test('returned state and listener snapshots cannot mutate the timer', () => {
  const c = clock();
  c.timer.subscribe(state => { state.phase = 'broken'; state.title = 'Не менять'; });
  const state = c.timer.start({ title: 'Моё дело', minutes: 25 });
  state.phase = 'idle';
  assert.equal(c.timer.getState().phase, 'running');
  assert.equal(c.timer.getState().title, 'Моё дело');
});

test('subscribing and init are idempotent; unsubscribe and destroy release resources', () => {
  const c = clock();
  const events = [];
  c.timer.init();
  c.timer.init();
  const unsubscribe = c.timer.subscribe((_, event) => events.push(event.type));
  assert.deepEqual(events, ['state']);
  c.timer.start({ minutes: 25 });
  c.timer.init();
  c.timer.init();
  assert.equal(c.scheduled.size, 1);
  unsubscribe();
  c.tick();
  assert.deepEqual(events, ['state', 'start']);
  c.timer.destroy();
  assert.equal(c.scheduled.size, 0);
});

test('clock rollback cannot increase the visible countdown past its duration', () => {
  const c = clock();
  c.timer.start({ minutes: 25 });
  c.elapse(-60000);
  assert.equal(c.timer.getState().remainingMs, 25 * 60000);
  assert.equal(c.timer.pause().remainingMs, 25 * 60000);
});

test('reading an elapsed timer reports finished before pause or resume can revive it', () => {
  const c = clock();
  c.timer.start({ minutes: 1 });
  c.elapse(61000);
  assert.equal(c.timer.pause().phase, 'finished');
  assert.equal(c.timer.resume().phase, 'finished');
});
