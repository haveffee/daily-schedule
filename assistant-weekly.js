(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HVFWeekly = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DAY = 86400000;
  var CURRENCIES = ['BYN', 'USD', 'RUB'];
  var MAX_AMOUNT = 1000000000;
  var MAX_CENTS = Number.MAX_SAFE_INTEGER;

  // Calendar dates are civil values. UTC is only used for arithmetic, never to
  // turn a user's selected date into a different day in the host's timezone.
  function civil(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    var year = Number(value.slice(0, 4));
    var month = Number(value.slice(5, 7));
    var day = Number(value.slice(8, 10));
    var date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(0, 0, 0, 0);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date.getTime() / DAY;
  }

  function dateText(day) { return new Date(day * DAY).toISOString().slice(0, 10); }

  function recordedDate(preferred, timestamp) {
    if (civil(preferred) !== null) return preferred;
    if (typeof timestamp === 'string') {
      var prefix = timestamp.slice(0, 10);
      if (civil(prefix) !== null && (timestamp.length === 10 || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(timestamp))) return prefix;
    }
    if (typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0) {
      var date = new Date(timestamp);
      if (Number.isFinite(date.getTime())) return date.toISOString().slice(0, 10);
    }
    return '';
  }

  // Match the editor's supported amount range and perform all sums in cents.
  // Parse the decimal before rounding so values such as 1.005 remain exact.
  function cents(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return 0;
    var text = String(value).trim().replace(/\s/g, '').replace(',', '.');
    if (!text || text.length > 128) return 0;
    var match = /^\+?(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
    if (!match || !Number.isFinite(Number(text)) || Number(text) > MAX_AMOUNT) return 0;
    var digits = match[1] + (match[2] || '');
    if (!/[1-9]/.test(digits)) return 0;
    var exponent = Number(match[3] || 0);
    if (exponent < -130 || exponent > 130) return 0;
    var position = match[1].length + exponent + 2;
    if (position < 0) return 0;
    var integer = position ? digits.slice(0, position).padEnd(position, '0') : '0';
    var next = digits.charAt(position) || '0';
    return Number(BigInt(integer) + (next >= '5' ? 1n : 0n));
  }

  function add(a, b) { return Math.min(MAX_CENTS, a + b); }
  function percentage(done, total) { return total ? Math.min(100, Math.round(done / total * 100)) : 0; }
  function currency(value) {
    if (value === undefined || value === null || value === '') return 'RUB';
    var code = String(value).trim().toUpperCase();
    return CURRENCIES.indexOf(code) >= 0 ? code : '';
  }
  function category(record) {
    if (record.commitmentId) return 'essentials';
    var value = String(record.category || '').trim().toLowerCase();
    if (['essential', 'essentials', 'needs', 'food', 'housing', 'bills', 'transport', 'health', 'обязательные', 'еда', 'жилье', 'транспорт', 'здоровье'].indexOf(value) >= 0) return 'essentials';
    if (value === 'reserve' || value === 'резерв') return 'reserve';
    if (['goal', 'goals', 'цель', 'цели'].indexOf(value) >= 0) return 'goals';
    return 'flexible';
  }
  function duration(task) {
    var value = Number(task.duration);
    return Number.isFinite(value) && value > 0 ? Math.min(480, Math.max(5, Math.round(value))) : 0;
  }

  function summarize(records, options) {
    options = options || {};
    var anchor = civil(options.anchorDate);
    if (anchor === null) throw new Error('Укажи дату отчёта в формате ГГГГ-ММ-ДД.');
    var weekday = new Date(anchor * DAY).getUTCDay();
    var start = anchor - (weekday + 6) % 7;
    var end = start + 6;
    var startDate = dateText(start);
    var endDate = dateText(end);
    var source = (Array.isArray(records) ? records : []).filter(function (record) { return record && typeof record === 'object' && !record.deleted; });
    var savedTasks = source.filter(function (record) { return record.kind === 'task' && civil(record.date) !== null; });
    var supplied = Array.isArray(options.tasks);
    var tasks = (supplied ? options.tasks : savedTasks).filter(function (task) {
      var day = task && typeof task === 'object' && !task.deleted ? civil(task.date) : null;
      return day !== null && day >= start && day <= end;
    });
    // Supplied tasks replace this week's materialized tasks, while tasks in
    // other weeks still prevent an unfinished multi-week goal looking complete.
    var allTasks = supplied ? savedTasks.filter(function (task) {
      var day = civil(task.date); return day < start || day > end;
    }).concat(tasks) : savedTasks;
    function doneByEnd(task) {
      if (task.done !== true) return false;
      var completedDate = recordedDate(task.completedDate, task.completedAt);
      return !completedDate || civil(completedDate) <= end;
    }
    var completedTasks = tasks.filter(doneByEnd);
    var days = Array.from({ length: 7 }, function (_, index) {
      var date = dateText(start + index);
      var daily = tasks.filter(function (task) { return task.date === date; });
      return { date: date, total: daily.length, completed: daily.filter(doneByEnd).length };
    });
    var goalProgress = source.filter(function (record) {
      return record.kind === 'goal' && tasks.some(function (task) { return task.goalId === record.id; });
    }).map(function (goal) {
      var linked = allTasks.filter(function (task) { return task.goalId === goal.id; });
      var weekly = tasks.filter(function (task) { return task.goalId === goal.id; });
      var weekCompleted = weekly.filter(doneByEnd).length;
      var target = cents(goal.target);
      var saved = cents(goal.saved);
      var stepsDone = linked.filter(function (task) { return civil(task.date) <= end && doneByEnd(task); }).length;
      var progress = target > 0 ? percentage(saved, target) : percentage(stepsDone, linked.length);
      return {
        id: goal.id, title: String(goal.title || ''), weekTotal: weekly.length,
        weekCompleted: weekCompleted, weekPercent: percentage(weekCompleted, weekly.length),
        progressPercent: progress, achieved: (target > 0 && saved >= target) || (linked.length > 0 && stepsDone === linked.length),
        currency: currency(goal.currency) || 'RUB', target: target / 100, saved: saved / 100
      };
    });
    var postponed = tasks.filter(function (task) {
      var count = Number(task.moveCount);
      var movedDate = recordedDate(task.lastMovedDate, task.lastMovedAt);
      return Number.isSafeInteger(count) && count > 0 && (!movedDate || civil(movedDate) <= end);
    }).map(function (task) {
      var movedDate = recordedDate(task.lastMovedDate, task.lastMovedAt);
      return {
        id: task.id, title: String(task.title || ''), count: Number(task.moveCount), date: task.date,
        fromDate: civil(task.movedFromDate) !== null ? task.movedFromDate : '', lastMovedDate: movedDate,
        withinWeek: Boolean(movedDate && civil(movedDate) >= start && civil(movedDate) <= end), countScope: 'lifetime'
      };
    }).sort(function (a, b) { return b.count - a.count || a.date.localeCompare(b.date) || a.title.localeCompare(b.title); });
    var ledgers = {};
    CURRENCIES.forEach(function (code) {
      ledgers[code] = { currency: code, spent: 0, income: 0, expenseCount: 0, incomeCount: 0, categories: { essentials: 0, reserve: 0, goals: 0, flexible: 0 } };
    });
    source.forEach(function (record) {
      // A monthly salary has no payment date and cannot truthfully be assigned
      // to a calendar week. Include only explicitly dated income records.
      if (record.kind !== 'expense' && record.kind !== 'income') return;
      var date = civil(record.date);
      var code = currency(record.currency);
      var amount = cents(record.amount);
      if (date === null || date < start || date > end || !code || amount <= 0) return;
      var ledger = ledgers[code];
      if (record.kind === 'income') { ledger.income = add(ledger.income, amount); ledger.incomeCount += 1; }
      else {
        var key = category(record);
        ledger.spent = add(ledger.spent, amount); ledger.expenseCount += 1;
        ledger.categories[key] = add(ledger.categories[key], amount);
      }
    });
    var finances = CURRENCIES.map(function (code) {
      var ledger = ledgers[code];
      var categories = {};
      Object.keys(ledger.categories).forEach(function (key) { categories[key] = ledger.categories[key] / 100; });
      return { currency: code, spent: ledger.spent / 100, income: ledger.income / 100, net: (ledger.income - ledger.spent) / 100,
        expenseCount: ledger.expenseCount, incomeCount: ledger.incomeCount, categories: categories };
    });
    return {
      startDate: startDate, endDate: endDate, days: days, total: tasks.length, completed: completedTasks.length,
      completionPercent: percentage(completedTasks.length, tasks.length),
      completedMinutes: completedTasks.reduce(function (sum, task) { return add(sum, duration(task)); }, 0),
      highPriorityPending: tasks.filter(function (task) { return Number(task.priority) === 2 && !doneByEnd(task); }).map(function (task) {
        return { id: task.id, title: String(task.title || ''), date: task.date, priority: 2, duration: duration(task) };
      }),
      goalProgress: goalProgress, completedGoals: goalProgress.filter(function (goal) { return goal.achieved; }),
      postponed: postponed, finances: finances
    };
  }

  return Object.freeze({ summarize: summarize });
}));
