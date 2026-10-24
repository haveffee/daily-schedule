const test = require('node:test');
const assert = require('node:assert/strict');
const categories = require('../assistant-categories.js');

const category = (changes = {}) => ({ id: 'category-food', kind: 'expense-category', month: '2000-03', title: 'Продукты', envelope: 'essentials', archived: false, ...changes });

test('categories are global, active by default, sorted and independently copied', () => {
  const records = [category(), category({ id: 'category-fun', title: 'Кино', envelope: 'flexible' }), category({ id: 'category-old', title: 'Старое', archived: true }),
    category({ id: 'category-deleted', deleted: true }), category({ id: 'category-wrong-month', month: '2026-10' }), null];
  const original = structuredClone(records);
  assert.deepEqual(categories.list(records, { includePresets: false }).map(row => row.title), ['Кино', 'Продукты']);
  assert.equal(categories.list(records, { includeArchived: true, includePresets: false }).length, 3);
  const first = categories.list(records)[0]; first.title = 'Другое';
  assert.deepEqual(records, original);
  assert.deepEqual(categories.list(null, { includePresets: false }), []);
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
    { kind: 'expense' }, { title: '' }, { title: ' '.repeat(100) }, { title: 'a'.repeat(49) }, { envelope: 'food' }, { archived: 'false' },
    { icon: null }, { icon: [] }, { icon: 'a'.repeat(65) }, { deleted: true }]) {
    const record = category(changes);
    assert.throws(() => categories.validateCategory(record, []), Error);
    assert.deepEqual(categories.list([record], { includeArchived: true, includePresets: false }), []);
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

test('empty accounts receive eight useful categories without creating or mutating records', () => {
  const records = [], result = categories.list(records);
  assert.deepEqual(result.map(row => row.title).sort(), ['Продукты', 'Кафе', 'Транспорт', 'Одежда', 'Развлечения', 'Здоровье', 'Дом', 'Подписки'].sort());
  assert.equal(new Set(result.map(row => row.id)).size, 8);
  assert.ok(result.every(row => row.id.startsWith('category-default-') && categories.validId(row.id)));
  assert.ok(result.every(row => row.month === '2000-03' && categories.ICONS.includes(categories.iconKey(row))));
  assert.ok(result.every(row => row.kind === 'expense-category' && row.archived === false));
  assert.deepEqual(records, []);
  result[0].title = 'Изменено локально';
  assert.equal(categories.list([]).some(row => row.title === 'Изменено локально'), false);
  assert.ok(Object.isFrozen(categories.PRESETS) && Object.isFrozen(categories.PRESETS[0]));
});

test('preset edits override the suggestion and archiving does not resurrect it', () => {
  const food = categories.findById('category-default-food', []);
  const edited = categories.validateCategory({ ...food, title: 'Покупки на неделю', icon: 'home' }, []);
  assert.equal(categories.list([edited]).length, 8);
  assert.equal(categories.list([edited]).filter(row => row.id === food.id).length, 1);
  assert.equal(categories.findById(food.id, [edited]).title, 'Покупки на неделю');
  const archived = { ...edited, archived: true };
  assert.equal(categories.list([archived]).some(row => row.id === food.id), false);
  assert.equal(categories.list([archived], { includeArchived: true }).find(row => row.id === food.id).archived, true);
  const expense = { expenseCategoryId: food.id, category: 'essentials', expenseCategoryTitle: 'Продукты' };
  assert.equal(categories.classification(expense, [archived]).title, 'Покупки на неделю');
  assert.equal(categories.classification(expense, [archived]).archived, true);
  assert.equal(categories.classification(expense, [archived]).envelope, 'essentials');
});

test('existing same-name categories take precedence without guessing aliases or losing explicit references', () => {
  const existing = category({ title: '  пРоДуКтЫ  ' });
  assert.equal(categories.list([existing]).filter(row => row.title.toLowerCase() === 'продукты').length, 1);
  assert.equal(categories.list([existing]).some(row => row.id === 'category-default-food'), false);
  assert.equal(categories.list([category({ title: 'Еда' })]).some(row => row.id === 'category-default-food'), true);
  assert.equal(categories.list([{ ...existing, archived: true }]).some(row => row.id === 'category-default-food'), false);
  assert.doesNotThrow(() => categories.validateCategory(category(), []));
  assert.throws(() => categories.validateCategory(category({ id: 'category-new' }), [existing]), /уже существует/);
  const historic = categories.classification({ expenseCategoryId: 'category-default-food', category: 'essentials' }, [existing]);
  assert.equal(historic.title, 'Продукты');
  assert.equal(historic.missing, false);
  assert.equal(categories.classification({ category: 'food' }, []).custom, false);
});

test('only safe icon keys reach the interface and old categories keep a neutral icon', () => {
  assert.equal(categories.iconKey(null), 'tag');
  assert.equal(categories.iconKey(category()), 'tag');
  assert.equal(categories.iconKey({ id: 'category-default-transport' }), 'transport');
  for (const icon of categories.ICONS) {
    assert.equal(categories.iconKey({ icon }), icon);
    assert.equal(categories.validateCategory(category({ icon }), []).icon, icon);
  }
  for (const icon of ['future-icon', '<svg onload=alert(1)>', '__proto__', 'constructor']) {
    assert.equal(categories.iconKey({ icon }), 'tag');
    assert.equal(categories.validateCategory(category({ icon }), []).icon, 'tag');
    assert.equal(categories.list([category({ icon })], { includePresets: false })[0].icon, 'tag');
  }
  assert.equal(categories.findById('category-missing', []), null);
  assert.equal(categories.findById('__proto__', []), null);
});
