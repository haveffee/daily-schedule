const test = require('node:test');
const assert = require('node:assert/strict');
const { summarize, crossing } = require('../assistant-limits.js');

const month = '2026-10';
const options = { month, currency: 'BYN' };
function limit(category = 'flexible', amount = 100, changes = {}) {
  return { id: `limit-${month}-BYN-${category}`, kind: 'spending-limit', month, currency: 'BYN', category, amount, ...changes };
}
function expense(amount, changes = {}) {
  return { id: 'expense', kind: 'expense', month, date: `${month}-24`, currency: 'BYN', category: 'flexible', amount, ...changes };
}
function flexible(records, settings = options) { return summarize(records, settings).find(row => row.category === 'flexible'); }

test('empty ledgers offer all four limits without allocating or protecting money', () => {
  const rows = summarize([], options);
  assert.deepEqual(rows.slice(0,4).map(row => row.category), ['essentials', 'reserve', 'goals', 'flexible']);
  assert.equal(rows.length,12);
  assert.equal(rows.filter(row=>row.category.startsWith('category-default-')).length,8);
  assert.ok(rows.every(row => !row.configured && row.amount === 0 && row.spent === 0 && row.remaining === null && row.status === 'ok'));
  assert.equal(rows[0].id, 'limit-2026-10-BYN-essentials');
});

test('a ready category and its envelope count an explicitly categorized expense without relabeling legacy expenses', () => {
  const id='category-default-food';
  const rows=summarize([limit(id,20),expense(7,{expenseCategoryId:id,category:'essentials'}),expense(3,{category:'food'})],options);
  assert.equal(rows.find(row=>row.category===id).spent,7);
  assert.equal(rows.find(row=>row.category==='essentials').spent,10);
  assert.equal(rows.find(row=>row.category===id).title,'Продукты');
});

test('decimal expenses reach the limit exactly, including 0.1 plus 0.2', () => {
  const row = flexible([limit('flexible', '0.30'), expense(0.1), expense(0.2)]);
  assert.equal(row.spent, 0.3);
  assert.equal(row.remaining, 0);
  assert.equal(row.percent, 100);
  assert.equal(row.status, 'exceeded');
  assert.equal(flexible([limit('flexible', '1,01'), expense(1.005)]).spent, 1.01);
});

test('month and currency are separate ledgers and legacy currency is RUB', () => {
  const records = [limit(), expense(20), expense(70, { currency: 'USD' }), expense(10, { currency: undefined }),
    expense(90, { date: '2026-11-01', month: '2026-11' }), expense(90, { date: '2026-09-30', month: '2026-09' }),
    expense(90, { date: '2026-10-24', month: '2026-09' })];
  assert.equal(flexible(records).spent, 20);
  assert.equal(flexible(records, { month, currency: 'RUB' }).spent, 10);
  assert.equal(flexible(records, { month, currency: 'USD' }).spent, 70);
});

test('named goals and mandatory payments map to their category; reserved money does not count', () => {
  const rows = summarize([limit('essentials'), limit('goals'), limit('reserve'),
    expense(30, { category: 'goal', goalId: 'trip' }), expense(11, { category: 'goals' }),
    expense(68, { commitmentId: 'tutors', category: 'flexible' }), expense(5, { category: 'food' }),
    expense(8, { category: 'reserve' }),
    { kind: 'goal', month, currency: 'BYN', saved: 90, target: 100 },
    { kind: 'commitment', month, currency: 'BYN', amount: 680 },
    { kind: 'budget', month, currency: 'BYN', amount: 1000 },
    { kind: 'income', month, date: `${month}-24`, currency: 'BYN', amount: 1000 }], options);
  assert.equal(rows.find(row => row.category === 'goals').spent, 41);
  assert.equal(rows.find(row => row.category === 'essentials').spent, 73);
  assert.equal(rows.find(row => row.category === 'reserve').spent, 8);
  assert.equal(rows.find(row => row.category === 'flexible').spent, 0);
});

test('near and reached thresholds compare exact cents at 80 and 100 percent', () => {
  for (const [amount, status, remaining] of [[79.99, 'ok', 20.01], [80, 'near', 20], [99.99, 'near', 0.01], [100, 'exceeded', 0], [101, 'exceeded', -1]]) {
    const row = flexible([limit(), expense(amount)]);
    assert.equal(row.status, status);
    assert.equal(row.remaining, remaining);
  }
  assert.equal(flexible([limit('flexible', 100, { warningPercent: 100 }), expense(99.99)]).status, 'ok');
  assert.equal(flexible([limit('flexible', 100, { warningPercent: 50 }), expense(50)]).status, 'near');
});

test('invalid thresholds default to 80 percent and malformed limit records stay unconfigured', () => {
  for (const warningPercent of [undefined, null, '', NaN, Infinity, 0, 49, 101, 80.5, 'invalid']) {
    const row = flexible([limit('flexible', 100, { warningPercent }), expense(80)]);
    assert.equal(row.warningPercent, 80);
    assert.equal(row.status, 'near');
  }
  for (const changes of [{ amount: 0 }, { amount: -1 }, { amount: Infinity }, { amount: 1e308 }, { amount: true },
    { id: 'wrong-id' }, { month: '2026-09' }, { currency: 'USD' }, { category: 'goals' }, { deleted: true }]) {
    assert.equal(flexible([limit('flexible', 100, changes)]).configured, false);
  }
});

test('invalid dates, unsupported currencies, deleted expenses and negative amounts are excluded', () => {
  const records = [limit(), expense(2), expense(100, { date: '2026-10-32' }), expense(100, { date: '2026-02-30' }),
    expense(100, { date: '2026-10-24T12:00:00Z' }), expense(100, { currency: 'EUR' }),
    expense(100, { deleted: true }), expense(-20), expense(Infinity), expense({}), expense(true), null];
  assert.equal(flexible(records).spent, 2);
  assert.equal(flexible([expense(3, { month: undefined })]).spent, 3);
  assert.equal(flexible([expense(4, { date: '2028-02-29', month: '2028-02' })], { month: '2028-02', currency: 'BYN' }).spent, 4);
});

test('large supported expenses and extreme inputs remain finite and safe', () => {
  const row = flexible([limit('flexible', 1e9), expense(1e9), expense(1e9), expense(1e308)]);
  assert.equal(row.amount, 1e9);
  assert.equal(row.spent, 2e9);
  assert.equal(row.remaining, -1e9);
  assert.equal(row.percent, 200);
  const capped = flexible([limit('flexible', 0.01), ...Array.from({ length: 90100 }, () => expense(1e9))]);
  assert.ok(Number.isFinite(capped.spent) && Number.isFinite(capped.percent));
  assert.equal(Math.round(capped.spent * 100), Number.MAX_SAFE_INTEGER);
});

test('editing or deleting expenses recalculates status without keeping phantom spending', () => {
  assert.equal(flexible([limit(), expense(105)]).status, 'exceeded');
  assert.equal(flexible([limit(), expense(80)]).status, 'near');
  assert.equal(flexible([limit(), expense(30)]).status, 'ok');
  assert.equal(flexible([limit(), expense(105, { deleted: true })]).spent, 0);
});

test('crossing alerts only when increased spending enters near or reached status', () => {
  const snapshots = [0, 79, 80, 85, 100, 110].map(amount => summarize([limit(), expense(amount)], options));
  assert.equal(crossing(snapshots[0], snapshots[1]).length, 0);
  assert.equal(crossing(snapshots[1], snapshots[2])[0].status, 'near');
  assert.equal(crossing(snapshots[1], snapshots[2])[0].previousStatus, 'ok');
  assert.equal(crossing(snapshots[2], snapshots[3]).length, 0);
  assert.equal(crossing(snapshots[3], snapshots[4])[0].status, 'exceeded');
  assert.equal(crossing(snapshots[4], snapshots[5]).length, 0);
  assert.equal(crossing(snapshots[5], snapshots[2]).length, 0);
  assert.equal(crossing(snapshots[4], snapshots[4]).length, 0);
  assert.equal(crossing([], snapshots[4]).length, 0);
});

test('changing limits or warning settings creates no expense alert', () => {
  const before = summarize([limit(), expense(70)], options);
  assert.equal(crossing(before, summarize([limit('flexible', 80), expense(70)], options)).length, 0);
  assert.equal(crossing(before, summarize([limit('flexible', 100, { warningPercent: 60 }), expense(70)], options)).length, 0);
  assert.equal(crossing(summarize([expense(70)], options), summarize([limit(), expense(90)], options)).length, 0);
  assert.equal(crossing(before, summarize([limit('flexible', 100, { deleted: true }), expense(110)], options)).length, 0);
});

test('summaries and alerts do not mutate persisted records or previous snapshots', () => {
  const records = [limit(), expense(79)];
  const original = structuredClone(records);
  const before = summarize(records, options);
  const next = summarize([records[0], expense(80)], options);
  const alert = crossing(before, next)[0];
  alert.spent = 1;
  assert.deepEqual(records, original);
  assert.equal(next.find(row => row.category === 'flexible').spent, 80);
  assert.equal(before.find(row => row.category === 'flexible').spent, 79);
});

test('invalid context fails clearly and non-array record input stays empty', () => {
  assert.throws(() => summarize([], { month: '2026-13', currency: 'BYN' }), /месяц/);
  assert.throws(() => summarize([], { month, currency: 'EUR' }), /валюту/);
  assert.equal(summarize(null, options).length, 12);
  assert.deepEqual(crossing(null, null), []);
});

function customCategory(id = 'category-food', changes = {}) {
  return { id, kind: 'expense-category', month: '2000-03', title: 'Продукты', envelope: 'essentials', archived: false, ...changes };
}

test('custom category limits count linked expenses while envelope limits retain the full envelope', () => {
  const rows = summarize([customCategory(), limit('essentials', 200), limit('category-food', 100),
    expense(60, { category: 'essentials', expenseCategoryId: 'category-food', expenseCategoryTitle: 'Продукты' }),
    expense(30, { category: 'essentials' }), expense(12, { category: 'essentials', expenseCategoryId: 'category-bus' }),
    expense(15, { category: 'flexible' })], options);
  const custom = rows.find(row => row.category === 'category-food');
  assert.equal(custom.id, 'limit-2026-10-BYN-category-food');
  assert.equal(custom.title, 'Продукты');
  assert.equal(custom.spent, 60);
  assert.equal(custom.remaining, 40);
  assert.equal(custom.custom, true);
  assert.equal(custom.envelope, 'essentials');
  assert.equal(rows.find(row => row.category === 'essentials').spent, 102);
  assert.equal(rows.find(row => row.category === 'flexible').spent, 15);
});

test('active categories offer limits without expenses and archived categories retain relevant history only', () => {
  const records = [customCategory(), customCategory('category-unused', { title: 'Кино', archived: true }),
    customCategory('category-old', { title: 'Старая категория', archived: true }),
    expense(22, { expenseCategoryId: 'category-old' })];
  const rows = summarize(records, options);
  assert.ok(rows.find(row => row.category === 'category-food'));
  assert.equal(rows.find(row => row.category === 'category-old').archived, true);
  assert.equal(rows.find(row => row.category === 'category-old').spent, 22);
  assert.equal(rows.some(row => row.category === 'category-unused'), false);
  assert.equal(summarize([...records, limit('category-unused', 10)], options).find(row => row.category === 'category-unused').amount, 10);
  assert.equal(summarize(records, { month: '2026-11', currency: 'BYN' }).some(row => row.category === 'category-old'), false);
});

test('missing custom categories use history or limit title snapshots without losing totals', () => {
  const records = [expense(10, { expenseCategoryId: 'category-gone', expenseCategoryTitle: 'Старое имя', createdAt: 1 }),
    expense(15, { expenseCategoryId: 'category-gone', expenseCategoryTitle: 'Новое имя', createdAt: 2 }),
    limit('category-empty', 50, { categoryTitle: 'Старый лимит' })];
  const rows = summarize(records, options);
  assert.equal(rows.find(row => row.category === 'category-gone').spent, 25);
  assert.equal(rows.find(row => row.category === 'category-gone').title, 'Новое имя');
  assert.equal(rows.find(row => row.category === 'category-gone').archived, true);
  assert.equal(rows.find(row => row.category === 'category-empty').title, 'Старый лимит');
  assert.equal(rows.find(row => row.category === 'flexible').spent, 25);
});

test('moving a category affects future envelopes without rewriting expense snapshots or category limits', () => {
  const records = [customCategory('category-food', { title: 'Еда', envelope: 'flexible' }),
    expense(80, { category: 'essentials', expenseCategoryId: 'category-food' }),
    expense(20, { category: 'flexible', expenseCategoryId: 'category-food' }), limit('category-food', 100)];
  const rows = summarize(records, options);
  assert.equal(rows.find(row => row.category === 'essentials').spent, 80);
  assert.equal(rows.find(row => row.category === 'flexible').spent, 20);
  assert.equal(rows.find(row => row.category === 'category-food').spent, 100);
  assert.equal(rows.find(row => row.category === 'category-food').status, 'exceeded');
  assert.equal(rows.find(row => row.category === 'category-food').title, 'Еда');
});

test('custom ledgers keep currency and months isolated, and links keep envelope semantics', () => {
  const rows = summarize([customCategory('category-food', { envelope: 'flexible' }),
    expense(80, { expenseCategoryId: 'category-food', currency: 'USD' }),
    expense(5, { expenseCategoryId: 'category-food', commitmentId: 'tutor' }),
    expense(7, { expenseCategoryId: 'category-food', goalId: 'trip' }),
    expense(90, { expenseCategoryId: 'category-food', date: '2026-11-01', month: '2026-11' }),
    expense(90, { expenseCategoryId: 'category-food', deleted: true })], options);
  assert.equal(rows.find(row => row.category === 'category-food').spent, 12);
  assert.equal(rows.find(row => row.category === 'essentials').spent, 5);
  assert.equal(rows.find(row => row.category === 'goals').spent, 7);
});

test('custom warning crossings occur once per increased threshold, including simultaneous envelope warnings', () => {
  const base = [customCategory(), limit('essentials', 100), limit('category-food', 100)];
  const at = amount => summarize([...base, expense(amount, { category: 'essentials', expenseCategoryId: 'category-food' })], options);
  const alerts = crossing(at(79.99), at(80));
  assert.deepEqual(alerts.map(row => row.category), ['essentials', 'category-food']);
  assert.equal(crossing(at(80), at(90)).length, 0);
  assert.equal(crossing(at(90), at(100)).find(row => row.category === 'category-food').status, 'exceeded');
  assert.equal(crossing(at(100), at(10)).length, 0);
  assert.equal(crossing(at(100), at(100)).length, 0);
});

test('unsafe custom identifiers and malformed category metadata never create hidden rows or change accounting', () => {
  const rows = summarize([customCategory('category-<script>'), customCategory('category-bad', { envelope: 'unknown' }),
    expense(10, { expenseCategoryId: '__proto__', category: 'flexible' }),
    expense(20, { expenseCategoryId: 'category-../path', category: 'essentials' }),
    limit('category-../path', 100), limit('category-inactive', 0)], options);
  assert.equal(rows.length, 12);
  assert.equal(rows.find(row => row.category === 'flexible').spent, 10);
  assert.equal(rows.find(row => row.category === 'essentials').spent, 20);
});
