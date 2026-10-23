(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const core = window.HVFCore, store = window.HVFStore, ai = window.HVFAI;
  const paths = {
    home:'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
    calendar:'M5 5h14a2 2 0 0 1 2 2v13H3V7a2 2 0 0 1 2-2ZM7 3v4m10-4v4M3 10h18m-13 4h2m4 0h2m-8 3h2',
    target:'M21 12a9 9 0 1 1-9-9m5 0v4h4m-9 5 7-7M16 12a4 4 0 1 1-4-4',
    wallet:'M21 7H5a2 2 0 0 1 0-4h13v4M3 5v14a2 2 0 0 0 2 2h16V7m0 6h-6v4h6m-3-2h.1',
    settings:'m9 3-1 3-3 1-2 3 2 3v4l3 1 2 3 3-2 4-1 1-3 3-2-2-3V6l-3-1-2-2-3 2Zm6 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    plus:'M12 5v14M5 12h14', edit:'m16 3 5 5-12 12-6 1 1-6Zm-2 2 5 5', delete:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
    clock:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2', spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4m-2-2h4',
    assistant:'M16 9a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2M3 7V5m-1 1h2m16-4v4m-2-2h4', arrow:'M5 12h14m-5-5 5 5-5 5', check:'m5 12 4 4L19 6', download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5'
  };
  const icon = (key) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(paths[key]||paths.spark)+'"/></svg>';
  document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2);
  const nowDate = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Minsk',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  let day = nowDate(), month = day.slice(0,7), state = store.getState(), view = 'overview', lastRenderedView = '', submitEditor = null, busy = false, planningGoal = '', toastTimer, undoAction;
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
  const dailyTasks = () => records('task').filter(t=>t.date===day);
  const budget = (currency=selectedCurrency()) => core.allocateBudget({...budgetConfig(currency),currency,incomes:records('income'),commitments:records('commitment'),goals:records('goal'),expenses:records('expense')});
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
    return tasks.map(t=>'<article class="task-row'+(t.done?' done':'')+'"><input type="checkbox" data-task-check="'+esc(t.id)+'" aria-label="Выполнено: '+esc(t.title)+'" '+(t.done?'checked':'')+'><div class="task-time">'+(waiting?'Не влезло':time(t.start))+'<small>'+(waiting?esc(t.time||'без времени'):time(t.end))+'</small></div><div class="task-copy"><h3>'+esc(t.title)+'</h3><p>'+duration(t.duration)+(t.goalId?' · '+esc(getRecord(t.goalId)?.title||'Цель месяца'):'')+'</p>'+(waiting?'<span class="tag warn">Измени время или дату</span>':t.estimated?'<span class="tag '+(t.estimateSource==='qwen'?'ai':'')+'">'+(t.estimateSource==='qwen'?'Оценка Qwen':'Примерное время')+'</span>':t.time?'<span class="tag">Фиксированное время</span>':'')+'</div>'+actions('task',t.id)+'</article>').join('');
  }
  function dayPanel(compact=false) {
    const p=plan(), set=settings();
    const tools=compact?'':'<div class="day-tools"><div class="date-arrows"><button type="button" data-action="prev-day" aria-label="Предыдущий день">‹</button><button type="button" data-action="next-day" aria-label="Следующий день">›</button></div><label><span class="sr-only">Дата дел</span><input type="date" id="dayPicker" value="'+day+'" required></label><button type="button" class="text-link" data-action="today">Сегодня</button><span class="day-meta">'+esc(set.start)+'–'+esc(set.end)+' · перерыв '+set.breakMinutes+' мин</span></div>';
    return '<section class="panel">'+panelHead(compact?'Мой день':'Дела на '+fmtDate(day),compact?'day':'',compact?'Открыть день':'')+tools+(p.placed.length?taskRows(compact?p.placed.slice(0,5):p.placed):!p.waiting.length?empty('calendar','В этом дне есть место для тебя','Добавь первое дело. Время можно не указывать — помощник предложит длительность.',button('+ Добавить дело','add-task','small secondary')):'')+(p.waiting.length?'<div class="notice warning">'+p.waiting.length+' дел пока не помещаются'+(p.conflicts.length?' или пересекаются с другими встречами':'')+'. Они сохранены: можно изменить время, длительность или перенести их на другой день.</div>'+taskRows(p.waiting,true):'')+(p.placed.length&&compact&&p.placed.length>5?'<a class="text-link" href="#day">Ещё '+(p.placed.length-5)+' дел →</a>':'')+'</section>';
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
    return head('Твои большие «хочу».','Задай направление на месяц. Разобьём путь на небольшие шаги.',button(icon('plus')+' Добавить цель','add-goal'))+(goals.length?'<div class="goal-grid">'+goals.map(g=>{const p=progress(g);return '<section class="panel goal-card"><div class="goal-top"><div class="goal-badge">'+icon('target')+'</div>'+actions('goal',g.id)+'</div><h3>'+esc(g.title)+'</h3><p class="outcome">'+esc(g.outcome||'Опиши результат, к которому хочешь прийти в этом месяце.')+'</p><div class="goal-bottom"><div class="goal-numbers"><span>'+p.text+'</span><strong>'+p.percent+'%</strong></div><div class="progress-track"><div class="progress-fill" style="width:'+p.percent+'%"></div></div>'+(Number(g.target)>0?'<p class="status-note">Денежная цель: '+money(g.target,recordCurrency(g))+' · '+(g.priority>=2?'высокий':g.priority===0?'низкий':'обычный')+' приоритет</p>':'')+'<div class="goal-buttons">'+button(planningGoal===g.id?'Продумываю шаги…':records('task').some(t=>t.goalId===g.id)?'Добавить шаг вручную':'Разбить на шаги',records('task').some(t=>t.goalId===g.id)?'goal-task':'plan-goal','small secondary',g.id)+'</div></div></section>';}).join('')+'</div>':'<section class="panel">'+empty('target','Твой месяц — чистый лист','Никаких встроенных целей. Напиши, чего хочешь достичь: закончить проект, освоить навык или накопить на важное.',button('+ Добавить первую цель','add-goal'))+'</section>')+'<div class="notice">Шаги появятся в плане дня. Если указать сумму цели, она также попадёт в распределение зарплаты. Предложенный план можно менять.</div>';
  }
  function goalSteps(goalId) {
    const steps=records('task').filter(t=>t.goalId===goalId).sort((a,b)=>a.date.localeCompare(b.date));
    return steps.length?'<div class="goal-steps">'+steps.map(t=>'<button type="button" class="goal-step" data-action="open-task-day" data-id="'+esc(t.id)+'"><span class="step-check">'+(t.done?'✓':'○')+'</span><span>'+esc(t.title)+'<small>'+fmtDate(t.date)+' · '+duration(t.duration)+'</small></span><span>↗</span></button>').join('')+'</div>':'';
  }
  function financialHistory(kind) {
    const items=currencyRecords(kind).sort((a,b)=>b.date.localeCompare(a.date)||(b.createdAt||0)-(a.createdAt||0));
    if(!items.length)return empty('wallet',kind==='income'?'Подарки и подработки — тоже доход':'Пока без расходов',kind==='income'?'Поступления добавляются к зарплате и увеличивают бюджет.':'Записывай траты, чтобы видеть точный свободный остаток.',button(kind==='income'?'+ Добавить поступление':'+ Записать расход',kind==='income'?'add-income':'add-expense','small secondary'));
    return items.map(item=>{
      const category=kind==='income'?'Дополнительный доход':item.commitmentId?(getRecord(item.commitmentId)?.title||item.commitmentTitle||'Обязательная сумма (архив)'):item.category==='goal'?(getRecord(item.goalId)?.title||'Цель (архив)'):envelopeNames[item.category]||'Свободные деньги';
      return '<article class="expense-row"><span class="expense-icon '+(kind==='income'?'income-icon':'')+'">'+icon(kind==='income'?'plus':'wallet')+'</span><div><h3>'+esc(item.title)+'</h3><p>'+fmtDate(item.date)+' · '+esc(category)+'</p></div><strong class="'+(kind==='income'?'income-amount':'')+'">'+(kind==='income'?'+':'−')+money(item.amount)+'</strong>'+actions(kind,item.id)+'</article>';
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
  function moneyView() {
    const b=budget(), now=nowDate(),monthLength=new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),0).getDate();
    const days=month===now.slice(0,7)?monthLength-Number(now.slice(8))+1:month>now.slice(0,7)?monthLength:0;
    const daily=days?Math.floor(Math.round(b.freeToSpend*100)/days)/100:0;
    const actionsHtml='<div class="finance-actions">'+button(icon('plus')+' Доход','add-income','secondary')+button(icon('plus')+' Расход','add-expense')+'</div>';
    const warnings=(b.mandatoryShortfall?'<div class="notice warning">На обязательные суммы не хватает '+money(b.mandatoryShortfall)+'. Добавь поступление или скорректируй суммы.</div>':'')+(b.protectionShortfall?'<div class="notice warning">Расходы затронули отложенные деньги: сейчас не покрыто '+money(b.protectionShortfall)+'. Свободных денег пока нет.</div>':'')+(b.deficit?'<div class="notice warning">Расходы превысили доход на '+money(b.deficit)+'.</div>':'');
    return head('Деньги с намерением.','Обязательное — отложено. Свободное — видно.',actionsHtml)+currencyStrip()+'<p class="currency-note">'+currencies[selectedCurrency()]+'. BYN, USD и RUB считаются отдельно, без пересчёта по курсу. Старые записи без валюты сохранены в RUB.</p><div class="stats">'+stat('Все поступления',money(b.income),'Зарплата '+money(b.salaryIncome)+' · ещё '+money(b.additionalIncome),'wallet')+stat('Всего осталось',money(b.available),'Потрачено '+money(b.spent),'arrow')+stat('Свободно тратить',money(b.freeToSpend),'За вычетом отложенного','target')+'</div>'+warnings+'<div class="free-budget"><div><p class="eyebrow">'+(days?'ОРИЕНТИР ДО КОНЦА МЕСЯЦА':'МЕСЯЦ ЗАВЕРШЁН')+'</p><h2>'+(days?money(daily)+' <span>в день</span>':'Свободный остаток: '+money(b.freeToSpend))+'</h2><p>'+(days?'Свободный остаток распределён на '+days+' дней этого месяца. Это ориентир, а не ограничение.':'Можно посмотреть историю и спланировать следующий месяц.')+'</p></div><span class="free-budget-icon">'+icon('spark')+'</span></div><div class="columns"><div class="stack">'+commitmentPanel(b)+'<section class="panel">'+panelHead('Дополнительные поступления')+financialHistory('income')+'</section><section class="panel">'+panelHead('История расходов')+financialHistory('expense')+'</section></div><div class="stack"><section class="panel"><div class="panel-head"><h2>Зарплата и план</h2><button type="button" class="text-link" data-action="edit-budget">Изменить ↗</button></div>'+(b.income?budgetLines(b,true):empty('wallet','Укажи зарплату за месяц','Дополнительные поступления записываются отдельно и тоже увеличивают бюджет.',button('Указать зарплату','edit-budget','small secondary')))+'<p class="status-note">Сначала обязательные суммы, потом '+b.reservePercent+'% остатка в резерв и '+b.goalsPercent+'% следующего остатка на цели. Неиспользованное остаётся свободным. Проценты можно изменить.</p></section><section class="panel">'+panelHead('На твои цели')+(b.goalAllocations.some(g=>g.target>0)?b.goalAllocations.filter(g=>g.target>0).map(g=>'<div class="allocation"><div class="allocation-top"><strong>'+esc(g.title)+'</strong><strong>'+money(g.allocation)+'</strong></div><p>План на месяц · оплачено '+money(g.spent)+'</p><p>Остаток плана '+money(g.budgetRemaining)+' · до цели '+money(g.remaining)+'</p></div>').join(''):empty('target','Для будущего важного','Укажи денежную цель в '+selectedCurrency()+', и она появится в плане.',button('+ Добавить цель','add-goal','small secondary')))+'</section>'+moneyAdvice(b,days)+'</div></div>';
  }
  function settingsView() {
    const s=settings(), status=ai.getStatus();
    return head('Под твой ритм.','Настройки помощника и связь между устройствами.')+'<div class="stack"><section class="panel"><div class="settings-section"><h3>Телефон и компьютер — один помощник</h3><p>'+esc(syncText())+'</p>'+button(state.user?'Выйти из аккаунта':'Войти через Google','account','secondary')+'<p>'+esc(state.user?.email||'На обоих устройствах нужен один Google-аккаунт.')+'</p>'+(state.error?'<div class="notice warning">'+esc(state.error)+'</div>':'')+'</div><div class="settings-section"><div class="toggle-line"><div><h3>Локальная нейросеть Qwen</h3><p>Оценивает время дел и предлагает шаги к целям. Первый запрос скачает модель размером примерно 0,6–1 ГБ. Она работает в браузере без API-ключа; на телефоне может быть медленной.</p></div><label class="switch"><input type="checkbox" id="aiEnabled" aria-label="Включить локальную нейросеть" '+(ai.isEnabled()?'checked':'')+'><span></span></label></div><p>Если нейросеть выключена или не запустилась, используется простая приблизительная оценка. Время всегда можно поправить.</p><p id="aiStatus" class="status-note">'+esc(typeof status==='string'?status:status?.message||'')+'</p></div><div class="settings-section"><h3>Время для дел · '+esc(monthLabel())+'</h3><p>Все дни выбранного месяца используют эти границы. Встроенных занятий нет; между делами оставляется указанный перерыв.</p><form id="rhythmForm" class="inline-form"><label class="field">Начало дня<input name="start" type="time" value="'+esc(s.start)+'" required></label><label class="field">Конец дня<input name="end" type="time" value="'+esc(s.end)+'" required></label><label class="field">Перерыв, мин<input name="breakMinutes" type="number" min="0" max="60" step="1" value="'+s.breakMinutes+'" required></label><button class="button" type="submit">Сохранить</button></form></div><div class="settings-section"><h3>Копия данных за месяц</h3><p>Скачать цели, дела, бюджет и расходы за '+esc(monthLabel())+' в JSON. Копия содержит личные данные.</p>'+button(icon('download')+' Скачать копию','export','secondary')+'</div></section><section class="panel" id="installationPanel"></section></div>';
  }
  function syncText() {return state.error||({local:'Данные сохранены в этом браузере. Войди в Google для синхронизации.',loading:'Подключаю данные аккаунта…',syncing:'Изменения сохранены на устройстве. Отправляю их в облако…',synced:'Синхронизация включена. Изменения обновляются на всех устройствах.',offline:'Нет связи с облаком. Изменения на устройстве ожидают отправки.',error:'Не удалось синхронизировать данные.'}[state.status]||'Сохраняю данные…');}
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
    view=['overview','day','goals','money','settings'].includes(location.hash.slice(1))?location.hash.slice(1):'overview';
    document.querySelectorAll('[data-view]').forEach(el=>{el.classList.toggle('active',el.dataset.view===view);el.setAttribute('aria-current',el.dataset.view===view?'page':'false');});
    $('monthPicker').value=month;
    $('content').innerHTML=view==='overview'?overview():view==='day'?head('День в твоём ритме.',fmtDate(day,{weekday:'long',day:'numeric',month:'long'})+' · меняй дела, остальное пересчитается.',button(icon('plus')+' Добавить дело','add-task'))+dayPanel():view==='goals'?goalsView():view==='money'?moneyView():settingsView();
    if(view==='settings')$('installationPanel').innerHTML=installationContent();
    if(lastRenderedView!==view){lastRenderedView=view;$('content').classList.remove('view-enter');void $('content').offsetWidth;$('content').classList.add('view-enter');}
    $('syncShort').textContent={local:'На этом устройстве',synced:'Всё синхронизировано',offline:'Сохранено на устройстве',loading:'Подключение…',syncing:'Синхронизирую…',error:'Проверь синхронизацию'}[state.status]||'Сохраняю…';
    $('syncDetail').textContent=syncText();$('syncDot').className=state.status==='synced'?'online':state.status==='error'||state.status==='offline'?'warning':'';
    $('accountButton').textContent=state.user?'Выйти из аккаунта':'Войти через Google';$('accountEmail').textContent=state.user?.email||'';
    $('accountButton').disabled=state.status==='loading';
    $('syncBadge').title=syncText();$('syncBadge').classList.toggle('cloud-online',state.status==='synced');
    if(view==='goals')document.querySelectorAll('.goal-card').forEach((card,i)=>{const goal=records('goal')[i];if(goal)card.querySelector('.goal-buttons').insertAdjacentHTML('beforebegin',goalSteps(goal.id));});
    document.querySelectorAll('[data-action="plan-goal"]').forEach(el=>el.disabled=!!planningGoal);
  }
  function field(label,name,type,value='',extra='',hint='') {return '<label class="field">'+label+'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+extra+'>'+(hint?'<small>'+hint+'</small>':'')+'</label>';}
  function selectField(label,name,options,value='') {return '<label class="field">'+label+'<select name="'+name+'">'+options.map(([id,title])=>'<option value="'+esc(id)+'" '+(id===value?'selected':'')+'>'+esc(title)+'</option>').join('')+'</select></label>';}
  function openEditor(title,html,save) {
    if(busy)return;
    $('dialogTitle').textContent=title;$('dialogFields').innerHTML=html;$('formError').textContent='';$('saveDialog').disabled=false;$('saveDialog').textContent='Сохранить';submitEditor=save;$('editor').showModal();
    $('cancelDialog').hidden=false;
  }
  function taskEditor(task,goalId) {
    const t=task||{}, goals=records('goal');
    openEditor(task?'Изменить дело':'Новое дело',field('Что нужно сделать','title','text',t.title||'','required maxlength="100" placeholder="Например, подготовить презентацию"')+'<div class="field-row">'+field('Дата','date','date',t.date||day,'required')+field('Начало, если важно','time','time',t.time||'')+'</div>'+field('Длительность, мин','duration','number',t.estimated?'':t.duration||'','min="5" max="480" step="1" placeholder="Определить автоматически"','Можно оставить пустым. '+(ai.isEnabled()?'Время оценит Qwen.':'Помощник предложит приблизительную оценку.'))+selectField('Связать с целью','goalId',[['','Без цели'],...goals.map(g=>[g.id,g.title])],t.goalId||goalId||''),async data=>{
      const chosenDate=String(data.get('date')), targetMonth=chosenDate.slice(0,7);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(chosenDate))throw new Error('Выбери дату.');
      const title=String(data.get('title')).trim();if(!title)throw new Error('Напиши название дела.');
      const estimate=!data.get('duration')?{minutes:core.estimateDuration(title),source:'local'}:null;
      const linked=String(data.get('goalId')||'');
      const record={...t,id:t.id&&t.month===targetMonth?t.id:uid(),kind:'task',month:targetMonth,date:chosenDate,title,duration:estimate?estimate.minutes:Number(data.get('duration')),time:String(data.get('time')||''),done:!!t.done,goalId:linked&&getRecord(linked)?.month===targetMonth?linked:'',estimated:!!estimate,estimateSource:estimate?.source||'manual',createdAt:t.createdAt||Date.now()};
      store.put(record);if(t.id&&t.id!==record.id)store.remove(t.id);
      if(estimate&&ai.isEnabled()){
        const scope=state.user?.uid||'anonymous';
        void ai.estimate(title).then(result=>{
          const latest=getRecord(record.id);
          if((state.user?.uid||'anonymous')!==scope||!latest||!latest.estimated||latest.estimateSource!=='local'||latest.title!==title||latest.duration!==record.duration||latest.date!==record.date)return;
          if(result.source==='qwen'){store.put({...latest,duration:result.minutes,estimateSource:'qwen'});toast('Qwen уточнила время: '+result.minutes+' мин. План обновлён.');}
          else toast('Нейросеть недоступна. Сохранена приблизительная оценка времени.');
        }).catch(()=>toast('Сохранена приблизительная оценка времени.'));
      }
      if(targetMonth!==month){day=chosenDate;month=targetMonth;store.setPeriod(month,day);}
      toast('Дело сохранено на '+fmtDate(chosenDate)+'. План пересчитан.');
    });
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
      if(!title||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Object.hasOwn(currencies,currency))throw new Error('Проверь название, дату и валюту.');
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
    const options=[['flexible','Свободные деньги'],['reserve','Резерв'],...matching.filter(r=>r.kind==='commitment').map(r=>['commitment:'+r.id,'Обязательное: '+r.title]),...matching.filter(r=>r.kind==='goal'&&Number(r.target)>0).map(r=>['goal:'+r.id,'Цель: '+r.title])];
    if(item.id&&recordCurrency(item)===currency&&item.month===date.slice(0,7)){
      if(item.category==='essentials'&&!item.commitmentId)options.push(['essentials','Прежний обязательный расход']);
      for(const [kind,id,label] of [['commitment',item.commitmentId,item.commitmentTitle||'Обязательное (архив)'],['goal',item.goalId,'Цель (архив)']])if(id&&!options.some(([v])=>v===kind+':'+id))options.push([kind+':'+id,label]);
    }
    return options;
  }
  function expenseEditor(expense) {
    const e=expense||{},c=expense?recordCurrency(e):selectedCurrency(),date=e.date||day;
    const category=e.commitmentId?'commitment:'+e.commitmentId:e.category==='goal'?'goal:'+e.goalId:e.category||'flexible';
    openEditor(expense?.id?'Изменить расход':'Записать расход',field('На что потрачено','title','text',e.title||'','required maxlength="100" placeholder="Например, продукты"')+currencyField(c)+'<div class="field-row">'+field('Сумма','amount','number',e.amount||'','required min="0.01" max="1000000000" step="0.01"')+field('Дата','date','date',date,'required')+'</div><div id="expenseCategoryField">'+selectField('Из какой части бюджета','category',expenseCategories(c,date,e),category)+'</div><p class="status-note">Для оплаты репетиторов или проезда выбери нужный обязательный пункт. Обычные траты уменьшают свободные деньги.</p>',async data=>{
      const title=String(data.get('title')).trim(),date=String(data.get('date')),currency=String(data.get('currency')),targetMonth=date.slice(0,7),category=String(data.get('category'));
      if(!title||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Object.hasOwn(currencies,currency))throw new Error('Проверь название, дату и валюту.');
      const commitmentId=category.startsWith('commitment:')?category.slice(11):'',goalId=category.startsWith('goal:')?category.slice(5):'';
      for(const [id,kind,original] of [[commitmentId,'commitment',e.commitmentId],[goalId,'goal',e.goalId]]){
        if(!id)continue;const linked=getRecord(id);
        if(linked?(linked.kind!==kind||linked.month!==targetMonth||recordCurrency(linked)!==currency):!(e.id&&id===original&&e.month===targetMonth&&recordCurrency(e)===currency))throw new Error('Выбери пункт из того же месяца и в той же валюте.');
      }
      const record={...e,id:e.id&&e.month===targetMonth?e.id:uid(),kind:'expense',month:targetMonth,currency,date,title,amount:readAmount(data,'amount'),category:commitmentId?'essentials':goalId?'goal':category,goalId,commitmentId,commitmentTitle:commitmentId?(getRecord(commitmentId)?.title||e.commitmentTitle||''):'',createdAt:e.createdAt||Date.now()};
      store.put(record);if(e.id&&e.id!==record.id)store.remove(e.id);if(targetMonth!==month){day=date;month=targetMonth;store.setPeriod(month,day);}setCurrency(currency);toast('Расход записан. Остатки обновлены.');
    });
    for(const el of $('editorForm').querySelectorAll('[name="currency"],[name="date"]'))el.addEventListener('change',()=>{
      const f=$('editorForm'),previous=f.elements.category.value,options=expenseCategories(f.elements.currency.value,f.elements.date.value,e);
      $('expenseCategoryField').innerHTML=selectField('Из какой части бюджета','category',options,options.some(([v])=>v===previous)?previous:'flexible');
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
  async function generateGoal(id) {
    if(planningGoal)return;
    const goal=getRecord(id), scope=state.user?.uid||'anonymous', selectedMonth=month;
    if(!goal)return;planningGoal=id;render();toast(ai.isEnabled()?'Qwen продумывает шаги. Прогресс — в настройках.':'Составляю базовые шаги к цели…');
    try {
      const result=await ai.plan(goal);
      const latest=getRecord(id);
      if((state.user?.uid||'anonymous')!==scope||!latest)return;
      if(latest.title!==goal.title||latest.outcome!==goal.outcome){toast('Цель изменилась. Запусти создание шагов ещё раз.');return;}
      if(Object.values(state.records).some(t=>t.kind==='task'&&t.goalId===id)){toast('У цели уже появились шаги. Можно добавить новые вручную.');return;}
      const today=nowDate(), startDate=selectedMonth===today.slice(0,7)?today:selectedMonth+'-01';
      const last=new Date(Number(selectedMonth.slice(0,4)),Number(selectedMonth.slice(5,7)),0).getDate(), first=Number(startDate.slice(8));
      result.steps.forEach((step,i)=>{
        const d=Math.min(last,first+Math.floor(i*Math.max(0,last-first)/Math.max(1,result.steps.length-1)));
        store.put({id:uid(),kind:'task',month:selectedMonth,date:selectedMonth+'-'+String(d).padStart(2,'0'),title:step.title,duration:step.duration,time:'',done:false,goalId:id,estimated:true,estimateSource:result.source,createdAt:Date.now()+i});
      });
      toast((result.source==='qwen'?'Qwen предложила':'Добавлены базовые')+' шаги. Их можно изменить в «Мой день».');
    }catch(error){toast(error.message||'Не удалось составить шаги.');}finally{planningGoal='';render();}
  }
  function deleteRecord(id) {
    const record=getRecord(id);if(!record)return;
    const removed=[record,...(record.kind==='goal'?Object.values(state.records).filter(r=>r.kind==='task'&&r.goalId===id):[])];
    const scope=state.user?.uid||'anonymous';removed.forEach(r=>store.remove(r.id));
    toast(record.kind==='goal'?'Цель и её шаги удалены.':record.kind==='task'?'Дело удалено. План пересчитан.':record.kind==='income'?'Поступление удалено. Бюджет пересчитан.':record.kind==='commitment'?'Обязательная сумма удалена. Записанные оплаты сохранены.':'Расход удалён.',()=>{if((state.user?.uid||'anonymous')!==scope){toast('Вернись в исходный аккаунт для восстановления.');return;}removed.forEach(r=>store.put(r));toast('Записи восстановлены.');});
  }
  function changeDay(value) {if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return;day=value;month=day.slice(0,7);store.setPeriod(month,day);render();}
  function shiftDay(delta) {const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+delta);changeDay(d.toISOString().slice(0,10));}
  document.addEventListener('click',event=>{
    const el=event.target.closest('[data-action]');if(!el||el.disabled)return;
    const action=el.dataset.action,id=el.dataset.id;
    if(action==='add-task')taskEditor();else if(action==='edit-task')taskEditor(getRecord(id));else if(action==='goal-task')taskEditor(null,id);
    else if(action==='add-goal')goalEditor();else if(action==='edit-goal')goalEditor(getRecord(id));else if(action==='plan-goal')void generateGoal(id);
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
    else if(action==='open-task-day'){const task=getRecord(id);if(task){changeDay(task.date);location.hash='day';}}
    else if(action==='prev-day')shiftDay(-1);else if(action==='next-day')shiftDay(1);else if(action==='today')changeDay(nowDate());
    else if(action==='export'){
      const blob=new Blob([JSON.stringify({app:'HVF',version:2,month,exportedAt:new Date().toISOString(),records:Object.values(state.records).filter(r=>r.month===month)},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='HVF-'+month+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
  });
  document.addEventListener('change',event=>{
    const el=event.target;
    if(el.dataset.taskCheck){const task=getRecord(el.dataset.taskCheck);if(task)store.put({...task,done:el.checked});}
    else if(el.id==='dayPicker')changeDay(el.value);
    else if(el.id==='aiEnabled'){ai.setEnabled(el.checked);toast(el.checked?'Нейросеть включена. Модель загрузится при первом запросе.':'Включена простая приблизительная оценка.');}
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
    try{await saveGuarded(save,data,scope,formMonth);$('editor').close();}catch(error){$('formError').textContent=error.message||'Не удалось сохранить.';}finally{busy=false;$('saveDialog').disabled=false;$('saveDialog').textContent='Сохранить';render();}
  });
  async function saveGuarded(save,data,scope,formMonth){
    // Account/period navigation is locked while a form has an asynchronous estimate.
    if((state.user?.uid||'anonymous')!==scope||month!==formMonth)throw new Error('Аккаунт или месяц изменился. Открой форму заново.');
    await save(data);
  }
  $('monthPicker').addEventListener('change',event=>{const value=event.target.value;if(!/^\d{4}-\d{2}$/.test(value)||busy)return;month=value;day=month===nowDate().slice(0,7)?nowDate():month+'-01';store.setPeriod(month,day);render();});
  $('accountButton').addEventListener('click',()=>{if(!busy)void store.signInOut().catch(e=>toast(e.message));});
  function closeEditor(){if(busy){toast('Дождись оценки времени. Прогресс — в настройках.');return;}$('editor').close();}
  $('closeDialog').addEventListener('click',closeEditor);$('cancelDialog').addEventListener('click',closeEditor);
  $('editor').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  $('editor').addEventListener('click',event=>{if(event.target===$('editor')){const r=$('editor').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeEditor();}});
  $('closeToast').addEventListener('click',()=>$('toast').hidden=true);$('undoButton').addEventListener('click',()=>{const fn=undoAction;undoAction=null;$('toast').hidden=true;if(fn)fn();});
  window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0);});
  window.addEventListener('hvf-pwa-status',()=>{if(view==='settings')$('installationPanel').innerHTML=installationContent();});
  let lastScope=state.user?.uid||'anonymous';
  store.subscribe(next=>{const nextScope=next.user?.uid||'anonymous';if(lastScope!==nextScope&&$('editor').open){$('editor').close();submitEditor=null;toast('Аккаунт изменился. Открой форму заново.');}lastScope=nextScope;state=next;render();});
  ai.subscribe(status=>{const el=$('aiStatus');if(el)el.textContent=typeof status==='string'?status:status?.message||'';});
  store.setPeriod(month,day);render();void store.init();
}());
