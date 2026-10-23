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

  // Parse decimal currency before doing arithmetic, including values such as 1.005.
  // All supported currencies have two decimal places; calculations use cents.
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

  function currencyCode(value) {
    var code = String(value || 'RUB').toUpperCase().trim();
    return ['RUB', 'BYN', 'USD'].indexOf(code) >= 0 ? code : 'RUB';
  }

  function budgetEntries(entries, currency) {
    return (Array.isArray(entries) ? entries : []).filter(function (entry) {
      if (!entry || typeof entry !== 'object') return false;
      // Missing currency belongs to the original RUB ledger. It is never
      // relabelled when a user switches their selected currency.
      if (currency === null) return true;
      var code = String(entry.currency || 'RUB').toUpperCase().trim();
      return code === currency;
    });
  }

  /**
   * Creates a plan, not a bank transfer. With commitments, fixed obligations are
   * funded first, reservePercent applies to the remainder, and goalsPercent
   * (default 20) applies after the reserve. Without commitments the original
   * percentage-based API is preserved. Currencies are separate ledgers; no
   * conversion or exchange rate is implied. Goals receive at most their unmet
   * target. Negative envelope balances expose overruns; freeToSpend protects
   * funded but unpaid obligations and savings, even when another item overruns.
   */
  function allocateBudget(input) {
    input = input || {};
    var currency = input.currency === undefined ? null : currencyCode(input.currency);
    var salaryIncome = toCents(input.income);
    var additionalIncome = sumCents(budgetEntries(input.incomes, currency).map(function (item) { return toCents(item.amount); }));
    var income = sumCents([salaryIncome, additionalIncome]);
    var fixedMode = Object.prototype.hasOwnProperty.call(input, 'commitments');
    var commitments = budgetEntries(input.commitments, currency).map(function (commitment) {
      return { source: commitment, requested: toCents(commitment.amount), planned: 0, spent: 0 };
    });
    var mandatoryRequested = sumCents(commitments.map(function (item) { return item.requested; }));
    var essentialBasis = fixedMode ? 0 : clamp(toCents(input.essentialPercent === undefined ? 50 : input.essentialPercent), 0, 10000);
    var reserveBasis = clamp(toCents(input.reservePercent === undefined ? 20 : input.reservePercent), 0, fixedMode ? 10000 : 10000 - essentialBasis);
    var goalBasis = fixedMode
      ? clamp(toCents(input.goalsPercent === undefined ? 20 : input.goalsPercent), 0, 10000)
      : input.goalsPercent === undefined
        ? 10000 - essentialBasis - reserveBasis
        : clamp(toCents(input.goalsPercent), 0, 10000 - essentialBasis - reserveBasis);
    var essentialPlan = fixedMode ? Math.min(income, mandatoryRequested) : percentageCents(income, essentialBasis);
    var obligationPool = essentialPlan;
    commitments.forEach(function (item) {
      item.planned = Math.min(item.requested, obligationPool);
      obligationPool -= item.planned;
    });
    var reservePlan = percentageCents(fixedMode ? income - essentialPlan : income, reserveBasis);
    var goalPool = fixedMode
      ? percentageCents(income - essentialPlan - reservePlan, goalBasis)
      : input.goalsPercent === undefined
        ? income - essentialPlan - reservePlan
        : percentageCents(income, goalBasis);
    var goals = budgetEntries(input.goals, currency).map(function (goal, index) {
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
    budgetEntries(input.expenses, currency).forEach(function (expense) {
      var amount = toCents(expense.amount);
      var category = expenseCategory(expense.category);
      spending[category] = Math.min(MAX_CENTS, spending[category] + amount);
      if (category === 'essentials') {
        var commitment = expense.commitmentId === undefined || expense.commitmentId === null ? null
          : commitments.find(function (item) { return String(item.source.id) === String(expense.commitmentId); });
        if (commitment) commitment.spent = sumCents([commitment.spent, amount]);
      }
      if (category === 'goals') {
        var goal = expense.goalId === undefined || expense.goalId === null ? null
          : goals.find(function (item) { return String(item.source.id) === String(expense.goalId); });
        if (goal) goal.spent = sumCents([goal.spent, amount]);
      }
    });
    // Only a payment explicitly linked to a protected item consumes its funds.
    // Unlinked spending and overruns cannot erase another item's protection.
    var totalSpent = sumCents(Object.keys(spending).map(function (key) { return spending[key]; }));
    var mandatoryRemaining = fixedMode
      ? sumCents(commitments.map(function (item) { return Math.max(0, item.planned - item.spent); }))
      : Math.max(0, essentialPlan - spending.essentials);
    var goalProtected = fixedMode
      ? sumCents(goals.map(function (goal) { return Math.max(0, goal.allocation - goal.spent); }))
      : Math.max(0, goalPlan - spending.goals);
    var protectedRemaining = sumCents([mandatoryRemaining, Math.max(0, reservePlan - spending.reserve), goalProtected]);
    var available = Math.max(0, income - totalSpent);
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
      currency: currency,
      salaryIncome: rubles(salaryIncome),
      additionalIncome: rubles(additionalIncome),
      income: rubles(income),
      spent: rubles(totalSpent),
      available: rubles(available),
      deficit: rubles(Math.max(0, totalSpent - income)),
      mandatoryRequested: rubles(mandatoryRequested),
      mandatoryFunded: rubles(fixedMode ? essentialPlan : 0),
      mandatoryShortfall: rubles(fixedMode ? Math.max(0, mandatoryRequested - essentialPlan) : 0),
      mandatoryRemaining: rubles(mandatoryRemaining),
      protectedRemaining: rubles(protectedRemaining),
      protectionShortfall: rubles(Math.max(0, protectedRemaining - available)),
      freeToSpend: rubles(Math.max(0, available - protectedRemaining)),
      totalAllocated: rubles(income),
      unallocated: 0,
      essentialsPercent: fixedMode ? (income > 0 ? Math.round(essentialPlan / income * 10000) / 100 : 0) : essentialBasis / 100,
      reservePercent: reserveBasis / 100,
      goalsPercent: goalBasis / 100,
      envelopes: envelopes,
      allocations: allocations,
      commitmentAllocations: commitments.map(function (item) {
        return Object.assign({}, item.source, {
          amount: rubles(item.requested),
          requested: rubles(item.requested),
          planned: rubles(item.planned),
          spent: rubles(item.spent),
          remaining: rubles(item.planned - item.spent),
          shortfall: rubles(item.requested - item.planned)
        });
      }),
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
