(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.HVFCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var MAX_CENTS = Number.MAX_SAFE_INTEGER;

  function finiteNumber(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  // Parse decimal rubles before doing arithmetic, including values such as 1.005.
  // Every subsequent budget calculation uses integer kopecks.
  function toCents(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return 0;
    var text = String(value).trim().replace(/\s/g, '').replace(',', '.');
    var match = /^\+?(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
    if (!match) return 0;
    if (!/[1-9]/.test(match[1] + (match[2] || ''))) return 0;
    var exponent = Number(match[3] || 0);
    if (exponent > 18) return MAX_CENTS;
    if (exponent < -30) return 0;
    var digits = match[1] + (match[2] || '');
    var decimalPosition = match[1].length + exponent;
    var centsPosition = decimalPosition + 2;
    var integerText;
    var roundDigit = '0';
    if (centsPosition <= 0) {
      integerText = '0';
      if (centsPosition === 0) roundDigit = digits.charAt(0) || '0';
    } else {
      integerText = digits.slice(0, centsPosition).padEnd(centsPosition, '0');
      roundDigit = digits.charAt(centsPosition) || '0';
    }
    integerText = integerText.replace(/^0+(?=\d)/, '');
    if (integerText.length > 16) return MAX_CENTS;
    var cents = BigInt(integerText || '0') + (roundDigit >= '5' ? 1n : 0n);
    return cents > BigInt(MAX_CENTS) ? MAX_CENTS : Number(cents);
  }

  function rubles(cents) {
    return cents / 100;
  }

  function sumCents(values) {
    return values.reduce(function (sum, value) {
      return Math.min(MAX_CENTS, sum + value);
    }, 0);
  }

  function percentageCents(cents, basisPoints) {
    return Number(BigInt(cents) * BigInt(basisPoints) / 10000n);
  }

  function estimateDuration(title) {
    var text = String(title || '').toLowerCase().replace(/ё/g, 'е');
    var estimates = [
      [/(?:^|[^а-яa-z])(?:сон|поспать|sleep)(?:$|[^а-яa-z])/, 480],
      [/(?:медитац|дыхательн|meditat)/, 10],
      [/(?:выпить вод|полить|витамин|water plants)/, 5],
      [/(?:звонок|позвонить|созвон|call)/, 30],
      [/(?:встреч|собеседован|meeting|interview)/, 60],
      [/(?:врач|доктор|стоматолог|doctor|dentist)/, 60],
      [/(?:трениров|спортзал|фитнес|workout|gym)/, 60],
      [/(?:пробеж|бегать|running|jog)/, 45],
      [/(?:прогул|гулять|walk)/, 30],
      [/(?:приготов|кулинар|cook)|(?:^|[^а-яa-z])готовить/, 45],
      [/(?:завтрак|обед|ужин|breakfast|lunch|dinner)/, 30],
      [/(?:уборк|убрать|прибраться|clean)/, 45],
      [/(?:магазин|покупк|shopping|grocer)/, 60],
      [/(?:английск|изуч|учеб|урок|курс|обуч|study|learn|lesson)/, 60],
      [/(?:читать|чтение|книг|reading|read a)/, 30],
      [/(?:проект|программ|код|дизайн|project|coding|design)/, 90],
      [/(?:подготов|презентац|presentation|prepar)/, 60],
      [/(?:работ|work)/, 60],
      [/(?:финанс|бюджет|счет|документ|почт|budget|email|document)/, 30]
    ];
    for (var i = 0; i < estimates.length; i += 1) {
      if (estimates[i][0].test(text)) return estimates[i][1];
    }
    return 30;
  }

  function minutes(value) {
    if (typeof value === 'number') {
      return Number.isInteger(value) && value >= 0 && value <= 1440 ? value : null;
    }
    var match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
    if (!match) return null;
    var hours = Number(match[1]);
    var minute = Number(match[2]);
    if (hours > 24 || minute > 59 || (hours === 24 && minute !== 0)) return null;
    return hours * 60 + minute;
  }

  function normalizedTask(task) {
    var result = Object.assign({}, task);
    var specified = task.duration !== '' && task.duration !== null && task.duration !== undefined;
    var duration = specified ? finiteNumber(task.duration, estimateDuration(task.title)) : estimateDuration(task.title);
    result.duration = clamp(Math.round(duration), 5, 480);
    return result;
  }

  /**
   * Fixed appointments are placed first and are never moved. The first appointment
   * wins a collision; later ones stay in waiting and receive an explicit conflict.
   * Floating tasks fill the earliest gaps in input order. Completed tasks retain
   * their slot so ticking a checkbox does not unexpectedly move the whole day.
   */
  function schedule(tasks, options) {
    options = options || {};
    var start = minutes(options.start === undefined ? '09:00' : options.start);
    var end = minutes(options.end === undefined ? '22:00' : options.end);
    var pause = clamp(Math.round(finiteNumber(options.breakMinutes === undefined ? 5 : options.breakMinutes, 5)), 0, 60);
    var entries = (Array.isArray(tasks) ? tasks : []).filter(function (task) {
      return task && typeof task === 'object';
    }).map(function (task, index) {
      return { task: normalizedTask(task), index: index };
    });
    var placed = [];
    var waiting = [];
    var conflicts = [];

    function reject(entry, reason, collision) {
      waiting.push(entry);
      var conflict = { task: entry.task, reason: reason };
      if (collision) conflict.withTaskId = collision.task.id;
      conflicts.push(conflict);
    }

    if (start === null || end === null || end <= start) {
      entries.forEach(function (entry) { reject(entry, 'invalid-window'); });
      return { placed: [], waiting: waiting.map(function (entry) { return entry.task; }), conflicts: conflicts };
    }

    var floating = [];
    entries.forEach(function (entry) {
      var time = entry.task.time;
      if (time === undefined || time === null || time === '') {
        floating.push(entry);
        return;
      }
      var requested = minutes(time);
      if (requested === null) {
        reject(entry, 'invalid-time');
        return;
      }
      var finish = requested + entry.task.duration;
      if (requested < start || finish > end) {
        reject(entry, 'outside-day');
        return;
      }
      var collision = placed.find(function (other) {
        return requested < other.end && finish > other.start;
      });
      if (collision) {
        reject(entry, 'overlap', collision);
        return;
      }
      placed.push({ task: entry.task, index: entry.index, start: requested, end: finish });
    });

    floating.forEach(function (entry) {
      placed.sort(function (a, b) { return a.start - b.start || a.index - b.index; });
      var cursor = start;
      var found = false;
      for (var i = 0; i < placed.length; i += 1) {
        if (cursor + entry.task.duration <= placed[i].start - pause) {
          found = true;
          break;
        }
        cursor = Math.max(cursor, placed[i].end + pause);
      }
      if (!found && cursor + entry.task.duration <= end) found = true;
      if (!found) {
        waiting.push(entry);
        return;
      }
      placed.push({ task: entry.task, index: entry.index, start: cursor, end: cursor + entry.task.duration });
    });

    placed.sort(function (a, b) { return a.start - b.start || a.index - b.index; });
    waiting.sort(function (a, b) { return a.index - b.index; });
    return {
      placed: placed.map(function (entry) {
        return Object.assign({}, entry.task, { start: entry.start, end: entry.end });
      }),
      waiting: waiting.map(function (entry) { return entry.task; }),
      conflicts: conflicts
    };
  }

  function expenseCategory(category) {
    var value = String(category || '').toLowerCase().trim();
    if (['essential', 'essentials', 'needs', 'food', 'housing', 'bills', 'transport', 'health', 'обязательные', 'еда', 'жилье', 'транспорт', 'здоровье'].indexOf(value) >= 0) return 'essentials';
    if (value === 'reserve' || value === 'резерв') return 'reserve';
    if (value === 'goal' || value === 'goals' || value === 'цель' || value === 'цели') return 'goals';
    return 'flexible';
  }

  /**
   * Creates a salary plan, not a bank transfer. Goals receive at most their unmet
   * target; any unused goal budget becomes flexible money. Expenses consume their
   * chosen envelope without silently moving money between envelopes. Negative
   * balances expose overruns while available/deficit show the real cash position.
   */
  function allocateBudget(input) {
    input = input || {};
    var income = toCents(input.income);
    var essentialBasis = clamp(toCents(input.essentialPercent === undefined ? 50 : input.essentialPercent), 0, 10000);
    var reserveBasis = clamp(toCents(input.reservePercent === undefined ? 20 : input.reservePercent), 0, 10000 - essentialBasis);
    var goalBasis = input.goalsPercent === undefined
      ? 10000 - essentialBasis - reserveBasis
      : clamp(toCents(input.goalsPercent), 0, 10000 - essentialBasis - reserveBasis);
    var essentialPlan = percentageCents(income, essentialBasis);
    var reservePlan = percentageCents(income, reserveBasis);
    var goalPool = input.goalsPercent === undefined
      ? income - essentialPlan - reservePlan
      : percentageCents(income, goalBasis);
    var goals = (Array.isArray(input.goals) ? input.goals : []).filter(function (goal) {
      return goal && typeof goal === 'object';
    }).map(function (goal, index) {
      var target = toCents(goal.target);
      var saved = toCents(goal.saved);
      return {
        source: goal,
        index: index,
        target: target,
        saved: saved,
        remaining: Math.max(0, target - saved),
        allocation: 0,
        spent: 0,
        priority: finiteNumber(goal.priority, 0)
      };
    });
    var poolLeft = goalPool;
    goals.slice().sort(function (a, b) {
      return b.priority - a.priority || a.index - b.index;
    }).forEach(function (goal) {
      goal.allocation = Math.min(goal.remaining, poolLeft);
      poolLeft -= goal.allocation;
    });
    var goalPlan = goalPool - poolLeft;
    var planned = {
      essentials: essentialPlan,
      reserve: reservePlan,
      goals: goalPlan,
      flexible: income - essentialPlan - reservePlan - goalPlan
    };
    var spending = { essentials: 0, reserve: 0, goals: 0, flexible: 0 };
    (Array.isArray(input.expenses) ? input.expenses : []).forEach(function (expense) {
      if (!expense || typeof expense !== 'object') return;
      var amount = toCents(expense.amount);
      var category = expenseCategory(expense.category);
      spending[category] = Math.min(MAX_CENTS, spending[category] + amount);
      if (category === 'goals' && expense.goalId !== undefined && expense.goalId !== null) {
        var goal = goals.find(function (item) { return String(item.source.id) === String(expense.goalId); });
        if (goal) goal.spent = Math.min(MAX_CENTS, goal.spent + amount);
      }
    });
    var totalSpent = sumCents(Object.keys(spending).map(function (key) { return spending[key]; }));
    var envelopes = {};
    var allocations = {};
    Object.keys(planned).forEach(function (key) {
      envelopes[key] = {
        planned: rubles(planned[key]),
        spent: rubles(spending[key]),
        remaining: rubles(planned[key] - spending[key])
      };
      allocations[key] = rubles(planned[key]);
    });
    return {
      income: rubles(income),
      spent: rubles(totalSpent),
      available: rubles(Math.max(0, income - totalSpent)),
      deficit: rubles(Math.max(0, totalSpent - income)),
      totalAllocated: rubles(income),
      unallocated: 0,
      essentialsPercent: essentialBasis / 100,
      reservePercent: reserveBasis / 100,
      goalsPercent: goalBasis / 100,
      envelopes: envelopes,
      allocations: allocations,
      goalAllocations: goals.map(function (goal) {
        return Object.assign({}, goal.source, {
          target: rubles(goal.target),
          saved: rubles(goal.saved),
          remaining: rubles(goal.remaining),
          allocation: rubles(goal.allocation),
          spent: rubles(goal.spent),
          budgetRemaining: rubles(goal.allocation - goal.spent),
          afterAllocation: rubles(Math.max(0, goal.remaining - goal.allocation))
        });
      })
    };
  }

  return Object.freeze({ schedule: schedule, estimateDuration: estimateDuration, allocateBudget: allocateBudget });
}));
