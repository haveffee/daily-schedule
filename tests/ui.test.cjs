const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../assistant-core.js');
const extras = require('../assistant-extras.js');
const planner = require('../assistant-planner.js');
const weekly = require('../assistant-weekly.js');
const categories = require('../assistant-categories.js');
const forecast = require('../assistant-forecast.js');
const backup = require('../assistant-backup.js');
const navigation = require('../assistant-navigation.js');
const motion = require('../assistant-motion.js');
const limits = require('../assistant-limits.js');
const focusModule = require('../assistant-focus.js');

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
  const downloads = [];
  const blobs = new Map();
  const contentWrites = [];
  const scrolls = [];
  const addListener = (registry,type,callback) => {
    const handlers=registry.get(type)||[];handlers.push(callback);registry.set(type,handlers);
  };
  const removeListener = (registry,type,callback) => registry.set(type,(registry.get(type)||[]).filter(handler=>handler!==callback));
  const emit = (registry,type,event={}) => {
    for(const handler of [...registry.get(type)||[]])handler(event);
  };
  let timerNow = Date.parse(DAY+'T09:00:00Z');
  let timerTick = () => {};
  const timerData = new Map();
  const focus = focusModule.createTimer({now:()=>timerNow,
    storage:{getItem:key=>timerData.get(key)||null,setItem:(key,value)=>timerData.set(key,value)},
    setInterval:fn=>{timerTick=fn;return 1;},clearInterval(){}});

  function node(id) {
    if (nodes.has(id)) return nodes.get(id);
    const listeners = new Map();
    const classes = new Set();
    const el = {
      id, innerHTML: '', innerHTMLWrites:0, textContent: '', hidden: false, value: '', open: false,
      disabled: false, dataset: {}, offsetWidth: 0,
      classList: {
        add: (...names) => names.forEach(name=>classes.add(name)), remove: (...names) => names.forEach(name=>classes.delete(name)),
        contains: name => classes.has(name),
        toggle(name, enabled) {
          const add = enabled === undefined ? !classes.has(name) : enabled;
          if (add) classes.add(name); else classes.delete(name);
          return add;
        }
      },
      style:{setProperty(name,value){el[name]=value;},removeProperty(name){delete el[name];}},
      addEventListener(type, callback) {
        const callbacks = listeners.get(type) || [];
        callbacks.push(callback); listeners.set(type, callbacks);
      },
      removeEventListener(type,callback){listeners.set(type,(listeners.get(type)||[]).filter(fn=>fn!==callback));},
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
    let html='';
    Object.defineProperty(el,'innerHTML',{
      get(){return html;},set(value){html=String(value);el.innerHTMLWrites++;if(id==='content')contentWrites.push(html);}
    });
    nodes.set(id, el);
    return el;
  }

  const publish = () => subscribers.forEach(callback => callback(clone(current)));
  const store = {
    getState: () => clone(current),
    subscribe(callback) { subscribers.push(callback); },
    put(record) { writes.push({ action: 'put', record: clone(record) }); current.records[record.id] = clone(record); publish(); },
    putMany(records, options={}) {
      if(options.expectedOwner!==undefined&&options.expectedOwner!==(current.user?.uid||'anonymous'))throw new Error('Аккаунт изменился.');
      for(const record of records){const old=current.records[record.id];if(old&&(old.month!==record.month||old.kind!==record.kind))throw new Error('Несовместимая запись.');}
      for(const record of records){writes.push({action:'put',record:clone(record)});current.records[record.id]=clone(record);}publish();return clone(records);
    },
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
    HVFPWA: options.pwa, HVFReminders: options.reminders,
    HVFCategories: categories, HVFForecast: forecast, HVFBackup: backup, HVFLimits: limits, HVFFocus: focus,
    HVFNavigation:options.navigation||navigation, HVFMotion:motion, PointerEvent:function(){},innerWidth:options.mobile?390:1200,
    matchMedia:query=>({matches:query.includes('reduced-motion')?!!options.reduced:!!options.mobile}),
    addEventListener(type, callback) { addListener(windowEvents,type,callback); },
    removeEventListener(type,callback){removeListener(windowEvents,type,callback);},
    scrollTo(value) {scrolls.push(clone(value));this.scrollY=value.top;},scrollY:0
  };
  const document = {
    getElementById: node, querySelectorAll: () => [],
    createElement:()=>({click(){downloads.push({name:this.download,blob:blobs.get(this.href)});}}),
    addEventListener(type, callback) { addListener(documentEvents,type,callback); },
    removeEventListener(type,callback){removeListener(documentEvents,type,callback);},
    documentElement:node('documentElement'),visibilityState:'visible'
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
    document, window, location, FormData, Date: FixedDate, Intl, Blob,
    URL:{createObjectURL(blob){const id='blob:'+blobs.size;blobs.set(id,blob);return id;},revokeObjectURL(){}},
    crypto: { randomUUID: () => 'ui-' + (++sequence) },
    setTimeout: () => ++sequence, clearTimeout() {}
  }, { filename: 'assistant-ui.js' });

  return {
    node, periods, writes, focus, downloads,contentWrites,scrolls,
    contentWriteCount:()=>contentWrites.length,
    scrollTop:()=>window.scrollY,
    scrollTo(value){window.scrollY=value;},
    elapse(ms) {timerNow+=ms;timerTick();return focus.getState();},
    form(id,values) {emit(documentEvents,'submit',{target:{id,values},preventDefault(){}});},
    records: kind => Object.values(clone(current.records)).filter(record => !kind || record.kind === kind),
    html: () => normalize(node('content').innerHTML),
    fields: () => normalize(node('dialogFields').innerHTML),
    click(action, id) {
      const target = { dataset: { action, id }, disabled: false };
      const previousHash = location.hash;
      emit(documentEvents,'click',{ target: { closest: () => target },preventDefault(){} });
      if (location.hash !== previousHash) emit(windowEvents,'hashchange');
    },
    change(dataset, checked, extra = {}) { emit(documentEvents,'change',{ target: { dataset, checked, ...extra } }); },
    upsert(record) { current.records[record.id] = clone(record); publish(); },
    status(status,error=''){current={...current,status,error};publish();},
    publish(){publish();},
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
    navigate(hash) { location.hash = hash; emit(windowEvents,'hashchange'); },
    windowEvent(type, event = {}) {const before=location.hash;emit(windowEvents,type,event);if(location.hash!==before&&type!=='hashchange')emit(windowEvents,'hashchange');},
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

test('task reminders require an explicit start time, persist their lead, and can be turned off', async () => {
  const ui = createUI();
  ui.click('add-task');
  assert.match(ui.fields(), /name="reminderMinutes"/);
  await ui.submit(taskFields({ title: 'Позвонить', reminderMinutes: '15' }), /укажи время начала/);
  assert.equal(ui.records('task').length, 0);
  await ui.submit(taskFields({ title: 'Позвонить', time: '18:00', reminderMinutes: '15' }));
  const task = ui.records('task')[0];
  assert.equal(task.reminderMinutes, 15);
  ui.navigate('#day');
  assert.match(taskMarkup(ui, task.id), /За 15 мин/);
  ui.click('edit-task', task.id);
  await ui.submit(taskFields({ title: 'Позвонить', time: '18:00', reminderMinutes: '-1' }));
  assert.equal(ui.records('task')[0].reminderMinutes, null);
  assert.doesNotMatch(taskMarkup(ui, task.id), /reminder-tag/);
});

test('notification navigation preserves an open editor and opens its target day after saving', async () => {
  const ui = createUI([dayTask('future', { month: '2026-11', date: '2026-11-01' })]);
  ui.click('add-task');
  ui.windowEvent('hvf-open-reminder', { detail: { date: '2026-11-01' } });
  assert.equal(ui.node('editor').open, true);
  assert.match(ui.node('toastText').textContent, /после закрытия формы/);
  await ui.submit(taskFields({ title: 'Не потерять запись' }));
  assert.ok(ui.records('task').some(t => t.title === 'Не потерять запись' && t.date === DAY));
  assert.deepEqual(ui.periods.at(-1), { month: '2026-11', day: '2026-11-01' });
  assert.match(ui.html(), /День в твоём ритме/);
  assert.ok(taskMarkup(ui, 'future'));
});

test('reminder setup and a test notification run only through their explicit controls', async () => {
  const calls = [];
  const ui = createUI([], { reminders: {
    init: async () => { calls.push('init'); }, subscribe() {},
    getStatus: () => ({ supported: true, configured: true, enabled: true, message: 'Напоминания включены' }),
    enable: async () => { calls.push('enable'); return true; },
    disable: async () => { calls.push('disable'); return true; },
    test: async () => { calls.push('test'); return true; }
  } });
  ui.account('alice'); ui.navigate('#settings');
  assert.deepEqual(calls, ['init']);
  assert.match(ui.node('remindersPanel').innerHTML, /Напоминания включены/);
  ui.click('test-reminders'); await Promise.resolve();
  assert.deepEqual(calls, ['init', 'test']);
  ui.click('disable-reminders'); await Promise.resolve();
  assert.deepEqual(calls, ['init', 'test', 'disable']);
});

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

test('Qwen controls and generic goal generation are gone while saved steps survive', () => {
  const ui=createUI([
    {id:'goal',kind:'goal',month:MONTH,title:'Поступить',outcome:'Сдать экзамен'},
    {id:'old-step',kind:'task',month:MONTH,date:DAY,title:'Сохранённый шаг',duration:30,estimated:true,estimateSource:'qwen',goalId:'goal'}
  ]);
  ui.navigate('#settings');assert.doesNotMatch(ui.html(),/Qwen|aiEnabled|aiStatus/);
  ui.navigate('#goals');assert.match(ui.html(),/Добавить шаг/);assert.doesNotMatch(ui.html(),/plan-goal|Разбить на шаги/);
  ui.navigate('#day');assert.match(ui.html(),/Сохранённый шаг/);assert.match(ui.html(),/Примерное время/);assert.doesNotMatch(ui.html(),/Qwen/);
  assert.equal(ui.records('task').length,1);assert.equal(ui.writes.length,0);
});

test('day has a single task entry without the redundant quick form', () => {
  const ui=createUI();ui.navigate('#day');assert.doesNotMatch(ui.html(),/quickTaskForm|quickText|Быстро записать/);ui.click('add-task');assert.equal(ui.node('dialogTitle').textContent,'Новое дело');
});

test('ready categories and vector icons are available without creating user records or money', () => {
  const ui=createUI();
  for(const title of ['Продукты','Кафе','Транспорт','Одежда','Развлечения','Здоровье','Дом','Подписки'])assert.ok(ui.html().includes('<h3>'+title+'</h3>'),title);
  assert.match(ui.html(),/data-category-icon="food"/);assert.match(ui.html(),/data-category-icon="shirt"/);
  assert.equal(ui.writes.length,0);assert.equal(ui.records().length,0);assert.equal(statValue(ui,'Все поступления'),'0 BYN');
  ui.click('add-expense');assert.match(ui.fields(),/value="category:category-default-food"/);
});

test('a ready category can be customized, archived and restored without reappearing as a duplicate', async () => {
  const ui=createUI();ui.click('edit-category','category-default-clothing');
  assert.equal(ui.node('dialogTitle').textContent,'Изменить категорию');assert.match(ui.fields(),/value="shirt" checked/);
  await ui.submit({title:'Моя одежда',envelope:'essentials',icon:'tag'});
  const [edited]=ui.records('expense-category');assert.equal(edited.id,'category-default-clothing');assert.equal(edited.icon,'tag');
  assert.ok(!categories.list(ui.records()).some(c=>c.title==='Одежда'));
  ui.click('archive-category',edited.id);await ui.submit({});
  assert.equal(categories.list(ui.records()).some(c=>c.id===edited.id),false);
  ui.upsert({id:'unrelated',kind:'income',month:MONTH,date:DAY,title:'Подарок',currency:'BYN',amount:10});
  assert.equal(categories.list(ui.records()).some(c=>c.id===edited.id),false);
  ui.click('restore-category',edited.id);assert.equal(categories.list(ui.records()).find(c=>c.id===edited.id).title,'Моя одежда');
});

test('preset expenses save their icon and keep legacy expenses unclassified', async () => {
  const legacy={id:'legacy',kind:'expense',month:MONTH,date:DAY,title:'Раньше',amount:5,currency:'BYN',category:'flexible'};
  const ui=createUI([legacy]);ui.click('add-expense');
  await ui.submit({title:'Хлеб',amount:'2.5',date:DAY,currency:'BYN',category:'category:category-default-food'});
  const food=ui.records('expense').find(r=>r.title==='Хлеб');assert.equal(food.expenseCategoryId,'category-default-food');assert.equal(food.expenseCategoryIcon,'food');assert.equal(food.category,'essentials');
  assert.equal(ui.records('expense').find(r=>r.id==='legacy').expenseCategoryId,undefined);
  ui.click('edit-category','category-default-food');await ui.submit({title:'Еда дома',envelope:'essentials',icon:'coffee'});
  assert.equal(categories.classification(food,ui.records()).title,'Еда дома');assert.equal(ui.records('expense').find(r=>r.id===food.id).amount,2.5);
});

test('custom categories retain a selected icon and reject unsafe icon values', async () => {
  const ui=createUI();ui.click('add-category');
  await ui.submit({title:'Подарки',envelope:'flexible',icon:'film'});
  const [custom]=ui.records('expense-category');assert.equal(custom.icon,'film');assert.equal(categories.list(ui.records()).length,9);
  ui.click('edit-category',custom.id);await ui.submit({title:'Подарки',envelope:'flexible',icon:'<svg>'},/значок из списка/);
  assert.equal(ui.records('expense-category')[0].icon,'film');
});

test('a deliberate touch swipe changes sections and a modal prevents it without data writes', async () => {
  const ui=createUI([],{mobile:true});ui.navigate('#day');
  const swipe=async(time)=>{
    await ui.node('content').fire('pointerdown',{pointerType:'touch',pointerId:1,isPrimary:true,button:0,clientX:250,clientY:300,timeStamp:time});
    ui.windowEvent('pointermove',{pointerId:1,clientX:120,clientY:304,timeStamp:time+120});
    ui.windowEvent('pointerup',{pointerId:1,clientX:100,clientY:305,timeStamp:time+180});
  };
  await swipe(1000);assert.match(ui.html(),/Твои большие/);assert.equal(ui.writes.length,0);
  ui.navigate('#day');ui.click('add-task');const fields=ui.fields();await swipe(3000);
  assert.match(ui.html(),/День в твоём ритме/);assert.equal(ui.fields(),fields);assert.equal(ui.node('editor').open,true);
});

test('first-run wizard reviews three steps and saves linked data only at the end', async () => {
  const ui=createUI();ui.navigate('#overview');assert.match(ui.html(),/Начни со своего дня и бюджета/);
  ui.click('start-onboarding');assert.match(ui.node('dialogTitle').textContent,/шаг 1 из 3/);
  await ui.submit({currency:'BYN',salary:'1000',nextDate:'2026-10-30',expectedAmount:'1200'});
  assert.equal(ui.records().length,0);assert.equal(ui.node('editor').open,true);
  await ui.submit({goalTitle:'Подготовиться',outcome:'Решить пять вариантов'});
  assert.equal(ui.records().length,0);assert.match(ui.fields(),/Будет сохранено/);
  await ui.submit({taskTitle:'Решить первый вариант',duration:'45',start:'10:00',end:'20:00'});
  assert.equal(ui.node('editor').open,false);assert.equal(ui.records('budget')[0].income,1000);
  assert.equal(ui.records('income-plan')[0].expectedAmount,1200);
  assert.equal(ui.records('task')[0].goalId,ui.records('goal')[0].id);
  assert.equal(ui.records('task')[0].duration,45);assert.equal(ui.records('settings')[0].start,'10:00');
  assert.equal(ui.records('onboarding-preferences')[0].completed,true);
  ui.navigate('#money');assert.equal(statValue(ui,'Все поступления'),'1 000 BYN');
  ui.navigate('#overview');assert.doesNotMatch(ui.html(),/Начни со своего дня и бюджета/);
});

test('wizard cancellation and optional fields never generate example records', async () => {
  const ui=createUI();ui.click('start-onboarding');
  await ui.submit({currency:'BYN',salary:'',nextDate:'',expectedAmount:''});
  await ui.node('cancelDialog').fire('click');assert.equal(ui.writes.length,0);
  ui.click('start-onboarding');
  await ui.submit({currency:'USD',salary:'',nextDate:'',expectedAmount:''});
  await ui.submit({goalTitle:'',outcome:''});
  await ui.submit({taskTitle:'',duration:'',start:'09:00',end:'22:00'});
  for(const kind of ['task','goal','budget','income-plan'])assert.equal(ui.records(kind).length,0,kind);
  assert.equal(ui.records('finance-preferences')[0].currency,'USD');
});

test('wizard validates amounts, dates and rhythm before any data is written', async () => {
  const ui=createUI();ui.click('start-onboarding');
  await ui.submit({currency:'BYN',salary:'Infinity',nextDate:'',expectedAmount:''},/Укажи сумму/);
  await ui.submit({currency:'BYN',salary:'100',nextDate:'2026-02-30',expectedAmount:''},/дату/);
  await ui.submit({currency:'BYN',salary:'100',nextDate:'',expectedAmount:''});
  await ui.submit({goalTitle:'Цель',outcome:''});
  await ui.submit({taskTitle:'Дело',duration:'30',start:'20:00',end:'09:00'},/Конец дня/);
  assert.equal(ui.writes.length,0);ui.account('other');assert.equal(ui.node('editor').open,false);
});

const settleUI=async()=>{for(let i=0;i<4;i++)await new Promise(resolve=>setImmediate(resolve));};
async function openBackup(ui,records) {
  const text=JSON.stringify(backup.create(records));
  ui.change({},false,{id:'backupFile',files:[{name:'my-copy.json',size:text.length,text:async()=>text}]});
  await settleUI();
}

test('restore previews full copies and merge preserves differing existing records', async () => {
  const existing=dayTask('same',{title:'Текущая версия'}),old={id:'old',kind:'income',month:'2026-09',date:'2026-09-10',title:'Подработка',amount:50,currency:'BYN'};
  const ui=createUI([existing]);
  await openBackup(ui,[{...existing,title:'Из копии'},old]);
  assert.match(ui.fields(),/my-copy.json/);assert.match(ui.fields(),/Пропустить совпадения/);assert.equal(ui.writes.length,0);
  await ui.submit({});
  assert.equal(ui.records('task')[0].title,'Текущая версия');assert.equal(ui.records('income')[0].month,'2026-09');
  assert.match(ui.node('toastText').textContent,/Восстановлено записей: 1/);
});

test('restore replaces only explicitly selected collisions and rechecks changed account data', async () => {
  const t=dayTask('same',{title:'Сейчас'}),ui=createUI([t,dayTask('unrelated')]);
  await openBackup(ui,[{...t,title:'Из копии'}]);
  ui.change({},true,{id:'replaceExisting'});assert.match(ui.fields(),/будет заменено/);
  ui.upsert({...t,title:'Изменено на телефоне'});
  await ui.submit({replaceExisting:'on'},/Данные или режим изменились/);
  assert.equal(ui.records('task').find(r=>r.id==='same').title,'Изменено на телефоне');
  await ui.submit({replaceExisting:'on'});
  assert.equal(ui.records('task').find(r=>r.id==='same').title,'Из копии');assert.equal(ui.records('task').length,2);
});

test('corrupt copies and account switching do not restore data', async () => {
  const ui=createUI();ui.change({},false,{id:'backupFile',files:[{size:4,text:async()=>'{bad'}]});await settleUI();
  assert.equal(ui.node('editor').open,false);assert.equal(ui.writes.length,0);
  await openBackup(ui,[dayTask('new')]);ui.account('other');assert.equal(ui.node('editor').open,false);assert.equal(ui.writes.length,0);
});

test('a slow backup file never replaces an editor opened while it is being read', async () => {
  const ui=createUI();let finish;
  const wait=new Promise(resolve=>finish=resolve);
  ui.change({},false,{id:'backupFile',files:[{size:100,text:()=>wait}]});
  ui.click('add-task');const fields=ui.fields();finish(JSON.stringify(backup.create([dayTask('from-file')])));await settleUI();
  assert.equal(ui.fields(),fields);assert.equal(ui.node('dialogTitle').textContent,'Новое дело');assert.equal(ui.writes.length,0);
  assert.match(ui.node('toastText').textContent,/Закрой открытую форму/);
});

test('full export contains all months and global categories without auth credentials', async () => {
  const ui=createUI([dayTask('today'),{...dayTask('old'),month:'2026-09',date:'2026-09-10'},{id:'category-food',kind:'expense-category',month:'2000-03',title:'Еда',envelope:'flexible',archived:false}]);
  ui.account('alice',ui.records());ui.click('export');assert.equal(ui.downloads.length,1);
  const exported=JSON.parse(await ui.downloads[0].blob.text());assert.equal(exported.scope,'all');assert.equal(exported.records.length,3);
  assert.equal(exported.user,undefined);assert.equal(exported.records.some(r=>r.id==='category-food'),true);
});

test('custom categories classify expenses, preserve past envelopes and survive archiving across months', async () => {
  const ui=createUI();ui.click('add-category');await ui.submit({title:'Еда',envelope:'flexible'});
  const [category]=ui.records('expense-category');assert.match(category.id,/^category-/);
  ui.click('add-expense');assert.match(ui.fields(),/Еда · Свободные деньги/);
  await ui.submit({title:'Продукты',amount:'20',date:DAY,currency:'BYN',category:'category:'+category.id});
  const [expense]=ui.records('expense');assert.equal(expense.category,'flexible');assert.equal(expense.expenseCategoryId,category.id);
  ui.click('edit-category',category.id);await ui.submit({title:'Продукты и еда',envelope:'essentials'});
  assert.equal(ui.records('expense')[0].category,'flexible');assert.match(ui.html(),/Продукты и еда/);
  ui.click('archive-category',category.id);await ui.submit({});
  ui.click('edit-expense',expense.id);assert.match(ui.fields(),/Продукты и еда \(архив\)/);
  await ui.submit({title:'Продукты',amount:'20',date:'2026-11-02',currency:'BYN',category:'category:'+category.id});
  const [moved]=ui.records('expense');assert.equal(moved.month,'2026-11');assert.equal(moved.expenseCategoryId,category.id);assert.equal(moved.category,'flexible');
  ui.click('restore-category',category.id);assert.equal(ui.records('expense-category')[0].archived,false);
});

test('category creation rejects duplicates and custom limits count only their category', async () => {
  const category={id:'category-food',kind:'expense-category',month:'2000-03',title:'Еда',envelope:'flexible',archived:false};
  const ui=createUI([category,{id:'food',kind:'expense',month:MONTH,date:DAY,title:'Хлеб',amount:20,currency:'BYN',category:'flexible',expenseCategoryId:category.id,expenseCategoryTitle:'Еда'},{id:'other',kind:'expense',month:MONTH,date:DAY,title:'Досуг',amount:50,currency:'BYN',category:'flexible'}]);
  ui.click('add-category');await ui.submit({title:' еда ',envelope:'flexible'},/уже существует/);await ui.node('cancelDialog').fire('click');
  ui.click('edit-limit','limit-'+MONTH+'-BYN-'+category.id);await ui.submit({amount:'25',warningPercent:'80'});
  const row=limits.summarize(ui.records(),{month:MONTH,currency:'BYN'}).find(r=>r.category===category.id);assert.equal(row.spent,20);assert.equal(row.status,'near');
  assert.match(ui.html(),/Лимиты расходов/);
});

test('legacy unlinked goal expenses retain their budget group when edited', async () => {
  const ui=createUI([{id:'legacy',kind:'expense',month:MONTH,date:DAY,title:'Для цели',amount:10,currency:'BYN',category:'goal'}]);
  ui.click('edit-expense','legacy');assert.match(ui.fields(),/value="goals" selected/);
  await ui.submit({title:'Для цели',amount:'15',date:DAY,currency:'BYN',category:'goals'});
  assert.equal(ui.records('expense')[0].category,'goals');
});

test('income forecast has an actionable date, excludes the expected amount and ignores viewed history month', async () => {
  const ui=createUI();await salary(ui,1000,'0','0');ui.click('edit-income-plan');
  await ui.submit({nextDate:'2026-11-02',expectedAmount:'2000'});
  assert.equal(statValue(ui,'Все поступления'),'1 000 BYN');assert.match(ui.html(),/100 BYN в день/);
  assert.match(ui.html(),/Ожидается 2 000 BYN/);await ui.setMonth('2026-09');
  assert.equal(statValue(ui,'Все поступления'),'0 BYN');assert.match(ui.html(),/100 BYN в день/);
  ui.click('currency','USD');assert.match(ui.html(),/Когда следующее поступление/);assert.doesNotMatch(ui.html(),/100 USD в день/);
});

test('future-dated receipts and expenses do not inflate today balances but affect the forecast', () => {
  const ui=createUI([
    {id:'budget-'+MONTH+'-BYN',kind:'budget',month:MONTH,currency:'BYN',income:1000,reservePercent:0,goalsPercent:0},
    {id:'future-income',kind:'income',month:MONTH,date:'2026-10-26',title:'Будущий подарок',amount:500,currency:'BYN'},
    {id:'future-expense',kind:'expense',month:MONTH,date:'2026-10-24',title:'Платёж завтра',amount:100,currency:'BYN',category:'flexible'},
    {id:'income-plan-BYN',kind:'income-plan',month:'2000-04',currency:'BYN',nextDate:'2026-10-28',expectedAmount:2000}
  ]);
  assert.equal(statValue(ui,'Все поступления'),'1 000 BYN');assert.equal(statValue(ui,'Всего осталось'),'1 000 BYN');
  assert.match(ui.html(),/180 BYN в день/);assert.match(ui.html(),/Запланировано/);
});

test('focus pauses, resumes and finishes without completing the task or clearing an open editor', async () => {
  const ui=createUI([dayTask('focus-me',{title:'Один раздел'})]);
  ui.click('focus-task','focus-me');await ui.submit({minutes:'25'});
  assert.equal(ui.focus.getState().phase,'running');assert.match(ui.html(),/Место для фокуса/);
  ui.click('add-task');const fields=ui.fields(),content=ui.html();
  ui.elapse(60000);assert.equal(ui.node('focusTime').textContent,'24:00');
  assert.equal(ui.html(),content);assert.equal(ui.fields(),fields);assert.equal(ui.node('editor').open,true);
  await ui.node('cancelDialog').fire('click');
  ui.click('focus-pause');ui.elapse(60000);assert.equal(ui.focus.getState().remainingMs,24*60000);
  ui.click('focus-resume');ui.elapse(24*60000);assert.equal(ui.focus.getState().phase,'finished');
  assert.equal(ui.records('task')[0].done,false);assert.match(ui.html(),/Перерыв 5 мин/);
  ui.click('focus-break','5');assert.equal(ui.focus.getState().mode,'break');assert.equal(ui.focus.getState().remainingMs,300000);
  assert.equal(ui.records('task')[0].done,false);
});

test('account changes isolate focus and close a stale focus editor', async () => {
  const t=dayTask('focus-me');const ui=createUI([t]);
  ui.click('focus-task',t.id);await ui.submit({minutes:'15'});ui.elapse(60000);
  ui.click('focus-task',t.id);assert.equal(ui.node('editor').open,true);
  ui.account('other',[t]);assert.equal(ui.node('editor').open,false);assert.equal(ui.focus.getState().phase,'idle');
  ui.account(null,[t]);assert.equal(ui.focus.getState().phase,'running');assert.equal(ui.focus.getState().remainingMs,14*60000);
  assert.equal(ui.writes.length,0);
});

test('finishing focus leaves the settings form untouched', async () => {
  const ui=createUI([dayTask('one-minute')]);ui.click('focus-task','one-minute');await ui.submit({minutes:'1'});
  ui.navigate('#settings');ui.node('content').innerHTML+='<!-- unsaved form state sentinel -->';
  const settingsHTML=ui.html();ui.elapse(60000);
  assert.equal(ui.focus.getState().phase,'finished');assert.equal(ui.html(),settingsHTML);
  assert.match(ui.node('toastText').textContent,/Время фокуса вышло/);
});

test('category limit keeps its captured ledger when synced currency preferences change', async () => {
  const ui=createUI();ui.click('edit-limit','limit-'+MONTH+'-BYN-flexible');
  ui.upsert({id:'finance-preferences',kind:'finance-preferences',month:'2000-01',currency:'USD'});
  await ui.submit({amount:'100',warningPercent:'80'});
  const [limit]=ui.records('spending-limit');assert.equal(limit.currency,'BYN');assert.equal(limit.month,MONTH);assert.equal(limit.id,'limit-'+MONTH+'-BYN-flexible');
  ui.click('currency','BYN');assert.match(ui.html(),/из 100 BYN/);
  ui.click('edit-limit',limit.id);await ui.submit({amount:'100',warningPercent:'30'},/от 50 до 100/);
  assert.equal(ui.records('spending-limit')[0].warningPercent,80);
});

test('expense saves warn only on fresh limit crossings and limit deletion preserves expenses', async () => {
  const ui=createUI([{id:'limit-'+MONTH+'-BYN-flexible',kind:'spending-limit',month:MONTH,currency:'BYN',category:'flexible',amount:100,warningPercent:80}]);
  const add=async amount=>{ui.click('add-expense');await ui.submit({title:'Покупка',amount:String(amount),date:DAY,currency:'BYN',category:'flexible'});};
  await add(79);assert.doesNotMatch(ui.node('toastText').textContent,/достигнуто|израсходован/);
  await add(1);assert.match(ui.node('toastText').textContent,/80% лимита/);
  await add(1);assert.doesNotMatch(ui.node('toastText').textContent,/достигнуто|израсходован/);
  await add(19);assert.match(ui.node('toastText').textContent,/лимит израсходован/);
  assert.match(ui.html(),/Лимит израсходован/);
  ui.click('currency','USD');assert.doesNotMatch(ui.html(),/Лимит израсходован/);
  ui.click('currency','BYN');ui.click('delete','limit-'+MONTH+'-BYN-flexible');
  assert.equal(ui.records('spending-limit').length,0);assert.equal(ui.records('expense').length,4);assert.match(ui.node('toastText').textContent,/Расходы сохранены/);
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

test('cloud acknowledgements update sync chrome without replacing a scrolling day', () => {
  const task=dayTask('stable',{title:'Сохранённое дело'}),ui=createUI([task]);
  ui.account('alice',[task]);ui.navigate('#day');ui.scrollTo(740);
  const before=ui.contentWriteCount(),html=ui.html(),scrollCalls=ui.scrolls.length;
  ui.status('syncing');
  assert.equal(ui.node('syncShort').textContent,'Синхронизирую…');
  ui.status('synced');ui.publish();
  assert.equal(ui.node('syncShort').textContent,'Всё синхронизировано');
  assert.equal(ui.node('syncBadge').classList.contains('cloud-online'),true);
  assert.equal(ui.contentWriteCount(),before);
  assert.equal(ui.html(),html);
  assert.equal(ui.scrollTop(),740);
  assert.equal(ui.scrolls.length,scrollCalls);
});

test('settings status updates preserve the rhythm form, editor and scroll while refreshing account chrome', () => {
  const ui=createUI();ui.account('alice');ui.navigate('#settings');
  ui.node('rhythmForm').values={start:'11:15',end:'23:00',breakMinutes:'12'};
  ui.scrollTo(515);ui.click('add-task');
  const before=ui.contentWriteCount(),fields=ui.fields(),settings=ui.html();
  ui.status('loading');
  assert.equal(ui.node('accountButton').disabled,true);
  assert.equal(ui.node('backupFile').disabled,true);
  assert.match(ui.node('settingsAccountPanel').innerHTML,/Подключаю данные аккаунта/);
  ui.status('offline');
  assert.equal(ui.node('backupFile').disabled,false);
  assert.equal(ui.node('accountButton').disabled,false);
  assert.match(ui.node('settingsAccountPanel').innerHTML,/ожидают отправки/);
  ui.status('error','Проверка соединения');
  assert.equal(ui.node('syncDetail').textContent,'Проверка соединения');
  assert.match(ui.node('settingsAccountPanel').innerHTML,/Проверка соединения/);
  assert.equal(ui.contentWriteCount(),before);
  assert.equal(ui.html(),settings);
  assert.equal(ui.node('rhythmForm').values.start,'11:15');
  assert.equal(ui.fields(),fields);
  assert.equal(ui.node('editor').open,true);
  assert.equal(ui.scrollTop(),515);
});

test('fresh clones with identical record values keep content stable but changed records and routes render', () => {
  const task=dayTask('same-value',{title:'Первоначальный текст'}),ui=createUI([task]);
  ui.navigate('#day');
  const before=ui.contentWriteCount();
  ui.upsert(clone(task));ui.publish();
  assert.equal(ui.contentWriteCount(),before,'referential changes alone are not visual changes');
  ui.upsert({...task,title:'Изменено на телефоне'});
  assert.equal(ui.contentWriteCount(),before+1);
  assert.match(ui.html(),/Изменено на телефоне/);
  assert.doesNotMatch(ui.html(),/Первоначальный текст/);
  ui.navigate('#goals');assert.equal(ui.contentWriteCount(),before+2);
  ui.navigate('#day');assert.equal(ui.contentWriteCount(),before+3);
  ui.navigate('#day');assert.equal(ui.contentWriteCount(),before+3,'the same route must not replay a transition');
});

test('saving one task renders its store change once despite the explicit render after submit', async () => {
  const ui=createUI();ui.navigate('#day');ui.click('add-task');
  const before=ui.contentWriteCount();
  await ui.submit(taskFields({title:'Одна запись — одно обновление'}));
  assert.equal(ui.contentWriteCount(),before+1);
  assert.equal(ui.node('editor').open,false);
  assert.equal(ui.records('task').length,1);
  assert.match(ui.html(),/Одна запись — одно обновление/);
  ui.status('syncing');ui.status('synced');
  assert.equal(ui.contentWriteCount(),before+1,'the server acknowledgement must not rebuild the freshly saved page');
});

test('focus ticks update only the clock while pause and resume update controls once', async () => {
  const ui=createUI([dayTask('focused',{title:'Тихая работа'})]);
  ui.click('focus-task','focused');await ui.submit({minutes:'25'});
  const before=ui.contentWriteCount();
  ui.elapse(1000);ui.elapse(1000);
  assert.equal(ui.node('focusTime').textContent,'24:58');
  assert.equal(ui.contentWriteCount(),before);
  ui.click('focus-pause');
  assert.equal(ui.contentWriteCount(),before+1);
  assert.match(ui.html(),/data-action="focus-resume"/);
  ui.elapse(60000);assert.equal(ui.contentWriteCount(),before+1);
  ui.click('focus-resume');
  assert.equal(ui.contentWriteCount(),before+2);
  assert.match(ui.html(),/data-action="focus-pause"/);
  assert.equal(ui.records('task')[0].done,false);
});

test('new account payload replaces old content immediately and closes an old editor through motion', () => {
  const alice=dayTask('private-alice',{title:'Личное дело Алисы'}),bob=dayTask('private-bob',{title:'Дело Боба'});
  const calls=[],ui=createUI([alice],{navigation:navigationSpy(calls)});ui.account('alice',[alice]);ui.navigate('#day');ui.click('edit-task',alice.id);
  assert.equal(ui.node('editor').open,true);
  const before=ui.contentWriteCount();calls.length=0;
  ui.account('bob',[bob]);
  assert.equal(ui.node('editor').open,false);
  assert.equal(ui.node('editor').classList.contains('hvf-dialog-exiting'),false);
  assert.equal(ui.contentWriteCount(),before+1);
  assert.match(ui.html(),/Дело Боба/);
  assert.doesNotMatch(ui.html(),/Личное дело Алисы/);
  assert.equal(ui.node('accountEmail').textContent,'bob@example.test');
  assertScene(calls,before,'','day',null);
  assert.match(ui.node('toastText').textContent,/Аккаунт изменился/);
  assert.equal(ui.writes.length,0);
});

function navigationSpy(calls) {
  return {create({root,document}){
    const capture=(phase,from,to,settings)=>calls.push({phase,from,to,settings:settings?clone(settings):null,
      writes:root.innerHTMLWrites,html:root.innerHTML,
      installation:document.getElementById('installationPanel').innerHTML,
      reminders:document.getElementById('remindersPanel').innerHTML});
    return {init(){},settle(){},cancel(){},prepare(content,from,to,settings){assert.equal(content,root);capture('prepare',from,to,settings);},
      enter(content,from,to,settings){assert.equal(content,root);capture('enter',from,to,settings);}};
  }};
}

function assertScene(calls,before,from,to,settings) {
  assert.deepEqual(calls.map(call=>call.phase),['prepare','enter']);
  assert.equal(calls[0].writes,before,'old scene is captured before HTML replacement');
  assert.equal(calls[1].writes,before+1,'new scene starts after one content replacement');
  for(const call of calls){assert.equal(call.from,from);assert.equal(call.to,to);assert.deepEqual(call.settings,settings);}
}

test('day, week and month changes prepare before mutation and enter afterward with their direction', async () => {
  const calls=[],ui=createUI([],{navigation:navigationSpy(calls)});
  ui.navigate('#day');
  for(const [action,direction] of [['next-day',1],['prev-day',-1]]){
    calls.length=0;const before=ui.contentWriteCount();ui.click(action);
    assertScene(calls,before,'day','day',{refresh:true,direction});
  }
  ui.navigate('#week');
  for(const [action,direction] of [['prev-week',-1],['next-week',1]]){
    calls.length=0;const before=ui.contentWriteCount();ui.click(action);
    assertScene(calls,before,'week','week',{refresh:true,direction});
  }
  calls.length=0;const before=ui.contentWriteCount();await ui.setMonth('2026-11');
  assertScene(calls,before,'week','week',{refresh:true,direction:1});
});

test('currency and important filters animate explicit refreshes while status and data sync do not start scenes', () => {
  const calls=[],task=dayTask('keep',{priority:2}),ui=createUI([task],{navigation:navigationSpy(calls)});
  calls.length=0;let before=ui.contentWriteCount();ui.click('currency','USD');
  assertScene(calls,before,'money','money',{refresh:true,direction:0});
  calls.length=0;ui.status('syncing');ui.status('synced');ui.publish();
  assert.deepEqual(calls,[]);
  ui.upsert({...task,title:'Пришло с телефона'});
  assert.deepEqual(calls,[],'synced data refresh changes content without a page animation');
  ui.navigate('#day');calls.length=0;before=ui.contentWriteCount();ui.click('important-only');
  assertScene(calls,before,'day','day',{refresh:true,direction:0});
  calls.length=0;ui.status('offline');ui.status('synced');
  assert.deepEqual(calls,[]);
});

test('ordinary route transitions omit refresh flags and finish secondary settings panels before entry', () => {
  const calls=[],ui=createUI([],{navigation:navigationSpy(calls)});
  calls.length=0;const before=ui.contentWriteCount();ui.navigate('#settings');
  assertScene(calls,before,'money','settings',null);
  assert.match(calls[0].html,/Деньги с намерением/);
  assert.match(calls[1].html,/Под твой ритм/);
  assert.match(calls[1].installation,/Приложение на телефоне и компьютере/);
  assert.match(calls[1].reminders,/Напоминания на этом устройстве/);
});
