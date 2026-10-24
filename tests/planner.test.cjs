const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../assistant-core.js');
const planner = require('../assistant-planner.js');

const routine = (overrides = {}) => ({
  id: 'english', kind: 'routine', month: '2000-02', title: 'Английский',
  duration: 60, time: '', priority: 2, weekdays: [1, 3, 5],
  startDate: '2026-10-01', untilDate: '', ...overrides
});
const task = (id, date, overrides = {}) => ({ id, kind: 'task', month: date.slice(0, 7), date, title: id, duration: 30, time: '', done: false, ...overrides });

test('floating tasks use stable priority order, and missing priorities remain normal', () => {
  const input = [{ id: 'low', duration: 30, priority: 0 }, { id: 'old', duration: 30 }, { id: 'high', duration: 30, priority: 2 }, { id: 'normal', duration: 30, priority: 1 }, { id: 'high2', duration: 30, priority: 2 }];
  const before = structuredClone(input);
  const result = core.schedule(input, { breakMinutes: 0 });
  assert.deepEqual(result.placed.map(t => t.id), ['high', 'high2', 'old', 'normal', 'low']);
  assert.deepEqual(input, before);
});

test('priorities never shift fixed appointments or change the input collision winner', () => {
  const result = core.schedule([
    { id: 'low-fixed', time: '10:00', duration: 60, priority: 0 },
    { id: 'high-conflict', time: '10:00', duration: 30, priority: 2 },
    { id: 'low', duration: 30, priority: 0 }, { id: 'high', duration: 30, priority: 2 }
  ], { start: '09:00', end: '12:00', breakMinutes: 0 });
  assert.deepEqual(result.placed.map(t => [t.id, t.start]), [['high', 540], ['low', 570], ['low-fixed', 600]]);
  assert.equal(result.conflicts[0].withTaskId, 'low-fixed');
  assert.equal(result.waiting[0].id, 'high-conflict');
});

test('priority controls which floating tasks fit a partly occupied day', () => {
  const result = core.schedule([
    { id: 'low', duration: 30, priority: 0 },
    { id: 'fixed', duration: 30, time: '09:30' },
    { id: 'high', duration: 30, priority: 2 }
  ], { start: '09:00', end: '10:00', breakMinutes: 0 });
  assert.deepEqual(result.placed.map(t => t.id), ['high', 'fixed']);
  assert.deepEqual(result.waiting.map(t => t.id), ['low']);
});

test('checking completion preserves slots with mixed priorities', () => {
  const input = [{ id: 'low', duration: 30, priority: 0 }, { id: 'high', duration: 45, priority: 2 }, { id: 'normal', duration: 30 }];
  assert.deepEqual(core.schedule(input).placed.map(t => [t.id, t.start, t.end]), core.schedule(input.map(t => ({ ...t, done: t.id === 'high' }))).placed.map(t => [t.id, t.start, t.end]));
});

test('priority normalization accepts only the defined levels and defaults legacy to normal', () => {
  for (const value of [undefined, null, '', NaN, Infinity, 'invalid', -1, 3]) assert.equal(planner.priorityValue(value), 1);
  for (const value of [0, 1, 2, '0', '1', '2']) assert.equal(planner.priorityValue({ priority: value }), Number(value));
});

test('civil dates handle leap days and month/year boundaries independently of timezone', () => {
  assert.equal(planner.nextDate('2026-10-31'), '2026-11-01');
  assert.equal(planner.nextDate('2026-12-31'), '2027-01-01');
  assert.equal(planner.nextDate('2028-02-28'), '2028-02-29');
  assert.equal(planner.nextDate('2028-02-29'), '2028-03-01');
  assert.equal(planner.nextDate('2100-02-28'), '2100-03-01');
  assert.equal(planner.nextDate('0099-12-31'), '0100-01-01');
  for (const date of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-10-00', '2026-10-32', '0000-01-01', '2026-1-01', undefined]) {
    assert.equal(planner.validDate(date), false);
    assert.equal(planner.nextDate(date), '');
  }
  assert.equal(planner.nextDate('9999-12-31'), '');
});

test('routine validation requires civil dates, weekdays and bounded optional fields', () => {
  assert.deepEqual(planner.validateRoutine(routine()), { valid: true, errors: [] });
  assert.equal(planner.validateRoutine(routine({ duration: '', time: '' })).valid, true);
  for (const overrides of [{ weekdays: [] }, { weekdays: [0] }, { weekdays: ['1'] }, { title: ' ' }, { startDate: '2026-02-29' }, { untilDate: '2026-09-30' }, { untilDate: 'wrong' }, { time: '24:00' }, { duration: 0 }, { duration: 481 }]) {
    assert.equal(planner.validateRoutine(routine(overrides)).valid, false);
  }
});

test('recurring days use ISO weekday numbers and include both start and end', () => {
  const records = [routine({ startDate: '2026-10-23', untilDate: '2026-10-26', weekdays: [1, 5, 7] })];
  for (const [date, count] of [['2026-10-22', 0], ['2026-10-23', 1], ['2026-10-24', 0], ['2026-10-25', 1], ['2026-10-26', 1], ['2026-10-30', 0]]) {
    assert.equal(planner.tasksForDay(records, date).length, count, date);
  }
});

test('occurrences cross months without writing or sharing completion state', () => {
  const records = [routine({ weekdays: [1, 2, 3, 4, 5, 6, 7] }), task('separate', '2026-11-01')];
  const before = structuredClone(records);
  const october = planner.tasksForDay(records, '2026-10-31')[0];
  const november = planner.tasksForDay(records, '2026-11-01');
  assert.equal(october.id, planner.routineTaskId('english', '2026-10-31'));
  assert.equal(october.month, '2026-10');
  const novemberOccurrence = november.find(t => t.routineId === 'english');
  assert.equal(novemberOccurrence.month, '2026-11');
  assert.equal(novemberOccurrence.done, false);
  assert.equal(novemberOccurrence.virtual, true);
  october.done = true;
  assert.equal(planner.tasksForDay(records, '2026-10-31')[0].done, false);
  assert.deepEqual(records, before);
});

test('explicit completed occurrence overrides the virtual task without duplicates', () => {
  const occurrenceDate = '2026-10-23';
  const override = task(planner.routineTaskId('english', occurrenceDate), occurrenceDate, { routineId: 'english', occurrenceDate, done: true, title: 'Изменённый урок' });
  const result = planner.tasksForDay([routine(), override], occurrenceDate);
  assert.equal(result.length, 1);
  assert.equal(result[0].done, true);
  assert.equal(result[0].title, 'Изменённый урок');
  assert.equal(planner.tasksForDay([routine(), override], '2026-10-26')[0].done, false);
});

test('moved occurrence suppresses the original globally even with a new cross-month id', () => {
  const override = task('moved-new-id', '2026-11-01', { routineId: 'english', occurrenceDate: '2026-10-23', title: 'Перенесённый урок' });
  const records = [routine(), override];
  assert.equal(planner.tasksForDay(records, '2026-10-23').length, 0);
  assert.equal(planner.tasksForDay(records, '2026-11-01')[0].id, 'moved-new-id');
  assert.equal(planner.tasksForDay(records, '2026-10-26').length, 1);
});

test('skipped occurrence remains absent and does not affect another date', () => {
  const date = '2026-10-23';
  const skip = { id: planner.routineSkipId('english', date), kind: 'routine-skip', month: '2026-10', routineId: 'english', occurrenceDate: date };
  assert.equal(planner.tasksForDay([routine(), skip], date).length, 0);
  assert.equal(planner.tasksForDay([routine(), skip], '2026-10-26').length, 1);
  assert.equal(planner.tasksForDay([{ ...routine(), deleted: true }], date).length, 0);
});

test('a live skip wins over a stale offline saved occurrence and a moved override', () => {
  const date = '2026-10-23';
  const skip = { id: planner.routineSkipId('english', date), kind: 'routine-skip', month: '2026-10', routineId: 'english', occurrenceDate: date };
  const original = task(planner.routineTaskId('english', date), date, { routineId: 'english', occurrenceDate: date, title: 'Старая офлайн-правка' });
  const moved = task('moved', '2026-11-01', { routineId: 'english', occurrenceDate: date, lastMovedAt: '2026-10-23T10:00:00Z' });
  const records = [routine(), skip, original, moved];
  assert.notEqual(skip.id, original.id);
  assert.deepEqual(planner.tasksForDay(records, date), []);
  assert.deepEqual(planner.tasksForDay(records, '2026-11-01'), []);
  assert.equal(planner.tasksForDay(records, '2026-10-26').length, 1);
});

test('interrupted cross-month moves show only the latest occurrence globally', () => {
  const date = '2026-10-23';
  const first = task('source', date, { routineId: 'english', occurrenceDate: date, lastMovedAt: '2026-10-22T08:00:00Z' });
  const moved = task('destination', '2026-11-01', { routineId: 'english', occurrenceDate: date, lastMovedAt: '2026-10-23T08:00:00Z' });
  for (const records of [[routine(), first, moved], [moved, first, routine()]]) {
    assert.equal(planner.tasksForDay(records, date).length, 0);
    assert.deepEqual(planner.tasksForDay(records, '2026-11-01').map(t => t.id), ['destination']);
  }
});

test('duplicate occurrence ties resolve by updatedAt then id independently of array order', () => {
  const date = '2026-10-23';
  const first = task('z-source', date, { routineId: 'english', occurrenceDate: date, updatedAt: 100 });
  const moved = task('a-destination', '2026-11-01', { routineId: 'english', occurrenceDate: date, updatedAt: 200 });
  for (const records of [[first, moved], [moved, first]]) assert.equal(planner.tasksForDay(records, date).length, 0);
  const tie = { ...first, id: 'zz-destination', date: '2026-11-01', month: '2026-11' };
  for (const records of [[first, tie], [tie, first]]) {
    assert.equal(planner.tasksForDay(records, date).length, 0);
    assert.deepEqual(planner.tasksForDay(records, '2026-11-01').map(t => t.id), ['zz-destination']);
  }
});

test('routine edits affect virtual occurrences and leave explicit history unchanged', () => {
  const done = task('done', '2026-10-23', { routineId: 'english', occurrenceDate: '2026-10-23', done: true, title: 'Первый урок' });
  const updated = routine({ title: 'Новый урок', duration: 90, weekdays: [5] });
  assert.equal(planner.tasksForDay([updated, done], '2026-10-23')[0].title, 'Первый урок');
  assert.equal(planner.tasksForDay([updated, done], '2026-10-30')[0].title, 'Новый урок');
  assert.equal(planner.tasksForDay([updated, done], '2026-10-26').length, 0);
  assert.equal(planner.tasksForDay([done], '2026-10-23')[0].done, true);
});

test('inactive routines stop virtual occurrences and preserve explicit history and date bounds', () => {
  const stopped = routine({ active: false, startDate: '2026-11-02', untilDate: '2026-12-31' });
  const before = structuredClone(stopped);
  const explicit = task('saved', '2026-11-02', { routineId: 'english', occurrenceDate: '2026-11-02', done: true });
  assert.equal(planner.tasksForDay([stopped], '2026-11-02').length, 0);
  assert.equal(planner.tasksForDay([stopped], '2026-11-04').length, 0);
  assert.deepEqual(planner.tasksForDay([stopped, explicit], '2026-11-02'), [{ ...explicit, createdAt: 0 }]);
  assert.deepEqual(stopped, before);
  assert.equal(planner.tasksForDay([{ ...stopped, active: true }], '2026-11-02').length, 1);
});

test('completing a recurring occurrence keeps equal-priority task order and slots stable', () => {
  const date = '2026-10-23';
  const records = [routine({ id: 'first', priority: 1, createdAt: 100 }), routine({ id: 'second', priority: 1, createdAt: 200 }), task('manual', date, { priority: 1, createdAt: 150 })];
  const before = planner.tasksForDay(records, date);
  const occurrence = before.find(t => t.routineId === 'second');
  const completed = { ...occurrence, done: true };
  delete completed.virtual;
  const after = planner.tasksForDay(records.concat(completed), date);
  assert.deepEqual(after.map(t => t.id), before.map(t => t.id));
  assert.deepEqual(core.schedule(after).placed.map(t => [t.id, t.start, t.end]), core.schedule(before).placed.map(t => [t.id, t.start, t.end]));
});

test('legacy routine timestamps and logical occurrence ids keep order stable when saved or moved', () => {
  const date = '2026-10-23';
  const first = routine({ id: 'a', priority: 1 }), second = routine({ id: 'b', priority: 1 });
  const initial = planner.tasksForDay([first, second], date);
  const saved = { ...initial[1], id: 'arbitrary-persistence-id', done: true, createdAt: 999999 };
  delete saved.virtual;
  const after = planner.tasksForDay([saved, second, first], date);
  assert.deepEqual(after.map(t => t.routineId), ['a', 'b']);
  assert.deepEqual(after.map(t => t.createdAt), [0, 0]);
  const otherDate = '2026-11-01';
  const movedFirst = { ...initial[0], id: 'z-new', date: otherDate, month: '2026-11' };
  const movedSecond = { ...initial[1], id: 'a-new', date: otherDate, month: '2026-11' };
  assert.deepEqual(planner.tasksForDay([first, second, movedSecond, movedFirst], otherDate).map(t => t.routineId), ['a', 'b']);
});

test('virtual occurrences inherit the series duration estimate metadata', () => {
  const original = routine({ createdAt: 12345, estimated: true, estimateSource: 'local' });
  const occurrence = planner.tasksForDay([original], '2026-10-23')[0];
  assert.equal(occurrence.createdAt, 12345);
  assert.equal(occurrence.estimated, true);
  assert.equal(occurrence.estimateSource, 'local');
  assert.equal(original.virtual, undefined);
});

test('move preview excludes completed tasks, respects destination meetings and reports overflow', () => {
  const records = [
    task('low', '2026-10-23', { priority: 0 }),
    task('done', '2026-10-23', { done: true }),
    task('high', '2026-10-23', { priority: 2, moveCount: 2 }),
    task('meeting', '2026-10-24', { time: '09:30', duration: 30 })
  ];
  const before = structuredClone(records);
  const result = planner.prepareMove(records, '2026-10-23', '2026-10-24', { start: '09:00', end: '10:00', breakMinutes: 0 });
  assert.deepEqual(result.candidates.map(t => t.id), ['high', 'low']);
  assert.deepEqual(result.placed.map(t => [t.id, t.start]), [['high', 540], ['meeting', 570]]);
  assert.deepEqual(result.waiting.map(t => t.id), ['low']);
  assert.equal(result.moved.find(t => t.id === 'high').time, '');
  assert.equal(result.moved.find(t => t.id === 'high').moveCount, 3);
  assert.equal(result.moved[0].date, '2026-10-24');
  assert.equal(result.moved[0].movedFromDate, '2026-10-23');
  assert.deepEqual(records, before);
});

test('move preview preserves routine occurrence identity and proposes cross-month records', () => {
  const records = [routine({ weekdays: [6], startDate: '2026-10-31' })];
  const result = planner.prepareMove(records, '2026-10-31', '2026-11-01');
  assert.equal(result.moved.length, 1);
  const moved = result.moved[0];
  assert.equal(moved.month, '2026-11');
  assert.equal(moved.routineId, 'english');
  assert.equal(moved.occurrenceDate, '2026-10-31');
  assert.equal(moved.virtual, undefined);
  assert.equal(planner.tasksForDay(records.concat(moved), '2026-10-31').length, 0);
  assert.equal(planner.tasksForDay(records.concat(moved), '2026-11-01').length, 1);
});

test('move preview retains fixed times by default and exposes destination conflicts', () => {
  const records = [task('source', '2026-10-23', { time: '10:00', priority: 2 }), task('meeting', '2026-10-24', { time: '10:00', priority: 0 })];
  const fixed = planner.prepareMove(records, '2026-10-23', '2026-10-24');
  assert.equal(fixed.moved[0].time, '10:00');
  assert.equal(fixed.waiting[0].id, 'source');
  assert.equal(fixed.conflicts[0].withTaskId, 'meeting');
  const flexible = planner.prepareMove(records, '2026-10-23', '2026-10-24', { resetTimes: true });
  assert.equal(flexible.moved[0].time, '');
  assert.equal(flexible.waiting.length, 0);
});

test('move preview includes only explicitly selected unfinished task ids', () => {
  const records = [task('first', '2026-10-23'), task('second', '2026-10-23'), task('done', '2026-10-23', { done: true })];
  assert.deepEqual(planner.prepareMove(records, '2026-10-23', '2026-10-24', { taskIds: ['second', 'done', 'missing'] }).moved.map(t => t.id), ['second']);
  assert.deepEqual(planner.prepareMove(records, '2026-10-23', '2026-10-24', { taskIds: [] }).moved, []);
});

test('move previews are no-ops for the same day and reject impossible dates', () => {
  const records = [task('same', '2026-10-23')];
  const result = planner.prepareMove(records, '2026-10-23', '2026-10-23');
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.moved, []);
  assert.equal(result.placed.length, 1);
  assert.throws(() => planner.prepareMove(records, '2026-02-29', '2026-03-01'), /даты/);
});
