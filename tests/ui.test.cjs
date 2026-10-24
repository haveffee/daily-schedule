const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../assistant-core.js');
const extras = require('../assistant-extras.js');
const planner = require('../assistant-planner.js');
const weekly = require('../assistant-weekly.js');

const source = fs.readFileSync(path.join(__dirname, '../assistant-ui.js'), 'utf8');
const MONTH = '2026-10';
const DAY = MONTH + '-23';
const clone = value => JSON.parse(JSON.stringify(value));
const normalize = value => value.replace(/[\u00a0\u202f]/g, ' ');

// Exercise the application's event handlers and generated markup without a
// browser, network, real storage, or a DOM implementation of the app itself.
function createUI(initial = [], options = {}) {
  const documentEvents = new Map();
  const windowEvents = new Map();
  const nodes = new Map();
  let sequence = 0;
  let current = {
    records: Object.fromEntries(initial.map(record => [record.id, clone(record)])),
    status: 'local', user: null, error: ''
  };
  const subscribers = [];
  const periods = [];
  const writes = [];

  function node(id) {
    if (nodes.has(id)) return nodes.get(id);
    const listeners = new Map();
    const classes = new Set();
    const el = {
      id, innerHTML: '', textContent: '', hidden: false, value: '', open: false,
      disabled: false, dataset: {}, offsetWidth: 0,
      classList: {
        add: name => classes.add(name), remove: name => classes.delete(name),
        toggle(name, enabled) {
          const add = enabled === undefined ? !classes.has(name) : enabled;
          if (add) classes.add(name); else classes.delete(name);
          return add;
        }
      },
      addEventListener(type, callback) {
        const callbacks = listeners.get(type) || [];
        callbacks.push(callback); listeners.set(type, callbacks);
      },
      async fire(type, event = {}) {
        for (const callback of listeners.get(type) || []) {
          await callback({ target: el, preventDefault() {}, ...event });
        }
      },
      querySelectorAll() { return []; },
      setAttribute(name, value) { el[name] = value; },
      showModal() { el.open = true; },
      close() { el.open = false; }
    };
    nodes.set(id, el);
    return el;
  }

  const publish = () => subscribers.forEach(callback => callback(clone(current)));
  const store = {
    getState: () => clone(current),
    subscribe(callback) { subscribers.push(callback); },
    put(record) { writes.push({ action: 'put', record: clone(record) }); current.records[record.id] = clone(record); publish(); },
    remove(id) { writes.push({ action: 'remove', id }); delete current.records[id]; publish(); },
    setPeriod(month, day) { periods.push({ month, day }); },
    init: async () => {}, signInOut: async () => {}
  };
  let currentHash = '#money';
  const location = {
    get hash() { return currentHash; },
    set hash(value) { const text = String(value); currentHash = text && !text.startsWith('#') ? '#' + text : text; }
  };
  const window = {
    HVFCore: core, HVFExtras: extras, HVFPlanner: planner, HVFWeekly: weekly, HVFStore: store,
    HVFPWA: options.pwa,
    HVFAI: {
      isEnabled: () => false, getStatus: () => 'Локальная оценка',
      subscribe() {}, setEnabled() {},
      estimate: async () => ({ minutes: 30, source: 'local' }),
      plan: async () => ({ steps: [], source: 'local' })
    },
    addEventListener(type, callback) { windowEvents.set(type, callback); },
    scrollTo() {}
  };
  const document = {
    getElementById: node, querySelectorAll: () => [],
    addEventListener(type, callback) { documentEvents.set(type, callback); }
  };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [DAY + 'T09:00:00Z'])); }
    static now() { return Date.parse(DAY + 'T09:00:00Z'); }
  }
  class FormData {
    constructor(form) { this.values = form.values; }
    get(name) { return Object.hasOwn(this.values, name) ? this.values[name] : null; }
  }
  vm.runInNewContext(source, {
    document, window, location, FormData, Date: FixedDate, Intl,
    crypto: { randomUUID: () => 'ui-' + (++sequence) },
    setTimeout: () => ++sequence, clearTimeout() {}
  }, { filename: 'assistant-ui.js' });

  return {
    node, periods, writes,
    records: kind => Object.values(clone(current.records)).filter(record => !kind || record.kind === kind),
    html: () => normalize(node('content').innerHTML),
    fields: () => normalize(node('dialogFields').innerHTML),
    click(action, id) {
      const target = { dataset: { action, id }, disabled: false };
      const previousHash = location.hash;
      documentEvents.get('click')({ target: { closest: () => target } });
      if (location.hash !== previousHash) windowEvents.get('hashchange')?.();
    },
    change(dataset, checked, extra = {}) { documentEvents.get('change')({ target: { dataset, checked, ...extra } }); },
    upsert(record) { current.records[record.id] = clone(record); publish(); },
    account(uid, records = []) {
      current = { ...current, user: uid ? { uid, email: uid + '@example.test' } : null,
        records: Object.fromEntries(records.map(record => [record.id, clone(record)])) };
      publish();
    },
    async submit(values, expectedError = '') {
      assert.equal(node('editor').open, true, 'an editor must be open before saving');
      await node('editorForm').fire('submit', { target: { id: 'editorForm', values } });
      const error = node('formError').textContent;
      if (expectedError) assert.match(error, expectedError);
      else assert.equal(error, '', 'the application must accept the entered values');
      return error;
    },
    navigate(hash) { location.hash = hash; windowEvents.get('hashchange')(); },
    windowEvent(type) { windowEvents.get(type)?.(); },
    setMonth: value => node('monthPicker').fire('change', { target: { value } })
  };
}

function statValue(ui, name) {
  const marker = '<span>' + name + '</span>';
  const start = ui.html().indexOf(marker);
  assert.ok(start >= 0, 'statistic is visible: ' + name);
  const value = ui.html().slice(start).match(/<strong>(.*?)<\/strong>/);
  assert.ok(value, 'statistic has a value: ' + name);
  return value[1];
}

async function salary(ui, amount, reservePercent = '20', goalsPercent = '20') {
  ui.click('edit-budget');
  await ui.submit({ income: String(amount), reservePercent, goalsPercent });
}

async function income(ui, title, amount, currency = 'BYN') {
  ui.click('add-income');
  await ui.submit({ title, amount: String(amount), currency, date: DAY });
  return ui.records('income').find(record => record.title === title);
}

async function commitment(ui, title, amount) {
  ui.click('add-commitment');
  await ui.submit({ title, amount: String(amount), currency: 'BYN', dueDay: '25' });
  return ui.records('commitment').find(record => record.title === title);
}

const dayTask = (id, values = {}) => ({
  id, kind: 'task', month: MONTH, date: DAY, title: id, duration: 30,
  time: '', priority: 1, done: false, ...values,
});
const recurring = (values = {}) => ({
  id: 'tutor-series', kind: 'routine', month: '2000-02', title: 'Репетитор',
  weekdays: [5], startDate: DAY, untilDate: '', duration: 60, time: '18:00', priority: 2,
  ...values,
});
const taskFields = (values = {}) => ({
  title: 'Новое дело', date: DAY, time: '', duration: '30', priority: '1', goalId: '', ...values,
});
const changeDay = (ui, date) => ui.change({}, false, { id: 'dayPicker', value: date });
function taskMarkup(ui, id) {
  return [...ui.html().matchAll(/<article class="task-row[^\"]*">[\s\S]*?<\/article>/g)]
    .map(match => match[0]).find(markup => markup.includes('data-task-check="' + id + '"')) || '';
}

test('new users see BYN while existing records without currency remain in RUB', () => {
  const original = [
    { id: 'legacy-budget', kind: 'budget', month: MONTH, income: 500, reservePercent: 0, goalsPercent: 0 },
    { id: 'legacy-expense', kind: 'expense', month: MONTH, date: DAY, title: 'Старый расход', amount: 50, category: 'flexible' }
  ];
  const ui = createUI(original);
  assert.equal(statValue(ui, 'Все поступления'), '0 BYN');
  assert.match(ui.html(), /data-id="BYN" aria-pressed="true"/);
  assert.match(ui.html(), /Старые записи без валюты сохранены в RUB/);
  ui.click('currency', 'RUB');
  assert.equal(statValue(ui, 'Все поступления'), '500 RUB');
  assert.equal(statValue(ui, 'Всего осталось'), '450 RUB');
  assert.match(ui.html(), /Старый расход/);
  assert.deepEqual(ui.records().filter(record => record.kind !== 'finance-preferences'), original);
  ui.click('currency', 'BYN');
  assert.equal(statValue(ui, 'Всего осталось'), '0 BYN');
  assert.doesNotMatch(ui.html(), /<h3>Старый расход<\/h3>/);
});

test('salary, gifts, mandatory sums and linked payments update the visible budget once', async () => {
  const ui = createUI();
  await salary(ui, 2000);
  assert.deepEqual(ui.records('budget').map(({ income, currency }) => ({ income, currency })), [{ income: 2000, currency: 'BYN' }]);
  assert.equal(statValue(ui, 'Все поступления'), '2 000 BYN');
  const gift = await income(ui, 'Подарок', 100);
  assert.equal(gift.amount, 100);
  assert.equal(statValue(ui, 'Все поступления'), '2 100 BYN');
  assert.match(ui.html(), /Зарплата 2 000 BYN · ещё 100 BYN/);

  const tutors = await commitment(ui, 'Репетиторы', 680);
  await commitment(ui, 'Проезд', 100);
  assert.equal(ui.records('expense').length, 0, 'reserving money is not a recorded expense');
  assert.equal(statValue(ui, 'Всего осталось'), '2 100 BYN');
  assert.equal(statValue(ui, 'Свободно тратить'), '1 056 BYN');
  assert.match(ui.html(), /Репетиторы/);
  assert.match(ui.html(), /ещё отложено 680 BYN/);

  ui.click('pay-commitment', tutors.id);
  assert.match(ui.fields(), /name="amount"[^>]*value="680"/);
  assert.match(ui.fields(), new RegExp('value="commitment:' + tutors.id + '" selected'));
  await ui.submit({ title: 'Репетиторы', amount: '680', currency: 'BYN', date: DAY, category: 'commitment:' + tutors.id });
  assert.deepEqual(ui.records('expense').map(({ amount, category, commitmentId, currency }) => ({ amount, category, commitmentId, currency })), [
    { amount: 680, category: 'essentials', commitmentId: tutors.id, currency: 'BYN' }
  ]);
  assert.equal(statValue(ui, 'Всего осталось'), '1 420 BYN');
  assert.equal(statValue(ui, 'Свободно тратить'), '1 056 BYN', 'payment consumes the reserved amount rather than charging free money again');
  assert.match(ui.html(), /Оплачено 680 BYN · ещё отложено 0 BYN/);

  ui.click('currency', 'USD');
  assert.equal(statValue(ui, 'Все поступления'), '0 USD');
  assert.equal(statValue(ui, 'Всего осталось'), '0 USD');
  assert.doesNotMatch(ui.html(), /<h3>Подарок<\/h3>|<h3>Репетиторы<\/h3>/);
  ui.click('currency', 'BYN');
  assert.equal(statValue(ui, 'Свободно тратить'), '1 056 BYN');
});

test('a new monthly money goal saves without existing goals or expense links', async () => {
  const ui = createUI();
  ui.click('add-goal');
  await ui.submit({ title: 'Ноутбук', outcome: '', currency: 'BYN', target: '1200', saved: '', priority: '1' });
  const [goal] = ui.records('goal');
  assert.equal(goal.title, 'Ноутбук');
  assert.equal(goal.currency, 'BYN');
  assert.equal(goal.target, 1200);
  assert.equal(goal.saved, 0);
  assert.equal(goal.month, MONTH);
  assert.ok(goal.id);
  assert.match(ui.html(), /Ноутбук/);
  assert.equal(ui.node('editor').open, false);
});

test('editing income and expense currencies moves only those records between separate ledgers', async () => {
  const ui = createUI();
  await salary(ui, 2000, '0', '0');
  const gift = await income(ui, 'Подарок', 100);
  ui.click('add-expense');
  await ui.submit({ title: 'Кофе', amount: '25', currency: 'BYN', date: DAY, category: 'flexible' });
  const [expense] = ui.records('expense');
  const budgetBefore = ui.records('budget');
  assert.equal(statValue(ui, 'Всего осталось'), '2 075 BYN');

  ui.click('edit-income', gift.id);
  await ui.submit({ title: 'Подарок', amount: '100', currency: 'USD', date: DAY });
  assert.equal(ui.records('income').length, 1);
  assert.equal(ui.records('income')[0].id, gift.id);
  assert.equal(statValue(ui, 'Все поступления'), '100 USD');
  assert.equal(statValue(ui, 'Всего осталось'), '100 USD');
  ui.click('currency', 'BYN');
  assert.equal(statValue(ui, 'Все поступления'), '2 000 BYN');
  assert.equal(statValue(ui, 'Всего осталось'), '1 975 BYN');
  assert.equal(ui.records('expense')[0].currency, 'BYN');

  ui.click('edit-expense', expense.id);
  await ui.submit({ title: 'Кофе', amount: '25', currency: 'USD', date: DAY, category: 'flexible' });
  assert.equal(ui.records('expense').length, 1);
  assert.equal(ui.records('expense')[0].id, expense.id);
  assert.equal(statValue(ui, 'Все поступления'), '100 USD');
  assert.equal(statValue(ui, 'Всего осталось'), '75 USD');
  ui.click('currency', 'BYN');
  assert.equal(statValue(ui, 'Всего осталось'), '2 000 BYN');
  assert.deepEqual(ui.records('budget'), budgetBefore, 'changing another record never relabels the salary');
});

test('linked payments reject a different currency and paid commitments preserve their currency', async () => {
  const ui = createUI();
  await salary(ui, 2000, '0', '0');
  const item = await commitment(ui, 'Репетиторы', 680);
  ui.click('pay-commitment', item.id);
  await ui.submit({ title: 'Репетиторы', amount: '680', currency: 'USD', date: DAY, category: 'commitment:' + item.id }, /той же валюте/);
  assert.equal(ui.records('expense').length, 0);
  assert.equal(ui.node('editor').open, true);
  await ui.submit({ title: 'Репетиторы', amount: '680', currency: 'BYN', date: DAY, category: 'commitment:' + item.id });
  ui.click('edit-commitment', item.id);
  await ui.submit({ title: 'Репетиторы', amount: '680', currency: 'USD', dueDay: '25' }, /уже есть оплаты/);
  assert.equal(ui.records('commitment')[0].currency, 'BYN');
  assert.equal(statValue(ui, 'Свободно тратить'), '1 320 BYN');
});

test('new payments reject deleted or previous-month commitments without saving a partial expense', async () => {
  const ui = createUI([
    { id: 'previous-tutors', kind: 'commitment', month: '2026-09', currency: 'BYN', title: 'Репетиторы в сентябре', amount: 680 }
  ]);
  await salary(ui, 2000, '0', '0');
  ui.click('add-expense');
  await ui.submit({ title: 'Репетиторы', amount: '680', currency: 'BYN', date: DAY, category: 'commitment:deleted-item' }, /того же месяца и в той же валюте/);
  assert.equal(ui.records('expense').length, 0);
  await ui.submit({ title: 'Репетиторы', amount: '680', currency: 'BYN', date: DAY, category: 'commitment:previous-tutors' }, /того же месяца и в той же валюте/);
  assert.equal(ui.records('expense').length, 0);
  assert.equal(statValue(ui, 'Всего осталось'), '2 000 BYN');
});

test('editing an archived payment preserves its original reference and history label', async () => {
  const ui = createUI([
    { id: 'archived-payment', kind: 'expense', month: MONTH, currency: 'BYN', date: DAY, title: 'Оплата репетитора', amount: 680, category: 'essentials', commitmentId: 'deleted-tutors', commitmentTitle: 'Репетиторы' }
  ]);
  await salary(ui, 2000, '0', '0');
  ui.click('edit-expense', 'archived-payment');
  assert.match(ui.fields(), /value="commitment:deleted-tutors" selected/);
  await ui.submit({ title: 'Оплата репетитора', amount: '650', currency: 'BYN', date: DAY, category: 'commitment:deleted-tutors' });
  assert.equal(ui.records('expense').length, 1);
  assert.equal(ui.records('expense')[0].commitmentId, 'deleted-tutors');
  assert.equal(ui.records('expense')[0].commitmentTitle, 'Репетиторы');
  assert.equal(statValue(ui, 'Всего осталось'), '1 350 BYN');
  assert.match(ui.html(), /23 октября · Репетиторы/);
});

test('deleting and undoing a gift restores its record and recalculates the budget', async () => {
  const ui = createUI();
  await salary(ui, 2000, '0', '0');
  const gift = await income(ui, 'Подарок', 100);
  ui.click('delete', gift.id);
  assert.equal(ui.records('income').length, 0);
  assert.equal(statValue(ui, 'Все поступления'), '2 000 BYN');
  assert.equal(ui.node('undoButton').hidden, false);
  await ui.node('undoButton').fire('click');
  assert.deepEqual(ui.records('income'), [gift]);
  assert.equal(statValue(ui, 'Все поступления'), '2 100 BYN');
});

test('repeating previous monthly commitments copies each once without carrying payments', async () => {
  const ui = createUI([
    { id: 'old-tutors', kind: 'commitment', month: '2026-09', currency: 'BYN', title: 'Репетиторы', amount: 680, dueDay: 25 },
    { id: 'old-bus', kind: 'commitment', month: '2026-09', currency: 'BYN', title: 'Проезд', amount: 100, dueDay: 0 },
    { id: 'old-usd', kind: 'commitment', month: '2026-09', currency: 'USD', title: 'USD подписка', amount: 10, dueDay: 0 },
    { id: 'old-payment', kind: 'expense', month: '2026-09', currency: 'BYN', title: 'Репетиторы', amount: 680, category: 'essentials', commitmentId: 'old-tutors', date: '2026-09-25' }
  ]);
  ui.click('copy-commitments');
  const copied = ui.records('commitment').filter(record => record.month === MONTH);
  assert.equal(copied.length, 2);
  assert.deepEqual(copied.map(({ title, amount }) => ({ title, amount })), [{ title: 'Репетиторы', amount: 680 }, { title: 'Проезд', amount: 100 }]);
  assert.ok(copied.every(record => !record.id.startsWith('old-')));
  assert.equal(ui.records('expense').filter(record => record.month === MONTH).length, 0);
  ui.click('copy-commitments');
  assert.equal(ui.records('commitment').filter(record => record.month === MONTH).length, 2);
});

test('finance screen renders local saving advice with its public sources', () => {
  const ui = createUI();
  assert.match(ui.html(), /Подсказки помощника/);
  assert.match(ui.html(), /Как удобнее откладывать/);
  assert.match(ui.html(), /https:\/\/consumer\.gov\/your-money\/making-budget/);
  assert.match(ui.html(), /https:\/\/www\.consumerfinance\.gov\/an-essential-guide-to-building-an-emergency-fund\//);
  ui.navigate('#settings');
  assert.match(ui.html(), /Телефон и компьютер — один помощник/);
  assert.match(ui.html(), /На обоих устройствах нужен один Google-аккаунт/);
});

test('settings installation panel uses the permanent public link and explains device independence', () => {
  const ui = createUI();
  ui.navigate('#settings');
  const installation = ui.node('installationPanel').innerHTML;
  assert.match(installation, /href="https:\/\/haveffee\.github\.io\/daily-schedule\/"/);
  assert.doesNotMatch(installation, /localhost|127\.0\.0\.1/);
  assert.match(installation, /Компьютер можно выключать/);
  assert.match(installation, /синхронизация работает через Firebase/);
  assert.match(installation, /Safari/);
  assert.match(installation, /Chrome или Edge/);
  assert.match(installation, /data-action="install-app"[^>]*>Как установить<\/button>/);
});

test('manual installation help explains Google sync and restores normal editor buttons afterward', async () => {
  const ui = createUI();
  ui.navigate('#settings');
  ui.click('install-app');
  assert.equal(ui.node('editor').open, true);
  assert.equal(ui.node('dialogTitle').textContent, 'Установить HVF');
  assert.match(ui.fields(), /На iPhone открой постоянную ссылку в Safari/);
  assert.match(ui.fields(), /один Google-аккаунт на каждом устройстве/);
  assert.match(ui.fields(), /href="https:\/\/support\.apple\.com\/guide\/iphone\/iph42ab2f3a7\/ios"/);
  assert.equal(ui.node('saveDialog').textContent, 'Понятно');
  assert.equal(ui.node('cancelDialog').hidden, true);
  await ui.submit({});
  assert.equal(ui.node('editor').open, false);
  assert.equal(ui.records().length, 0, 'acknowledging installation help does not save a financial record');

  ui.click('add-income');
  assert.equal(ui.node('saveDialog').textContent, 'Сохранить');
  assert.equal(ui.node('cancelDialog').hidden, false);
  await ui.submit({ title: 'Подарок после установки', amount: '100', currency: 'BYN', date: DAY });
  assert.equal(ui.records('income').length, 1);
});

test('available native installation runs only after its explicit action and refreshes its installed state', async () => {
  let requests = 0;
  let status = { canInstall: true, installed: false, offlineReady: false, updateReady: false };
  const ui = createUI([], { pwa: {
    getStatus: () => ({ ...status }),
    async requestInstall() { requests++; return { outcome: 'accepted' }; }
  } });
  assert.equal(requests, 0);
  ui.navigate('#settings');
  assert.match(ui.node('installationPanel').innerHTML, /Установить HVF/);
  assert.equal(requests, 0, 'viewing installation information never triggers the native prompt');
  ui.click('currency', 'USD');
  ui.navigate('#money');
  ui.navigate('#settings');
  assert.equal(requests, 0, 'normal app navigation never triggers the native prompt');
  ui.click('install-app');
  await Promise.resolve();
  assert.equal(requests, 1);
  assert.match(ui.node('toastText').textContent, /Установка подтверждена/);
  assert.equal(ui.node('editor').open, false);

  status = { canInstall: false, installed: true, offlineReady: true, updateReady: true };
  ui.windowEvent('hvf-pwa-status');
  const installation = ui.node('installationPanel').innerHTML;
  assert.match(installation, /HVF установлен на этом устройстве/);
  assert.doesNotMatch(installation, /data-action="install-app"/);
  assert.match(installation, /Файлы приложения сохранены на этом устройстве/);
  assert.match(installation, /Доступно обновление/);
  assert.equal(requests, 1);
});

test('an unavailable native installation opens platform instructions with sync guidance', async () => {
  let requests = 0;
  const ui = createUI([], { pwa: {
    getStatus: () => ({ canInstall: true }),
    async requestInstall() { requests++; return { outcome: 'unavailable' }; },
    getInstallInstructions: () => ({
      title: 'Установка на Android',
      steps: ['Открой постоянную ссылку в Chrome.', 'Нажми «Добавить на главный экран».'],
      sourceUrl: 'https://support.google.com/chrome/answer/9658361'
    })
  } });
  ui.click('install-app');
  await Promise.resolve();
  assert.equal(requests, 1);
  assert.equal(ui.node('editor').open, true);
  assert.equal(ui.node('dialogTitle').textContent, 'Установка на Android');
  assert.match(ui.fields(), /Добавить на главный экран/);
  assert.match(ui.fields(), /один Google-аккаунт на каждом устройстве/);
  assert.match(ui.fields(), /https:\/\/support\.google\.com\/chrome\/answer\/9658361/);
  assert.equal(ui.node('saveDialog').textContent, 'Понятно');
});

test('priority labels and important-only filtering preserve the complete day schedule', async () => {
  const ui = createUI([
    { id: 'rhythm', kind: 'settings', month: MONTH, start: '09:00', end: '12:00', breakMinutes: 0 },
    dayTask('appointment', { title: 'Обычная встреча', time: '09:00', duration: 60 }),
    dayTask('important', { title: 'Важная работа', priority: 2 }),
    dayTask('low', { title: 'Мелочь', priority: 0 }),
  ]);
  ui.navigate('#day');
  assert.match(taskMarkup(ui, 'appointment'), /priority-1">Обычный приоритет/);
  assert.match(taskMarkup(ui, 'important'), /priority-2">Высокий приоритет/);
  assert.match(taskMarkup(ui, 'low'), /priority-0">Низкий приоритет/);
  assert.match(taskMarkup(ui, 'important'), /class="task-time">10:00<small>10:30/);

  ui.click('important-only');
  assert.equal(taskMarkup(ui, 'appointment'), '');
  assert.equal(taskMarkup(ui, 'low'), '');
  assert.match(taskMarkup(ui, 'important'), /class="task-time">10:00<small>10:30/,
    'hiding an ordinary appointment must not free its occupied slot');
  assert.equal(ui.writes.length, 0, 'a visual filter does not alter any task');
  ui.click('important-only');
  ui.click('edit-task', 'low');
  assert.match(ui.fields(), /Высокий · коралловый/);
  assert.match(ui.fields(), /Обычный · зелёный/);
  assert.match(ui.fields(), /Низкий · серый/);
  await ui.submit(taskFields({ title: 'Теперь важное', priority: '2' }));
  assert.equal(ui.records('task').find(record => record.id === 'low').priority, 2);
  assert.match(taskMarkup(ui, 'low'), /priority-2">Высокий приоритет/);
});

test('recurring creation validates weekdays and completion materializes only the chosen occurrence', async () => {
  const ui = createUI();
  ui.navigate('#day');
  ui.click('add-routine');
  const values = {
    title: 'Английский', startDate: DAY, untilDate: '', duration: '45', time: '18:00', priority: '2',
  };
  await ui.submit(values, /Выбери дни недели/);
  assert.equal(ui.records().length, 0);
  await ui.submit({ ...values, weekday2: '2', weekday5: '5' });
  const [rule] = ui.records('routine');
  assert.deepEqual(rule.weekdays, [2, 5]);
  assert.equal(rule.month, '2000-02');
  assert.equal(ui.records('task').length, 0, 'future repetitions are virtual until separately changed');
  const currentId = planner.routineTaskId(rule.id, DAY);
  assert.ok(taskMarkup(ui, currentId));

  ui.change({ taskCheck: currentId }, true);
  const [completed] = ui.records('task');
  assert.equal(completed.id, currentId);
  assert.equal(completed.done, true);
  assert.equal(completed.completedDate, DAY);
  assert.equal(completed.occurrenceDate, DAY);
  assert.equal(completed.virtual, undefined, 'view-only fields never become persistent data');
  changeDay(ui, '2026-10-24');
  assert.equal(taskMarkup(ui, planner.routineTaskId(rule.id, '2026-10-24')), '');
  changeDay(ui, '2026-10-27');
  assert.match(taskMarkup(ui, planner.routineTaskId(rule.id, '2026-10-27')), /Английский/);
  assert.doesNotMatch(taskMarkup(ui, planner.routineTaskId(rule.id, '2026-10-27')), /class="task-row done"/);
  assert.equal(ui.records('task').length, 1);
  assert.deepEqual(ui.records('routine'), [rule], 'checking one day does not change its series');
});

test('skipping and undoing a virtual occurrence preserves the rest of its recurring series', async () => {
  const rule = recurring();
  const ui = createUI([rule]);
  ui.navigate('#day');
  const id = planner.routineTaskId(rule.id, DAY);
  ui.click('delete', id);
  assert.equal(taskMarkup(ui, id), '');
  const [skipped] = ui.records('routine-skip');
  assert.equal(skipped.id, planner.routineSkipId(rule.id, DAY));
  assert.equal(skipped.occurrenceDate, DAY);
  assert.equal(ui.records('task').length, 0);
  changeDay(ui, '2026-10-30');
  assert.ok(taskMarkup(ui, planner.routineTaskId(rule.id, '2026-10-30')));
  await ui.node('undoButton').fire('click');
  assert.equal(ui.records('routine-skip').length, 0);
  assert.equal(ui.records('task').length, 0);
  changeDay(ui, DAY);
  assert.ok(taskMarkup(ui, id));
  assert.deepEqual(ui.records('routine'), [rule]);
});

test('editing then deleting a single recurring occurrence restores exactly that edit on undo', async () => {
  const rule = recurring();
  const ui = createUI([rule]);
  ui.navigate('#day');
  const id = planner.routineTaskId(rule.id, DAY);
  ui.click('edit-task', id);
  assert.match(ui.fields(), /Изменится только это повторение/);
  await ui.submit(taskFields({ title: 'Занятие перенесли на утро', time: '10:00', duration: '45', priority: '0' }));
  const [edited] = ui.records('task');
  assert.equal(edited.id, id);
  assert.equal(edited.routineId, rule.id);
  assert.equal(edited.priority, 0);
  assert.deepEqual(ui.records('routine'), [rule]);
  changeDay(ui, '2026-10-30');
  const future = taskMarkup(ui, planner.routineTaskId(rule.id, '2026-10-30'));
  assert.match(future, /Репетитор/);
  assert.doesNotMatch(future, /Занятие перенесли/);
  changeDay(ui, DAY);
  ui.click('delete', id);
  assert.equal(ui.records('task').length, 0);
  assert.equal(ui.records('routine-skip').length, 1);
  await ui.node('undoButton').fire('click');
  assert.deepEqual(ui.records('task'), [edited]);
  assert.equal(ui.records('routine-skip').length, 0);
  assert.match(taskMarkup(ui, id), /Занятие перенесли на утро/);
});

test('move preview is read-only, supports deselection and cancellation, and keeps completed tasks in place', async () => {
  const original = [dayTask('move-me'), dayTask('leave-me'), dayTask('completed', { done: true })];
  const ui = createUI(original);
  ui.navigate('#day');
  ui.click('move-preview');
  assert.equal(ui.node('dialogTitle').textContent, 'Перенести на завтра');
  assert.match(ui.fields(), /2 к переносу/);
  assert.doesNotMatch(ui.fields(), /data-move-task="completed"/);
  assert.deepEqual(ui.records(), original);
  assert.equal(ui.writes.length, 0);
  ui.change({ moveTask: 'leave-me' }, false);
  assert.match(ui.fields(), /1 к переносу/);
  await ui.node('cancelDialog').fire('click');
  assert.equal(ui.node('editor').open, false);
  assert.equal(ui.writes.length, 0);

  ui.click('move-preview');
  assert.match(ui.fields(), /2 к переносу/, 'reopening a cancelled preview resets the selection');
  ui.change({ moveTask: 'leave-me' }, false);
  await ui.submit({});
  const byId = Object.fromEntries(ui.records('task').map(record => [record.id, record]));
  assert.equal(byId['move-me'].date, '2026-10-24');
  assert.equal(byId['move-me'].moveCount, 1);
  assert.equal(byId['move-me'].movedFromDate, DAY);
  assert.equal(byId['move-me'].lastMovedDate, DAY);
  assert.equal(byId['leave-me'].date, DAY);
  assert.equal(byId.completed.date, DAY);
  assert.equal(byId.completed.done, true);
  assert.equal(ui.node('editor').open, false);
});

test('move preview requires a selection and retains fixed-time conflicts after confirmation', async () => {
  const tomorrow = '2026-10-24';
  const ui = createUI([
    dayTask('source-fixed', { title: 'Исходная встреча', time: '10:00', duration: 60 }),
    dayTask('tomorrow-fixed', { title: 'Уже назначено', date: tomorrow, time: '10:00', duration: 60 }),
  ]);
  ui.navigate('#day');
  ui.click('move-preview');
  assert.match(ui.fields(), /Есть пересечения по времени/);
  assert.match(ui.fields(), /Не помещается: 1/);
  assert.equal(ui.writes.length, 0);
  ui.change({ moveTask: 'source-fixed' }, false);
  await ui.submit({}, /Выбери хотя бы одно дело/);
  assert.equal(ui.writes.length, 0);
  ui.change({ moveTask: 'source-fixed' }, true);
  await ui.submit({});
  assert.equal(ui.records('task').find(record => record.id === 'source-fixed').time, '10:00');
  assert.equal(ui.records('task').find(record => record.id === 'tomorrow-fixed').time, '10:00');
  assert.match(taskMarkup(ui, 'source-fixed'), /Не влезло/);
  assert.match(ui.html(), /пересекаются с другими встречами/);
});

test('cross-month move assigns new persistence IDs and never regenerates the original recurring occurrence', async () => {
  const from = '2026-10-31';
  const rule = recurring({ weekdays: [6], startDate: from });
  const id = planner.routineTaskId(rule.id, from);
  const savedOccurrence = dayTask(id, {
    title: 'Особое занятие', date: from, routineId: rule.id, occurrenceDate: from, priority: 0,
  });
  const goal = { id: 'october-goal', kind: 'goal', month: MONTH, title: 'Октябрьская цель' };
  const ui = createUI([rule, savedOccurrence, goal, dayTask('ordinary', { date: from, goalId: goal.id })]);
  ui.navigate('#day'); changeDay(ui, from);
  ui.click('move-preview');
  assert.equal(ui.writes.length, 0);
  await ui.submit({});
  const tasks = ui.records('task');
  assert.equal(tasks.length, 2);
  assert.ok(tasks.every(record => record.month === '2026-11' && record.date === '2026-11-01'));
  assert.ok(tasks.every(record => record.id !== id && record.id !== 'ordinary'));
  assert.equal(tasks.find(record => record.title === 'ordinary').goalId, '', 'a monthly goal link is cleared when its step moves to another month');
  const movedOccurrence = tasks.find(record => record.routineId === rule.id);
  assert.equal(movedOccurrence.occurrenceDate, from);
  assert.equal(movedOccurrence.priority, 0);
  assert.equal(planner.tasksForDay(ui.records(), from).length, 0);
  assert.equal(planner.tasksForDay(ui.records(), '2026-11-01').length, 2);
  assert.equal(planner.tasksForDay(ui.records(), '2026-11-07').length, 1);
  assert.deepEqual(ui.periods.at(-1), { month: '2026-11', day: '2026-11-01' });
});

test('stopping a recurring series preserves history and separately edited future occurrences', async () => {
  const rule = recurring({ startDate: '2026-10-16' });
  const futureDate = '2026-10-30';
  const exception = dayTask('special-future', { date: futureDate, routineId: rule.id, occurrenceDate: futureDate });
  const ui = createUI([rule, exception]);
  ui.navigate('#day');
  ui.click('stop-routine', rule.id);
  assert.equal(ui.writes.length, 0, 'opening the stop confirmation does not alter the series');
  await ui.submit({});
  assert.equal(ui.records('routine')[0].untilDate, '2026-10-22');
  assert.equal(planner.tasksForDay(ui.records(), '2026-10-16').length, 1);
  assert.equal(planner.tasksForDay(ui.records(), DAY).length, 0);
  assert.equal(planner.tasksForDay(ui.records(), futureDate)[0].id, exception.id);
  assert.equal(planner.tasksForDay(ui.records(), '2026-11-06').length, 0);
  await ui.node('undoButton').fire('click');
  assert.deepEqual(ui.records('routine')[0], rule);
  assert.equal(planner.tasksForDay(ui.records(), '2026-11-06').length, 1);
});

test('stopping before the series begins retains valid dates and prevents future generation', async () => {
  const rule = recurring({ startDate: '2026-11-06' });
  const ui = createUI([rule]);
  ui.navigate('#day'); ui.click('stop-routine', rule.id);
  await ui.submit({});
  const stopped = ui.records('routine')[0];
  assert.equal(stopped.active, false);
  assert.equal(stopped.startDate, rule.startDate);
  assert.equal(planner.validateRoutine(stopped).valid, true);
  assert.equal(planner.tasksForDay(ui.records(), rule.startDate).length, 0);
});

test('synchronization during move preview requires review before applying the changed plan', async () => {
  const ui = createUI([dayTask('to-move')]);
  ui.navigate('#day');
  ui.click('move-preview');
  ui.upsert(dayTask('arrived-from-phone', { title: 'Встреча с телефона', date: '2026-10-24', time: '09:00', duration: 60 }));
  await ui.submit({}, /План изменился после синхронизации/);
  assert.equal(ui.writes.length, 0);
  assert.equal(ui.records('task').find(record => record.id === 'to-move').date, DAY);
  assert.match(ui.fields(), /Встреча с телефона/);
  await ui.submit({});
  assert.equal(ui.records('task').find(record => record.id === 'to-move').date, '2026-10-24');
  assert.equal(ui.records('task').find(record => record.id === 'arrived-from-phone').time, '09:00');
});

test('changing accounts closes a pending move preview and prevents saving into the new account', () => {
  const ui = createUI([dayTask('alice-task')]);
  ui.account('alice', [dayTask('alice-task')]);
  ui.navigate('#day'); ui.click('move-preview');
  assert.equal(ui.node('editor').open, true);
  ui.account('bob');
  assert.equal(ui.node('editor').open, false);
  assert.equal(ui.records().length, 0);
  assert.equal(ui.writes.length, 0);
  assert.match(ui.node('toastText').textContent, /Аккаунт изменился/);
});

test('weekly route combines task progress and separate currency totals within the selected week', () => {
  const ui = createUI([
    { id: 'goal', kind: 'goal', month: MONTH, title: 'Учиться', target: 0 },
    dayTask('finished', { title: 'Завершённый шаг', date: '2026-10-20', done: true, goalId: 'goal', completedDate: '2026-10-20' }),
    dayTask('pending', { title: 'Важный шаг', date: '2026-10-22', priority: 2, goalId: 'goal', moveCount: 3, lastMovedDate: '2026-10-22' }),
    { id: 'monthly-salary', kind: 'budget', month: MONTH, income: 2000, currency: 'BYN' },
    { id: 'byn-expense', kind: 'expense', month: MONTH, date: DAY, amount: 100, currency: 'BYN', category: 'essentials' },
    { id: 'usd-expense', kind: 'expense', month: MONTH, date: DAY, amount: 5, currency: 'USD', category: 'flexible' },
    { id: 'rub-expense', kind: 'expense', month: MONTH, date: DAY, amount: 200, currency: 'RUB', category: 'reserve' },
    { id: 'gift', kind: 'income', month: MONTH, date: DAY, amount: 50, currency: 'BYN' },
    { id: 'usd-income', kind: 'income', month: MONTH, date: DAY, amount: 10, currency: 'USD' },
    { id: 'outside-week', kind: 'expense', month: MONTH, date: '2026-10-18', amount: 999, currency: 'BYN', category: 'flexible' },
  ]);
  ui.navigate('#week');
  assert.match(ui.html(), /Неделя в деталях/);
  assert.equal(statValue(ui, 'Дела выполнены'), '1 / 2');
  assert.equal(statValue(ui, 'Время на выполненное'), '30 мин');
  assert.match(ui.html(), /На этой неделе 1 из 2 шагов/);
  assert.match(ui.html(), /3 переносов за всё время/);
  assert.match(ui.html(), /Важный шаг/);
  for (const amount of ['100 BYN', '50 BYN', '5 USD', '10 USD', '200 RUB']) assert.ok(ui.html().includes(amount), amount);
  assert.doesNotMatch(ui.html(), /999 BYN|2 000 BYN/);
  ui.click('currency', 'USD');
  assert.match(ui.html(), /100 BYN/);
  assert.match(ui.html(), /200 RUB/);
  ui.click('prev-week');
  assert.equal(statValue(ui, 'Дела выполнены'), '0 / 0');
  assert.match(ui.html(), /999 BYN/);
  assert.doesNotMatch(ui.html(), /100 BYN/);
  ui.click('next-week');
  ui.click('report-day', '2026-10-22');
  assert.match(ui.html(), /День в твоём ритме/);
  assert.ok(taskMarkup(ui, 'pending'));
});
