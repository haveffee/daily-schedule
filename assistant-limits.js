(function (root, factory) {
  'use strict';
  var api = factory(typeof module === 'object' && module.exports ? require('./assistant-categories.js') : root && root.HVFCategories);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HVFLimits = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (categories) {
  'use strict';

  var CATEGORIES = ['essentials', 'reserve', 'goals', 'flexible'];
  var CURRENCIES = ['BYN', 'USD', 'RUB'];
  var MAX_AMOUNT = 1000000000;
  var MAX_CENTS = Number.MAX_SAFE_INTEGER;

  // Amounts use the same decimal range as the expense editor. Convert before
  // adding or comparing so 0.1 + 0.2 reaches a 0.30 limit exactly.
  function cents(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return 0;
    var text = String(value).trim().replace(/\s/g, '').replace(',', '.');
    if (!text || text.length > 128) return 0;
    var match = /^\+?(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
    var numeric = Number(text);
    if (!match || !Number.isFinite(numeric) || numeric > MAX_AMOUNT) return 0;
    var digits = match[1] + (match[2] || '');
    if (!/[1-9]/.test(digits)) return 0;
    var exponent = Number(match[3] || 0);
    if (exponent < -130 || exponent > 130) return 0;
    var position = match[1].length + exponent + 2;
    if (position < 0) return 0;
    var integer = position ? digits.slice(0, position).padEnd(position, '0') : '0';
    return Number(BigInt(integer) + ((digits.charAt(position) || '0') >= '5' ? 1n : 0n));
  }

  function currency(value) {
    // Legacy records belong to the original RUB ledger, never to whichever
    // currency the user currently views.
    if (value === undefined || value === null || value === '') return 'RUB';
    var code = String(value).trim().toUpperCase();
    return CURRENCIES.indexOf(code) >= 0 ? code : '';
  }

  function validMonth(value) {
    return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  }

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var date = new Date(0);
    var year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(0, 0, 0, 0);
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }

  function category(record) {
    if (record.commitmentId) return 'essentials';
    if (record.goalId) return 'goals';
    var value = String(record.category || '').trim().toLowerCase();
    if (['essential', 'essentials', 'needs', 'food', 'housing', 'bills', 'transport', 'health', 'обязательные', 'еда', 'жилье', 'транспорт', 'здоровье'].indexOf(value) >= 0) return 'essentials';
    if (value === 'reserve' || value === 'резерв') return 'reserve';
    if (['goal', 'goals', 'цель', 'цели'].indexOf(value) >= 0) return 'goals';
    return 'flexible';
  }

  function warningPercent(value) {
    var number = Number(value);
    return Number.isInteger(number) && number >= 50 && number <= 100 ? number : 80;
  }

  /**
   * A limit is a spending warning, not an allocation or a protected balance.
   * Keep the original four envelope limits and offer custom category limits.
   * Envelope totals include their custom expenses; a custom total includes only
   * expenses explicitly linked to that category, without double counting within
   * either limit. Archived categories remain visible while their history matters.
   * Only actual dated expenses count; salary, reserved money and savings do not.
   */
  function summarize(records, options) {
    options = options || {};
    var month = options.month;
    var code = currency(options.currency);
    if (!validMonth(month)) throw new Error('Укажи месяц лимитов в формате ГГГГ-ММ.');
    if (!code) throw new Error('Выбери валюту лимитов: BYN, USD или RUB.');
    var source = (Array.isArray(records) ? records : []).filter(function (record) {
      return record && typeof record === 'object' && !record.deleted;
    });
    var categoryRecords = categories ? categories.list(source, { includeArchived: true }) : [];
    var metadata = Object.create(null);
    categoryRecords.forEach(function (record) { metadata[record.id] = record; });
    var totals = { essentials: 0, reserve: 0, goals: 0, flexible: 0 };
    var customTotals = Object.create(null);
    var snapshots = Object.create(null);
    function validCustomId(value) {
      return categories ? categories.validId(value) : typeof value === 'string' && /^category-[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(value);
    }
    function remember(record) {
      var key = record.expenseCategoryId;
      if (!validCustomId(key)) return;
      var previous = snapshots[key];
      if (!previous || (Number(record.updatedAt) || Number(record.createdAt) || 0) >= (Number(previous.updatedAt) || Number(previous.createdAt) || 0)) snapshots[key] = record;
    }
    source.forEach(function (record) {
      if (record.kind !== 'expense' || currency(record.currency) !== code || !validDate(record.date) || record.date.slice(0, 7) !== month) return;
      // A contradictory month indicates a damaged/imported record. Missing
      // month remains compatible with a legacy expense that has a valid date.
      if (record.month !== undefined && record.month !== null && record.month !== '' && record.month !== month) return;
      var amount = cents(record.amount);
      var key = categories ? categories.classification(record, categoryRecords).envelope : category(record);
      totals[key] = Math.min(MAX_CENTS, totals[key] + amount);
      if (validCustomId(record.expenseCategoryId) && amount > 0) {
        customTotals[record.expenseCategoryId] = Math.min(MAX_CENTS, (customTotals[record.expenseCategoryId] || 0) + amount);
        remember(record);
      }
    });
    var keys = CATEGORIES.concat(categoryRecords.filter(function (record) { return !record.archived; }).map(function (record) { return record.id; }));
    Object.keys(customTotals).forEach(function (key) { if (keys.indexOf(key) < 0) keys.push(key); });
    source.forEach(function (record) {
      var key = record.category;
      if (record.kind === 'spending-limit' && validCustomId(key) && record.id === 'limit-' + month + '-' + code + '-' + key &&
        record.month === month && currency(record.currency) === code && cents(record.amount) > 0 && keys.indexOf(key) < 0) keys.push(key);
    });
    return keys.map(function (key) {
      var id = 'limit-' + month + '-' + code + '-' + key;
      var record = source.find(function (item) {
        return item.id === id && item.kind === 'spending-limit' && item.month === month && currency(item.currency) === code && item.category === key;
      });
      var amount = record ? cents(record.amount) : 0;
      var configured = amount > 0;
      var custom = CATEGORIES.indexOf(key) < 0;
      var info = metadata[key];
      var snapshot = snapshots[key];
      var spent = custom ? customTotals[key] || 0 : totals[key];
      var archived = custom && (!info || info.archived === true);
      var title = custom ? info ? info.title : snapshot && String(snapshot.expenseCategoryTitle || '').trim().slice(0, 48) ||
        record && String(record.categoryTitle || '').trim().slice(0, 48) || 'Категория из архива' :
        { essentials: 'Обязательные расходы', reserve: 'Резерв', goals: 'Цели', flexible: 'Свободные деньги' }[key];
      var threshold = warningPercent(record && record.warningPercent);
      var status = 'ok';
      if (configured) {
        if (spent >= amount) status = 'exceeded';
        else if (BigInt(spent) * 100n >= BigInt(amount) * BigInt(threshold)) status = 'near';
      }
      return {
        id: id, category: key, month: month, currency: code,
        title: title, envelope: custom ? info ? info.envelope : snapshot ? category(snapshot) : 'flexible' : key,
        custom: custom, archived: archived,
        configured: configured, amount: amount / 100, spent: spent / 100,
        remaining: configured ? (amount - spent) / 100 : null,
        percent: configured ? Number(BigInt(spent) * 10000n / BigInt(amount)) / 100 : 0,
        status: status, warningPercent: threshold
      };
    });
  }

  /**
   * Call after an expense changes, with the before/after summaries for that
   * ledger. Re-rendering, lowering a limit, and editing its warning threshold
   * produce no extra alert. Decreased spending can clear a warning naturally.
   */
  function crossing(previous, next) {
    var before = Array.isArray(previous) ? previous : [];
    var rank = { ok: 0, near: 1, exceeded: 2 };
    return (Array.isArray(next) ? next : []).filter(function (item) {
      if (!item || !item.configured || !item.id || !Object.prototype.hasOwnProperty.call(rank, item.status)) return false;
      var old = before.find(function (entry) { return entry && entry.id === item.id; });
      return old && old.configured && old.month === item.month && old.currency === item.currency && old.category === item.category &&
        cents(old.amount) === cents(item.amount) && old.warningPercent === item.warningPercent &&
        Number.isFinite(old.spent) && Number.isFinite(item.spent) && item.spent > old.spent &&
        Object.prototype.hasOwnProperty.call(rank, old.status) && rank[item.status] > rank[old.status];
    }).map(function (item) {
      var old = before.find(function (entry) { return entry && entry.id === item.id; });
      return Object.assign({}, item, { previousStatus: old.status });
    });
  }

  return Object.freeze({ summarize: summarize, crossing: crossing });
}));
