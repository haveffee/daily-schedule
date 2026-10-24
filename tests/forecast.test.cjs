const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, validDate } = require('../assistant-forecast.js');

const options = { today: '2026-10-24', currency: 'BYN' };
const budget = (income = 100, extra = {}) => ({ id: 'budget-2026-10-BYN', kind: 'budget', month: '2026-10', currency: 'BYN', income, reservePercent: 0, goalsPercent: 0, ...extra });
const plan = (nextDate = '2026-11-01', extra = {}) => ({ id: 'income-plan-BYN', kind: 'income-plan', month: '2000-04', currency: 'BYN', nextDate, ...extra });
const commitment = (amount, extra = {}) => ({ id: 'tutors', kind: 'commitment', month: '2026-10', currency: 'BYN', amount, dueDay: 28, ...extra });
const expense = (amount, extra = {}) => ({ id: 'expense', kind: 'expense', month: '2026-10', currency: 'BYN', amount, date: '2026-10-24', category: 'flexible', ...extra });
const income = (amount, extra = {}) => ({ id: 'gift', kind: 'income', month: '2026-10', currency: 'BYN', amount, date: '2026-10-24', ...extra });

test('no configured payday gives a current recorded balance without an invented daily allowance', () => {
  const result = summarize([budget()], options);
  assert.equal(result.status, 'unconfigured');
  assert.equal(result.daysUntilIncome, null);
  assert.equal(result.perDay, null);
  assert.equal(result.freeToSpend, 100);
});

test('payday itself and an overdue date require confirmation rather than pretending income arrived', () => {
  const today = summarize([budget(), plan('2026-10-24', { expectedAmount: 1000 })], options);
  assert.equal(today.status, 'due-today');
  assert.equal(today.perDay, null);
  assert.equal(today.available, 100);
  const overdue = summarize([budget(), plan('2026-10-20')], options);
  assert.equal(overdue.status, 'overdue');
  assert.equal(overdue.daysUntilIncome, 0);
  assert.equal(overdue.daysLate, 4);
  assert.equal(overdue.perDay, null);
});

test('the interval includes today and excludes payday across a month boundary', () => {
  const result = summarize([budget(), plan('2026-11-01')], options);
  assert.equal(result.daysUntilIncome, 8);
  assert.equal(result.perDay, 12.5);
  assert.equal(summarize([budget(), plan('2026-10-25')], options).perDay, 100);
});

test('day arithmetic crosses leap days and years independently of the host timezone', () => {
  const result = summarize([plan('2028-03-01')], { ...options, today: '2028-02-28' });
  assert.equal(result.daysUntilIncome, 2);
  assert.equal(summarize([plan('2027-01-02')], { ...options, today: '2026-12-31' }).daysUntilIncome, 2);
});

test('expected pay is informational and never increases money available before payday', () => {
  const result = summarize([budget(), plan('2026-11-01', { expectedAmount: 2000 }), income(2000, { date: '2026-10-30' })], options);
  assert.equal(result.expectedAmount, 2000);
  assert.equal(result.available, 100);
  assert.equal(result.perDay, 12.5);
});

test('only current-month received transactions count, and contradictory dates do not inflate the ledger', () => {
  const result = summarize([budget(), plan(), income(20), income(80, { month: '2026-09', date: '2026-09-30' }),
    income(70, { date: '2026-11-01' }), income(40, { date: '2026-02-30' }), expense(10), expense(10, { date: '2026-12-01' })], options);
  assert.equal(result.available, 110);
  assert.equal(result.freeToSpend, 110);
});

test('monthly salary and legacy undated transactions retain the existing ledger meaning', () => {
  const result = summarize([budget(), plan(), income(20, { date: undefined }), expense(5, { date: undefined })], options);
  assert.equal(result.available, 115);
});

test('different currencies and deleted records never mix; legacy records belong to RUB', () => {
  const records = [budget(), plan(), income(20), income(90, { currency: 'USD' }), income(30, { currency: undefined }),
    income(90, { deleted: true }), plan('2026-10-25', { id: 'income-plan-USD', currency: 'USD' })];
  assert.equal(summarize(records, options).available, 120);
  assert.equal(summarize(records, { ...options, currency: 'RUB' }).available, 30);
  assert.equal(summarize(records, { ...options, currency: 'RUB' }).freeToSpend, 24);
  assert.equal(summarize(records, { ...options, currency: 'USD' }).daysUntilIncome, 1);
});

test('protected current-month obligations and savings are deducted once', () => {
  const result = summarize([budget(1000, { reservePercent: 20 }), plan(), commitment(680),
    expense(100, { category: 'essentials', commitmentId: 'tutors' })], options);
  assert.equal(result.available, 900);
  assert.equal(result.protectedRemaining, 644);
  assert.equal(result.freeToSpend, 256);
  assert.equal(result.spendable, 256);
  assert.equal(result.perDay, 32);
});

test('a planned payment of a protected current obligation does not consume free money again', () => {
  const result = summarize([budget(1000, { reservePercent: 20 }), plan(), commitment(680),
    expense(680, { date: '2026-10-28', category: 'essentials', commitmentId: 'tutors' })], options);
  assert.equal(result.available, 1000);
  assert.equal(result.plannedExpenses, 680);
  assert.equal(result.currentMonthPlannedImpact, 0);
  assert.equal(result.freeToSpend, 256);
  assert.equal(result.spendable, 256);
});

test('unprotected future spending reduces the forecast but is not presented as already paid', () => {
  const result = summarize([budget(), plan(), expense(20, { date: '2026-10-30' }), expense(50, { date: '2026-11-01', month: '2026-11' })], options);
  assert.equal(result.available, 100);
  assert.equal(result.currentMonthPlannedImpact, 20);
  assert.equal(result.plannedExpenses, 20);
  assert.equal(result.spendable, 80);
  assert.equal(result.perDay, 10);
});

test('next-month obligations before payday reduce free money; obligations on payday do not', () => {
  const result = summarize([budget(), plan('2026-11-05'), commitment(30, { month: '2026-11', dueDay: 2 }),
    commitment(80, { id: 'later', month: '2026-11', dueDay: 5 })], options);
  assert.equal(result.daysUntilIncome, 12);
  assert.equal(result.additionalObligations, 30);
  assert.equal(result.spendable, 70);
  assert.equal(result.perDay, 5.83);
});

test('a future linked payment and its obligation are counted once, including payment overruns', () => {
  const records = [budget(), plan('2026-11-05'), commitment(30, { month: '2026-11', dueDay: 2 }),
    expense(10, { date: '2026-11-02', month: '2026-11', category: 'essentials', commitmentId: 'tutors' })];
  let result = summarize(records, options);
  assert.equal(result.additionalObligations, 20);
  assert.equal(result.additionalPlannedExpenses, 10);
  assert.equal(result.spendable, 70);
  result = summarize([...records, expense(40, { date: '2026-11-03', month: '2026-11', category: 'essentials', commitmentId: 'tutors' })], options);
  assert.equal(result.additionalObligations, 0);
  assert.equal(result.additionalPlannedExpenses, 50);
  assert.equal(result.spendable, 50);
});

test('legacy future payments infer their month from the date without reserving the same obligation twice', () => {
  const result = summarize([budget(), plan('2026-11-05'), commitment(30, { month: '2026-11', dueDay: 2 }),
    expense(10, { date: '2026-11-02', month: undefined, category: 'essentials', commitmentId: 'tutors' })], options);
  assert.equal(result.additionalObligations, 20);
  assert.equal(result.additionalPlannedExpenses, 10);
  assert.equal(result.spendable, 70);
});

test('due days are clamped to the last real day of a month and undated obligations are not guessed', () => {
  const result = summarize([plan('2027-03-01'), commitment(30, { month: '2027-02', dueDay: 31 }),
    commitment(1000, { id: 'unknown', month: '2027-02', dueDay: 0 })], { ...options, today: '2027-01-30' });
  assert.equal(result.futureObligations.length, 1);
  assert.equal(result.futureObligations[0].date, '2027-02-28');
  assert.equal(result.additionalObligations, 30);
  assert.deepEqual(result.uncertainObligations, [{ id: 'unknown', title: '', month: '2027-02', amount: 1000 }]);
});

test('uncertain future obligations are reported only for months that intersect the actual forecast interval', () => {
  const records = [budget(), plan('2026-11-02'), commitment(20, { month: '2026-11', dueDay: 0 }),
    commitment(90, { id: 'december', month: '2026-12', dueDay: 0 }), commitment(30, { id: 'current', dueDay: 0 })];
  const result = summarize(records, options);
  assert.deepEqual(result.uncertainObligations.map(row => row.id), ['tutors']);
  assert.equal(result.additionalObligations, 0);
  assert.equal(result.spendable, 70);
  assert.deepEqual(summarize(records, { ...options, nextDate: '2026-11-01' }).uncertainObligations, []);
  assert.deepEqual(summarize(records, { ...options, nextDate: '2026-10-24' }).uncertainObligations, []);
});

test('insufficient money gives an explicit shortfall while preserving protected funds', () => {
  const result = summarize([budget(50), plan('2026-11-05'), commitment(70, { month: '2026-11', dueDay: 2 })], options);
  assert.equal(result.status, 'shortfall');
  assert.equal(result.shortfall, 20);
  assert.equal(result.spendable, 0);
  assert.equal(result.perDay, 0);
});

test('current unfunded obligations and an overdraft are not counted twice after an overpayment', () => {
  const result = summarize([budget(), plan(), commitment(200), expense(150, { category: 'essentials', commitmentId: 'tutors' })], options);
  assert.equal(result.status, 'shortfall');
  assert.equal(result.shortfall, 100);
});

test('scheduled spending beyond available money exposes its shortfall rather than just clamping to zero', () => {
  const result = summarize([budget(100, { reservePercent: 20 }), plan(), expense(100, { date: '2026-10-30' })], options);
  assert.equal(result.status, 'shortfall');
  assert.equal(result.freeToSpend, 80);
  assert.equal(result.shortfall, 20);
});

test('daily guidance uses whole cents without promising more money than is available', () => {
  const result = summarize([budget('0.30'), plan('2026-10-31')], options);
  assert.equal(result.daysUntilIncome, 7);
  assert.equal(result.perDay, 0.04);
  assert.equal(summarize([budget('1.005'), plan('2026-10-25')], options).perDay, 1.01);
});

test('a preview can override payday and expected amount without modifying synchronized records', () => {
  const records = [budget(), plan('2026-11-01', { expectedAmount: 1000 })];
  const before = JSON.stringify(records);
  const result = summarize(records, { ...options, nextDate: '2026-10-25', expectedAmount: 500 });
  assert.equal(result.perDay, 100);
  assert.equal(result.expectedAmount, 500);
  assert.equal(JSON.stringify(records), before);
});

test('invalid dates never roll into another month or create a phantom payday', () => {
  assert.equal(validDate('2026-02-29'), false);
  assert.equal(validDate('2028-02-29'), true);
  assert.equal(validDate('0000-01-01'), false);
  const result = summarize([budget(), plan('2026-02-31')], options);
  assert.equal(result.status, 'unconfigured');
  assert.equal(result.planIssue, 'invalid-date');
  assert.equal(result.perDay, null);
  assert.throws(() => summarize([], { ...options, today: '2026-02-31' }), /дату/);
  assert.throws(() => summarize([], { ...options, currency: 'EUR' }), /валюту/);
});
