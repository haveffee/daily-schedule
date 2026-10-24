const test = require('node:test');
const assert = require('node:assert/strict');
const backup = require('../assistant-backup.js');

const stamp = '2026-10-24T12:00:00.000Z';
const task = (id = 'first', overrides = {}) => ({
  id, kind: 'task', month: '2026-10', date: '2026-10-24', title: 'Подготовить документы', duration: 30,
  time: '18:00', priority: 2, done: false, reminderMinutes: 10, ...overrides
});
const envelope = records => ({ app: 'HVF', version: 3, scope: 'all', exportedAt: stamp, records });
const parsed = records => backup.parse(JSON.stringify(envelope(records)));

test('full export includes previous months, recurring rules, preferences and old estimate metadata', () => {
  const original = [task(), task('previous', { month: '2026-09', date: '2026-09-04', estimated: true, estimateSource: 'qwen' }),
    { id: 'weekly', kind: 'routine', month: '2000-02', title: 'Занятие', weekdays: [1, 3], startDate: '2026-09-01', duration: 60, time: '17:30', active: true },
    { id: 'finance-preferences', kind: 'finance-preferences', month: '2000-01', currency: 'BYN' },
    { id: 'onboarding-preferences', kind: 'onboarding-preferences', month: '2000-05', completed: true, version: 1, completedAt: stamp },
    { id: 'category-cafes', kind: 'expense-category', month: '2000-03', title: 'Кафе', envelope: 'flexible', archived: false },
    { id: 'income-plan-BYN', kind: 'income-plan', month: '2000-04', currency: 'BYN', nextDate: '2026-11-15', expectedAmount: 1500 }];
  const exported = backup.create(Object.fromEntries(original.map(record => [record.id, record])), { exportedAt: stamp });
  assert.deepEqual(exported, envelope(original));
  assert.deepEqual(backup.parse(JSON.stringify(exported)).records, original);
  exported.records[0].title = 'Изменено вне приложения';
  assert.equal(original[0].title, 'Подготовить документы');
});

test('version 2 monthly backups remain restorable with a clear history warning', () => {
  const old = { app: 'HVF', version: 2, month: '2026-10', exportedAt: stamp, records: [task(),
    { id: 'legacy-budget', kind: 'budget', month: '2026-10', income: 500, reservePercent: 0, goalsPercent: 0 },
    { id: 'legacy-expense', kind: 'expense', month: '2026-10', amount: 50, category: 'flexible' }] };
  const result = backup.parse(JSON.stringify(old));
  assert.equal(result.ok, true);
  assert.equal(result.scope, 'month');
  assert.match(result.warnings.join(' '), /не всю историю/);
  assert.deepEqual(backup.importPlan([], result).additions, old.records);
});

test('default restore adds new records and reports conflicts without touching current records', () => {
  const existing = task('same');
  const changed = task('different', { title: 'Текущая версия' });
  const untouched = task('unrelated');
  const current = [existing, changed, untouched];
  const incoming = [task('same'), task('different', { title: 'Версия из копии' }), task('new')];
  const before = JSON.stringify({ current, incoming });
  const plan = backup.importPlan(current, envelope(incoming));
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.records, [task('new')]);
  assert.deepEqual(plan.additions, [task('new')]);
  assert.equal(plan.replacements.length, 0);
  assert.deepEqual(plan.unchanged, [existing]);
  assert.equal(plan.conflicts[0].id, 'different');
  assert.equal(plan.conflicts[0].reason, 'changed');
  assert.equal(plan.conflicts[0].replaceable, true);
  assert.equal(plan.skipped, 1);
  assert.equal(JSON.stringify({ current, incoming }), before);
});

test('explicit replace overwrites only changed matching ids and never removes unrelated records', () => {
  const current = [task('first', { title: 'Изменённое дело' }), task('unrelated')];
  const plan = backup.preview(current, envelope([task()]), { mode: 'replace' });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.records, [task()]);
  assert.deepEqual(plan.replacements, [task()]);
  assert.equal(plan.skipped, 0);
  assert.equal(plan.records.some(record => record.id === 'unrelated'), false);
  assert.equal(current[1].id, 'unrelated');
});

test('same id in another month or kind is never replaceable', () => {
  const current = [task('moved', { month: '2026-09', date: '2026-09-30' }),
    { id: 'reused', kind: 'goal', month: '2026-10', title: 'Цель' }];
  const plan = backup.importPlan(current, envelope([task('moved'), task('reused')]), { mode: 'replace' });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.records, []);
  assert.deepEqual(plan.conflicts.map(item => [item.id, item.reason, item.replaceable]), [['moved', 'month', false], ['reused', 'kind', false]]);
  assert.equal(plan.skipped, 2);
});

test('duplicate ids block the entire backup even when their months differ', () => {
  const result = parsed([task(), task('first', { month: '2026-11', date: '2026-11-02' }), task('valid')]);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some(error => error.code === 'duplicate'), true);
  assert.deepEqual(result.records, []);
  const plan = backup.importPlan([], result);
  assert.equal(plan.ok, false);
  assert.deepEqual(plan.records, []);
});

test('bad dates, month mismatches, non-finite values and unknown kinds block restoration', () => {
  const cases = [
    task('bad-day', { date: '2026-02-30', month: '2026-02' }),
    task('month-mismatch', { date: '2026-11-01' }),
    task('bad-time', { time: '24:05' }),
    task('unknown', { kind: 'auth' }),
    { id: 'cash', kind: 'expense', month: '2026-10', amount: -20 },
    { id: 'currency', kind: 'expense', month: '2026-10', amount: 20, currency: 'EUR' },
    { id: 'weekly', kind: 'routine', month: '2000-02', title: 'Дело', weekdays: [0], startDate: '2026-10-01' },
    { id: 'skip', kind: 'routine-skip', month: '2026-10', routineId: 'weekly', occurrenceDate: '2026-11-01' }
  ];
  for (const record of cases) {
    const result = parsed([task('valid'), record]);
    assert.equal(result.ok, false, record.id);
    assert.deepEqual(backup.importPlan([], result).records, [], record.id);
  }
  assert.equal(backup.parse('{"app":"HVF","version":3,"scope":"all","records":[{"id":"bad","kind":"expense","month":"2026-10","amount":1e999}]}').ok, false);
});

test('prototype keys and credentials are rejected even inside nested otherwise harmless fields', () => {
  for (const fragment of ['"__proto__":{"polluted":true}', '"constructor":{}', '"prototype":{}', '"id_token":"secret"', '"VAPID_PRIVATE_KEY":"secret"']) {
    const text = JSON.stringify(envelope([task()])).replace('"title":"Подготовить документы"', '"title":"Подготовить документы","metadata":{' + fragment + '}');
    const result = backup.parse(text);
    assert.equal(result.ok, false, fragment);
    assert.equal(result.errors[0].code, 'unsafe');
  }
  assert.equal({}.polluted, undefined);
});

test('5 MiB bound uses UTF-8 bytes rather than character count, and record count is capped', () => {
  assert.equal(backup.parse(' '.repeat(backup.MAX_BYTES + 1)).errors[0].code, 'size');
  const largeUnicode = JSON.stringify(envelope([task('unicode', { notes: 'я'.repeat(backup.MAX_BYTES / 2) })]));
  assert.ok(largeUnicode.length < backup.MAX_BYTES);
  assert.equal(backup.parse(largeUnicode).errors[0].code, 'size');
  const many = Array.from({ length: backup.MAX_RECORDS + 1 }, (_, i) => task('task-' + i));
  assert.equal(parsed(many).errors.some(error => error.code === 'count'), true);
});

test('deep nested data is rejected safely and a UTF-8 BOM is accepted', () => {
  let notes = 'ок';
  for (let i = 0; i < 50; i += 1) notes = { nested: notes };
  const tooDeep = parsed([task('deep', { notes })]);
  assert.equal(tooDeep.ok, false);
  assert.equal(tooDeep.errors[0].code, 'unsafe');
  assert.equal(backup.parse('\uFEFF' + JSON.stringify(envelope([task()]))).ok, true);
});

test('canonical comparison ignores property order but preserves financial differences and legacy fields', () => {
  const original = task('first', { estimated: true, estimateSource: 'qwen', metadata: { b: 2, a: 1 } });
  const reordered = Object.fromEntries(Object.entries(original).reverse());
  reordered.metadata = { a: 1, b: 2 };
  const plan = backup.importPlan([original], envelope([reordered]));
  assert.equal(plan.unchanged.length, 1);
  assert.equal(plan.conflicts.length, 0);
  const finances = { id: 'price', kind: 'expense', month: '2026-10', currency: 'BYN', amount: 0.1, category: 'flexible' };
  assert.equal(backup.importPlan([finances], envelope([{ ...finances, amount: 0.11 }])).conflicts.length, 1);
});

test('parsed preview is revalidated after mutation before use and invalid modes cannot write', () => {
  const result = parsed([task()]);
  result.backup.records[0].date = '2026-10-99';
  const plan = backup.importPlan([], result, { mode: 'replace' });
  assert.equal(plan.ok, false);
  assert.deepEqual(plan.records, []);
  assert.equal(backup.importPlan([], envelope([task()]), { mode: 'unexpected' }).ok, false);
  assert.equal(backup.importPlan([], { ok: false, backup: null, records: [task()], errors: [] }).ok, false);
});

test('create rejects invalid non-data objects without invoking getters or serializing cycles', () => {
  let called = false;
  const record = task();
  Object.defineProperty(record, 'secret', { enumerable: true, get() { called = true; return 'unexpected'; } });
  assert.throws(() => backup.create([record]), /обычные поля/);
  assert.equal(called, false);
  const cyclic = task();
  cyclic.notes = cyclic;
  assert.throws(() => backup.create([cyclic]), /циклическую/);
  assert.throws(() => backup.create(new Date()), /список записей/);
});

test('empty complete backup is a valid no-op and parse errors explain unsupported files', () => {
  const empty = backup.create([], { exportedAt: stamp });
  const plan = backup.importPlan([task()], empty);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.records, []);
  assert.equal(backup.parse('{bad json').errors[0].code, 'json');
  assert.equal(backup.parse(JSON.stringify({ app: 'Different', version: 3, records: [] })).ok, false);
  assert.equal(backup.parse(JSON.stringify({ app: 'HVF', version: 99, records: [] })).ok, false);
});

test('money restored from decimal or scientific notation is counted by the actual budget parser', () => {
  const core = require('../assistant-core.js');
  for (const amount of [16, '16', '1.6e1', '+16.00', '0', '1e-2']) {
    const expense = { id: 'decimal-expense', kind: 'expense', month: '2026-10', amount, currency: 'BYN', category: 'flexible' };
    const plan = backup.importPlan([], envelope([expense]));
    assert.equal(plan.ok, true, String(amount));
    const allocation = core.allocateBudget({ currency: 'BYN', income: 100, expenses: plan.records });
    assert.equal(allocation.envelopes.flexible.spent, Number(amount), String(amount));
  }
  for (const amount of ['0x10', '0b10000', '0o20', [16], true, false, '', 'Infinity']) {
    const expense = { id: 'malformed-expense', kind: 'expense', month: '2026-10', amount, currency: 'BYN', category: 'flexible' };
    const result = parsed([task('valid'), expense]);
    assert.equal(result.ok, false, JSON.stringify(amount));
    assert.deepEqual(backup.importPlan([], result).records, [], JSON.stringify(amount));
  }
});

test('category backup validation matches active and archived category semantics', () => {
  const categories = require('../assistant-categories.js');
  const category = { id: 'category-cafes', kind: 'expense-category', month: '2000-03', title: 'Кафе', envelope: 'flexible', archived: false };
  for (const archived of [false, true, undefined]) {
    const record = { ...category, archived };
    if (archived === undefined) delete record.archived;
    const result = parsed([record]);
    assert.equal(result.ok, true, String(archived));
    assert.equal(categories.list(result.records, { includeArchived: true }).length, 1);
    assert.equal(categories.list(result.records).length, archived === true ? 0 : 1);
  }
  for (const changes of [
    { archived: 'false' }, { archived: null }, { archived: 0 }, { envelope: 'unknown' }, { envelope: [] },
    { id: 'cafes' }, { id: 'category-' }, { month: '2026-10' }, { title: 'я'.repeat(49) }, { title: [] }
  ]) {
    const result = parsed([{ ...category, ...changes }]);
    assert.equal(result.ok, false, JSON.stringify(changes));
    assert.deepEqual(backup.importPlan([], result).records, [], JSON.stringify(changes));
  }
});

test('income plan requires its global id, currency and civil date while preserving overdue plans', () => {
  const plan = { id: 'income-plan-BYN', kind: 'income-plan', month: '2000-04', currency: 'BYN', nextDate: '2026-09-20', expectedAmount: 1500 };
  for (const expectedAmount of [null, undefined, 0, '1e3', 1000.01]) {
    const record = { ...plan, expectedAmount };
    if (expectedAmount === undefined) delete record.expectedAmount;
    assert.equal(parsed([record]).ok, true, String(expectedAmount));
  }
  for (const changes of [
    { id: 'payday' }, { currency: 'USD' }, { id: 'income-plan-EUR', currency: 'EUR' }, { month: '2026-10' },
    { nextDate: [] }, { nextDate: '2026-02-30' }, { nextDate: '' }, { expectedAmount: ['1000'] },
    { expectedAmount: false }, { expectedAmount: '0x10' }, { expectedAmount: '' }, { expectedAmount: -1 }
  ]) {
    const result = parsed([{ ...plan, ...changes }]);
    assert.equal(result.ok, false, JSON.stringify(changes));
    assert.deepEqual(backup.importPlan([], result).records, [], JSON.stringify(changes));
  }
});

test('first-run preferences cannot silently change behavior through truthy strings or wrong ids', () => {
  const preference = { id: 'onboarding-preferences', kind: 'onboarding-preferences', month: '2000-05', version: 1, completed: true, completedAt: stamp };
  assert.equal(parsed([preference]).ok, true);
  assert.equal(parsed([{ ...preference, completed: false }]).ok, true);
  for (const changes of [{ id: 'wizard' }, { month: '2026-10' }, { completed: 'false' }, { completed: null }, { version: '1' }, { version: 2 }]) {
    const result = parsed([{ ...preference, ...changes }]);
    assert.equal(result.ok, false, JSON.stringify(changes));
    assert.deepEqual(backup.importPlan([], result).records, [], JSON.stringify(changes));
  }
});
