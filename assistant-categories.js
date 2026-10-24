(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HVFCategories = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MONTH = '2000-03';
  var ENVELOPES = ['essentials', 'reserve', 'goals', 'flexible'];
  var TITLES = { essentials: 'Обязательные расходы', reserve: 'Резерв', goals: 'Цели', flexible: 'Свободные деньги' };

  function source(records) {
    return (Array.isArray(records) ? records : []).filter(function (record) {
      return record && typeof record === 'object' && !record.deleted;
    });
  }

  function validId(value) {
    return typeof value === 'string' && /^category-[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(value);
  }

  function title(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  }

  function envelope(value) {
    var key = String(value || '').trim().toLowerCase();
    if (['essential', 'essentials', 'needs', 'food', 'housing', 'bills', 'transport', 'health', 'обязательные', 'еда', 'жилье', 'транспорт', 'здоровье'].indexOf(key) >= 0) return 'essentials';
    if (key === 'reserve' || key === 'резерв') return 'reserve';
    if (['goal', 'goals', 'цель', 'цели'].indexOf(key) >= 0) return 'goals';
    return 'flexible';
  }

  function normalize(record) {
    if (!record || record.kind !== 'expense-category' || record.month !== MONTH || !validId(record.id) || record.deleted) return null;
    var name = title(record.title);
    if (!name || name.length > 48 || ENVELOPES.indexOf(record.envelope) < 0 ||
      (record.archived !== undefined && typeof record.archived !== 'boolean')) return null;
    return Object.assign({}, record, { title: name, archived: record.archived === true });
  }

  /** Categories live independently of monthly ledgers. Never alter saved entries. */
  function list(records, options) {
    var includeArchived = !!(options && options.includeArchived);
    return source(records).map(normalize).filter(function (record) {
      return record && (includeArchived || !record.archived);
    }).sort(function (a, b) {
      return Number(a.archived) - Number(b.archived) || a.title.localeCompare(b.title, 'ru') || a.id.localeCompare(b.id);
    });
  }

  function validateCategory(record, records) {
    if (!record || record.kind !== 'expense-category' || record.month !== MONTH || !validId(record.id)) throw new Error('Не удалось определить категорию. Создай её ещё раз.');
    var name = title(record.title);
    if (!name || name.length > 48) throw new Error('Название категории должно содержать от 1 до 48 символов.');
    if (ENVELOPES.indexOf(record.envelope) < 0) throw new Error('Выбери часть бюджета для категории.');
    if (record.archived !== undefined && typeof record.archived !== 'boolean') throw new Error('Не удалось определить состояние категории.');
    if (record.deleted) throw new Error('Удалённую категорию нельзя сохранить.');
    var result = Object.assign({}, record, { title: name, archived: record.archived === true });
    if (!result.archived && list(records).some(function (entry) {
      return entry.id !== result.id && entry.title.toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru');
    })) throw new Error('Активная категория с таким названием уже существует.');
    return result;
  }

  /**
   * New expenses persist their envelope and category title as snapshots. Renaming
   * a category updates its label; moving it between envelopes affects future
   * expenses only. An archived or missing category never hides historical money.
   */
  function classification(expense, records) {
    expense = expense && typeof expense === 'object' ? expense : {};
    var id = validId(expense.expenseCategoryId) ? expense.expenseCategoryId : '';
    var category = id ? list(records, { includeArchived: true }).find(function (entry) { return entry.id === id; }) : null;
    var group = expense.commitmentId ? 'essentials' : expense.goalId ? 'goals' :
      expense.category !== undefined && expense.category !== null && expense.category !== '' ? envelope(expense.category) :
        category ? category.envelope : 'flexible';
    return {
      id: id || group,
      title: id ? category ? category.title : title(expense.expenseCategoryTitle).slice(0, 48) || 'Категория из архива' : TITLES[group],
      envelope: group,
      custom: !!id,
      archived: !!id && (!category || category.archived),
      missing: !!id && !category
    };
  }

  return Object.freeze({ list: list, validateCategory: validateCategory, classification: classification, validId: validId });
}));
