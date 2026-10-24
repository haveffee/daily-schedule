const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize } = require('../assistant-weekly.js');

const task = (id, date, data = {}) => ({ id, kind: 'task', date, title: id, duration: 30, ...data });
const entry = (kind, date, amount, data = {}) => ({ kind, date, amount, ...data });
const report = (records, data = {}) => summarize(records, { anchorDate: '2026-10-23', ...data });

test('calendar weeks begin Monday across year and leap-day boundaries', () => {
  assert.deepEqual([report([], { anchorDate: '2021-01-01' }).startDate, report([], { anchorDate: '2021-01-01' }).endDate], ['2020-12-28', '2021-01-03']);
  const leap = report([], { anchorDate: '2024-02-29' });
  assert.equal(leap.startDate, '2024-02-26');
  assert.equal(leap.endDate, '2024-03-03');
  assert.equal(leap.days.length, 7);
  assert.equal(leap.days[3].date, '2024-02-29');
  assert.equal(report([], { anchorDate: '2026-10-25' }).startDate, '2026-10-19');
});

test('invalid civil dates never silently roll into another month', () => {
  for (const anchorDate of ['2025-02-29', '2026-02-30', '2026-13-01', '2026-10-00', '', null]) {
    assert.throws(() => report([], { anchorDate }), /дату отчёта/);
  }
  assert.equal(report([task('invalid', '2026-10-32')]).total, 0);
});

test('counts tasks by scheduled week and excludes completion after the historical week', () => {
  const result = report([
    task('legacy', '2026-10-19', { done: true, duration: 45 }),
    task('later', '2026-10-20', { done: true, completedDate: '2026-10-26', priority: 2 }),
    task('in-week', '2026-10-21', { done: true, completedAt: '2026-10-25T22:30:00.000Z' }),
    task('open', '2026-10-25', { done: false, priority: '2' }),
    task('previous', '2026-10-18', { done: true }),
    task('future', '2026-10-26', { done: true }),
  ]);
  assert.equal(result.total, 4);
  assert.equal(result.completed, 2);
  assert.equal(result.completionPercent, 50);
  assert.equal(result.completedMinutes, 75);
  assert.deepEqual(result.highPriorityPending.map(item => item.id), ['later', 'open']);
  assert.deepEqual(result.days.map(day => day.completed), [1, 0, 1, 0, 0, 0, 0]);
});

test('local completion date takes precedence over the UTC timestamp', () => {
  const result = report([task('late-Sunday', '2026-10-25', {
    done: true, completedDate: '2026-10-26', completedAt: '2026-10-25T21:05:00.000Z'
  })]);
  assert.equal(result.completed, 0);
});

test('composed recurrence occurrences replace saved week tasks without mutating input', () => {
  const records = [task('one', '2026-10-20'), task('outside', '2026-10-27')];
  const tasks = [task('one', '2026-10-20', { done: true }), task('virtual', '2026-10-22', { done: true })];
  const original = JSON.stringify({ records, tasks });
  const result = report(records, { tasks });
  assert.equal(result.total, 2);
  assert.equal(result.completed, 2);
  assert.equal(JSON.stringify({ records, tasks }), original);
  assert.equal(report(records, { tasks: [] }).total, 0);
});

test('weekly expense categories and receipts stay in separate currencies with exact cents', () => {
  const result = report([
    entry('expense', '2026-10-19', '1.005', { currency: 'BYN', category: 'food' }),
    entry('expense', '2026-10-20', '.10', { currency: 'BYN' }),
    entry('expense', '2026-10-20', '0.10', { currency: 'BYN' }),
    entry('expense', '2026-10-21', '0.20', { currency: 'BYN' }),
    entry('expense', '2026-10-22', 680, { currency: 'BYN', commitmentId: 'tutors', category: 'flexible' }),
    entry('expense', '2026-10-23', '15,25', { currency: 'USD', category: 'goal' }),
    entry('expense', '2026-10-24', 300, { category: 'reserve' }),
    entry('income', '2026-10-25', 1000, { currency: 'BYN' }),
    entry('income', '2026-10-19', 20, { currency: 'USD' }),
  ]);
  const [byn, usd, rub] = result.finances;
  assert.equal(byn.spent, 681.31);
  assert.equal(byn.income, 1000);
  assert.equal(byn.net, 318.69);
  assert.equal(byn.categories.essentials, 681.01);
  assert.equal(byn.categories.flexible, 0.3);
  assert.equal(usd.spent, 15.25);
  assert.equal(usd.categories.goals, 15.25);
  assert.equal(rub.spent, 300);
  assert.equal(rub.categories.reserve, 300);
});

test('monthly salary is never invented as weekly income and invalid or out-of-week entries are excluded', () => {
  const result = report([
    { kind: 'budget', month: '2026-10', currency: 'BYN', income: 5000 },
    entry('expense', '2026-10-18', 1, { currency: 'BYN' }),
    entry('expense', '2026-10-26', 2, { currency: 'BYN' }),
    entry('expense', '2026-10-19', -2, { currency: 'BYN' }),
    entry('expense', '2026-10-19', Infinity, { currency: 'BYN' }),
    entry('expense', '2026-10-19', 1000000001, { currency: 'BYN' }),
    entry('expense', '2026-10-19', 100, { currency: 'EUR' }),
    entry('expense', '2026-10-19', true, { currency: 'BYN' }),
    entry('income', '', 1000, { currency: 'BYN' }),
    entry('income', '2026-10-26', 1000, { currency: 'BYN' }),
  ]);
  assert.ok(result.finances.every(item => item.income === 0 && item.spent === 0));
});

test('only linked goals appear and weekly progress cannot imply completion of a whole goal', () => {
  const result = report([
    { id: 'ongoing', kind: 'goal', title: 'Project' },
    { id: 'finished', kind: 'goal', title: 'Done' },
    { id: 'money', kind: 'goal', title: 'Laptop', target: 1000, saved: 1000, currency: 'BYN' },
    { id: 'unrelated', kind: 'goal', title: 'No weekly tasks', done: true },
    task('a', '2026-10-20', { goalId: 'ongoing', done: true }),
    task('b', '2026-10-27', { goalId: 'ongoing', done: false }),
    task('c', '2026-10-21', { goalId: 'finished', done: true }),
    task('d', '2026-10-22', { goalId: 'money', done: false }),
  ]);
  assert.equal(result.goalProgress.length, 3);
  assert.equal(result.goalProgress[0].weekPercent, 100);
  assert.equal(result.goalProgress[0].progressPercent, 50);
  assert.equal(result.goalProgress[0].achieved, false);
  assert.deepEqual(result.completedGoals.map(item => item.id), ['finished', 'money']);
});

test('future completed tasks do not retroactively finish a historical goal', () => {
  const result = report([
    { id: 'goal', kind: 'goal', title: 'Project' },
    task('current', '2026-10-20', { goalId: 'goal', done: true }),
    task('future', '2026-10-27', { goalId: 'goal', done: true, completedDate: '2026-10-27' }),
  ]);
  assert.equal(result.completedGoals.length, 0);
  assert.equal(result.goalProgress[0].progressPercent, 50);
});

test('move counts are clearly lifetime totals and unknown movement dates are not invented', () => {
  const result = report([
    task('known', '2026-10-23', { moveCount: 3, movedFromDate: '2026-10-22', lastMovedDate: '2026-10-23' }),
    task('unknown', '2026-10-24', { moveCount: 5 }),
    task('old', '2026-10-21', { moveCount: 1, lastMovedAt: '2026-10-18T12:00:00Z' }),
    task('future-move', '2026-10-22', { moveCount: 9, lastMovedAt: '2026-10-26T12:00:00Z' }),
  ]);
  assert.deepEqual(result.postponed.map(item => item.id), ['unknown', 'known', 'old']);
  assert.ok(result.postponed.every(item => item.countScope === 'lifetime'));
  assert.equal(result.postponed[0].lastMovedDate, '');
  assert.equal(result.postponed[0].withinWeek, false);
  assert.equal(result.postponed[1].withinWeek, true);
  assert.equal(result.postponed[1].fromDate, '2026-10-22');
  assert.equal(result.postponed[2].withinWeek, false);
});
