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
