(function (root,factory) {
  'use strict';
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.HVFGuide=api;
}(typeof window!=='undefined'?window:globalThis,function (root) {
  'use strict';

  function deepFreeze(value){
    if(value&&typeof value==='object'&&!Object.isFrozen(value)){
      Object.values(value).forEach(deepFreeze);Object.freeze(value);
    }
    return value;
  }
  // Copy only describes capabilities that are already present. The UI owns
  // safe text/HTML rendering; this module never opens a permission prompt.
  const features=deepFreeze([
    {id:'day',icon:'calendar',title:'День, которым управляешь ты',description:'Добавляй свои дела и меняй планы без готового расписания.',items:[
      {id:'priorities',title:'Приоритеты',description:'Выделяй важное цветом и показывай только дела с высоким приоритетом.'},
      {id:'time',title:'Время для дел',description:'Укажи время встречи или оставь дело свободным. Примерную длительность можно изменить.'},
      {id:'recurring',title:'Повторения',description:'Выбирай дни недели для регулярных дел, меняй одно повторение или всю серию.'},
      {id:'move',title:'Перенос на завтра',description:'Сначала проверь список и пересечения по времени, затем перенеси выбранные дела.'},
      {id:'focus',title:'Режим фокуса',description:'Выдели время на одно дело. Таймер сохраняется на устройстве; завершение дела отмечаешь ты.'},
      {id:'weekly',title:'Итоги недели',description:'Смотри выполненные дела, продвижение к целям и расходы, чтобы планировать следующую неделю.'}
    ]},
    {id:'goals',icon:'target',title:'Цели превращаются в конкретные дела',description:'Определи результат месяца и свяжи его с посильными шагами.',items:[
      {id:'monthly-goals',title:'Цели месяца',description:'Запиши, чего хочешь достичь и как поймёшь, что результат получен.'},
      {id:'goal-progress',title:'Видимый прогресс',description:'Связывай дела с целью и отслеживай выполненные шаги или накопленную сумму.'}
    ]},
    {id:'money',icon:'wallet',title:'Понятно, сколько можно тратить',description:'Записывай доходы и расходы, отделяй обязательные суммы от свободных денег.',items:[
      {id:'currencies',title:'BYN, USD и RUB',description:'Веди отдельный бюджет в каждой валюте. Автоматической конвертации по курсу нет.'},
      {id:'income',title:'Зарплата и дополнительный доход',description:'Учитывай полученную зарплату, подарки и подработки, чтобы видеть доступный бюджет.'},
      {id:'mandatory',title:'Обязательные суммы',description:'Выделяй деньги на репетиторов, проезд и другие платежи до расчёта свободного остатка.'},
      {id:'forecast',title:'Прогноз до следующего дохода',description:'Укажи дату поступления и посмотри, как распределить остаток до неё. Будущие деньги ещё не считаются полученными.'},
      {id:'categories-limits',title:'Категории и лимиты',description:'Используй готовые или свои категории и задавай месячные лимиты с предупреждениями о тратах.'}
    ]},
    {id:'everywhere',icon:'assistant',title:'Рядом на телефоне и компьютере',description:'Устанавливай HVF на главный экран и открывай свои планы с разных устройств.',items:[
      {id:'sync',title:'Google-синхронизация',description:'Войди в один Google-аккаунт на каждом устройстве. Передача изменений требует подключения к интернету.'},
      {id:'backup',title:'Резервная копия',description:'Скачивай полную JSON-копию всех месяцев и восстанавливай её после просмотра изменений.'},
      {id:'notifications',title:'Напоминания о делах',description:'Укажи время и напоминание в деле, затем включи уведомления отдельно на устройстве. На iPhone нужен HVF с главного экрана и разрешение уведомлений.'}
    ]}
  ]);
  const offerCopy=deepFreeze({
    enable:{kind:'enable',action:'enable',title:'Напомнить о важном?',description:'Включи уведомления на этом устройстве. Затем укажи время начала и напоминание в нужном деле.',actionLabel:'Включить напоминания',dismissLabel:'Позже'},
    install:{kind:'install',action:'install',title:'Напоминания на iPhone',description:'Добавь HVF на главный экран и открой с новой иконки. После этого можно включить уведомления; они пока не включены.',actionLabel:'Как установить',dismissLabel:'Позже'},
    login:{kind:'login',action:'login',title:'Подключи напоминания к своим делам',description:'Войди через Google, затем включи уведомления на этом устройстве. Доходы и расходы для напоминаний не передаются.',actionLabel:'Войти через Google',dismissLabel:'Позже'}
  });

  const PREFIX='hvf-notification-offer:v1:';
  const memories=new WeakMap(),unavailableMemory=new Map();
  function scopeKey(scope){
    if(scope===undefined||scope===null||scope==='')return 'anonymous';
    if(typeof scope!=='string')throw new TypeError('Notification offer scope must be a uid string or anonymous.');
    return scope;
  }
  function availableOffer(scope,status){
    if(!status||status.configured!==true||status.initialized===false||status.busy||status.enabled||status.permission==='denied')return null;
    const uid=typeof status.uid==='string'?status.uid:'';
    if(scope==='anonymous'?Boolean(uid):uid!==scope)return null;
    if(status.needsInstall===true)return offerCopy.install;
    if(status.supported!==true||!['default','granted'].includes(status.permission))return null;
    return scope==='anonymous'?offerCopy.login:offerCopy.enable;
  }
  function createNotificationOffer(options){
    options=options||{};let storage=options.storage;
    if(!Object.prototype.hasOwnProperty.call(options,'storage')){try{storage=root.localStorage;}catch(_){/* Use page-session memory. */}}
    const clock=typeof options.now==='function'?options.now:Date.now;
    const usable=storage&&(typeof storage==='object'||typeof storage==='function');
    let memory=usable?memories.get(storage):unavailableMemory;
    if(!memory){memory=new Map();memories.set(storage,memory);}
    function timestamp(){try{const value=Number(clock());return Number.isFinite(value)&&value>=0?value:0;}catch(_){return 0;}}
    function key(scope){return PREFIX+encodeURIComponent(scope);}
    function marker(scope){
      if(memory.has(scope))return memory.get(scope);
      try{
        const value=JSON.parse(storage?.getItem(key(scope))||'null');
        if(value&&value.version===1&&['offeredAt','dismissedAt'].some(name=>Number.isFinite(value[name])&&value[name]>=0)){
          const saved=Object.freeze({version:1,...(Number.isFinite(value.offeredAt)&&value.offeredAt>=0?{offeredAt:value.offeredAt}:{}),...(Number.isFinite(value.dismissedAt)&&value.dismissedAt>=0?{dismissedAt:value.dismissedAt}:{})});
          memory.set(scope,saved);return saved;
        }
      }catch(_){/* Blocked or malformed local storage must not break the app. */}
      return null;
    }
    function save(scope,value){
      const saved=Object.freeze(value);memory.set(scope,saved);
      try{storage?.setItem(key(scope),JSON.stringify(saved));}catch(_){/* Memory still prevents repeated offers this session. */}
      return saved;
    }
    function canOffer(scope,status){return Boolean(availableOffer(scopeKey(scope),status));}
    function getOffer(scope,status,settings){
      scope=scopeKey(scope);const offer=availableOffer(scope,status);
      if(!offer||(!settings?.ignoreShown&&marker(scope)))return null;
      return offer;
    }
    function markShown(scope){
      scope=scopeKey(scope);const previous=marker(scope);
      return save(scope,{version:1,...previous,offeredAt:previous?.offeredAt??timestamp()});
    }
    function dismiss(scope){
      scope=scopeKey(scope);const previous=marker(scope),at=timestamp();
      return save(scope,{version:1,...previous,offeredAt:previous?.offeredAt??at,dismissedAt:at});
    }
    return Object.freeze({canOffer,getOffer,shouldOffer:(scope,status)=>Boolean(getOffer(scope,status)),markShown,dismiss});
  }
  return Object.freeze({features,sections:features,getFeatures:()=>features,createNotificationOffer});
}));
