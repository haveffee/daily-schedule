(function (root, factory) {
  'use strict';
  var core = typeof module === 'object' && module.exports ? require('./assistant-core.js') : root.HVFCore;
  var api = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HVFForecast = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';

  var DAY = 86400000;
  var CURRENCIES = ['BYN', 'USD', 'RUB'];
  var MAX_CENTS = Number.MAX_SAFE_INTEGER;

  // Civil dates do not change when the app is opened in another timezone.
  function civil(value) {
    if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) return null;
    var year = Number(value.slice(0, 4));
    if (year < 1) return null;
    var date = new Date(0);
    date.setUTCFullYear(year, Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
    date.setUTCHours(0, 0, 0, 0);
    return date.toISOString().slice(0, 10) === value ? date.getTime() / DAY : null;
  }

  function validDate(value) { return civil(value) !== null; }

  function currency(value) {
    if (value === undefined || value === null || value === '') return 'RUB';
    var code = String(value).trim().toUpperCase();
    return CURRENCIES.indexOf(code) >= 0 ? code : '';
  }

  // Parse decimal amounts before rounding; all three supported ledgers use cents.
  function cents(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return 0;
    var text = String(value).trim().replace(/\s/g, '').replace(',', '.');
    if (!text || text.length > 128) return 0;
    var match = /^\+?(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
    var numeric = Number(text);
    if (!match || !Number.isFinite(numeric) || numeric > MAX_CENTS / 100) return 0;
    var digits = match[1] + (match[2] || '');
    var exponent = Number(match[3] || 0);
    if (!/[1-9]/.test(digits) || exponent < -130 || exponent > 130) return 0;
    var position = match[1].length + exponent + 2;
    if (position < 0) return 0;
    var integer = position ? digits.slice(0, position).padEnd(position, '0') : '0';
    var amount = BigInt(integer) + ((digits.charAt(position) || '0') >= '5' ? 1n : 0n);
    return Number(amount > BigInt(MAX_CENTS) ? BigInt(MAX_CENTS) : amount);
  }

  function sum(values) {
    return values.reduce(function (total, value) { return Math.min(MAX_CENTS, total + value); }, 0);
  }

  function validMonth(value) { return typeof value === 'string' && validDate(value + '-01'); }

  function monthOf(record) {
    if (validMonth(record.month)) return record.month;
    return validDate(record.date) ? record.date.slice(0, 7) : '';
  }

  function matchesMonth(record, month) {
    if (monthOf(record) !== month) return false;
    return !record.date || (validDate(record.date) && record.date.slice(0, 7) === month);
  }

  function dueDate(record) {
    var day = Number(record.dueDay);
    if (!validMonth(record.month) || !Number.isInteger(day) || day < 1 || day > 31) return '';
    var first = new Date(civil(record.month + '-01') * DAY);
    first.setUTCMonth(first.getUTCMonth() + 1);
    first.setUTCDate(0);
    return record.month + '-' + String(Math.min(day, first.getUTCDate())).padStart(2, '0');
  }

  function buildBudget(source, today, code, through) {
    var month = today.slice(0, 7);
    var current = source.filter(function (record) { return matchesMonth(record, month); });
    var configs = current.filter(function (record) { return record.kind === 'budget'; });
    var config = configs.find(function (record) { return record.id === 'budget-' + month + '-' + code; }) || configs[0] || {};
    var actual = function (record) { return !record.date || record.date <= today; };
    var expenses = current.filter(function (record) {
      return record.kind === 'expense' && (actual(record) || (through && record.date < through));
    });
    return core.allocateBudget({
      currency: code,
      income: actual(config) ? config.income : 0,
      reservePercent: config.reservePercent === undefined ? 20 : config.reservePercent,
      goalsPercent: config.goalsPercent === undefined ? 20 : config.goalsPercent,
      incomes: current.filter(function (record) { return record.kind === 'income' && actual(record); }),
      commitments: current.filter(function (record) { return record.kind === 'commitment'; }),
      goals: current.filter(function (record) { return record.kind === 'goal'; }),
      expenses: expenses
    });
  }

  function budgetShortfall(budget) {
    // A payment beyond an item's funded portion also reduces its unfunded
    // remainder. Counting mandatoryShortfall verbatim would count that debt twice.
    var unfunded = sum((Array.isArray(budget.commitmentAllocations) ? budget.commitmentAllocations : []).map(function (item) {
      var unpaid = Math.max(0, cents(item.requested === undefined ? item.amount : item.requested) - cents(item.spent));
      var protectedUnpaid = Math.max(0, cents(item.planned) - cents(item.spent));
      return Math.max(0, unpaid - protectedUnpaid);
    }));
    return sum([unfunded, cents(budget.protectionShortfall), cents(budget.deficit)]);
  }

  /**
   * This is a conservative plan from today's recorded monthly ledger, not a
   * bank balance or automatic transfer. Future income is always informational.
   * Today's protected funds already cover this month's obligations and savings;
   * only additional dated outflows before payday reduce the free remainder.
   * An optional budget must describe the same current, actually received ledger.
   */
  function summarize(records, options) {
    options = options || {};
    var today = options.today;
    var code = currency(options.currency);
    if (!validDate(today)) throw new Error('Укажи сегодняшнюю дату в формате ГГГГ-ММ-ДД.');
    if (!code) throw new Error('Выбери валюту прогноза: BYN, USD или RUB.');
    var source = (Array.isArray(records) ? records : []).filter(function (record) {
      return record && typeof record === 'object' && !record.deleted && currency(record.currency) === code;
    }).slice().sort(function (a, b) { return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0); });
    var plan = source.find(function (record) {
      return record.kind === 'income-plan' && record.month === '2000-04' && record.id === 'income-plan-' + code;
    }) || {};
    var requestedDate = Object.prototype.hasOwnProperty.call(options, 'nextDate') ? options.nextDate : plan.nextDate;
    var nextDate = validDate(requestedDate) ? requestedDate : '';
    var expected = cents(Object.prototype.hasOwnProperty.call(options, 'expectedAmount') ? options.expectedAmount : plan.expectedAmount);
    var days = nextDate ? civil(nextDate) - civil(today) : null;
    var active = days !== null && days > 0;
    var calculated = buildBudget(source, today, code, '');
    var current = options.budget && typeof options.budget === 'object' && currency(options.budget.currency) === code ? options.budget : calculated;
    var prospective = active ? buildBudget(source, today, code, nextDate) : calculated;
    var planned = active ? source.filter(function (record) {
      return record.kind === 'expense' && validDate(record.date) && record.date > today && record.date < nextDate && matchesMonth(record, record.date.slice(0, 7));
    }) : [];
    var futureExpenses = planned.filter(function (record) { return record.date.slice(0, 7) > today.slice(0, 7); });
    var futureObligations = active ? source.filter(function (record) {
      var due = dueDate(record);
      return record.kind === 'commitment' && record.month > today.slice(0, 7) && due && due > today && due < nextDate && cents(record.amount) > 0;
    }).map(function (record) {
      var paid = sum(futureExpenses.filter(function (expense) {
        return expense.commitmentId === record.id && monthOf(expense) === record.month;
      }).map(function (expense) { return cents(expense.amount); }));
      return { id: record.id, title: String(record.title || ''), date: dueDate(record), amount: cents(record.amount) / 100, recordedPayments: paid / 100, remaining: Math.max(0, cents(record.amount) - paid) / 100 };
    }) : [];
    // A monthly amount without a due day cannot be placed on either side of
    // payday. Surface that uncertainty rather than inventing a payment date.
    var uncertainObligations = active ? source.filter(function (record) {
      return record.kind === 'commitment' && validMonth(record.month) && record.month > today.slice(0, 7) &&
        record.month + '-01' < nextDate && !dueDate(record) && cents(record.amount) > 0;
    }).map(function (record) {
      return { id: record.id, title: String(record.title || ''), month: record.month, amount: cents(record.amount) / 100 };
    }) : [];
    var currentPlannedImpact = Math.max(0, cents(calculated.freeToSpend) - cents(prospective.freeToSpend));
    var remaining = Math.max(0, cents(current.freeToSpend) - currentPlannedImpact);
    var additionalObligations = sum(futureObligations.map(function (record) { return cents(record.remaining); }));
    var additionalExpenses = sum(futureExpenses.map(function (record) { return cents(record.amount); }));
    var additional = sum([additionalObligations, additionalExpenses]);
    var spendable = Math.max(0, remaining - additional);
    var shortfall = sum([budgetShortfall(current), Math.max(0, budgetShortfall(prospective) - budgetShortfall(calculated)), Math.max(0, additional - remaining)]);
    var status = !nextDate ? 'unconfigured' : days < 0 ? 'overdue' : days === 0 ? 'due-today' : shortfall > 0 ? 'shortfall' : 'ready';
    return {
      currency: code, today: today, month: today.slice(0, 7), status: status,
      nextDate: nextDate, daysUntilIncome: days === null ? null : Math.max(0, days), daysLate: days === null ? 0 : Math.max(0, -days),
      planIssue: requestedDate && !nextDate ? 'invalid-date' : '', expectedAmount: expected ? expected / 100 : null,
      available: cents(current.available) / 100, protectedRemaining: cents(current.protectedRemaining) / 100,
      freeToSpend: cents(current.freeToSpend) / 100,
      plannedExpenses: sum(planned.map(function (record) { return cents(record.amount); })) / 100,
      currentMonthPlannedImpact: currentPlannedImpact / 100,
      additionalObligations: additionalObligations / 100, additionalPlannedExpenses: additionalExpenses / 100,
      spendable: spendable / 100, perDay: active ? Math.floor(spendable / days) / 100 : null,
      shortfall: shortfall / 100, futureObligations: futureObligations, uncertainObligations: uncertainObligations, budget: current
    };
  }

  return Object.freeze({ summarize: summarize, validDate: validDate });
}));
