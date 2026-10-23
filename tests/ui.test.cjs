const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../assistant-core.js');
const extras = require('../assistant-extras.js');

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
    put(record) { current.records[record.id] = clone(record); publish(); },
    remove(id) { delete current.records[id]; publish(); },
    setPeriod(month, day) { periods.push({ month, day }); },
    init: async () => {}, signInOut: async () => {}
  };
  const location = { hash: '#money' };
  const window = {
    HVFCore: core, HVFExtras: extras, HVFStore: store,
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
    node, periods,
    records: kind => Object.values(clone(current.records)).filter(record => !kind || record.kind === kind),
    html: () => normalize(node('content').innerHTML),
    fields: () => normalize(node('dialogFields').innerHTML),
    click(action, id) {
      const target = { dataset: { action, id }, disabled: false };
      documentEvents.get('click')({ target: { closest: () => target } });
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
