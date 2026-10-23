const test = require('node:test');
const assert = require('node:assert/strict');
const { schedule, estimateDuration, allocateBudget } = require('../assistant-core.js');

test('empty schedule does not create built-in events', () => {
  assert.deepEqual(schedule([]), { placed: [], waiting: [], conflicts: [] });
});

test('fixed appointments reserve exact times before floating tasks', () => {
  const tasks = [
    { id: 'long', title: 'Проект', duration: 120 },
    { id: 'meeting', title: 'Встреча', time: '10:00', duration: 60 },
    { id: 'short', title: 'Почта', duration: 30 }
  ];
  const result = schedule(tasks, { start: '09:00', end: '14:00', breakMinutes: 5 });
  assert.deepEqual(result.placed.map(({ id, start, end }) => ({ id, start, end })), [
    { id: 'short', start: 540, end: 570 },
    { id: 'meeting', start: 600, end: 660 },
    { id: 'long', start: 665, end: 785 }
  ]);
  assert.deepEqual(tasks[0], { id: 'long', title: 'Проект', duration: 120 });
});

test('colliding fixed appointments remain visible as waiting and conflicts', () => {
  const result = schedule([
    { id: 'a', time: '10:00', duration: 60 },
    { id: 'b', time: '10:30', duration: 30 },
    { id: 'c', time: '11:00', duration: 30 },
    { id: 'd', time: '08:00', duration: 20 },
    { id: 'e', time: 'wrong', duration: 20 }
  ]);
  assert.deepEqual(result.placed.map(task => task.id), ['a', 'c']);
  assert.deepEqual(result.waiting.map(task => task.id), ['b', 'd', 'e']);
  assert.deepEqual(result.conflicts.map(item => item.reason), ['overlap', 'outside-day', 'invalid-time']);
  assert.equal(result.conflicts[0].withTaskId, 'a');
});

test('duration limits and end-of-day overflow preserve tasks', () => {
  const result = schedule([
    { id: 'minimum', duration: 0 },
    { id: 'large', duration: 999 },
    { id: 'last', duration: 5 }
  ], { start: '09:00', end: '09:10', breakMinutes: 5 });
  assert.equal(result.placed[0].duration, 5);
  assert.deepEqual(result.waiting.map(task => [task.id, task.duration]), [['large', 480], ['last', 5]]);
  assert.equal(result.conflicts.length, 0);
});

test('deleting a task recalculates floating tasks into earlier free time', () => {
  const tasks = [{ id: 'a', duration: 60 }, { id: 'b', duration: 30 }, { id: 'c', duration: 30 }];
  assert.equal(schedule(tasks).placed.find(task => task.id === 'b').start, 605);
  assert.equal(schedule(tasks.filter(task => task.id !== 'a')).placed[0].start, 540);
});

test('completed tasks retain stable slots and estimates use local rules', () => {
  const tasks = [{ id: 'a', title: 'Английский язык' }, { id: 'b', duration: 30 }];
  const original = schedule(tasks);
  const completed = schedule([{ ...tasks[0], done: true }, tasks[1]]);
  assert.deepEqual(original.placed.map(task => [task.start, task.end]), completed.placed.map(task => [task.start, task.end]));
  assert.equal(estimateDuration('Тренировка в спортзале'), 60);
  assert.equal(estimateDuration('Неизвестное дело'), 30);
  assert.equal(original.placed[0].duration, 60);
});

test('preparation is not mistaken for cooking by a shared Russian substring', () => {
  assert.equal(estimateDuration('Подготовить проект'), 90);
  assert.equal(estimateDuration('Подготовить презентацию'), 60);
  assert.equal(estimateDuration('Готовить еду'), 45);
  assert.equal(estimateDuration('Приготовить ужин'), 45);
  assert.equal(estimateDuration('Тренировка в спортзале'), 60);
  assert.equal(estimateDuration('Персональный кабинет'), 30);
});

test('breaks fit on both sides of floating tasks near fixed appointments', () => {
  const result = schedule([
    { id: 'fixed', time: '10:00', duration: 30 },
    { id: 'fits', duration: 55 },
    { id: 'next', duration: 30 }
  ], { start: '09:00', end: '12:00', breakMinutes: 5 });
  assert.equal(result.placed.find(task => task.id === 'fits').end, 595);
  assert.equal(result.placed.find(task => task.id === 'next').start, 635);
});

test('salary allocation uses exact kopecks and returns all leftover money', () => {
  const result = allocateBudget({ income: '100.01', goals: [{ id: 'g', target: 1000 }] });
  assert.deepEqual(result.allocations, { essentials: 50, reserve: 20, goals: 30.01, flexible: 0 });
  assert.equal(Object.values(result.allocations).reduce((sum, amount) => sum + Math.round(amount * 100), 0), 10001);
  assert.equal(allocateBudget({ income: '1.005', essentialPercent: 0, reservePercent: 0 }).income, 1.01);
  assert.equal(allocateBudget({ income: '12 345,67' }).income, 12345.67);
});

test('goal caps and priorities prevent imaginary money and savings are not changed', () => {
  const goals = [
    { id: 'later', target: 500, saved: 0, priority: 0 },
    { id: 'first', target: 20, saved: 10, priority: 3 },
    { id: 'finished', target: 10, saved: 12, priority: 9 }
  ];
  const result = allocateBudget({ income: 100, goals });
  assert.deepEqual(result.goalAllocations.map(goal => [goal.id, goal.allocation]), [['later', 20], ['first', 10], ['finished', 0]]);
  assert.equal(goals[1].saved, 10);
  const capped = allocateBudget({ income: 100, goals: [{ id: 'g', target: 5 }] });
  assert.equal(capped.allocations.goals, 5);
  assert.equal(capped.allocations.flexible, 25);
});

test('expenses consume selected envelopes and expose category and total overruns', () => {
  const result = allocateBudget({
    income: 100,
    goals: [{ id: 'g', target: 1000 }],
    expenses: [
      { amount: 60, category: 'essentials' },
      { amount: 25, category: 'reserve' },
      { amount: 40, category: 'goal', goalId: 'g' },
      { amount: 5, category: 'flexible' }
    ]
  });
  assert.deepEqual(result.envelopes.essentials, { planned: 50, spent: 60, remaining: -10 });
  assert.deepEqual(result.envelopes.reserve, { planned: 20, spent: 25, remaining: -5 });
  assert.equal(result.envelopes.goals.remaining, -10);
  assert.equal(result.envelopes.flexible.remaining, -5);
  assert.equal(result.goalAllocations[0].spent, 40);
  assert.equal(result.goalAllocations[0].budgetRemaining, -10);
  assert.equal(result.spent, 130);
  assert.equal(result.available, 0);
  assert.equal(result.deficit, 30);
});

test('zero income, invalid amounts and over-100 percentages stay bounded', () => {
  const result = allocateBudget({ income: -100, essentialPercent: 90, reservePercent: 90, expenses: [{ amount: -50 }, { amount: 'invalid' }, { amount: 1.5 }] });
  assert.equal(result.income, 0);
  assert.equal(result.totalAllocated, 0);
  assert.equal(result.reservePercent, 10);
  assert.equal(result.deficit, 1.5);
  const salary = allocateBudget({ income: 100, essentialPercent: 90, reservePercent: 90, goals: [{ target: 1000 }] });
  assert.deepEqual(salary.allocations, { essentials: 90, reserve: 10, goals: 0, flexible: 0 });
});

test('expense order does not change balances or goal attribution', () => {
  const input = {
    income: 300,
    goals: [{ id: 'a', target: 50 }, { id: 'b', target: 100 }],
    expenses: [{ amount: '0.1', category: 'goal', goalId: 'a' }, { amount: '0.2', category: 'goal', goalId: 'a' }, { amount: 30, category: 'reserve' }]
  };
  const result = allocateBudget(input);
  assert.equal(result.goalAllocations[0].spent, 0.3);
  assert.deepEqual(result, allocateBudget({ ...input, expenses: input.expenses.slice().reverse() }));
});

function fixedBudget(overrides = {}) {
  return {
    currency: 'BYN',
    income: 2000,
    incomes: [{ id: 'gift', amount: 100, currency: 'BYN' }],
    commitments: [
      { id: 'tutors', title: 'Репетиторы', amount: 680, currency: 'BYN' },
      { id: 'transport', title: 'Проезд', amount: 100, currency: 'BYN' }
    ],
    reservePercent: 20,
    goalsPercent: 20,
    goals: [{ id: 'holiday', target: 1000, currency: 'BYN' }],
    ...overrides
  };
}

test('additional income funds fixed obligations before reserve, goals and free money', () => {
  const input = fixedBudget();
  const original = structuredClone(input);
  const result = allocateBudget(input);
  assert.equal(result.salaryIncome, 2000);
  assert.equal(result.additionalIncome, 100);
  assert.equal(result.income, 2100);
  assert.equal(result.mandatoryRequested, 780);
  assert.equal(result.mandatoryFunded, 780);
  assert.equal(result.mandatoryShortfall, 0);
  assert.deepEqual(result.allocations, { essentials: 780, reserve: 264, goals: 211.2, flexible: 844.8 });
  assert.equal(result.mandatoryRemaining, 780);
  assert.equal(result.protectedRemaining, 1255.2);
  assert.equal(result.freeToSpend, 844.8);
  assert.equal(result.totalAllocated, 2100);
  assert.deepEqual(input, original);
});

test('paying a named obligation spends its protected money without subtracting free money twice', () => {
  const before = allocateBudget(fixedBudget());
  const after = allocateBudget(fixedBudget({
    expenses: [{ amount: 680, category: 'essentials', commitmentId: 'tutors', currency: 'BYN' }]
  }));
  assert.equal(after.spent, 680);
  assert.equal(after.available, 1420);
  assert.equal(after.mandatoryRemaining, 100);
  assert.equal(after.freeToSpend, before.freeToSpend);
  assert.deepEqual(after.commitmentAllocations.map(item => [item.id, item.planned, item.spent, item.remaining]), [
    ['tutors', 680, 680, 0], ['transport', 100, 0, 100]
  ]);
});

test('an obligation overrun cannot consume another obligation or planned savings', () => {
  const result = allocateBudget(fixedBudget({
    expenses: [{ amount: 900, category: 'essentials', commitmentId: 'tutors', currency: 'BYN' }]
  }));
  assert.equal(result.commitmentAllocations[0].remaining, -220);
  assert.equal(result.commitmentAllocations[1].remaining, 100);
  assert.equal(result.mandatoryRemaining, 100);
  assert.equal(result.protectedRemaining, 575.2);
  assert.equal(result.available, 1200);
  assert.equal(result.freeToSpend, 624.8);
  assert.equal(result.protectionShortfall, 0);
  const exhausted = allocateBudget(fixedBudget({
    expenses: [{ amount: 1800, category: 'essentials', commitmentId: 'tutors', currency: 'BYN' }]
  }));
  assert.equal(exhausted.freeToSpend, 0);
  assert.equal(exhausted.protectionShortfall, 275.2);
  assert.equal(exhausted.deficit, 0);
});

test('unlinked or unknown essential expenses spend free money and preserve every named obligation', () => {
  for (const commitmentId of [undefined, 'missing']) {
    const result = allocateBudget(fixedBudget({
      expenses: [{ amount: 80, category: 'essentials', commitmentId, currency: 'BYN' }]
    }));
    assert.equal(result.envelopes.essentials.spent, 80);
    assert.equal(result.mandatoryRemaining, 780);
    assert.equal(result.protectedRemaining, 1255.2);
    assert.equal(result.freeToSpend, 764.8);
    assert.deepEqual(result.commitmentAllocations.map(item => item.spent), [0, 0]);
  }
});

test('insufficient income reports each unfunded obligation and leaves no imaginary free money', () => {
  const result = allocateBudget(fixedBudget({ income: 500, incomes: [] }));
  assert.equal(result.mandatoryRequested, 780);
  assert.equal(result.mandatoryFunded, 500);
  assert.equal(result.mandatoryShortfall, 280);
  assert.deepEqual(result.commitmentAllocations.map(item => [item.planned, item.shortfall]), [[500, 180], [0, 100]]);
  assert.deepEqual(result.allocations, { essentials: 500, reserve: 0, goals: 0, flexible: 0 });
  assert.equal(result.freeToSpend, 0);
  assert.equal(result.protectionShortfall, 0);
});

test('an explicit empty obligation list uses only the requested savings percentages', () => {
  const result = allocateBudget({ income: 100, commitments: [], reservePercent: 20, goalsPercent: 20, goals: [] });
  assert.deepEqual(result.allocations, { essentials: 0, reserve: 20, goals: 0, flexible: 80 });
  assert.equal(result.freeToSpend, 80);
  const capped = allocateBudget({ income: 100, commitments: [], reservePercent: 20, goalsPercent: 20, goals: [{ id: 'g', target: 5 }] });
  assert.deepEqual(capped.allocations, { essentials: 0, reserve: 20, goals: 5, flexible: 75 });
  assert.equal(capped.freeToSpend, 75);
});

test('BYN, USD and RUB ledgers never add or relabel each other’s transactions', () => {
  const input = {
    income: 100,
    reservePercent: 0,
    goalsPercent: 0,
    incomes: [{ amount: 10, currency: 'BYN' }, { amount: 20, currency: 'USD' }, { amount: 30, currency: 'RUB' }, { amount: 40 }],
    commitments: [{ id: 'byn', amount: 10, currency: 'BYN' }, { id: 'usd', amount: 20, currency: 'USD' }, { id: 'rub', amount: 30, currency: 'RUB' }, { id: 'legacy', amount: 40 }],
    goals: [{ id: 'byn', target: 1, currency: 'BYN' }, { id: 'usd', target: 1, currency: 'USD' }, { id: 'rub', target: 1, currency: 'RUB' }, { id: 'legacy', target: 1 }],
    expenses: [{ amount: 1, currency: 'BYN' }, { amount: 2, currency: 'USD' }, { amount: 3, currency: 'RUB' }, { amount: 4 }]
  };
  for (const [currency, extra, required, spent, ids] of [
    ['BYN', 10, 10, 1, ['byn']], ['USD', 20, 20, 2, ['usd']], ['RUB', 70, 70, 7, ['rub', 'legacy']]
  ]) {
    const result = allocateBudget({ ...input, currency });
    assert.equal(result.currency, currency);
    assert.equal(result.additionalIncome, extra);
    assert.equal(result.income, 100 + extra);
    assert.equal(result.mandatoryRequested, required);
    assert.equal(result.spent, spent);
    assert.deepEqual(result.commitmentAllocations.map(item => item.id), ids);
    assert.deepEqual(result.goalAllocations.map(item => item.id), ids);
  }
  assert.equal(allocateBudget({ ...input, currency: ' byn ' }).currency, 'BYN');
});

test('mixed currencies cannot attach expenses to a different ledger’s protected items', () => {
  const result = allocateBudget(fixedBudget({
    expenses: [
      { amount: 680, category: 'essentials', commitmentId: 'tutors', currency: 'USD' },
      { amount: 100, category: 'goal', goalId: 'holiday' }
    ]
  }));
  assert.equal(result.spent, 0);
  assert.equal(result.mandatoryRemaining, 780);
  assert.equal(result.goalAllocations[0].spent, 0);
  assert.equal(result.freeToSpend, 844.8);
});

test('a named goal payment only releases that goal’s protection, including when it overruns', () => {
  const result = allocateBudget(fixedBudget({
    goals: [{ id: 'first', target: 100, currency: 'BYN' }, { id: 'second', target: 1000, currency: 'BYN' }],
    expenses: [{ amount: 150, category: 'goal', goalId: 'first', currency: 'BYN' }]
  }));
  assert.deepEqual(result.goalAllocations.map(item => [item.allocation, item.spent, item.budgetRemaining]), [[100, 150, -50], [111.2, 0, 111.2]]);
  assert.equal(result.protectedRemaining, 1155.2);
  assert.equal(result.freeToSpend, 794.8);
  const unlinked = allocateBudget(fixedBudget({ expenses: [{ amount: 50, category: 'goal', currency: 'BYN' }] }));
  assert.equal(unlinked.goalAllocations[0].spent, 0);
  assert.equal(unlinked.protectedRemaining, 1255.2);
  assert.equal(unlinked.freeToSpend, 794.8);
});

test('fixed allocation rounds income once, keeps exact cents and returns capped goals to free funds', () => {
  const result = allocateBudget({
    currency: 'BYN', income: '100,01', incomes: [{ amount: '0.005', currency: 'BYN' }],
    commitments: [{ id: 'a', amount: '10.005', currency: 'BYN' }],
    reservePercent: 20, goalsPercent: 20, goals: [{ id: 'g', target: '1.005', currency: 'BYN' }],
    expenses: [{ amount: '0.1', currency: 'BYN' }, { amount: '0.2', currency: 'BYN' }]
  });
  assert.equal(result.income, 100.02);
  assert.equal(result.additionalIncome, 0.01);
  assert.deepEqual(result.allocations, { essentials: 10.01, reserve: 18, goals: 1.01, flexible: 71 });
  assert.equal(result.spent, 0.3);
  assert.equal(result.freeToSpend, 70.7);
  assert.equal(Object.values(result.allocations).reduce((sum, amount) => sum + Math.round(amount * 100), 0), 10002);
});

test('invalid income, obligation and expense amounts cannot add or remove money', () => {
  const result = allocateBudget({
    currency: 'BYN', income: -100,
    incomes: [null, { amount: -20, currency: 'BYN' }, { amount: 'invalid', currency: 'BYN' }, { amount: Infinity, currency: 'BYN' }, { amount: 100, currency: 'BYN' }],
    commitments: [null, { id: 'negative', amount: -30, currency: 'BYN' }, { id: 'invalid', amount: {}, currency: 'BYN' }, { id: 'real', amount: 40, currency: 'BYN' }],
    reservePercent: 150, goalsPercent: 150,
    expenses: [null, { amount: -5, currency: 'BYN' }, { amount: 'bad', currency: 'BYN' }, { amount: 1.5, currency: 'BYN' }]
  });
  assert.equal(result.income, 100);
  assert.equal(result.mandatoryRequested, 40);
  assert.deepEqual(result.allocations, { essentials: 40, reserve: 60, goals: 0, flexible: 0 });
  assert.equal(result.spent, 1.5);
  assert.equal(result.freeToSpend, 0);
  assert.equal(result.protectionShortfall, 1.5);
  assert.equal(result.reservePercent, 100);
  assert.equal(result.goalsPercent, 100);
});
