(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const core = window.HVFCore, store = window.HVFStore, categories = window.HVFCategories, forecast = window.HVFForecast, backup = window.HVFBackup, focus = window.HVFFocus, limits = window.HVFLimits, planner = window.HVFPlanner, weekly = window.HVFWeekly, reminders = window.HVFReminders;
  const paths = {
    food:'M3 8h18l-2 12H5L3 8Zm4 0 3-5m7 5-3-5M9 12v4m6-4v4',
    coffee:'M3 8h13v8a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8Zm13 1h2a3 3 0 1 1 0 6h-2M6 3v2m4-2v2m4-2v2',
    transport:'M5 17h14M5 17l-1-6 2-7h12l2 7-1 6M4 11h16M7 17v3m10-3v3M7 14h.1m9.9 0h.1',
    shirt:'m8 3-6 4 3 5 3-2v11h8V10l3 2 3-5-6-4a4 4 0 0 1-8 0Z',
    film:'M3 4h18v16H3V4Zm5 0v16m8-16v16M3 9h5m-5 6h5m8-6h5m-5 6h5',
    health:'M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3Z',
    repeat:'M20 7V3l-4 4h4a8 8 0 0 0-14 1M4 17v4l4-4H4a8 8 0 0 0 14-1',
    tag:'M3 3h8l10 10-8 8L3 11V3Zm4 4h.1',
    home:'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
    calendar:'M5 5h14a2 2 0 0 1 2 2v13H3V7a2 2 0 0 1 2-2ZM7 3v4m10-4v4M3 10h18m-13 4h2m4 0h2m-8 3h2',
    target:'M21 12a9 9 0 1 1-9-9m5 0v4h4m-9 5 7-7M16 12a4 4 0 1 1-4-4',
    wallet:'M21 7H5a2 2 0 0 1 0-4h13v4M3 5v14a2 2 0 0 0 2 2h16V7m0 6h-6v4h6m-3-2h.1',
    settings:'m9 3-1 3-3 1-2 3 2 3v4l3 1 2 3 3-2 4-1 1-3 3-2-2-3V6l-3-1-2-2-3 2Zm6 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    plus:'M12 5v14M5 12h14', edit:'m16 3 5 5-12 12-6 1 1-6Zm-2 2 5 5', delete:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
    clock:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2', spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4m-2-2h4',
    bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
    assistant:'M16 9a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2M3 7V5m-1 1h2m16-4v4m-2-2h4', arrow:'M5 12h14m-5-5 5 5-5 5', check:'m5 12 4 4L19 6', download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5'
  };
  const icon = (key) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(paths[key]||paths.spark)+'"/></svg>';
  document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2);
  const nowDate = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Minsk',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const reminderRouteDate = () => /^#day\/(\d{4}-\d{2}-\d{2})$/.exec(location.hash)?.[1]||'';
  let day = planner.validDate(reminderRouteDate())?reminderRouteDate():nowDate(), month = day.slice(0,7), state = store.getState(), view = 'overview', lastRenderedView = '', submitEditor = null, busy = false, onboarding = null, restoreContext = null, editorLabel = 'Сохранить', toastTimer, undoAction, importantOnly = false, movePreview = null, completionFlash = null, pendingReminderDate = '';
  const navigation=window.HVFNavigation?.create({root:$('content'),window,document,getRoute:()=>view,navigate:route=>{location.hash=route;},isBlocked:()=>busy||$('editor').open});
  const categoryIconNames={food:'Продукты',coffee:'Кафе',transport:'Транспорт',shirt:'Одежда',film:'Развлечения',health:'Здоровье',home:'Дом',repeat:'Подписки',tag:'Другое'};
  const categorySymbol=category=>'<span class="category-symbol" data-category-icon="'+categories.iconKey(category)+'">'+icon(categories.iconKey(category))+'</span>';
  const fmtDate = (date, options={day:'numeric',month:'long'}) => new Intl.DateTimeFormat('ru-RU',{...options,timeZone:'Europe/Minsk'}).format(new Date(date+'T12:00:00+03:00'));
  const monthLabel = () => fmtDate(month+'-01',{month:'long',year:'numeric'}).replace(' г.','');
  const currencies = {BYN:'Белорусский рубль',USD:'Доллар США',RUB:'Российский рубль'};
  const recordCurrency = (record) => Object.hasOwn(currencies,record?.currency)?record.currency:'RUB';
  const selectedCurrency = () => Object.hasOwn(currencies,state.records['finance-preferences']?.currency) ? state.records['finance-preferences'].currency : 'BYN';
  const money = (n,currency=selectedCurrency()) => new Intl.NumberFormat('ru-BY',{style:'currency',currency,currencyDisplay:'code',maximumFractionDigits:Number.isInteger(n)?0:2}).format(Number(n)||0);
  const time = (m) => String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
  const duration = (m) => m>=60 ? Math.floor(m/60)+' ч'+(m%60?' '+m%60+' мин':'') : m+' мин';
  const records = (kind) => Object.values(state.records).filter(r => r.month === month && r.kind === kind).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
  const getRecord = (id) => state.records[id];
  const settings = () => records('settings')[0] || {start:'09:00',end:'22:00',breakMinutes:5};
  const currencyRecords = (kind,currency=selectedCurrency()) => records(kind).filter(record=>recordCurrency(record)===currency);
  const budgetConfig = (currency=selectedCurrency()) => currencyRecords('budget',currency).find(r=>r.id==='budget-'+month+'-'+currency)||currencyRecords('budget',currency)[0]||{income:0,reservePercent:20,goalsPercent:20,currency};
  const allRecords = () => Object.values(state.records);
  const dailyTasks = () => planner.tasksForDay(allRecords(),day);
  const priorityNames = ['Низкий','Обычный','Высокий'];
  const priorityTag = (task) => '<span class="tag priority-'+planner.priorityValue(task)+'">'+priorityNames[planner.priorityValue(task)]+' приоритет</span>';
  const priorityField = (value) => selectField('Приоритет','priority',[['2','Высокий · коралловый'],['1','Обычный · зелёный'],['0','Низкий · серый']],String(planner.priorityValue(value)));
  const reminderOptions = [['-1','Не напоминать'],['0','В момент начала'],['5','За 5 минут'],['10','За 10 минут'],['15','За 15 минут'],['30','За 30 минут'],['60','За час'],['1440','За день']];
  const reminderField = (task) => selectField('Напоминание','reminderMinutes',reminderOptions,String(task.reminderMinutes??-1))+'<p class="status-note reminder-field-hint">Для напоминания укажи время начала. Уведомления включаются отдельно на каждом устройстве в <a class="text-link" href="#settings">настройках</a>.</p>';
  function readReminder(data,at,previous) {
    const raw=data.get('reminderMinutes'),value=raw===null?previous:raw;
    if(value===undefined||value===null||String(value)==='-1'||value==='')return null;
    const minutes=Number(value);if(!reminderOptions.some(([n])=>n!=='-1'&&Number(n)===minutes))throw new Error('Выбери время напоминания.');
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(at))throw new Error('Для напоминания укажи время начала дела.');
    return minutes;
  }
  const reminderTag = (task) => Number.isInteger(task.reminderMinutes)&&task.reminderMinutes>=0?'<span class="tag reminder-tag">'+icon('bell')+(task.reminderMinutes===0?'В начале':task.reminderMinutes===1440?'За день':task.reminderMinutes===60?'За час':'За '+task.reminderMinutes+' мин')+'</span>':'';
  function getTask(id) {
    if(getRecord(id)?.kind==='task')return getRecord(id);
    const date=String(id).slice(-10);
    return planner.validDate(date)?planner.tasksForDay(allRecords(),date).find(t=>t.id===id):null;
  }
  function cleanTask(task) {const copy={...task};delete copy.virtual;delete copy.start;delete copy.end;return copy;}
  function rhythmFor(date) {return allRecords().find(r=>r.kind==='settings'&&r.month===date.slice(0,7))||{start:'09:00',end:'22:00',breakMinutes:5};}
  const bookedRecords = kind => records(kind).filter(r=>month!==nowDate().slice(0,7)||!r.date||r.date<=nowDate());
  const budget = (currency=selectedCurrency()) => core.allocateBudget({...budgetConfig(currency),currency,incomes:bookedRecords('income'),commitments:records('commitment'),goals:records('goal'),expenses:bookedRecords('expense')});
  function setCurrency(currency) {if(Object.hasOwn(currencies,currency))store.put({id:'finance-preferences',kind:'finance-preferences',month:'2000-01',currency});}
  function currencyField(value=selectedCurrency()) {return selectField('Валюта','currency',Object.entries(currencies).map(([c,n])=>[c,c+' · '+n]),value);}
  function currencyStrip() {return '<div class="currency-strip" role="group" aria-label="Валюта бюджета">'+Object.keys(currencies).map(c=>'<button type="button" data-action="currency" data-id="'+c+'" aria-pressed="'+(c===selectedCurrency())+'" class="currency-tab '+(c===selectedCurrency()?'active':'')+'">'+c+'<small>'+currencies[c]+'</small></button>').join('')+'</div>';}
  const plan = () => core.schedule(dailyTasks(),settings());
  const button = (label, action, cls='', id='') => '<button type="button" class="button '+cls+'" data-action="'+action+'"'+(id?' data-id="'+esc(id)+'"':'')+'>'+label+'</button>';
  const head = (title, subtitle, action='') => '<div class="page-head"><div><p class="eyebrow">'+esc(monthLabel().toUpperCase())+'</p><h1>'+title+'</h1><p class="subhead">'+subtitle+'</p></div>'+action+'</div>';
  const empty = (name,title,text,action='') => '<div class="empty"><div class="empty-icon">'+icon(name)+'</div><h3>'+title+'</h3><p>'+text+'</p>'+action+'</div>';
  const panelHead = (title,href,label='Смотреть всё') => '<div class="panel-head"><h2>'+title+'</h2>'+(href?'<a class="text-link" href="#'+href+'">'+label+' ↗</a>':'')+'</div>';
  const stat = (name,value,note,i) => '<div class="stat"><div class="stat-top"><span>'+name+'</span>'+icon(i)+'</div><strong>'+value+'</strong><small>'+note+'</small></div>';
  function toast(message, undo) {
    clearTimeout(toastTimer); $('toastText').textContent=message; $('toast').hidden=false;
    undoAction=undo; $('undoButton').hidden=!undo;
    toastTimer=setTimeout(()=>$('toast').hidden=true,undo?12000:7000);
  }
  function actions(kind,id) {return '<div class="row-actions"><button type="button" class="icon-button" data-action="edit-'+kind+'" data-id="'+esc(id)+'" aria-label="Редактировать">'+icon('edit')+'</button><button type="button" class="icon-button delete" data-action="delete" data-id="'+esc(id)+'" aria-label="Удалить">'+icon('delete')+'</button></div>';}
  function taskRows(tasks, waiting=false) {
    return tasks.map(t=>'<article class="task-row'+(t.done?' done':'')+(t.done&&completionFlash?.id===t.id&&Date.now()-completionFlash.at<500?' just-completed':'')+'"><input type="checkbox" data-task-check="'+esc(t.id)+'" aria-label="Выполнено: '+esc(t.title)+'" '+(t.done?'checked':'')+'><div class="task-time">'+(waiting?'Не влезло':time(t.start))+'<small>'+(waiting?esc(t.time||'без времени'):time(t.end))+'</small></div><div class="task-copy"><h3>'+esc(t.title)+'</h3><p>'+duration(t.duration)+(t.goalId?' · '+esc(getRecord(t.goalId)?.title||'Цель месяца'):'')+'</p><div class="task-tags">'+priorityTag(t)+reminderTag(t)+(t.routineId?'<span class="tag repeat-tag">↻ Повтор</span>':'')+(t.time?'<span class="tag">Фиксированное время</span>':'')+(t.estimated?'<span class="tag">Примерное время</span>':'')+(waiting?'<span class="tag warn">Измени время или дату</span>':'')+'</div>'+(!t.done?button('Сфокусироваться','focus-task','small secondary focus-task-button',t.id):'')+'</div>'+actions('task',t.id)+'</article>').join('');
  }
  function dayPanel(compact=false) {
    const p=plan(), set=settings();
    const tools=compact?'':'<div class="day-tools"><div class="date-arrows"><button type="button" data-action="prev-day" aria-label="Предыдущий день">‹</button><button type="button" data-action="next-day" aria-label="Следующий день">›</button></div><label><span class="sr-only">Дата дел</span><input type="date" id="dayPicker" value="'+day+'" required></label><button type="button" class="text-link" data-action="today">Сегодня</button><span class="day-meta">'+esc(set.start)+'–'+esc(set.end)+' · перерыв '+set.breakMinutes+' мин</span></div>';
    const shown=importantOnly&&!compact?p.placed.filter(t=>planner.priorityValue(t)===2):p.placed, waiting=importantOnly&&!compact?p.waiting.filter(t=>planner.priorityValue(t)===2):p.waiting;
    const featureTools=compact?'':'<div class="planner-toolbar"><button type="button" class="filter-chip '+(importantOnly?'selected':'')+'" data-action="important-only" aria-pressed="'+importantOnly+'">● Только важное</button>'+button('↻ Повторять дело','add-routine','small secondary')+button('На завтра →','move-preview','small secondary')+'<a class="text-link" href="#focus">Режим фокуса ↗</a><a class="text-link" href="#week">Итоги недели ↗</a></div><p class="status-note planner-hint">Свободные дела с высоким приоритетом идут раньше. Встречи с указанным временем сохраняют своё место.</p>';
    return '<section class="panel">'+panelHead(compact?'Мой день':'Дела на '+fmtDate(day),compact?'day':'',compact?'Открыть день':'')+tools+featureTools+(shown.length?taskRows(compact?shown.slice(0,5):shown):!waiting.length?empty('calendar',importantOnly&&!compact?'Важных дел нет':'В этом дне есть место для тебя',importantOnly&&!compact?'Повышай приоритет в редакторе дела или покажи весь день.':'Добавь первое дело. Время можно не указывать — помощник предложит длительность.',button(importantOnly&&!compact?'Показать все дела':'+ Добавить дело',importantOnly&&!compact?'important-only':'add-task','small secondary')):'')+(waiting.length?'<div class="notice warning">'+waiting.length+' дел пока не помещаются'+(p.conflicts.length?' или пересекаются с другими встречами':'')+'. Они сохранены: можно изменить время, длительность или перенести их на другой день.</div>'+taskRows(waiting,true):'')+(shown.length&&compact&&shown.length>5?'<a class="text-link" href="#day">Ещё '+(shown.length-5)+' дел →</a>':'')+'</section>';
  }
  function setEditorLabel(label) {editorLabel=label;$('saveDialog').textContent=label;}
  function onboardingPanel() {
    if(state.status==='loading'||getRecord('onboarding-preferences')?.completed)return '';
    const existing=allRecords().some(r=>['task','goal','budget','income','commitment'].includes(r.kind));
    return '<section class="onboarding-card"><div><p class="eyebrow">'+(existing?'НАСТРОЙКА HVF':'ДОБРО ПОЖАЛОВАТЬ В HVF')+'</p><h2>'+(existing?'Собери планы и деньги в одну систему':'Начни со своего дня и бюджета')+'</h2><p>Три коротких шага: доход, цель и первое дело. Все поля можно пропустить; готового расписания здесь нет.</p></div><div class="onboarding-actions">'+button('Настроить HVF','start-onboarding')+button('Пока пропустить','skip-onboarding','secondary')+'</div></section>';
  }
  function startOnboarding() {
    if(state.status==='loading'){toast('Дождись загрузки данных аккаунта.');return;}
    const currency=selectedCurrency(),b=budgetConfig(currency),s=settings(),incomePlan=getRecord('income-plan-'+currency)||{};
    onboarding={step:0,scope:state.user?.uid||'anonymous',month,day,values:{currency,salary:b.income||'',nextDate:incomePlan.nextDate||'',expectedAmount:incomePlan.expectedAmount||'',goalTitle:'',outcome:'',taskTitle:'',duration:'',start:s.start,end:s.end}};
    openEditor('Начальная настройка','',async data=>{
      if(!onboarding)throw new Error('Открой настройку заново.');
      captureOnboarding(data,true);
      if(onboarding.step<2){onboarding.step++;showOnboarding();return {keepOpen:true};}
      if(state.status==='loading')throw new Error('Дождись загрузки данных аккаунта.');
      const w=onboarding,v=w.values,items=[],stamp=Date.now(),currency=v.currency;
      if((state.user?.uid||'anonymous')!==w.scope||month!==w.month)throw new Error('Аккаунт или месяц изменился. Открой настройку заново.');
      items.push({id:'finance-preferences',kind:'finance-preferences',month:'2000-01',currency});
      if(v.salary!==''){
        const previous=budgetConfig(currency),income=Number(v.salary);
        items.push({...previous,id:previous.id||'budget-'+month+'-'+currency,kind:'budget',month,currency,income,reservePercent:previous.reservePercent??20,goalsPercent:previous.goalsPercent??20,createdAt:previous.createdAt||stamp});
      }
      if(v.nextDate)items.push({...getRecord('income-plan-'+currency),id:'income-plan-'+currency,kind:'income-plan',month:'2000-04',currency,nextDate:v.nextDate,expectedAmount:v.expectedAmount===''?null:Number(v.expectedAmount),createdAt:stamp});
      const goalId=v.goalTitle?'goal-'+uid():'';
      if(goalId)items.push({id:goalId,kind:'goal',month,title:v.goalTitle,outcome:v.outcome,target:0,saved:0,priority:1,currency,createdAt:stamp});
      if(v.taskTitle)items.push({id:uid(),kind:'task',month,date:w.day,title:v.taskTitle,time:'',duration:v.duration?Number(v.duration):core.estimateDuration(v.taskTitle),priority:1,done:false,goalId,estimated:!v.duration,estimateSource:v.duration?'manual':'local',reminderMinutes:null,createdAt:stamp});
      items.push({id:'settings-'+month,kind:'settings',month,start:v.start,end:v.end,breakMinutes:settings().breakMinutes??5});
      items.push({id:'onboarding-preferences',kind:'onboarding-preferences',month:'2000-05',completed:true,version:1,completedAt:new Date().toISOString()});
      store.putMany(items,{expectedOwner:w.scope});onboarding=null;toast('Настройка сохранена. Твои планы и бюджет готовы к работе.');
    });showOnboarding();
  }
  function captureOnboarding(data,validate) {
    const w=onboarding;if(!w)return;const keys=[['currency','salary','nextDate','expectedAmount'],['goalTitle','outcome'],['taskTitle','duration','start','end']][w.step];
    for(const key of keys)w.values[key]=String(data.get(key)||'').trim();
    if(!validate)return;const v=w.values;
    if(w.step===0){
      if(!Object.hasOwn(currencies,v.currency))throw new Error('Выбери валюту.');
      for(const key of ['salary','expectedAmount'])if(v[key]!==''&&(!Number.isFinite(Number(v[key]))||Number(v[key])<0||Number(v[key])>1e9||Math.abs(Number(v[key])*100-Math.round(Number(v[key])*100))>0.0001))throw new Error('Укажи сумму до миллиарда с точностью до копеек.');
      if(v.nextDate&&(!forecast.validDate(v.nextDate)||v.nextDate<nowDate()))throw new Error('Укажи сегодняшнюю или будущую дату поступления.');
      if(v.expectedAmount&&!v.nextDate)throw new Error('Для ожидаемой суммы укажи дату поступления.');
    }
    if(w.step===1&&v.outcome&&!v.goalTitle)throw new Error('Назови цель или оставь оба поля пустыми.');
    if(w.step===1&&(v.goalTitle.length>100||v.outcome.length>300))throw new Error('Сократи название цели до 100 символов, результат — до 300.');
    if(w.step===2){
      if(v.taskTitle.length>100)throw new Error('Название дела — до 100 символов.');
      if(v.duration&&(!Number.isInteger(Number(v.duration))||Number(v.duration)<5||Number(v.duration)>480))throw new Error('Длительность — от 5 до 480 целых минут.');
      if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.end)||v.start>=v.end)throw new Error('Конец дня должен быть позже начала.');
    }
  }
  function showOnboarding() {
    const w=onboarding,v=w.values,labels=['Деньги','Цель месяца','Первое дело'];
    $('dialogTitle').textContent=labels[w.step]+' · шаг '+(w.step+1)+' из 3';
    const prefix='<ol class="setup-progress" aria-label="Шаги настройки">'+labels.map((name,i)=>'<li class="'+(i===w.step?'current':i<w.step?'complete':'')+'">'+(i+1)+'. '+name+'</li>').join('')+'</ol>';
    let html=w.step===0?'<p class="preview-intro">Сначала отделим полученные деньги от ожидаемых.</p>'+currencyField(v.currency)+field('Уже полученная зарплата за '+monthLabel(),'salary','number',v.salary,'min="0" max="1000000000" step="0.01" placeholder="Можно позже"')+'<div class="field-row">'+field('Следующее поступление','nextDate','date',v.nextDate,'min="'+nowDate()+'"')+field('Ожидаемая сумма','expectedAmount','number',v.expectedAmount,'min="0" max="1000000000" step="0.01" placeholder="Необязательно"')+'</div><p class="status-note">Будущий доход не увеличивает доступный остаток. Обязательные суммы можно добавить в «Финансах» после настройки.</p>':w.step===1?'<p class="preview-intro">Какой один результат будет важен в этом месяце?</p>'+field('Цель месяца','goalTitle','text',v.goalTitle,'maxlength="100" placeholder="Например, подготовиться к экзамену"')+field('Как поймёшь, что цель достигнута','outcome','text',v.outcome,'maxlength="300" placeholder="Например, решить пять вариантов"')+'<p class="status-note">Можно оставить пустым. Шаги к цели добавляются тобой, без шаблонного плана.</p>':'<p class="preview-intro">Выбери конкретный первый шаг на '+fmtDate(w.day)+'. Он свяжется с новой целью.</p>'+field('Что сделать','taskTitle','text',v.taskTitle,'maxlength="100" placeholder="Например, решить первый вариант"')+field('Длительность, мин','duration','number',v.duration,'min="5" max="480" step="1" placeholder="Оценить по названию"')+'<div class="field-row">'+field('Начало дня','start','time',v.start,'required')+field('Конец дня','end','time',v.end,'required')+'</div><div class="notice"><strong>Будет сохранено</strong><p>'+esc(v.salary!==''?'Полученная зарплата: '+money(Number(v.salary),v.currency)+'. ':'Зарплата пока не указана. ')+esc(v.nextDate?'Следующее поступление: '+fmtDate(v.nextDate)+'. ':'')+esc(v.goalTitle?'Цель: '+v.goalTitle+'. ':'Без новой цели. ')+'Дело появится, если заполнить его название.</p></div>';
    $('dialogFields').innerHTML=prefix+html+(w.step?button('← Назад','onboarding-back','secondary small'):'');setEditorLabel(w.step===2?'Сохранить настройку':'Далее');$('formError').textContent='';$('editor').scrollTop=0;
  }
  function snapshotFingerprint() {return JSON.stringify(allRecords().sort((a,b)=>a.id.localeCompare(b.id)));}
  let backupReadSequence=0;
  async function readBackupFile(file) {
    if(!file||busy)return;const scope=state.user?.uid||'anonymous',readSequence=++backupReadSequence;
    try{
      if(state.status==='loading')throw new Error('Дождись загрузки данных аккаунта.');
      if(file.size>backup.MAX_BYTES)throw new Error('Копия должна быть не больше 5 МБ.');
      const parsed=backup.parse(await file.text());
      if(readSequence!==backupReadSequence)return;
      if((state.user?.uid||'anonymous')!==scope)throw new Error('Аккаунт изменился. Выбери файл заново.');
      if(state.status==='loading')throw new Error('Дождись загрузки данных аккаунта и выбери копию заново.');
      if(busy||$('editor').open)throw new Error('Закрой открытую форму и выбери копию ещё раз.');
      if(!parsed.ok)throw new Error(parsed.errors.slice(0,3).map(e=>e.message).join(' '));
      restoreContext={parsed,scope,fileName:String(file.name||'Копия HVF').slice(0,200),replace:false,fingerprint:snapshotFingerprint()};
      openEditor('Восстановление копии','',async data=>{
        const ctx=restoreContext;if(!ctx||ctx.scope!==(state.user?.uid||'anonymous'))throw new Error('Аккаунт изменился. Выбери файл заново.');
        if(state.status==='loading')throw new Error('Дождись загрузки данных аккаунта перед восстановлением.');
        const replace=!!data.get('replaceExisting');
        if(ctx.replace!==replace||ctx.fingerprint!==snapshotFingerprint()){
          ctx.replace=replace;showRestorePreview();$('formError').textContent='Данные или режим изменились. Проверь обновлённый список и подтверди ещё раз.';return {keepOpen:true};
        }
        const plan=backup.importPlan(allRecords(),ctx.parsed,{mode:ctx.replace?'replace':'merge'});
        if(!plan.ok)throw new Error(plan.invalid.map(e=>e.message).join(' '));
        if(!plan.records.length)throw new Error('Нет новых записей для восстановления.');
        store.putMany(plan.records,{expectedOwner:ctx.scope});restoreContext=null;toast('Восстановлено записей: '+plan.records.length+'. '+(state.user?'Ожидается синхронизация с другими устройствами.':'Они сохранены на этом устройстве.'));
      });showRestorePreview();
    }catch(error){toast(error.message||'Не удалось прочитать копию.');}
    finally{const input=$('backupFile');if(input&&readSequence===backupReadSequence)input.value='';}
  }
  function showRestorePreview() {
    const ctx=restoreContext,plan=backup.importPlan(allRecords(),ctx.parsed,{mode:ctx.replace?'replace':'merge'});ctx.fingerprint=snapshotFingerprint();
    const months=[...new Set(ctx.parsed.records.map(r=>r.month).filter(m=>!m.startsWith('2000-')))];
    const names={task:'дела',routine:'повторения',goal:'цели',expense:'расходы',income:'поступления','expense-category':'категории','spending-limit':'лимиты'};
    const counts={};ctx.parsed.records.forEach(r=>{const name=names[r.kind]||'настройки и другие записи';counts[name]=(counts[name]||0)+1;});
    $('dialogFields').innerHTML='<p class="backup-filename">'+esc(ctx.fileName)+'</p><p class="preview-intro">'+ctx.parsed.records.length+' записей · '+months.length+' месяцев. Файл обрабатывается в браузере. После подтверждения данные сохранятся в текущем аккаунте.</p><div class="backup-counts">'+Object.entries(counts).map(([label,n])=>'<span>'+n+' · '+esc(label)+'</span>').join('')+'</div><dl class="restore-totals"><div><dt>Добавить новые</dt><dd>'+plan.additions.length+'</dd></div><div><dt>Без изменений</dt><dd>'+plan.unchanged.length+'</dd></div><div><dt>Заменить по выбору</dt><dd>'+plan.replacements.length+'</dd></div><div><dt>Пропустить совпадения</dt><dd>'+plan.skipped+'</dd></div></dl><label class="restore-choice"><input type="checkbox" id="replaceExisting" name="replaceExisting" '+(ctx.replace?'checked':'')+'> Заменить отличающиеся записи с теми же id</label><p class="status-note">По умолчанию текущие записи сохраняются. Другие записи не удаляются. Совпадения разных месяцев или типов всегда пропускаются.</p>'+(plan.conflicts.length?'<details class="backup-conflicts"><summary>Совпадения: '+plan.conflicts.length+'</summary><ul>'+plan.conflicts.slice(0,15).map(c=>'<li>'+esc(c.incoming.title||c.id)+' · '+esc(c.reason==='month'?'другой месяц':c.reason==='kind'?'другой тип':ctx.replace?'будет заменено':'текущая запись сохранится')+'</li>').join('')+'</ul></details>':'')+'<p class="notice">Перед заменой полезно скачать текущую копию из настроек. Восстановление может вернуть уведомления, сохранённые в делах.</p>';
    setEditorLabel('Восстановить '+plan.records.length+' записей');$('saveDialog').disabled=!plan.records.length;
  }
  function focusClock(value) {const seconds=Math.ceil(Math.max(0,value)/1000);return String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0');}
  function focusMini() {
    const f=focus.getState();if(f.phase==='idle')return '';
    return '<a class="focus-mini" href="#focus"><span>'+esc(f.mode==='break'?'Перерыв':f.title)+'<small>'+esc(f.phase==='finished'?'Время вышло':f.phase==='paused'?'На паузе':'Открыть режим фокуса')+'</small></span><strong id="focusMiniTime">'+focusClock(f.remainingMs)+'</strong></a>';
  }
  function focusView() {
    const f=focus.getState(),active=f.phase!=='idle',tasks=dailyTasks().filter(t=>!t.done);
    const status=f.phase==='finished'?'Время вышло':f.phase==='paused'?'На паузе':f.mode==='break'?'Время отдохнуть':'Одна задача за раз';
    return head('Место для фокуса.','Выбери одно дело, выдели время и вернись к нему спокойно.','<a class="text-link" href="#day">К делам дня ↗</a>')+'<section class="panel focus-panel">'+(active?'<div class="focus-meta"><span class="focus-status '+f.phase+'">'+status+'</span><span>'+duration(Math.round(f.durationMs/60000))+'</span></div><h2 class="focus-task-title">'+esc(f.mode==='break'?'Небольшой перерыв':f.title)+'</h2><strong id="focusTime" class="focus-time" aria-label="Осталось времени">'+focusClock(f.remainingMs)+'</strong><div class="focus-controls">'+(f.phase==='running'?button('Пауза','focus-pause','secondary'):f.phase==='paused'?button('Продолжить','focus-resume'):'')+(f.phase==='finished'?button('Перерыв 5 мин','focus-break','secondary','5')+button('Перерыв 10 мин','focus-break','secondary','10'):'')+button(f.phase==='finished'?'Завершить сессию':'Остановить','focus-stop','secondary')+'</div>':'<div class="empty"><h2>Сейчас — только одно дело</h2><p>Начни с короткой сессии, например 25 минут. Ниже — невыполненные дела выбранного дня.</p></div>')+'<p class="focus-description">Таймер сохраняется на этом устройстве и продолжает учитывать время при закрытии страницы. Это отсчёт времени; звуковой сигнал при закрытом приложении не предусмотрен. Выполнение дела отмечается отдельно в списке.</p>'+(!f.storageAvailable?'<p class="notice warning">Браузер не разрешает сохранить таймер. После закрытия страницы отсчёт может потеряться.</p>':'')+'</section><section class="panel">'+panelHead('Выбрать дело · '+fmtDate(day))+(tasks.length?'<div class="focus-choices">'+tasks.map(t=>'<div><span>'+esc(t.title)+'<small>'+duration(t.duration)+' · '+priorityNames[planner.priorityValue(t)]+' приоритет</small></span>'+button('Начать','focus-task','small secondary',t.id)+'</div>').join(''):'<p class="status-note">На выбранный день нет невыполненных дел.</p>')+'</section>';
  }
  function focusEditor(id) {
    const task=getTask(id);if(!task||task.done){toast('Выбери невыполненное дело.');return;}
    const f=focus.getState();
    openEditor('Сфокусироваться', '<p class="preview-intro">'+esc(task.title)+'</p>'+field('Сколько минут выделить','minutes','number',Math.min(25,task.duration||25),'required min="1" max="480" step="1"')+((f.phase==='running'||f.phase==='paused')?'<div class="notice warning">Новая сессия заменит текущий таймер на этом устройстве.</div>':'')+'<p class="status-note">Начни с одного посильного отрезка. Дело останется в списке, пока ты сам не отметишь его выполненным.</p>',async data=>{
      const latest=getTask(id),minutes=Number(data.get('minutes'));if(!latest||latest.done)throw new Error('Дело уже выполнено или удалено.');
      focus.start({taskId:id,title:latest.title,minutes});location.hash='focus';
    });$('saveDialog').textContent='Начать фокус';
  }
  function progress(goal) {
    const tasks=records('task').filter(t=>t.goalId===goal.id), done=tasks.filter(t=>t.done).length;
    const percent=tasks.length?Math.round(done/tasks.length*100):Number(goal.target)>0?Math.min(100,Math.round((Number(goal.saved)||0)/goal.target*100)):0;
    return {percent,text:tasks.length?done+' из '+tasks.length+' шагов':Number(goal.target)>0?money(Number(goal.saved)||0,recordCurrency(goal))+' из '+money(goal.target,recordCurrency(goal)):'Пока без шагов'};
  }
  function miniGoals() {
    const goals=records('goal');
    return '<section class="panel">'+panelHead('К важному — шаг за шагом','goals')+(goals.length?goals.slice(0,3).map(g=>{const p=progress(g);return '<div class="goal-mini"><div class="goal-mini-top"><span>'+esc(g.title)+'</span><small>'+p.percent+'%</small></div><div class="progress-track"><div class="progress-fill" style="width:'+p.percent+'%"></div></div><small>'+p.text+'</small></div>';}).join(''):empty('target','Что важно в этом месяце?','Пусть цели будут твоими. Выбери, на что хочешь направить время и деньги.',button('+ Моя первая цель','add-goal','small secondary')))+'</section>';
  }
  const envelopeNames={essentials:'Обязательные расходы',reserve:'Резерв',goals:'На твои цели',flexible:'Свободные деньги'};
  function budgetLines(b,detail=false) {
    return '<div class="budget-bar">'+Object.entries(b.envelopes).map(([k,e])=>'<span class="c-'+k+'" style="width:'+(b.income?100*e.planned/b.income:0)+'%"></span>').join('')+'</div><div class="budget-list">'+Object.entries(b.envelopes).map(([k,e])=>'<div><div class="budget-line"><span class="budget-line-label"><span class="budget-dot c-'+k+'"></span>'+envelopeNames[k]+'</span><strong>'+money(detail?e.remaining:e.planned)+'</strong></div>'+(detail?'<p class="status-note" style="margin:3px 0 0 16px">План '+money(e.planned)+' · потрачено '+money(e.spent)+(e.remaining<0?' · перерасход':'')+'</p>':'')+'</div>').join('')+'</div>';
  }
  function moneyPanel() {const b=budget();return '<section class="panel">'+panelHead('Деньги под контролем','money')+currencyStrip()+(b.income?'<span class="muted" style="font-size:10px">Можно тратить свободно</span><strong class="money-total">'+money(b.freeToSpend)+'</strong><p class="status-note">Всего осталось '+money(b.available)+' · из них отложено '+money(b.protectedRemaining)+'</p>'+budgetLines(b):empty('wallet','Начнём с дохода','Добавь зарплату или другое поступление. Затем укажи обязательные суммы.',button('Указать зарплату','edit-budget','small secondary')))+'</section>';}
  function overview() {
    const tasks=dailyTasks(), goals=records('goal'), b=budget();
    return head('Всё важное — рядом.','Твой день, твои цели и спокойствие в деньгах.',button(icon('plus')+' Добавить дело','add-task'))+'<section class="hero"><div><p class="eyebrow">ТВОЙ ЛИЧНЫЙ ПОМОЩНИК</p><h2>Меньше суеты.<br>Больше своего.</h2><p>Освободи голову для важного. Я помогу собрать планы,<br class="desktop-br"> найти время для целей и разложить бюджет.</p>'+button('Начать с цели '+icon('arrow'),'add-goal','lime')+'</div><div class="hero-art" aria-hidden="true"><div class="orbit"></div><span class="spark">✧</span><div class="orb">'+icon('assistant')+'</div><span class="art-dot"></span></div></section><div class="stats">'+stat('Дела на день',tasks.filter(t=>t.done).length+' <span class="muted" style="font-size:17px">/ '+tasks.length+'</span>',fmtDate(day),'calendar')+stat('Цели месяца',String(goals.length),goals.length?'В своём темпе, по своему плану':'Добавь то, что важно тебе','target')+stat('Свободные деньги',money(b.freeToSpend),b.income?'Потрачено '+money(b.spent):'Зарплата ещё не указана','wallet')+'</div><div class="columns"><div class="stack">'+dayPanel(true)+'<div class="insight">'+icon('spark')+'<div><h3>'+(!tasks.length?'План начинается с тебя':plan().waiting.length?'Оставь дню немного воздуха':'На всё — своё время')+'</h3><p>'+(!tasks.length?'Здесь нет чужого расписания. Добавляй и убирай дела, а свободное время остаётся твоим.':plan().waiting.length?'Не все дела поместились. Открой «Мой день», чтобы сократить задачу или выбрать другую дату.':'После изменения дел план пересчитывается. Указанные встречи сохраняют своё время.')+'</p></div></div></div><div class="stack">'+miniGoals()+moneyPanel()+'</div></div>';
  }
  function goalsView() {
    const goals=records('goal');
    return head('Твои большие «хочу».','Задай направление на месяц и добавь конкретные шаги.',button(icon('plus')+' Добавить цель','add-goal'))+(goals.length?'<div class="goal-grid">'+goals.map(g=>{const p=progress(g);return '<section class="panel goal-card"><div class="goal-top"><div class="goal-badge">'+icon('target')+'</div>'+actions('goal',g.id)+'</div><h3>'+esc(g.title)+'</h3><p class="outcome">'+esc(g.outcome||'Опиши результат, к которому хочешь прийти в этом месяце.')+'</p><div class="goal-bottom"><div class="goal-numbers"><span>'+p.text+'</span><strong>'+p.percent+'%</strong></div><div class="progress-track"><div class="progress-fill" style="width:'+p.percent+'%"></div></div>'+(Number(g.target)>0?'<p class="status-note">Денежная цель: '+money(g.target,recordCurrency(g))+' · '+(g.priority>=2?'высокий':g.priority===0?'низкий':'обычный')+' приоритет</p>':'')+'<div class="goal-buttons">'+button('Добавить шаг','goal-task','small secondary',g.id)+'</div></div></section>';}).join('')+'</div>':'<section class="panel">'+empty('target','Твой месяц — чистый лист','Никаких встроенных целей. Напиши, чего хочешь достичь: закончить проект, освоить навык или накопить на важное.',button('+ Добавить первую цель','add-goal'))+'</section>')+'<div class="notice">Шаги появятся в плане дня. Если указать сумму цели, она также попадёт в распределение зарплаты. Шаги добавляются вручную: запиши конкретное действие и нужный результат.</div>';
  }
  function goalSteps(goalId) {
    const steps=records('task').filter(t=>t.goalId===goalId).sort((a,b)=>a.date.localeCompare(b.date));
    return steps.length?'<div class="goal-steps">'+steps.map(t=>'<button type="button" class="goal-step" data-action="open-task-day" data-id="'+esc(t.id)+'"><span class="step-check">'+(t.done?'✓':'○')+'</span><span>'+esc(t.title)+'<small>'+fmtDate(t.date)+' · '+duration(t.duration)+'</small></span><span>↗</span></button>').join('')+'</div>':'';
  }
  function financialHistory(kind) {
    const items=currencyRecords(kind).sort((a,b)=>b.date.localeCompare(a.date)||(b.createdAt||0)-(a.createdAt||0));
    if(!items.length)return empty('wallet',kind==='income'?'Подарки и подработки — тоже доход':'Пока без расходов',kind==='income'?'Поступления добавляются к зарплате и увеличивают бюджет.':'Записывай траты, чтобы видеть точный свободный остаток.',button(kind==='income'?'+ Добавить поступление':'+ Записать расход',kind==='income'?'add-income':'add-expense','small secondary'));
    return items.map(item=>{
      const category=kind==='income'?'Дополнительный доход':item.expenseCategoryId?categories.classification(item,allRecords()).title:item.commitmentId?(getRecord(item.commitmentId)?.title||item.commitmentTitle||'Обязательная сумма (архив)'):item.category==='goal'?(getRecord(item.goalId)?.title||'Цель (архив)'):envelopeNames[item.category]||'Свободные деньги';
      return '<article class="expense-row"><span class="expense-icon '+(kind==='income'?'income-icon':'')+'">'+icon(kind==='income'?'plus':item.expenseCategoryId?categories.iconKey(categories.findById(item.expenseCategoryId,allRecords())||{icon:item.expenseCategoryIcon}):'wallet')+'</span><div><h3>'+esc(item.title)+'</h3><p>'+fmtDate(item.date)+(item.date>nowDate()?' · Запланировано':'')+' · '+esc(category)+'</p></div><strong class="'+(kind==='income'?'income-amount':'')+'">'+(kind==='income'?'+':'−')+money(item.amount)+'</strong>'+actions(kind,item.id)+'</article>';
    }).join('');
  }
  function commitmentPanel(b) {
    return '<section class="panel"><div class="panel-head"><h2>Обязательно отложить</h2><button type="button" class="text-link" data-action="add-commitment">+ Добавить</button></div><p class="status-note" style="margin:0 0 16px">Эти суммы откладываются первыми. Оплачивай нужный пункт здесь, чтобы учесть трату из его резерва.</p>'+(b.commitmentAllocations.length?b.commitmentAllocations.map(c=>'<article class="commitment-card"><div class="allocation-top"><strong>'+esc(c.title)+'</strong>'+actions('commitment',c.id)+'</div><div class="commitment-amount">'+money(c.amount)+'<small>'+(c.dueDay?'до '+Math.min(c.dueDay,new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate())+' числа':'на месяц')+'</small></div><div class="progress-track"><div class="progress-fill" style="width:'+Math.min(100,c.amount?c.spent/c.amount*100:0)+'%"></div></div><p class="status-note">Оплачено '+money(c.spent)+' · ещё отложено '+money(Math.max(0,c.remaining))+(c.shortfall?' · не хватает '+money(c.shortfall):'')+'</p>'+(c.spent<c.amount?button('Записать оплату','pay-commitment','small secondary',c.id):'<span class="tag">Оплачено</span>')+'</article>').join(''):empty('wallet','Свои обязательные суммы','Например: репетиторы — 680 BYN, проезд — своя сумма. Запиши их один раз на месяц.',button('+ Добавить сумму','add-commitment','small secondary')))+'<button type="button" class="text-link copy-commitments" data-action="copy-commitments">Повторить суммы из прошлого месяца ↗</button></section>';
  }
  function moneyAdvice(b,days) {
    const extras=window.HVFExtras;
    if(!extras)return '';
    const insights=extras.insights(b,selectedCurrency(),days);
    return '<section class="panel">'+panelHead('Подсказки помощника')+insights.map(i=>'<div class="notice '+(i.tone==='warning'?'warning':'')+'"><strong>'+esc(i.title)+'</strong><br>'+esc(i.text)+'</div>').join('')+'<details class="saving-tips"><summary>Как удобнее откладывать</summary>'+extras.tips.map(t=>'<article><h3>'+esc(t.title)+'</h3><p>'+esc(t.text)+'</p><a href="'+esc(t.url)+'" target="_blank" rel="noopener noreferrer">'+esc(t.source)+' ↗</a></article>').join('')+'</details></section>';
  }
  function categoryPanel() {
    const list=categories.list(allRecords(),{includeArchived:true}),active=list.filter(c=>!c.archived),archived=list.filter(c=>c.archived),summaries=new Map(limits.summarize(allRecords(),{month,currency:selectedCurrency()}).map(r=>[r.category,r]));
    const row=c=>{const spent=summaries.get(c.id)?.spent||0;return '<article class="category-card">'+categorySymbol(c)+'<div class="category-card-copy"><h3>'+esc(c.title)+'</h3><p>'+esc(envelopeNames[c.envelope])+'</p><strong>'+money(spent)+'</strong></div><div class="category-card-action">'+button(c.archived?'Вернуть':'Настроить',c.archived?'restore-category':'edit-category','small secondary',c.id)+'</div></article>';};
    return '<section class="panel"><div class="panel-head"><h2>Категории расходов</h2>'+button('+ Своя категория','add-category','small secondary')+'</div><p class="status-note planner-hint">Готовые категории уже доступны при записи расхода. Меняй названия и значки, добавляй свои. Суммы ниже — записанные расходы за '+esc(monthLabel())+'.</p><div class="category-grid">'+active.map(row).join('')+'</div>'+(archived.length?'<details class="category-archive"><summary>Архив · '+archived.length+'</summary><div class="category-grid">'+archived.map(row).join('')+'</div></details>':'')+'</section>';
  }
  function categoryEditor(id) {
    const old=categories.findById(id,allRecords())||{},isNew=!old.id,chosenIcon=categories.iconKey(old);
    const iconPicker='<fieldset class="category-icon-picker"><legend>Значок</legend><div>'+categories.ICONS.map(key=>'<label><input type="radio" name="icon" value="'+key+'" '+(key===chosenIcon?'checked':'')+'>'+categorySymbol({icon:key})+'<span>'+categoryIconNames[key]+'</span></label>').join('')+'</div></fieldset>';
    openEditor(isNew?'Новая категория':'Изменить категорию',field('Название','title','text',old.title||'','required maxlength="48" placeholder="Например, продукты"')+iconPicker+selectField('Из какой части бюджета тратить','envelope',Object.entries(envelopeNames),old.envelope||'flexible')+'<p class="status-note">Название обновится в истории. Изменение части бюджета применяется к новым расходам; прежние суммы остаются на своих местах.</p>'+(!isNew?'<div class="category-editor-archive">'+button('Убрать в архив','archive-category','small secondary',old.id)+'<p class="status-note">История сохранится. Категорию можно вернуть позже.</p></div>':''),async data=>{
      const selectedIcon=String(data.get('icon')||chosenIcon);if(!categories.ICONS.includes(selectedIcon))throw new Error('Выбери значок из списка.');
      const record=categories.validateCategory({...old,id:old.id||'category-'+uid(),kind:'expense-category',month:'2000-03',title:String(data.get('title')||''),icon:selectedIcon,envelope:String(data.get('envelope')||''),archived:false,createdAt:old.createdAt||Date.now()},allRecords());
      store.put(record);toast('Категория сохранена. Теперь она доступна в редакторе расхода.');
    });
  }
  function archiveCategory(id,archived) {
    const record=categories.findById(id,allRecords());if(!record)return;
    if(!archived){try{store.put(categories.validateCategory({...record,archived:false},allRecords()));toast('Категория снова доступна для новых расходов.');}catch(e){toast(e.message);}return;}
    openEditor('Убрать категорию в архив?', '<p class="preview-intro">'+esc(record.title)+' не будет предлагаться для новых расходов. История и лимиты сохранятся. Категорию можно вернуть из архива.</p>',async()=>{const latest=categories.findById(id,allRecords());if(!latest)throw new Error('Категория уже недоступна.');store.put({...latest,archived:true});toast('Категория в архиве. Записанные траты сохранены.');});setEditorLabel('В архив');
  }
  function forecastPanel() {
    const currency=selectedCurrency(),f=forecast.summarize(allRecords(),{today:nowDate(),currency}),ready=f.status==='ready'||f.status==='shortfall';
    const title=f.status==='unconfigured'?'Когда следующее поступление?':f.status==='overdue'?'Обнови дату поступления':f.status==='due-today'?'Доход ожидается сегодня':money(f.perDay,currency)+' в день';
    const description=f.status==='unconfigured'?'Укажи дату дохода: HVF рассчитает, на сколько дней должен хватить свободный остаток.':f.status==='overdue'?'Плановая дата уже прошла. Если деньги пришли, запиши их как доход и укажи следующую дату.':f.status==='due-today'?'Будущие деньги ещё не прибавлены. После получения запиши доход и выбери следующую дату.':'До '+fmtDate(f.nextDate)+' · '+f.daysUntilIncome+' дней. На повседневные траты остаётся '+money(f.spendable,currency)+'.';
    return '<section class="forecast-card"><div class="forecast-heading"><p class="eyebrow">ПРОГНОЗ НА СЕГОДНЯ · '+fmtDate(nowDate()).toUpperCase()+'</p>'+button(f.nextDate?'Изменить дату':'Указать поступление','edit-income-plan','small secondary')+'</div><h2>'+esc(title)+'</h2><p>'+esc(description)+'</p>'+(f.expectedAmount!==null?'<p class="forecast-expected">Ожидается '+money(f.expectedAmount,currency)+(f.nextDate?' · '+fmtDate(f.nextDate):'')+'. В доступные деньги эта сумма не включена.</p>':'')+(ready?'<div class="forecast-facts"><span>Отложено сейчас <strong>'+money(f.protectedRemaining,currency)+'</strong></span><span>Предстоящие записанные платежи <strong>'+money(f.plannedExpenses+f.additionalObligations,currency)+'</strong></span></div>':'')+(f.uncertainObligations?.length?'<div class="notice warning">У '+f.uncertainObligations.length+' обязательных сумм будущих месяцев нет срока. Укажи число оплаты, чтобы учесть их в прогнозе.</div>':'')+(f.shortfall>0?'<div class="notice warning">По записанным обязательствам и тратам не хватает '+money(f.shortfall,currency)+'.</div>':'')+'<details class="forecast-method"><summary>Как считается</summary><p>Берутся полученные деньги и отложения текущего месяца в '+currency+'. Будущие записанные платежи до дохода учитываются; оплата уже отложенного не вычитается дважды. Дата дохода в расчёт дней не входит. Остаток прошлого месяца автоматически не переносится: если он есть, внеси его отдельным поступлением. Оценка меняется после записи трат.</p></details></section>';
  }
  function incomePlanEditor() {
    const currency=selectedCurrency(),id='income-plan-'+currency,item=getRecord(id)||{};
    openEditor('Следующее поступление · '+currency,field('Когда ожидаешь доход','nextDate','date',item.nextDate||'','required min="'+nowDate()+'"')+field('Ожидаемая сумма','expectedAmount','number',item.expectedAmount??'','min="0.01" max="1000000000" step="0.01" placeholder="Необязательно"')+'<p class="status-note">План нужен для прогноза. Он не увеличивает бюджет. Когда деньги придут, запиши их через «Доход» или укажи уже полученную зарплату.</p>',async data=>{
      const nextDate=String(data.get('nextDate')||'');if(!forecast.validDate(nextDate)||nextDate<nowDate())throw new Error('Укажи сегодняшнюю или будущую дату поступления.');
      store.put({...item,id,kind:'income-plan',month:'2000-04',currency,nextDate,expectedAmount:data.get('expectedAmount')?readAmount(data,'expectedAmount'):null,createdAt:item.createdAt||Date.now()});toast('Прогноз пересчитан до следующего поступления.');
    });
  }
  function limitsPanel() {
    const rows=limits.summarize(allRecords(),{month,currency:selectedCurrency()}),configured=rows.filter(r=>r.configured),available=rows.filter(r=>!r.configured&&!r.archived);
    const row=r=>'<article class="limit-card '+r.status+'"><div class="limit-top"><h3>'+esc(r.title)+'</h3>'+(r.configured?'<span class="tag">'+Math.round(r.percent)+'%</span>':'')+'</div><div class="limit-track"><div class="limit-fill" style="width:'+Math.min(100,r.percent)+'%"></div></div><div class="limit-amounts"><strong>'+money(r.spent)+'</strong><span>'+(r.configured?'из '+money(r.amount):'Лимит не задан')+'</span></div>'+(r.configured?'<p class="limit-alert '+r.status+'">'+(r.status==='exceeded'?(r.remaining<0?'Превышение на '+money(-r.remaining):'Лимит израсходован'):r.status==='near'?'Приближаешься к лимиту. Осталось '+money(r.remaining):'Можно потратить ещё '+money(r.remaining))+'</p>':'')+'<div class="limit-controls">'+button(r.configured?'Изменить':'Задать лимит','edit-limit','small secondary',r.id)+(r.configured?button('Убрать','delete','small secondary',r.id):'')+'</div></article>';
    return '<section class="panel">'+panelHead('Лимиты расходов')+'<p class="status-note planner-hint">Задай месячную границу для нужной категории или части бюджета. Общий лимит части включает её категории. Учитываются записанные расходы в '+selectedCurrency()+', включая будущие даты.</p>'+(configured.length?'<div class="limits-list">'+configured.map(row).join('')+'</div>':'<p class="status-note">Лимиты пока не заданы. Выбери категорию ниже, чтобы получать предупреждения о тратах.</p>')+(available.length?'<details class="limits-more"><summary>Задать '+(configured.length?'ещё один ':'')+'лимит</summary><div class="limits-list">'+available.map(row).join('')+'</div></details>':'')+'</section>';
  }
  function limitEditor(id) {
    const row=limits.summarize(allRecords(),{month,currency:selectedCurrency()}).find(r=>r.id===id);if(!row)return;
    const item=getRecord(id)||{};
    openEditor('Лимит · '+row.title,'<p class="status-note">'+esc(monthLabel())+' · '+selectedCurrency()+'. Это предупреждение о тратах, оно не переводит и не откладывает деньги.</p>'+field('Максимум на месяц','amount','number',row.amount||'','required min="0.01" max="1000000000" step="0.01"')+field('Предупредить после, %','warningPercent','number',row.warningPercent,'required min="50" max="100" step="1"'),async data=>{
      const warningPercent=Number(data.get('warningPercent'));if(!Number.isInteger(warningPercent)||warningPercent<50||warningPercent>100)throw new Error('Порог предупреждения — от 50 до 100 целых процентов.');
      store.put({...item,id:row.id,kind:'spending-limit',month:row.month,currency:row.currency,category:row.category,categoryTitle:row.title,amount:readAmount(data,'amount'),warningPercent,createdAt:item.createdAt||Date.now()});toast('Лимит сохранён. Он синхронизируется вместе с расходами.');
    });
  }
  function moneyView() {
    const b=budget(), now=nowDate(),monthLength=new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate();
    const days=month===now.slice(0,7)?monthLength-Number(now.slice(8))+1:month>now.slice(0,7)?monthLength:0;
    const daily=days?Math.floor(Math.round(b.freeToSpend*100)/days)/100:0;
    const actionsHtml='<div class="finance-actions">'+button(icon('plus')+' Доход','add-income','secondary')+button(icon('plus')+' Расход','add-expense')+'</div>';
    const warnings=(b.mandatoryShortfall?'<div class="notice warning">На обязательные суммы не хватает '+money(b.mandatoryShortfall)+'. Добавь поступление или скорректируй суммы.</div>':'')+(b.protectionShortfall?'<div class="notice warning">Расходы затронули отложенные деньги: сейчас не покрыто '+money(b.protectionShortfall)+'. Свободных денег пока нет.</div>':'')+(b.deficit?'<div class="notice warning">Расходы превысили доход на '+money(b.deficit)+'.</div>':'');
    return head('Деньги с намерением.','Обязательное — отложено. Свободное — видно.',actionsHtml)+currencyStrip()+'<p class="currency-note">'+currencies[selectedCurrency()]+'. BYN, USD и RUB считаются отдельно, без пересчёта по курсу. Старые записи без валюты сохранены в RUB.</p><div class="stats">'+stat('Все поступления',money(b.income),'Зарплата '+money(b.salaryIncome)+' · ещё '+money(b.additionalIncome),'wallet')+stat('Всего осталось',money(b.available),'Потрачено '+money(b.spent),'arrow')+stat('Свободно тратить',money(b.freeToSpend),'За вычетом отложенного','target')+'</div>'+warnings+forecastPanel()+'<div class="columns"><div class="stack">'+commitmentPanel(b)+'<section class="panel">'+panelHead('Дополнительные поступления')+financialHistory('income')+'</section><section class="panel">'+panelHead('История расходов')+financialHistory('expense')+'</section></div><div class="stack"><section class="panel"><div class="panel-head"><h2>Зарплата и план</h2><button type="button" class="text-link" data-action="edit-budget">Изменить ↗</button></div>'+(b.income?budgetLines(b,true):empty('wallet','Укажи зарплату за месяц','Дополнительные поступления записываются отдельно и тоже увеличивают бюджет.',button('Указать зарплату','edit-budget','small secondary')))+'<p class="status-note">Сначала обязательные суммы, потом '+b.reservePercent+'% остатка в резерв и '+b.goalsPercent+'% следующего остатка на цели. Неиспользованное остаётся свободным. Проценты можно изменить.</p></section><section class="panel">'+panelHead('На твои цели')+(b.goalAllocations.some(g=>g.target>0)?b.goalAllocations.filter(g=>g.target>0).map(g=>'<div class="allocation"><div class="allocation-top"><strong>'+esc(g.title)+'</strong><strong>'+money(g.allocation)+'</strong></div><p>План на месяц · оплачено '+money(g.spent)+'</p><p>Остаток плана '+money(g.budgetRemaining)+' · до цели '+money(g.remaining)+'</p></div>').join(''):empty('target','Для будущего важного','Укажи денежную цель в '+selectedCurrency()+', и она появится в плане.',button('+ Добавить цель','add-goal','small secondary')))+'</section>'+categoryPanel()+limitsPanel()+moneyAdvice(b,days)+'</div></div>';
  }
  function settingsView() {
    const s=settings();
    return head('Под твой ритм.','Настройки помощника и связь между устройствами.')+'<div class="stack"><section class="panel"><div class="settings-section"><h3>Телефон и компьютер — один помощник</h3><p>'+esc(syncText())+'</p>'+button(state.user?'Выйти из аккаунта':'Войти через Google','account','secondary')+'<p>'+esc(state.user?.email||'На обоих устройствах нужен один Google-аккаунт.')+'</p>'+(state.error?'<div class="notice warning">'+esc(state.error)+'</div>':'')+'</div><div class="settings-section"><h3>Время для дел · '+esc(monthLabel())+'</h3><p>Все дни выбранного месяца используют эти границы. Встроенных занятий нет; между делами оставляется указанный перерыв.</p><form id="rhythmForm" class="inline-form"><label class="field">Начало дня<input name="start" type="time" value="'+esc(s.start)+'" required></label><label class="field">Конец дня<input name="end" type="time" value="'+esc(s.end)+'" required></label><label class="field">Перерыв, мин<input name="breakMinutes" type="number" min="0" max="60" step="1" value="'+s.breakMinutes+'" required></label><button class="button" type="submit">Сохранить</button></form></div><div class="settings-section"><h3>Первый запуск</h3><p>Пройди три шага: доход, цель и конкретное дело. Сохранение происходит только в конце.</p>'+button('Начальная настройка','start-onboarding','secondary')+'</div><div class="settings-section"><h3>Резервная копия и восстановление</h3><p>Копия содержит все месяцы, дела, цели, финансы и категории. Храни её в безопасном месте: в файле есть личные данные.</p><div class="backup-actions">'+button(icon('download')+' Скачать полную копию','export','secondary')+'<label class="button secondary backup-file-label" for="backupFile">Восстановить из файла</label><input class="sr-only" id="backupFile" type="file" accept="application/json,.json" '+(state.status==='loading'?'disabled':'')+'></div><p class="status-note">Перед восстановлением покажем новые записи и совпадения. Ничего не удаляется автоматически. Поддерживаются и прежние месячные копии HVF.</p></div></section><section class="panel" id="remindersPanel"></section><section class="panel" id="installationPanel"></section></div>';
  }
  function syncText() {return state.error||({local:'Данные сохранены в этом браузере. Войди в Google для синхронизации.',loading:'Подключаю данные аккаунта…',syncing:'Изменения сохранены на устройстве. Отправляю их в облако…',synced:'Синхронизация включена. Изменения обновляются на всех устройствах.',offline:'Нет связи с облаком. Изменения на устройстве ожидают отправки.',error:'Не удалось синхронизировать данные.'}[state.status]||'Сохраняю данные…');}
  function remindersContent() {
    const s=reminders?.getStatus()||{},disabled=s.busy||!s.configured||!s.supported||!state.user;
    const controls=s.enabled?'<div class="reminder-controls">'+button('Прислать проверку','test-reminders','secondary')+button('Отключить здесь','disable-reminders','secondary')+'</div>':s.needsInstall?button('Как добавить на экран Домой','install-app','secondary'):'<button type="button" class="button" data-action="enable-reminders" '+(disabled?'disabled':'')+'>'+(s.busy?'Подключаю…':'Включить напоминания')+'</button>';
    return '<div class="reminder-heading"><span class="reminder-symbol">'+icon('bell')+'</span><div><h3>Напоминания на этом устройстве</h3><p class="status-note">HVF напомнит о деле с указанным временем, в том числе когда приложение закрыто.</p></div></div><p class="reminder-status '+(s.enabled?'enabled':'')+'" role="status">'+esc(s.message||(s.busy?'Подключаю напоминания…':!s.configured?'Сервис напоминаний ещё не подключён.':'Напоминания пока выключены на этом устройстве.'))+'</p>'+(s.error?'<p class="error">'+esc(s.error)+'</p>':'')+(!state.user?'<p class="status-note">Сначала войди в Google. Настройки дел будут общими на телефоне и компьютере.</p>'+button('Войти через Google','account','secondary'):controls)+'<ol class="reminder-steps"><li>Включи уведомления на этом устройстве.</li><li>В редакторе дела укажи начало и выбери «Напоминание».</li><li>Нажми «Прислать проверку», чтобы проверить доставку.</li></ol><p class="status-note">На iPhone нужен iOS 16.4 или новее: открой HVF с иконки на главном экране и разреши уведомления. Доставка зависит от сети и настроек фокусирования телефона.</p><p class="status-note">Время напоминаний — по Минску. Сервис обрабатывает название и время дела. Изменения расписания отправляются после синхронизации.</p>';
  }
  function installationContent() {
    const pwa=window.HVFPWA,status=pwa?.getStatus()||{};
    return '<h3>'+(status.installed?'HVF установлен на этом устройстве':'Приложение на телефоне и компьютере')+'</h3><p class="status-note">Постоянная ссылка: <a class="text-link" href="https://haveffee.github.io/daily-schedule/" target="_blank" rel="noopener noreferrer">haveffee.github.io/daily-schedule ↗</a><br>Приложение размещается на GitHub Pages. Компьютер можно выключать: телефон обращается к внешнему хостингу, а синхронизация работает через Firebase.</p><p class="status-note">На iPhone: открой ссылку в Safari → «Поделиться» → «На экран Домой». На компьютере: открой ссылку в Chrome или Edge → меню браузера → «Установить приложение».</p>'+(status.installed?'':button(status.canInstall?'Установить HVF':'Как установить','install-app','secondary'))+(status.offlineReady?'<p class="status-note">Файлы приложения сохранены на этом устройстве. Для входа и обмена данными между устройствами нужен интернет.</p>':'')+(status.updateReady?'<div class="notice">Доступно обновление. Оно применится после закрытия всех окон HVF и следующего открытия.</div>':'')+(status.error?'<p class="status-note">'+esc(status.error)+'</p>':'');
  }
  function showInstallHelp() {
    const help=window.HVFPWA?.getInstallInstructions()||{title:'Установить HVF',steps:['На iPhone открой постоянную ссылку в Safari.','Выбери «Поделиться» → «На экран Домой».','На компьютере открой ссылку в Chrome или Edge и выбери установку приложения в меню браузера.'],sourceUrl:'https://support.apple.com/guide/iphone/iph42ab2f3a7/ios'};
    openEditor(help.title,'<ol class="install-steps">'+help.steps.map(step=>'<li>'+esc(step)+'</li>').join('')+'</ol><p class="status-note">Для синхронизации войди в один Google-аккаунт на каждом устройстве.</p><a class="text-link" href="'+esc(help.sourceUrl)+'" target="_blank" rel="noopener noreferrer">Инструкция браузера ↗</a>',async()=>{});
    $('saveDialog').textContent='Понятно';$('cancelDialog').hidden=true;
  }
  function render() {
    const route=planner.validDate(reminderRouteDate())?'day':location.hash.slice(1);
    view=['overview','day','week','goals','money','settings','focus'].includes(route)?route:'overview';
    document.querySelectorAll('[data-view]').forEach(el=>{const active=el.dataset.view===(view==='week'?'overview':view==='focus'?'day':view);el.classList.toggle('active',active);el.setAttribute('aria-current',active?'page':'false');});
    $('monthPicker').value=month;
    $('content').innerHTML=view==='overview'?onboardingPanel()+focusMini()+overview()+weekTeaser():view==='day'?head('День в твоём ритме.',fmtDate(day,{weekday:'long',day:'numeric',month:'long'})+' · меняй дела, остальное пересчитается.',button(icon('plus')+' Добавить дело','add-task'))+onboardingPanel()+focusMini()+'<div class="stack">'+dayPanel()+routinePanel()+'</div>':view==='focus'?focusView():view==='week'?weeklyView():view==='goals'?goalsView():view==='money'?moneyView():settingsView();
    if(view==='settings'){$('installationPanel').innerHTML=installationContent();$('remindersPanel').innerHTML=remindersContent();}
    if(lastRenderedView!==view){const previous=lastRenderedView;lastRenderedView=view;navigation?.enter($('content'),previous,view);}
    $('syncShort').textContent={local:'На этом устройстве',synced:'Всё синхронизировано',offline:'Сохранено на устройстве',loading:'Подключение…',syncing:'Синхронизирую…',error:'Проверь синхронизацию'}[state.status]||'Сохраняю…';
    $('syncDetail').textContent=syncText();$('syncDot').className=state.status==='synced'?'online':state.status==='error'||state.status==='offline'?'warning':'';
    $('accountButton').textContent=state.user?'Выйти из аккаунта':'Войти через Google';$('accountEmail').textContent=state.user?.email||'';
    $('accountButton').disabled=state.status==='loading';
    $('syncBadge').title=syncText();$('syncBadge').classList.toggle('cloud-online',state.status==='synced');
    if(view==='goals')document.querySelectorAll('.goal-card').forEach((card,i)=>{const goal=records('goal')[i];if(goal)card.querySelector('.goal-buttons').insertAdjacentHTML('beforebegin',goalSteps(goal.id));});
  }
  function field(label,name,type,value='',extra='',hint='') {return '<label class="field">'+label+'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+extra+'>'+(hint?'<small>'+hint+'</small>':'')+'</label>';}
  function selectField(label,name,options,value='') {return '<label class="field">'+label+'<select name="'+name+'">'+options.map(([id,title])=>'<option value="'+esc(id)+'" '+(id===value?'selected':'')+'>'+esc(title)+'</option>').join('')+'</select></label>';}
  function openEditor(title,html,save) {
    if(busy)return;
    movePreview=null;editorLabel='Сохранить';
    $('dialogTitle').textContent=title;$('dialogFields').innerHTML=html;$('formError').textContent='';$('saveDialog').disabled=false;$('saveDialog').textContent='Сохранить';submitEditor=save;$('editor').showModal();
    $('cancelDialog').hidden=false;
  }
  function taskEditor(task,goalId) {
    const t=task||{}, goals=records('goal');
    openEditor(t.id?'Изменить дело':'Новое дело',(t.routineId?'<div class="notice">Изменится только это повторение. Всю серию можно настроить в разделе «Повторяющиеся дела».</div>':'')+field('Что нужно сделать','title','text',t.title||'','required maxlength="100" placeholder="Например, подготовить презентацию"')+'<div class="field-row">'+field('Дата','date','date',t.date||day,'required')+field('Начало, если важно','time','time',t.time||'')+'</div>'+field('Длительность, мин','duration','number',t.estimated?'':t.duration||'','min="5" max="480" step="1" placeholder="Определить автоматически"','Можно оставить пустым. Длительность будет примерно оценена по названию; её можно изменить.')+priorityField(t)+reminderField(t)+selectField('Связать с целью','goalId',[['','Без цели'],...goals.map(g=>[g.id,g.title])],t.goalId||goalId||''),async data=>{
      const chosenDate=String(data.get('date')), targetMonth=chosenDate.slice(0,7);
      if(!planner.validDate(chosenDate))throw new Error('Выбери дату.');
      const title=String(data.get('title')).trim();if(!title)throw new Error('Напиши название дела.');
      const estimate=!data.get('duration')?{minutes:core.estimateDuration(title),source:'local'}:null;
      const linked=String(data.get('goalId')||'');
      const minutes=estimate?estimate.minutes:Number(data.get('duration'));if(!Number.isInteger(minutes)||minutes<5||minutes>480)throw new Error('Длительность — от 5 до 480 целых минут.');
      const record={...cleanTask(t),id:t.id&&t.month===targetMonth?t.id:uid(),kind:'task',month:targetMonth,date:chosenDate,title,duration:minutes,time:String(data.get('time')||''),priority:planner.priorityValue(data.get('priority')??t),done:!!t.done,goalId:linked&&getRecord(linked)?.month===targetMonth?linked:'',estimated:!!estimate,estimateSource:estimate?.source||'manual',createdAt:t.createdAt||Date.now()};
      if(t.id&&t.date&&t.date!==chosenDate){record.moveCount=(Number(t.moveCount)||0)+1;record.movedFromDate=t.date;record.lastMovedDate=nowDate();record.lastMovedAt=new Date().toISOString();}
      record.reminderMinutes=readReminder(data,record.time,t.reminderMinutes);
      store.put(record);if(t.id&&t.id!==record.id&&getRecord(t.id))store.remove(t.id);
      if(targetMonth!==month){day=chosenDate;month=targetMonth;store.setPeriod(month,day);}
      toast('Дело сохранено на '+fmtDate(chosenDate)+'. План пересчитан.');
    });
  }
  const weekdays = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  function routinePanel() {
    const rules=allRecords().filter(r=>r.kind==='routine').sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
    return '<section class="panel routine-panel">'+panelHead('Повторяющиеся дела')+'<p class="status-note planner-hint">Выбери дни недели один раз. Отметка, перенос или удаление отдельного повторения не меняет остальные.</p>'+(rules.length?rules.map(r=>{const stopped=r.active===false||r.untilDate&&r.untilDate<day;return '<article class="routine-row"><div><h3>'+esc(r.title)+'</h3><p>'+esc((r.weekdays||[]).map(n=>weekdays[n-1]).join(' · '))+' · '+duration(r.duration)+(r.time?' · '+esc(r.time):'')+'</p><small>С '+fmtDate(r.startDate)+(r.untilDate?' по '+fmtDate(r.untilDate):'')+(stopped?' · серия остановлена':'')+'</small><div class="task-tags">'+priorityTag(r)+'</div></div><div class="routine-actions">'+button('Настроить','edit-routine','small secondary',r.id)+(!stopped?button('Остановить','stop-routine','small secondary',r.id):'')+'</div></article>';}).join(''):empty('calendar','Ритм, который подходит тебе','Учёба по вторникам, тренировки через день или еженедельный обзор — задай своё повторение.',''))+button('+ Повторяющееся дело','add-routine','small secondary')+'</section>';
  }
  function routineEditor(rule) {
    const r=rule||{}, selected=r.weekdays||[1,2,3,4,5];
    openEditor(rule?'Настроить повторение':'Повторяющееся дело',field('Что повторять','title','text',r.title||'','required maxlength="100"')+'<fieldset class="weekday-field"><legend>Дни недели</legend><div class="weekday-picker">'+weekdays.map((label,i)=>'<label><input type="checkbox" name="weekday'+(i+1)+'" value="'+(i+1)+'" '+(selected.includes(i+1)?'checked':'')+'><span>'+label+'</span></label>').join('')+'</div></fieldset><div class="field-row">'+field('Начать с','startDate','date',r.startDate||day,'required')+field('Повторять до','untilDate','date',r.untilDate||'','','Необязательно, включительно.')+'</div><div class="field-row">'+field('Начало, если важно','time','time',r.time||'')+field('Длительность, мин','duration','number',r.duration||'','min="5" max="480" step="1" placeholder="Оценить"')+'</div>'+priorityField(r)+reminderField(r)+'<p class="status-note">Изменения применятся к повторениям без отдельных правок. Выполненные, перенесённые и пропущенные дела сохранятся. Сохранение включает серию снова.</p>',async data=>{
      const title=String(data.get('title')||'').trim(),estimated=!data.get('duration');
      const record={...r,id:r.id||uid(),kind:'routine',month:'2000-02',title,weekdays:weekdays.map((_,i)=>i+1).filter(n=>data.get('weekday'+n)),startDate:String(data.get('startDate')||''),untilDate:String(data.get('untilDate')||''),time:String(data.get('time')||''),duration:estimated?core.estimateDuration(title):Number(data.get('duration')),priority:planner.priorityValue(data.get('priority')),active:true,estimated,estimateSource:estimated?'local':'manual',createdAt:r.createdAt||Date.now()};
      record.reminderMinutes=readReminder(data,record.time,r.reminderMinutes);
      const check=planner.validateRoutine(record);if(!check.valid)throw new Error(check.errors.join('\n'));
      store.put(record);toast('Повторение сохранено. Оно появится в выбранные дни.');
    });
  }
  function stopRoutine(id) {
    const rule=getRecord(id);if(!rule)return;
    openEditor('Остановить повторение?', '<p class="preview-intro">«'+esc(rule.title)+'» больше не будет автоматически появляться с '+fmtDate(day)+'. Прошлые дни и отдельно изменённые дела сохранятся.</p>',async()=>{
      const previous=new Date(day+'T12:00:00Z');previous.setUTCDate(previous.getUTCDate()-1);const until=previous.toISOString().slice(0,10);
      store.put({...rule,...(until>=rule.startDate?{untilDate:rule.untilDate&&rule.untilDate<until?rule.untilDate:until}:{active:false})});
      const scope=state.user?.uid||'anonymous';toast('Повторение остановлено.',()=>{if((state.user?.uid||'anonymous')===scope)store.put(rule);});
    });
    $('saveDialog').textContent='Остановить серию';
  }
  function movePlan(context) {return planner.prepareMove(allRecords(),context.from,context.to,{...rhythmFor(context.to),taskIds:[...context.selected]});}
  function showMovePreview(context) {
    const candidates=planner.tasksForDay(allRecords(),context.from).filter(t=>!t.done), preview=movePlan(context), ids=new Set(preview.moved.map(t=>t.id));
    context.fingerprint=JSON.stringify(preview);
    const row=(t,waiting)=>'<li class="preview-task '+(ids.has(t.id)?'incoming':'')+'"><span>'+(waiting?'Не помещается':time(t.start)+'–'+time(t.end))+'</span><div><strong>'+esc(t.title)+'</strong><small>'+(ids.has(t.id)?'Переносим · ':'Уже на завтра · ')+duration(t.duration)+(t.time?' · время сохранено':'')+'</small></div></li>';
    $('dialogFields').innerHTML='<p class="preview-intro">С '+fmtDate(context.from)+' на '+fmtDate(context.to)+'. Выбери, что перенести, и посмотри будущий план. Изменения сохранятся после подтверждения.</p><div class="move-selection">'+candidates.map(t=>'<label><input type="checkbox" data-move-task="'+esc(t.id)+'" '+(context.selected.has(t.id)?'checked':'')+'><span>'+esc(t.title)+'<small>'+duration(t.duration)+'</small></span>'+priorityTag(t)+'</label>').join('')+'</div><h3 class="preview-heading">Завтра · '+preview.moved.length+' к переносу</h3>'+(preview.placed.length?'<ol class="preview-plan">'+preview.placed.map(t=>row(t,false)).join('')+'</ol>':'<p class="status-note">Запланированных дел пока нет.</p>')+(preview.waiting.length?'<div class="notice warning">Не помещается: '+preview.waiting.length+(preview.conflicts.length?'. Есть пересечения по времени':'')+'. Эти дела останутся в списке на завтра без свободного слота. Время встреч сохраняется.</div><ol class="preview-plan">'+preview.waiting.map(t=>row(t,true)).join('')+'</ol>':'');
  }
  function openMovePreview() {
    const to=planner.nextDate(day), candidates=dailyTasks().filter(t=>!t.done);if(!to){toast('Не удалось выбрать следующий день.');return;}if(!candidates.length){toast('На этот день нет невыполненных дел для переноса.');return;}
    const context={from:day,to,selected:new Set(candidates.map(t=>t.id)),scope:state.user?.uid||'anonymous',fingerprint:''};
    openEditor('Перенести на завтра','',async()=>{
      if((state.user?.uid||'anonymous')!==context.scope)throw new Error('Аккаунт изменился. Открой перенос заново.');
      if(!context.selected.size)throw new Error('Выбери хотя бы одно дело.');
      const preview=movePlan(context);if(JSON.stringify(preview)!==context.fingerprint){showMovePreview(context);throw new Error('План изменился после синхронизации. Проверь обновлённый просмотр и подтверди ещё раз.');}
      if(!preview.moved.length)throw new Error('Эти дела уже выполнены или перенесены.');
      const stamp=new Date().toISOString();
      for(const task of preview.moved){const original=getTask(task.id);const record={...cleanTask(task),id:original?.month===task.month?task.id:uid(),lastMovedAt:stamp,lastMovedDate:nowDate(),goalId:task.goalId&&getRecord(task.goalId)?.month===task.month?task.goalId:"",createdAt:task.createdAt||Date.now()};store.put(record);if(record.id!==task.id&&getRecord(task.id))store.remove(task.id);}
      movePreview=null;changeDay(context.to);location.hash='day';toast('Перенесено дел: '+preview.moved.length+'.'+(preview.waiting.length?' Проверь дела без свободного времени.':''));
    });
    movePreview=context;showMovePreview(context);$('saveDialog').textContent='Перенести выбранное';
  }
  function weekSummary() {
    const source=allRecords(), bounds=weekly.summarize(source,{anchorDate:day});
    return weekly.summarize(source,{anchorDate:day,tasks:bounds.days.flatMap(d=>planner.tasksForDay(source,d.date))});
  }
  function weekTeaser() {
    const w=weekSummary();return '<section class="panel week-teaser">'+panelHead('Твоя неделя','week','Посмотреть итоги')+'<div><strong>'+w.completed+' <span>/ '+w.total+'</span></strong><p>дел выполнено · '+duration(w.completedMinutes)+' для важного</p></div><div class="progress-track"><div class="progress-fill" style="width:'+w.completionPercent+'%"></div></div><p class="status-note">'+fmtDate(w.startDate)+' — '+fmtDate(w.endDate)+' · прогресс целей, переносы и расходы в одном месте.</p></section>';
  }
  function weeklyView() {
    const w=weekSummary(), finance=w.finances.filter(f=>f.expenseCount||f.incomeCount);
    const taskLinks=(items,postponed)=>items.map(t=>'<button type="button" class="report-task" data-action="report-day" data-id="'+esc(t.date)+'"><span><strong>'+esc(t.title)+'</strong><small>'+fmtDate(t.date)+(postponed?' · '+t.count+' переносов за всё время':' · '+duration(t.duration))+'</small></span><span>↗</span></button>').join('');
    return head('Неделя в деталях.','Небольшой обзор того, что получилось и чему ещё нужно внимание.')+'<div class="week-controls"><div class="date-arrows"><button type="button" data-action="prev-week" aria-label="Предыдущая неделя">‹</button><button type="button" data-action="next-week" aria-label="Следующая неделя">›</button></div><strong>'+fmtDate(w.startDate)+' — '+fmtDate(w.endDate,{day:'numeric',month:'long',year:'numeric'})+'</strong><button class="text-link" type="button" data-action="today">Текущая неделя</button></div><div class="stats">'+stat('Дела выполнены',w.completed+' / '+w.total,w.completionPercent+'% недельного плана','check')+stat('Время на выполненное',duration(w.completedMinutes),'По длительности отмеченных дел','clock')+stat('Цели завершены',String(w.completedGoals.length),'По текущим данным связанных целей','target')+'</div><div class="columns"><div class="stack"><section class="panel">'+panelHead('В своём темпе')+'<div class="week-chart">'+w.days.map(d=>'<button type="button" class="week-day" data-action="report-day" data-id="'+d.date+'" aria-label="'+esc(fmtDate(d.date,{weekday:'long',day:'numeric',month:'long'}))+': выполнено '+d.completed+' из '+d.total+'"><span>'+d.completed+'/'+d.total+'</span><div class="week-column"><i style="height:'+(d.completed?Math.max(5,100*d.completed/d.total):0)+'%"></i></div><strong>'+fmtDate(d.date,{weekday:'short'})+'</strong><small>'+d.date.slice(8)+'</small></button>').join('')+'</div><p class="status-note">Нажми на день, чтобы открыть его дела.</p></section><section class="panel">'+panelHead('Прогресс целей')+(w.goalProgress.length?w.goalProgress.map(g=>'<div class="goal-mini"><div class="goal-mini-top"><span>'+esc(g.title)+'</span><small>'+g.progressPercent+'%</small></div><div class="progress-track"><div class="progress-fill" style="width:'+g.progressPercent+'%"></div></div><small>На этой неделе '+g.weekCompleted+' из '+g.weekTotal+' шагов'+(g.achieved?' · цель достигнута':'')+'</small></div>').join(''):'<p class="status-note">На этой неделе пока нет дел, связанных с целями месяца.</p>')+'</section><section class="panel">'+panelHead('Что переносится')+(w.postponed.length?taskLinks(w.postponed,true):'<p class="status-note">У дел этой недели пока нет переносов.</p>')+'<p class="status-note">Показаны дела этой недели и число их переносов за всё время. Это поможет заметить задачи, которые стоит упростить.</p></section></div><div class="stack"><section class="panel">'+panelHead('Важное ещё впереди')+(w.highPriorityPending.length?taskLinks(w.highPriorityPending,false):'<p class="status-note">Незавершённых дел с высоким приоритетом на этой неделе нет.</p>')+'</section><section class="panel">'+panelHead('Деньги за неделю')+(finance.length?finance.map(f=>'<div class="weekly-finance"><h3>'+f.currency+'</h3><div class="budget-line"><span>Расходы</span><strong>'+money(f.spent,f.currency)+'</strong></div><div class="budget-line"><span>Дополнительный доход</span><strong>'+money(f.income,f.currency)+'</strong></div>'+Object.entries(f.categories).filter(([,n])=>n>0).map(([k,n])=>'<div class="budget-line weekly-category"><span>'+envelopeNames[k]+'</span><strong>'+money(n,f.currency)+'</strong></div>').join('')+'</div>').join(''):'<p class="status-note">Запиши расходы или поступления — здесь появятся итоги по валютам.</p>')+'<p class="status-note">Валюты учитываются отдельно. Месячная зарплата без даты выплаты не входит в дополнительный доход недели.</p></section></div></div>';
  }
  function readAmount(data,name,zero=false) {
    const value=Number(data.get(name)||0);
    if(!Number.isFinite(value)||value<(zero?0:0.01)||value>1000000000)throw new Error('Проверь сумму: она должна быть '+(zero?'неотрицательной.':'больше нуля.'));
    return Math.round((value+Number.EPSILON)*100)/100;
  }
  function goalEditor(goal) {
    const g=goal||{},c=goal?recordCurrency(g):selectedCurrency();
    openEditor(goal?'Изменить цель':'Цель на '+monthLabel(),field('Чего хочешь достичь','title','text',g.title||'','required maxlength="100" placeholder="Например, запустить свой проект"')+'<label class="field">Результат к концу месяца<textarea name="outcome" maxlength="500" placeholder="Как ты поймёшь, что цель достигнута?">'+esc(g.outcome||'')+'</textarea></label>'+currencyField(c)+'<div class="field-row">'+field('Нужная сумма','target','number',g.target||'','min="0" max="1000000000" step="0.01" placeholder="Необязательно"')+field('Уже накоплено','saved','number',g.saved||'','min="0" max="1000000000" step="0.01" placeholder="0"')+'</div>'+selectField('Приоритет в бюджете','priority',[['2','Высокий'],['1','Обычный'],['0','Низкий']],String(g.priority??1))+'<p class="status-note">Суммы указаны в выбранной валюте. Смена валюты не пересчитывает число по курсу.</p>',async data=>{
      const title=String(data.get('title')).trim(),currency=String(data.get('currency'));if(!title)throw new Error('Напиши название цели.');
      if(!Object.hasOwn(currencies,currency))throw new Error('Выбери валюту.');
      const linked=g.id&&Object.values(state.records).some(r=>r.kind==='expense'&&r.goalId===g.id);
      if(linked&&currency!==recordCurrency(g))throw new Error('У цели уже есть расходы. Создай отдельную цель для другой валюты, чтобы сохранить их учёт.');
      store.put({...g,id:g.id||uid(),kind:'goal',month,currency,title,outcome:String(data.get('outcome')||'').trim(),target:readAmount(data,'target',true),saved:readAmount(data,'saved',true),priority:Number(data.get('priority')),createdAt:g.createdAt||Date.now()});toast('Цель сохранена. Бюджет обновлён.');
    });
  }
  function budgetEditor() {
    const c=selectedCurrency(),b=budgetConfig(c);
    openEditor('Зарплата и план · '+c,field('Зарплата за '+esc(monthLabel())+', '+c,'income','number',b.income||'','required min="0" max="1000000000" step="0.01" placeholder="Сумма зарплаты"')+'<div class="field-row">'+field('В резерв, %','reservePercent','number',b.reservePercent??20,'required min="0" max="100" step="1"','От остатка после обязательных сумм.')+field('На цели, %','goalsPercent','number',b.goalsPercent??20,'required min="0" max="100" step="1"','От остатка после резерва.')+'</div><p class="status-note">Подарки, подработки и другие поступления добавляются отдельно кнопкой «Доход». Обязательные суммы задаются в разделе «Обязательно отложить» и получают деньги первыми.</p>',async data=>{
      const r=Number(data.get('reservePercent')),g=Number(data.get('goalsPercent'));if(!Number.isFinite(r)||!Number.isFinite(g)||r<0||r>100||g<0||g>100)throw new Error('Процент должен быть от 0 до 100.');
      store.put({...b,id:b.id||'budget-'+month+'-'+c,kind:'budget',month,currency:c,income:readAmount(data,'income',true),reservePercent:r,goalsPercent:g});toast('Зарплата и распределение сохранены.');
    });
  }
  function incomeEditor(income) {
    const item=income||{};
    openEditor(income?'Изменить поступление':'Дополнительный доход',field('Откуда деньги','title','text',item.title||'','required maxlength="100" placeholder="Подарок, подработка, возврат…"')+currencyField(income?recordCurrency(item):selectedCurrency())+'<div class="field-row">'+field('Сумма','amount','number',item.amount||'','required min="0.01" max="1000000000" step="0.01"')+field('Дата поступления','date','date',item.date||day,'required')+'</div><p class="status-note">Поступление прибавится к зарплате в своей валюте. Если деньги уже учтены в зарплате, повторно добавлять их не нужно.</p>',async data=>{
      const title=String(data.get('title')).trim(),date=String(data.get('date')),currency=String(data.get('currency')),targetMonth=date.slice(0,7);
      if(!title||!planner.validDate(date)||!Object.hasOwn(currencies,currency))throw new Error('Проверь название, дату и валюту.');
      const record={...item,id:item.id&&item.month===targetMonth?item.id:uid(),kind:'income',month:targetMonth,currency,date,title,amount:readAmount(data,'amount'),createdAt:item.createdAt||Date.now()};
      store.put(record);if(item.id&&item.id!==record.id)store.remove(item.id);
      if(targetMonth!==month){day=date;month=targetMonth;store.setPeriod(month,day);}setCurrency(currency);toast('Поступление добавлено. Бюджет пересчитан.');
    });
  }
  function commitmentEditor(commitment) {
    const item=commitment||{};
    openEditor(commitment?'Изменить обязательную сумму':'Обязательно отложить',field('На что откладываем','title','text',item.title||'','required maxlength="100" placeholder="Репетиторы, проезд, связь…"')+currencyField(commitment?recordCurrency(item):selectedCurrency())+'<div class="field-row">'+field('Сумма на месяц','amount','number',item.amount||'','required min="0.01" max="1000000000" step="0.01" placeholder="Например, 680"')+field('До какого числа','dueDay','number',item.dueDay||'','min="1" max="31" step="1" placeholder="Необязательно"')+'</div><p class="status-note">Сумма будет защищена от свободных трат. Это ещё не расход: когда оплатишь, нажми «Записать оплату» у этого пункта. При нехватке денег пункты получают их по порядку добавления.</p>',async data=>{
      const title=String(data.get('title')).trim(),currency=String(data.get('currency')),dueDay=Number(data.get('dueDay')||0);
      if(!title||!Object.hasOwn(currencies,currency)||!Number.isInteger(dueDay)||dueDay<0||dueDay>31)throw new Error('Проверь название, валюту и число месяца.');
      if(item.id&&currency!==recordCurrency(item)&&Object.values(state.records).some(r=>r.kind==='expense'&&r.commitmentId===item.id))throw new Error('У пункта уже есть оплаты. Для другой валюты создай отдельный пункт.');
      store.put({...item,id:item.id||uid(),kind:'commitment',month,currency,title,amount:readAmount(data,'amount'),dueDay,createdAt:item.createdAt||Date.now()});setCurrency(currency);toast('Обязательная сумма отложена в плане.');
    });
  }
  function expenseCategories(currency,date,item={}) {
    const matching=Object.values(state.records).filter(r=>r.month===date.slice(0,7)&&recordCurrency(r)===currency);
    const options=[['flexible','Свободные деньги'],['essentials','Обязательные расходы без отложения'],['reserve','Резерв'],['goals','Цели без привязки'],...categories.list(allRecords()).map(r=>['category:'+r.id,r.title+' · '+envelopeNames[r.envelope]]),...matching.filter(r=>r.kind==='commitment').map(r=>['commitment:'+r.id,'Обязательное: '+r.title]),...matching.filter(r=>r.kind==='goal'&&Number(r.target)>0).map(r=>['goal:'+r.id,'Цель: '+r.title])];
    if(item.id&&item.expenseCategoryId&&!options.some(([v])=>v==='category:'+item.expenseCategoryId))options.push(['category:'+item.expenseCategoryId,categories.classification(item,allRecords()).title+' (архив)']);
    if(item.id&&recordCurrency(item)===currency&&item.month===date.slice(0,7)){
      for(const [kind,id,label] of [['commitment',item.commitmentId,item.commitmentTitle||'Обязательное (архив)'],['goal',item.goalId,'Цель (архив)']])if(id&&!options.some(([v])=>v===kind+':'+id))options.push([kind+':'+id,label]);
    }
    return options;
  }
  function expenseEditor(expense) {
    const e=expense||{},c=expense?recordCurrency(e):selectedCurrency(),date=e.date||day;
    const category=e.commitmentId?'commitment:'+e.commitmentId:e.goalId?'goal:'+e.goalId:e.expenseCategoryId?'category:'+e.expenseCategoryId:categories.classification(e,allRecords()).envelope;
    openEditor(expense?.id?'Изменить расход':'Записать расход',field('На что потрачено','title','text',e.title||'','required maxlength="100" placeholder="Например, продукты"')+currencyField(c)+'<div class="field-row">'+field('Сумма','amount','number',e.amount||'','required min="0.01" max="1000000000" step="0.01"')+field('Дата','date','date',date,'required')+'</div><div id="expenseCategoryField">'+selectField('Категория или обязательный платёж','category',expenseCategories(c,date,e),category)+'</div><p class="status-note">Для оплаты репетиторов или проезда выбери нужный обязательный пункт. Обычные траты уменьшают свободные деньги.</p>',async data=>{
      const title=String(data.get('title')).trim(),date=String(data.get('date')),currency=String(data.get('currency')),targetMonth=date.slice(0,7),category=String(data.get('category'));
      if(!title||!planner.validDate(date)||!Object.hasOwn(currencies,currency))throw new Error('Проверь название, дату и валюту.');
      const commitmentId=category.startsWith('commitment:')?category.slice(11):'',goalId=category.startsWith('goal:')?category.slice(5):'';
      for(const [id,kind,original] of [[commitmentId,'commitment',e.commitmentId],[goalId,'goal',e.goalId]]){
        if(!id)continue;const linked=getRecord(id);
        if(linked?(linked.kind!==kind||linked.month!==targetMonth||recordCurrency(linked)!==currency):!(e.id&&id===original&&e.month===targetMonth&&recordCurrency(e)===currency))throw new Error('Выбери пункт из того же месяца и в той же валюте.');
      }
      const categoryId=category.startsWith('category:')?category.slice(9):'',custom=categoryId?categories.findById(categoryId,allRecords()):null;
      if(categoryId&&(!custom||custom.archived)&&!(e.id&&e.expenseCategoryId===categoryId))throw new Error('Категория больше недоступна. Выбери другую.');
      if(!expenseCategories(currency,date,e).some(([value])=>value===category))throw new Error('Выбери существующую категорию расхода.');
      const sameCustom=!!categoryId&&e.expenseCategoryId===categoryId;
      const categoryEnvelope=categoryId?(sameCustom?categories.classification(e,allRecords()).envelope:custom.envelope):category;
      const record={...e,id:e.id&&e.month===targetMonth?e.id:uid(),kind:'expense',month:targetMonth,currency,date,title,amount:readAmount(data,'amount'),category:commitmentId?'essentials':goalId?'goal':categoryEnvelope,expenseCategoryId:categoryId,expenseCategoryTitle:categoryId?(custom?.title||e.expenseCategoryTitle||'Категория из архива'):'',expenseCategoryIcon:categoryId?categories.iconKey(custom||{icon:e.expenseCategoryIcon}):'',goalId,commitmentId,commitmentTitle:commitmentId?(getRecord(commitmentId)?.title||e.commitmentTitle||''):'',createdAt:e.createdAt||Date.now()};
      const before=limits.summarize(allRecords(),{month:targetMonth,currency});
      store.put(record);if(e.id&&e.id!==record.id)store.remove(e.id);if(targetMonth!==month){day=date;month=targetMonth;store.setPeriod(month,day);}setCurrency(currency);const warnings=limits.crossing(before,limits.summarize(allRecords(),{month:targetMonth,currency}));toast(warnings.length?'Расход записан. '+warnings.map(r=>r.title+': '+(r.status==='exceeded'?'лимит израсходован':'достигнуто '+Math.round(r.percent)+'% лимита')).join('. ')+'.':'Расход записан. Остатки обновлены.');
    });
    for(const el of $('editorForm').querySelectorAll('[name="currency"],[name="date"]'))el.addEventListener('change',()=>{
      const f=$('editorForm'),previous=f.elements.category.value,options=expenseCategories(f.elements.currency.value,f.elements.date.value,e);
      $('expenseCategoryField').innerHTML=selectField('Категория или обязательный платёж','category',options,options.some(([v])=>v===previous)?previous:'flexible');
    });
  }
  function copyCommitments() {
    const date=new Date(month+'-01T12:00:00Z');date.setUTCMonth(date.getUTCMonth()-1);const previous=date.toISOString().slice(0,7),c=selectedCurrency();
    const signature=r=>JSON.stringify([r.title.trim().toLowerCase(),r.amount,r.dueDay||0]);
    const existing=new Set(currencyRecords('commitment').map(signature));
    const source=Object.values(state.records).filter(r=>r.kind==='commitment'&&r.month===previous&&recordCurrency(r)===c).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
    let count=0;for(const item of source){const key=signature(item);if(existing.has(key))continue;existing.add(key);store.put({...item,id:uid(),month,createdAt:Date.now()+count++});}
    toast(count?'Добавлено обязательных сумм: '+count+'. Оплаты прошлого месяца не перенесены.':'В прошлом месяце нет новых для переноса сумм в '+c+'.');
  }
  function deleteRecord(id) {
    const task=getTask(id);
    if(task?.routineId){
      const original=getRecord(id),occurrence=task.occurrenceDate||task.date,skipId=planner.routineSkipId(task.routineId,occurrence),scope=state.user?.uid||'anonymous';
      store.put({id:skipId,kind:'routine-skip',month:occurrence.slice(0,7),routineId:task.routineId,occurrenceDate:occurrence,date:occurrence,createdAt:Date.now()});
      if(original)store.remove(id);
      toast('Это повторение пропущено. Остальная серия сохранена.',()=>{if((state.user?.uid||'anonymous')!==scope){toast('Вернись в исходный аккаунт для восстановления.');return;}if(original)store.put(original);store.remove(skipId);toast('Повторение восстановлено.');});return;
    }
    const record=getRecord(id);if(!record)return;
    const removed=[record,...(record.kind==='goal'?Object.values(state.records).filter(r=>r.kind==='task'&&r.goalId===id):[])];
    const scope=state.user?.uid||'anonymous';removed.forEach(r=>store.remove(r.id));
    toast(record.kind==='goal'?'Цель и её шаги удалены.':record.kind==='task'?'Дело удалено. План пересчитан.':record.kind==='income'?'Поступление удалено. Бюджет пересчитан.':record.kind==='commitment'?'Обязательная сумма удалена. Записанные оплаты сохранены.':record.kind==='spending-limit'?'Лимит удалён. Расходы сохранены.':'Расход удалён.',()=>{if((state.user?.uid||'anonymous')!==scope){toast('Вернись в исходный аккаунт для восстановления.');return;}removed.forEach(r=>store.put(r));toast('Записи восстановлены.');});
  }
  function changeDay(value) {if(!planner.validDate(value))return;day=value;month=day.slice(0,7);store.setPeriod(month,day);render();}
  function shiftDay(delta) {const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+delta);changeDay(d.toISOString().slice(0,10));}
  document.addEventListener('click',event=>{
    const el=event.target.closest('[data-action]');if(!el||el.disabled)return;
    const action=el.dataset.action,id=el.dataset.id;
    if(action==='add-task')taskEditor();else if(action==='edit-task')taskEditor(getTask(id));else if(action==='goal-task')taskEditor(null,id);
    else if(action==='focus-task')focusEditor(id);
    else if(action==='focus-pause')focus.pause();else if(action==='focus-resume')focus.resume();else if(action==='focus-stop')focus.stop();else if(action==='focus-break')focus.startBreak(Number(id));
    else if(action==='start-onboarding')startOnboarding();
    else if(action==='skip-onboarding'){store.put({id:'onboarding-preferences',kind:'onboarding-preferences',month:'2000-05',completed:true,version:1,completedAt:new Date().toISOString()});toast('Настройку можно открыть позже в разделе «Настройки».');}
    else if(action==='onboarding-back'&&onboarding){captureOnboarding(new FormData($('editorForm')),false);onboarding.step=Math.max(0,onboarding.step-1);showOnboarding();}
    else if(action==='add-category')categoryEditor();else if(action==='edit-category')categoryEditor(id);else if(action==='archive-category')archiveCategory(id,true);else if(action==='restore-category')archiveCategory(id,false);
    else if(action==='edit-income-plan')incomePlanEditor();
    else if(action==='important-only'){importantOnly=!importantOnly;render();}
    else if(action==='add-routine')routineEditor();else if(action==='edit-routine')routineEditor(getRecord(id));else if(action==='stop-routine')stopRoutine(id);
    else if(action==='move-preview')openMovePreview();
    else if(action==='enable-reminders'||action==='disable-reminders'||action==='test-reminders'){
      const operation=action==='enable-reminders'?'enable':action==='disable-reminders'?'disable':'test';
      if(reminders)void reminders[operation]().then(result=>{if(result===true)toast(operation==='test'?'Проверка отправлена. Проверь уведомления устройства.':operation==='disable'?'Напоминания на этом устройстве отключены.':'Напоминания подключены. Выбери их в нужных делах.');}).catch(e=>toast(e.message||'Не удалось настроить напоминания.'));
    }
    else if(action==='report-day'){importantOnly=false;changeDay(id);location.hash='day';}
    else if(action==='prev-week')shiftDay(-7);else if(action==='next-week')shiftDay(7);
    else if(action==='add-goal')goalEditor();else if(action==='edit-goal')goalEditor(getRecord(id));
    else if(action==='edit-limit')limitEditor(id);
    else if(action==='edit-budget')budgetEditor();else if(action==='add-expense')expenseEditor();else if(action==='edit-expense')expenseEditor(getRecord(id));
    else if(action==='currency')setCurrency(id);
    else if(action==='add-income')incomeEditor();else if(action==='edit-income')incomeEditor(getRecord(id));
    else if(action==='add-commitment')commitmentEditor();else if(action==='edit-commitment')commitmentEditor(getRecord(id));
    else if(action==='copy-commitments')copyCommitments();
    else if(action==='install-app'){
      const pwa=window.HVFPWA;
      if(!pwa?.getStatus().canInstall)showInstallHelp();
      else void pwa.requestInstall().then(result=>{if(result.outcome==='accepted')toast('Установка подтверждена. HVF появится среди приложений.');else if(result.outcome==='error'||result.outcome==='unavailable')showInstallHelp();});
    }
    else if(action==='pay-commitment'){const c=getRecord(id),allocation=budget().commitmentAllocations.find(r=>r.id===id);if(c)expenseEditor({title:c.title,amount:Math.max(0.01,c.amount-(allocation?.spent||0)),currency:recordCurrency(c),date:day,category:'essentials',commitmentId:c.id,commitmentTitle:c.title});}
    else if(action==='delete')deleteRecord(id);else if(action==='account')void store.signInOut().catch(e=>toast(e.message));
    else if(action==='open-task-day'){const task=getTask(id);if(task){importantOnly=false;changeDay(task.date);location.hash='day';}}
    else if(action==='prev-day')shiftDay(-1);else if(action==='next-day')shiftDay(1);else if(action==='today')changeDay(nowDate());
    else if(action==='export'){
      try{if(state.status==='loading')throw new Error('Дождись загрузки данных аккаунта перед созданием копии.');const blob=new Blob([JSON.stringify(backup.create(allRecords()),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='HVF-backup-'+nowDate()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Полная копия подготовлена. Сохрани файл в надёжном месте.');}catch(error){toast(error.message||'Не удалось создать копию.');}
    }
  });
  document.addEventListener('change',event=>{
    const el=event.target;
    if(el.id==='backupFile'){void readBackupFile(el.files?.[0]);}
    else if(el.id==='replaceExisting'&&restoreContext){restoreContext.replace=el.checked;showRestorePreview();$('formError').textContent='';}
    else if(el.dataset.taskCheck){const task=getTask(el.dataset.taskCheck);if(task){completionFlash=el.checked?{id:task.id,at:Date.now()}:null;store.put({...cleanTask(task),done:el.checked,completedDate:el.checked?nowDate():'',completedAt:el.checked?new Date().toISOString():'',createdAt:task.createdAt||Date.now()});}}
    else if(el.dataset.moveTask&&movePreview){if(el.checked)movePreview.selected.add(el.dataset.moveTask);else movePreview.selected.delete(el.dataset.moveTask);showMovePreview(movePreview);$('formError').textContent='';}
    else if(el.id==='dayPicker')changeDay(el.value);

  });
  document.addEventListener('submit',event=>{
    if(event.target.id!=='rhythmForm')return;event.preventDefault();const d=new FormData(event.target),start=String(d.get('start')),end=String(d.get('end'));
    if(start>=end){toast('Конец дня должен быть позже начала.');return;}
    store.put({id:'settings-'+month,kind:'settings',month,start,end,breakMinutes:Number(d.get('breakMinutes'))});toast('Ритм сохранён. Дела пересчитаны.');
  });
  $('editorForm').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!submitEditor)return;
    const save=submitEditor, data=new FormData(event.target),scope=state.user?.uid||'anonymous',formMonth=month;
    busy=true;$('saveDialog').disabled=true;$('saveDialog').textContent='Сохраняю…';$('formError').textContent='';
    try{const result=await saveGuarded(save,data,scope,formMonth);if(!result?.keepOpen){$('editor').close();movePreview=null;}}catch(error){$('formError').textContent=error.message||'Не удалось сохранить.';}finally{busy=false;$('saveDialog').disabled=!!restoreContext&&!backup.importPlan(allRecords(),restoreContext.parsed,{mode:restoreContext.replace?'replace':'merge'}).records.length;$('saveDialog').textContent=movePreview?'Перенести выбранное':editorLabel;if(!$('editor').open&&pendingReminderDate)openReminderDay(pendingReminderDate);render();}
  });
  async function saveGuarded(save,data,scope,formMonth){
    // Reject a stale editor after an account or period change.
    if((state.user?.uid||'anonymous')!==scope||month!==formMonth)throw new Error('Аккаунт или месяц изменился. Открой форму заново.');
    return await save(data);
  }
  $('monthPicker').addEventListener('change',event=>{const value=event.target.value;if(!/^\d{4}-\d{2}$/.test(value)||busy)return;month=value;day=month===nowDate().slice(0,7)?nowDate():month+'-01';store.setPeriod(month,day);render();});
  $('accountButton').addEventListener('click',()=>{if(!busy)void store.signInOut().catch(e=>toast(e.message));});
  function closeEditor(){if(busy){toast('Дождись сохранения.');return;}$('editor').close();movePreview=null;onboarding=null;restoreContext=null;if(pendingReminderDate)openReminderDay(pendingReminderDate);}
  $('closeDialog').addEventListener('click',closeEditor);$('cancelDialog').addEventListener('click',closeEditor);
  $('editor').addEventListener('cancel',e=>{if(busy)e.preventDefault();else {movePreview=null;onboarding=null;restoreContext=null;}});
  $('editor').addEventListener('close',()=>{if(pendingReminderDate&&!busy)openReminderDay(pendingReminderDate);});
  $('editor').addEventListener('click',event=>{if(event.target===$('editor')){const r=$('editor').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeEditor();}});
  $('closeToast').addEventListener('click',()=>$('toast').hidden=true);$('undoButton').addEventListener('click',()=>{const fn=undoAction;undoAction=null;$('toast').hidden=true;if(fn)fn();});
  function openReminderDay(date) {
    if(!planner.validDate(date))return;
    if(busy||$('editor').open){pendingReminderDate=date;toast('Есть напоминание на '+fmtDate(date)+'. Открою день после закрытия формы.');return;}
    pendingReminderDate='';importantOnly=false;changeDay(date);location.hash='day';render();window.scrollTo(0,0);
  }
  window.addEventListener('hashchange',()=>{if(planner.validDate(reminderRouteDate()))openReminderDay(reminderRouteDate());else render();window.scrollTo(0,0);});
  window.addEventListener('hvf-open-reminder',event=>openReminderDay(event.detail?.date));
  window.addEventListener('hvf-pwa-status',()=>{if(view==='settings')$('installationPanel').innerHTML=installationContent();});
  let lastScope=state.user?.uid||'anonymous';
  store.subscribe(next=>{const nextScope=next.user?.uid||'anonymous';if(lastScope!==nextScope){pendingReminderDate='';completionFlash=null;onboarding=null;restoreContext=null;if($('editor').open){$('editor').close();submitEditor=null;movePreview=null;toast('Аккаунт изменился. Открой форму заново.');}}const changed=lastScope!==nextScope;lastScope=nextScope;state=next;if(changed)focus.setScope(next.user?.uid||null);render();});

  reminders?.subscribe(()=>{if(view==='settings')$('remindersPanel').innerHTML=remindersContent();});
  if(reminders)void reminders.init().catch(e=>toast(e.message||'Сервис напоминаний временно недоступен.'));
  focus.setScope(state.user?.uid||null);focus.init();
  focus.subscribe((f,event)=>{if(event.type==='tick'){const face=$('focusTime'),mini=$('focusMiniTime');if(face)face.textContent=focusClock(f.remainingMs);if(mini)mini.textContent=focusClock(f.remainingMs);return;}if(event.type==='finished')toast(f.mode==='break'?'Перерыв закончился. Можно выбрать следующее дело.':'Время фокуса вышло. Отметь результат в списке дел.');if(view==='focus'||view==='overview'||view==='day')render();});
  navigation?.init();
  store.setPeriod(month,day);render();void store.init();
}());
