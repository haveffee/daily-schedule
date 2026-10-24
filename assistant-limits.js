(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HVFLimits = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
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
   * Return every category so an empty ledger still has four editable limits.
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
    var totals = { essentials: 0, reserve: 0, goals: 0, flexible: 0 };
    source.forEach(function (record) {
      if (record.kind !== 'expense' || currency(record.currency) !== code || !validDate(record.date) || record.date.slice(0, 7) !== month) return;
      // A contradictory month indicates a damaged/imported record. Missing
      // month remains compatible with a legacy expense that has a valid date.
      if (record.month !== undefined && record.month !== null && record.month !== '' && record.month !== month) return;
      var key = category(record);
      totals[key] = Math.min(MAX_CENTS, totals[key] + cents(record.amount));
    });
    return CATEGORIES.map(function (key) {
      var id = 'limit-' + month + '-' + code + '-' + key;
      var record = source.find(function (item) {
        return item.id === id && item.kind === 'spending-limit' && item.month === month && currency(item.currency) === code && item.category === key;
      });
      var amount = record ? cents(record.amount) : 0;
      var configured = amount > 0;
      var spent = totals[key];
      var threshold = warningPercent(record && record.warningPercent);
      var status = 'ok';
      if (configured) {
        if (spent >= amount) status = 'exceeded';
        else if (BigInt(spent) * 100n >= BigInt(amount) * BigInt(threshold)) status = 'near';
      }
      return {
        id: id, category: key, month: month, currency: code,
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
