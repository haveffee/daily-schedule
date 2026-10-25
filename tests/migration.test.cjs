const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const backup=require('../assistant-backup.js');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));
const NEW_APP='https://hvf-app.haveffee-assistant.workers.dev/';
const task=(id,month='2026-10')=>({id,kind:'task',month,date:month+'-23',title:'Сохранить '+id,duration:30,time:'',priority:1,done:false});

function migrationPage(records=[],options={}){
  let current={records:Object.fromEntries(records.map(record=>[record.id,copy(record)])),status:options.status||'local',user:options.user||null,error:''};
  let ready;const initialization=new Promise(resolve=>{ready=resolve;});
  const listeners=[],nodes=new Map(),downloads=[],blobs=new Map(),registrations=[],timers=[],requests=[];
  let signInCalls=0,unsubscribes=0,tokenCalls=0;
  const oldEndpoint='https://web.push.apple.com/legacy-device';
  let subscription=options.subscription===null?null:{endpoint:oldEndpoint,async unsubscribe(){unsubscribes++;if(options.unsubscribe)return await options.unsubscribe();subscription=null;return true;}};
  const registration={update:async()=>{registrations.push('update');},pushManager:{getSubscription:async()=>subscription}};
  function node(id){
    if(!nodes.has(id))nodes.set(id,{disabled:false,textContent:'',href:'',events:new Map(),addEventListener(type,fn){this.events.set(type,fn);}});
    return nodes.get(id);
  }
  const store={
    getState:()=>copy(current),subscribe:fn=>listeners.push(fn),init:()=>initialization,
    async signInOut(){signInCalls++;if(options.signInError)throw new Error(options.signInError);},
    async getIdToken(){tokenCalls++;return options.getIdToken?await options.getIdToken():'test-token';}
  };
  const document={getElementById:node,body:{appendChild(){}},createElement:()=>({click(){downloads.push({name:this.download,blob:blobs.get(this.href)});},remove(){}})};
  const navigator=options.worker?{serviceWorker:{register:async(...args)=>{registrations.push(args);return registration;},getRegistration:async scope=>{registrations.push({lookup:scope});return registration;}}}:{};
  class PageURL extends URL{
    static createObjectURL(blob){const url='blob:'+blobs.size;blobs.set(url,blob);return url;}
    static revokeObjectURL(){}
  }
  vm.runInNewContext(read('legacy-migration.js'),{
    window:{HVFStore:store,HVFBackup:backup,HVF_REMINDERS_CONFIG:{endpoint:options.serviceEndpoint||'https://hvf-reminders.haveffee-assistant.workers.dev'},fetch:async(url,request)=>{requests.push({url,request});return options.fetch?await options.fetch(url,request):{ok:true,status:200,json:async()=>({ok:true})};}},document,navigator,Blob,URL:PageURL,
    setTimeout(fn,ms){timers.push({fn,ms});return timers.length;},clearTimeout(){}
  });
  return {
    node,downloads,registrations,timers,requests,oldEndpoint,signInCalls:()=>signInCalls,unsubscribes:()=>unsubscribes,tokenCalls:()=>tokenCalls,
    setSubscription(value){subscription=value;},
    async ready(){ready();await initialization;await Promise.resolve();},
    publish(changes){current={...current,...copy(changes)};for(const fn of listeners)fn(copy(current));},
    // Update without a subscriber delivery to verify export reads fresh data.
    snapshot(changes){current={...current,...copy(changes)};},
    async click(id){await node(id).events.get('click')();}
  };
}

test('legacy page preserves the origin and explains an explicit account or backup migration',()=>{
  const html=read('legacy-migration.html'),js=read('legacy-migration.js');
  assert.match(html,/на тот же Google-аккаунт|в тот же Google-аккаунт/);
  assert.match(html,/Восстановить из файла/);
  assert.match(html,/заново включи напоминания/);
  assert.match(html,/не удаляет старые записи/);
  assert.match(html,/id="migrationOpen"[^>]*href="https:\/\/hvf-app\.haveffee-assistant\.workers\.dev\/"/);
  assert.doesNotMatch(html,/<meta[^>]+http-equiv=["']refresh/i);
  assert.doesNotMatch(js,/location\s*[.=]|localStorage\.|sessionStorage\.|\.remove\(\s*['"]hvf|store\.(?:put|remove|putMany)\(/);
  for(const script of ['firebase-config.js','assistant-core.js','assistant-planner.js','assistant-store.js','assistant-backup.js','legacy-migration.js'])assert.ok(html.includes('src="./'+script+'"'),script);
  assert.doesNotMatch(html,/(?:assistant-ui|assistant-billing|assistant-reminders|pwa)\.js/);
});

test('Google login waits for initialization and the account snapshot, then uses the existing sign-in flow',async()=>{
  const page=migrationPage([],{status:'loading'});
  assert.equal(page.node('migrationAuth').disabled,true);
  await page.click('migrationAuth');assert.equal(page.signInCalls(),0);
  await page.ready();assert.equal(page.node('migrationAuth').disabled,true);
  page.publish({status:'local'});assert.equal(page.node('migrationAuth').disabled,false);
  await page.click('migrationAuth');assert.equal(page.signInCalls(),1);
  page.publish({status:'synced',user:{uid:'owner',email:'me@example.test'}});
  assert.equal(page.node('migrationAuth').textContent,'Выйти из аккаунта');
  assert.match(page.node('migrationAccount').textContent,/me@example.test/);
  assert.equal(page.node('migrationStatus').textContent,'Всё синхронизировано');
});

test('migration export includes all months and local records without transferring them in a URL',async()=>{
  const records=[task('october'),task('september','2026-09'),{id:'finance-preferences',kind:'finance-preferences',month:'2000-01',currency:'BYN'}];
  const page=migrationPage(records,{status:'offline',user:{uid:'private-id',email:'private@example.test'}});
  assert.equal(page.node('migrationExport').disabled,false);
  await page.click('migrationExport');assert.equal(page.downloads.length,1);
  assert.match(page.downloads[0].name,/^HVF-full-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const text=await page.downloads[0].blob.text(),parsed=backup.parse(text);
  assert.equal(parsed.ok,true);assert.equal(parsed.records.length,3);
  assert.deepEqual(parsed.records.map(record=>record.id).sort(),records.map(record=>record.id).sort());
  assert.doesNotMatch(text,/private-id|private@example|token|apiKey/i);
  assert.equal(page.node('migrationOpen').href,NEW_APP);
  assert.ok(page.timers.some(timer=>timer.ms>=1000),'the browser has time to consume the download before revoking it');
});

test('export reads a fresh account snapshot and never exports the previous owner after switching',async()=>{
  const page=migrationPage([task('old-account')]);
  page.snapshot({records:{fresh:task('fresh')}});
  await page.click('migrationExport');
  const parsed=backup.parse(await page.downloads[0].blob.text());
  assert.deepEqual(parsed.records.map(record=>record.id),['fresh']);
  page.snapshot({records:{}});await page.click('migrationExport');
  assert.equal(page.downloads.length,1);assert.match(page.node('migrationError').textContent,/нет записей/);
});

test('offline export remains possible while cloud data is loading and errors do not erase records',async()=>{
  const page=migrationPage([task('local')],{status:'loading',signInError:'Google временно недоступен'});
  assert.equal(page.node('migrationExport').disabled,false);
  assert.match(page.node('migrationDetail').textContent,/только записи, уже доступные/);
  await page.click('migrationExport');assert.equal(page.downloads.length,1);
  await page.ready();page.publish({status:'error',error:'Нет подключения'});
  await page.click('migrationAuth');assert.match(page.node('migrationError').textContent,/Google временно/);
  await page.click('migrationExport');assert.equal(page.downloads.length,2);
});

test('legacy worker registration preserves the push version and never forces open pages to reload',async()=>{
  const page=migrationPage([],{worker:true});await page.ready();await Promise.resolve();
  assert.equal(page.registrations[0][0],'./service-worker.js?v=reminders-1');
  assert.equal(page.registrations[0][1].scope,'./');assert.ok(page.registrations.includes('update'));
});

const settle=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const owner={uid:'owner',email:'owner@example.test'};

test('old reminders stop only after an explicit click and remove precisely this origin subscription',async()=>{
  const page=migrationPage([task('keep-data')],{worker:true,user:owner,status:'synced'});
  await page.ready();assert.equal(page.requests.length,0);assert.equal(page.unsubscribes(),0);
  await page.click('migrationStopReminders');
  assert.equal(page.requests.length,1);const {url,request}=page.requests[0];
  assert.equal(url,'https://hvf-reminders.haveffee-assistant.workers.dev/v1/devices');
  assert.equal(request.method,'DELETE');assert.equal(request.credentials,'omit');assert.equal(request.redirect,'error');
  assert.equal(request.headers.Authorization,'Bearer test-token');
  assert.deepEqual(JSON.parse(request.body),{endpoint:page.oldEndpoint});
  assert.equal(page.unsubscribes(),1);assert.equal(page.tokenCalls(),1);
  assert.ok(page.registrations.some(call=>call.lookup==='./'));
  assert.match(page.node('migrationReminderStatus').textContent,/другие устройства не затронуты/);
  await page.click('migrationExport');assert.equal(page.downloads.length,1,'disabling old reminders preserves the planning records');
});

test('reminder migration requires Google login and reports a missing old subscription honestly',async()=>{
  const anonymous=migrationPage([],{worker:true});await anonymous.ready();
  await anonymous.click('migrationStopReminders');assert.match(anonymous.node('migrationReminderStatus').textContent,/Сначала войди/);
  assert.equal(anonymous.requests.length,0);assert.equal(anonymous.tokenCalls(),0);assert.equal(anonymous.unsubscribes(),0);
  const empty=migrationPage([],{worker:true,user:owner,subscription:null});await empty.ready();
  await empty.click('migrationStopReminders');assert.match(empty.node('migrationReminderStatus').textContent,/нет подключённых напоминаний/);
  assert.equal(empty.requests.length,0);assert.equal(empty.tokenCalls(),0);assert.equal(empty.unsubscribes(),0);
});

test('a failed server deletion keeps the browser subscription instead of silently dropping delivery',async()=>{
  const page=migrationPage([],{worker:true,user:owner,fetch:async()=>({ok:false,status:403})});await page.ready();
  await page.click('migrationStopReminders');assert.equal(page.requests.length,1);assert.equal(page.unsubscribes(),0);
  assert.match(page.node('migrationReminderStatus').textContent,/HTTP 403/);
  assert.equal(page.node('migrationStopReminders').disabled,false,'the user can retry');
});

test('a token wait cannot delete or unsubscribe after an account switches away and back',async()=>{
  let resolveToken;const pendingToken=new Promise(resolve=>{resolveToken=resolve;});
  const page=migrationPage([],{worker:true,user:owner,getIdToken:()=>pendingToken});await page.ready();
  const pending=page.click('migrationStopReminders');await settle();assert.equal(page.tokenCalls(),1);
  page.publish({user:{uid:'other',email:'other@example.test'}});page.publish({user:owner});
  resolveToken('test-token');await pending;
  assert.equal(page.requests.length,0);assert.equal(page.unsubscribes(),0);
  assert.match(page.node('migrationReminderStatus').textContent,/Аккаунт изменился/);
});

test('account switching during the server request never unsubscribes the old browser object for the new account',async()=>{
  let finishRequest;const response=new Promise(resolve=>{finishRequest=resolve;});
  const page=migrationPage([],{worker:true,user:owner,fetch:()=>response});await page.ready();
  const pending=page.click('migrationStopReminders');await settle();assert.equal(page.requests.length,1);
  page.publish({user:{uid:'other',email:'other@example.test'}});
  finishRequest({ok:true,status:200,json:async()=>({ok:true})});await pending;
  assert.equal(page.unsubscribes(),0);assert.match(page.node('migrationReminderStatus').textContent,/Аккаунт изменился/);
});

test('a changed browser subscription is not unsubscribed after deleting the previously selected endpoint',async()=>{
  let page,newUnsubscribes=0;
  page=migrationPage([],{worker:true,user:owner,fetch:async()=>{
    page.setSubscription({endpoint:'https://web.push.apple.com/replacement',async unsubscribe(){newUnsubscribes++;}});
    return {ok:true,status:200,json:async()=>({ok:true})};
  }});await page.ready();await page.click('migrationStopReminders');
  assert.deepEqual(JSON.parse(page.requests[0].request.body),{endpoint:page.oldEndpoint});
  assert.equal(page.unsubscribes(),0);assert.equal(newUnsubscribes,0);
  assert.match(page.node('migrationReminderStatus').textContent,/Подключение напоминаний изменилось/);
});

test('the old reminder token cannot be sent to an untrusted configured host',async()=>{
  const page=migrationPage([],{worker:true,user:owner,serviceEndpoint:'https://other.test/'});await page.ready();
  await page.click('migrationStopReminders');assert.equal(page.requests.length,0);assert.equal(page.unsubscribes(),0);
  assert.match(page.node('migrationReminderStatus').textContent,/адрес сервиса/);
});

test('a browser that refuses unsubscribe receives an honest partial-completion message',async()=>{
  const page=migrationPage([],{worker:true,user:owner,unsubscribe:async()=>false});await page.ready();
  await page.click('migrationStopReminders');assert.equal(page.requests.length,1);assert.equal(page.unsubscribes(),1);
  assert.match(page.node('migrationReminderStatus').textContent,/Сервис отключил старое устройство, но браузер ещё не подтвердил/);
});

function legacyWorker(){
  const events=new Map(),notifications=[],opened=[];
  const self={registration:{showNotification:async(...args)=>{notifications.push(args);}},clients:{openWindow:async url=>{opened.push(url);}},addEventListener(type,fn){events.set(type,fn);}};
  vm.runInNewContext(read('legacy-service-worker.js'),{self,URL});
  return {events,notifications,opened,async emit(type,event){let pending;events.get(type)({...event,waitUntil(value){pending=value;}});await pending;}};
}

test('legacy worker leaves requests and storage alone while preserving visible push delivery',async()=>{
  const worker=legacyWorker();
  assert.deepEqual([...worker.events.keys()].sort(),['notificationclick','push']);
  await worker.emit('push',{data:{json:()=>({title:'Репетитор',body:'Через 10 минут',date:'2026-10-30',tag:'task-1'})}});
  assert.equal(worker.notifications[0][0],'Репетитор');
  assert.equal(worker.notifications[0][1].body,'Через 10 минут');
  assert.equal(worker.notifications[0][1].data.date,'2026-10-30');
  assert.equal(worker.notifications[0][1].icon,NEW_APP+'icon-192.png');
  await worker.emit('push',{data:{json(){throw new Error('invalid payload');}}});
  assert.equal(worker.notifications[1][0],'HVF · Напоминание');
});

test('old notification clicks open only the new app with a sanitized day route',async()=>{
  const worker=legacyWorker();let closed=0;
  await worker.emit('notificationclick',{notification:{close(){closed++;},data:{date:'2026-10-30'}}});
  assert.equal(worker.opened[0],NEW_APP+'#day/2026-10-30');
  await worker.emit('notificationclick',{notification:{close(){closed++;},data:{date:'https://other.test/private'}}});
  assert.equal(worker.opened[1],NEW_APP+'#day');assert.equal(closed,2);
});

test('legacy publication is manual and packages only migration and required public dependencies',()=>{
  const workflow=read('.github/workflows/legacy-migration.yml');
  const triggers=workflow.slice(workflow.indexOf('\non:'),workflow.indexOf('\npermissions:'));
  assert.match(triggers,/workflow_dispatch:/);assert.doesNotMatch(triggers,/push:|pull_request:|schedule:/);
  assert.match(workflow,/cp legacy-migration\.html legacy-public\/index\.html/);
  assert.match(workflow,/cp legacy-service-worker\.js legacy-public\/service-worker\.js/);
  assert.match(workflow,/assistant-store\.js assistant-backup\.js/);
  assert.match(workflow,/reminders-config\.js/);
  assert.doesNotMatch(workflow,/cp\s+-r|\.env|\.vapid|backend\/|assistant-ui\.js|assistant-billing\.js/);
  assert.match(workflow,/pages: write/);assert.match(workflow,/id-token: write/);
  for(const match of read('legacy-migration.html').matchAll(/(?:src|href)="\.\/([^"?#]+)"/g))assert.ok(fs.existsSync(path.join(__dirname,'..',match[1])),match[1]);
});
