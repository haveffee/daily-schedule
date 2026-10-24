const test = require('node:test');
const assert = require('node:assert/strict');
const categories = require('../assistant-categories.js');

const category = (changes = {}) => ({ id: 'category-food', kind: 'expense-category', month: '2000-03', title: 'Продукты', envelope: 'essentials', archived: false, ...changes });

test('categories are global, active by default, sorted and independently copied', () => {
  const records = [category(), category({ id: 'category-fun', title: 'Кино', envelope: 'flexible' }), category({ id: 'category-old', title: 'Старое', archived: true }),
    category({ id: 'category-deleted', deleted: true }), category({ id: 'category-wrong-month', month: '2026-10' }), null];
  const original = structuredClone(records);
  assert.deepEqual(categories.list(records).map(row => row.title), ['Кино', 'Продукты']);
  assert.equal(categories.list(records, { includeArchived: true }).length, 3);
  const first = categories.list(records)[0]; first.title = 'Другое';
  assert.deepEqual(records, original);
  assert.deepEqual(categories.list(null), []);
});

test('validating a category normalizes whitespace and prevents indistinguishable active names', () => {
  const input = category({ title: '  Еда   вне дома  ' });
  const saved = categories.validateCategory(input, []);
  assert.equal(saved.title, 'Еда вне дома');
  assert.equal(input.title, '  Еда   вне дома  ');
  assert.throws(() => categories.validateCategory(category({ id: 'category-other', title: ' продукты ' }), [category()]), /уже существует/);
  assert.doesNotThrow(() => categories.validateCategory(category(), [category()]));
  assert.doesNotThrow(() => categories.validateCategory(category({ id: 'category-new' }), [category({ archived: true })]));
  assert.doesNotThrow(() => categories.validateCategory(category({ id: 'category-old', archived: true }), [category()]));
  assert.throws(() => categories.validateCategory(category({ id: 'category-old', archived: false }), [category()]), /уже существует/);
});

test('malformed category records fail clearly and never enter category lists', () => {
  for (const changes of [{ id: '' }, { id: 'food' }, { id: 'category-../food' }, { id: 'category-<script>' }, { month: '2026-10' },
    { kind: 'expense' }, { title: '' }, { title: ' '.repeat(100) }, { title: 'a'.repeat(49) }, { envelope: 'food' }, { archived: 'false' }, { deleted: true }]) {
    const record = category(changes);
    assert.throws(() => categories.validateCategory(record, []), Error);
    assert.deepEqual(categories.list([record], { includeArchived: true }), []);
  }
});

test('renaming or moving a category changes labels without reclassifying old expense envelopes', () => {
  const expense = { category: 'essentials', expenseCategoryId: 'category-food', expenseCategoryTitle: 'Продукты' };
  const result = categories.classification(expense, [category({ title: 'Покупки', envelope: 'flexible' })]);
  assert.deepEqual(result, { id: 'category-food', title: 'Покупки', envelope: 'essentials', custom: true, archived: false, missing: false });
  assert.equal(expense.expenseCategoryTitle, 'Продукты');
  assert.equal(categories.classification({ expenseCategoryId: 'category-food' }, [category()]).envelope, 'essentials');
});

test('archiving and missing category records preserve readable historical expense labels', () => {
  const expense = { category: 'flexible', expenseCategoryId: 'category-food', expenseCategoryTitle: 'Продукты раньше' };
  assert.equal(categories.classification(expense, [category({ archived: true })]).title, 'Продукты');
  assert.equal(categories.classification(expense, [category({ archived: true })]).archived, true);
  const missing = categories.classification(expense, []);
  assert.equal(missing.title, 'Продукты раньше');
  assert.equal(missing.missing, true);
  assert.equal(missing.envelope, 'flexible');
  assert.equal(categories.classification({ expenseCategoryId: 'category-unknown' }, []).title, 'Категория из архива');
});

test('mandatory and goal links retain their accounting meaning despite category metadata', () => {
  const expense = { category: 'flexible', expenseCategoryId: 'category-food' };
  assert.equal(categories.classification({ ...expense, commitmentId: 'tutor' }, [category()]).envelope, 'essentials');
  assert.equal(categories.classification({ ...expense, goalId: 'trip' }, [category()]).envelope, 'goals');
  assert.equal(categories.classification({ category: 'goal' }, []).envelope, 'goals');
  assert.equal(categories.classification({ category: 'food' }, []).envelope, 'essentials');
  assert.equal(categories.classification(null, []).envelope, 'flexible');
  assert.equal(categories.classification({ expenseCategoryId: '__proto__' }, []).custom, false);
});
