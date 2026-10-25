(function () {
  'use strict';
  const $=id=>document.getElementById(id),store=window.HVFStore,backup=window.HVFBackup;
  const NEW_APP_URL='https://hvf-app.haveffee-assistant.workers.dev/';
  let initialized=false,signingIn=false,stoppingReminders=false,scopeRevision=0,state=store.getState(),reminderStopController=null;
  const statusNames={local:'На этом устройстве',synced:'Всё синхронизировано',offline:'Доступна локальная копия',loading:'Загружаем данные…',syncing:'Синхронизируем изменения…',error:'Нужна проверка синхронизации'};
  function render(){
    const count=Object.keys(state.records).length;
    $('migrationStatus').textContent=statusNames[state.status]||'Проверяем данные…';
    $('migrationDetail').textContent=state.error||(state.status==='synced'?'Записи переданы в аккаунт. На новом адресе войди в тот же Google-аккаунт.':state.status==='syncing'?'Не закрывай страницу, пока изменения передаются. Копию уже доступных записей можно скачать ниже.':state.status==='loading'?'Дождись загрузки аккаунта. Пока идёт подключение, копия содержит только записи, уже доступные на этом устройстве.':state.user?'Связь с облаком пока не подтверждена. Локальные записи можно скачать и восстановить на новом адресе.':'Без входа записи хранятся в браузере старого адреса. Скачай копию и восстанови её в новом HVF.');
    $('migrationAccount').textContent=state.user?.email?'Аккаунт: '+state.user.email:'Google-аккаунт не подключён.';
    $('migrationCount').textContent='Доступно записей для копии: '+count+'. Копия включает все доступные месяцы.';
    $('migrationAuth').textContent=signingIn?'Подключаем…':state.user?'Выйти из аккаунта':'Войти через Google';
    $('migrationAuth').disabled=!initialized||state.status==='loading'||signingIn||stoppingReminders;
    $('migrationExport').disabled=count===0;
    $('migrationStopReminders').disabled=!initialized||state.status==='loading'||stoppingReminders||signingIn;
    $('migrationStopReminders').textContent=stoppingReminders?'Отключаем старые напоминания…':'Отключить напоминания старого приложения';
  }
  store.subscribe(next=>{
    if(next.user?.uid!==state.user?.uid){scopeRevision++;reminderStopController?.abort();$('migrationReminderStatus').textContent='';}
    state=next;render();
  });
  $('migrationAuth').addEventListener('click',async()=>{
    if(!initialized||state.status==='loading'||signingIn||stoppingReminders)return;
    signingIn=true;$('migrationError').textContent='';render();
    try{await store.signInOut();}catch(error){$('migrationError').textContent=error.message||'Не удалось подключить аккаунт. Скачай локальную копию и попробуй позже.';}
    finally{signingIn=false;state=store.getState();render();}
  });
  $('migrationExport').addEventListener('click',()=>{
    $('migrationError').textContent='';
    try{
      // Read a fresh snapshot so account switching or a cloud update cannot
      // export stale records from the previously rendered status panel.
      const records=Object.values(store.getState().records);
      if(!records.length)throw new Error('Пока нет записей для копии. Дождись загрузки или войди в свой аккаунт.');
      const json=JSON.stringify(backup.create(records),null,2);
      const blob=new Blob([json],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download='HVF-full-backup-'+new Date().toISOString().slice(0,10)+'.json';
      document.body.appendChild(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
    }catch(error){$('migrationError').textContent=error.message||'Не удалось создать копию. Старые данные остаются на этом устройстве.';}
  });
  function reminderStopCurrent(context){
    if(context.revision!==scopeRevision||store.getState().user?.uid!==context.uid)throw new Error('Аккаунт изменился. Войди в прежний аккаунт и повтори действие.');
  }
  function reminderServiceUrl(){
    const allowedOrigin='https://hvf-reminders.haveffee-assistant.workers.dev';
    const endpoint=new URL(window.HVF_REMINDERS_CONFIG?.endpoint||allowedOrigin);
    if(endpoint.origin!==allowedOrigin||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/')throw new Error('Не удалось подтвердить адрес сервиса напоминаний. Старые напоминания сохранены.');
    return new URL('/v1/devices',endpoint).href;
  }
  $('migrationStopReminders').addEventListener('click',async()=>{
    if(!initialized||state.status==='loading'||stoppingReminders||signingIn)return;
    const uid=store.getState().user?.uid;
    if(!uid){$('migrationReminderStatus').textContent='Сначала войди через Google в аккаунт старого приложения.';return;}
    const context={uid,revision:scopeRevision};stoppingReminders=true;$('migrationReminderStatus').textContent='Проверяем старое подключение на этом устройстве…';render();
    let timeout;
    try{
      if(!navigator.serviceWorker?.getRegistration)throw new Error('Этот браузер не поддерживает управление напоминаниями. Открой старую иконку HVF на устройстве, где они подключены.');
      const registration=await navigator.serviceWorker.getRegistration('./');reminderStopCurrent(context);
      const subscription=await registration?.pushManager?.getSubscription();reminderStopCurrent(context);
      if(!subscription){$('migrationReminderStatus').textContent='На этом устройстве нет подключённых напоминаний старого HVF.';return;}
      const endpoint=subscription.endpoint;
      if(typeof endpoint!=='string'||!endpoint)throw new Error('Браузер не вернул старое подключение. Ничего не отключено.');
      const token=await store.getIdToken();reminderStopCurrent(context);
      if(!token)throw new Error('Войди через Google заново и повтори действие.');
      const serviceUrl=reminderServiceUrl();
      reminderStopController=typeof AbortController==='function'?new AbortController():null;
      if(reminderStopController)timeout=setTimeout(()=>reminderStopController?.abort(),15000);
      const response=await window.fetch(serviceUrl,{
        method:'DELETE',mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',
        headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
        body:JSON.stringify({endpoint}),...(reminderStopController?{signal:reminderStopController.signal}:{})
      });
      reminderStopCurrent(context);
      if(!response.ok)throw new Error('Сервис не подтвердил отключение (HTTP '+response.status+'). Проверь вход и интернет; старое подключение пока сохранено.');
      const result=await response.json();reminderStopCurrent(context);
      if(result?.ok!==true)throw new Error('Сервис не подтвердил отключение. Старое подключение пока сохранено.');
      const current=await registration.pushManager.getSubscription();reminderStopCurrent(context);
      if(current&&current.endpoint!==endpoint)throw new Error('Подключение напоминаний изменилось. Повтори действие для текущего подключения.');
      if(current){
        const removed=await subscription.unsubscribe();reminderStopCurrent(context);
        if(removed===false){
          const remaining=await registration.pushManager.getSubscription();reminderStopCurrent(context);
          if(remaining?.endpoint===endpoint)throw new Error('Сервис отключил старое устройство, но браузер ещё не подтвердил отключение. Повтори действие или убери разрешение уведомлений для старого адреса в настройках браузера.');
        }
      }
      reminderStopCurrent(context);
      $('migrationReminderStatus').textContent='Напоминания старого HVF на этом устройстве отключены. Новый адрес и другие устройства не затронуты.';
    }catch(error){
      $('migrationReminderStatus').textContent=error?.name==='AbortError'?'Отключение прервано. Проверь аккаунт и интернет, затем повтори действие.':error.message||'Не удалось отключить старые напоминания. Попробуй ещё раз.';
    }finally{if(timeout!==undefined)clearTimeout(timeout);reminderStopController=null;stoppingReminders=false;state=store.getState();render();}
  });
  $('migrationOpen').href=NEW_APP_URL;
  render();
  void Promise.resolve(store.init()).then(()=>{initialized=true;state=store.getState();render();},error=>{initialized=true;state=store.getState();$('migrationError').textContent=error.message||'Не удалось загрузить аккаунт. Локальные записи доступны для копии.';render();});
  if('serviceWorker' in navigator){
    void navigator.serviceWorker.register('./service-worker.js?v=reminders-1',{scope:'./'}).then(registration=>registration.update()).catch(()=>{$('migrationWorker').textContent='Обновление старой иконки сейчас недоступно. Скачивание копии и новый адрес продолжают работать.';});
  }
}());
