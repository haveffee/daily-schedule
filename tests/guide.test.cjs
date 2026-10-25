'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const guide=require('../assistant-guide.js');
const status=(uid='owner',overrides={})=>({uid,configured:true,initialized:true,supported:true,needsInstall:false,permission:'default',enabled:false,busy:false,...overrides});
function localStorage(initial=[]){
  const values=new Map(initial),writes=[];
  return {values,writes,getItem:key=>values.get(key)||null,setItem(key,value){writes.push({key,value});values.set(key,value);}};
}

test('feature sections and nested copy are immutable plain text describing current capabilities',()=>{
  assert.equal(guide.getFeatures(),guide.features);assert.equal(guide.sections,guide.features);
  assert.deepEqual(guide.features.map(section=>section.id),['day','goals','money','everywhere']);
  assert.equal(Object.isFrozen(guide),true);assert.equal(Object.isFrozen(guide.features),true);
  for(const section of guide.features){
    assert.equal(Object.isFrozen(section),true);assert.equal(Object.isFrozen(section.items),true);
    assert.ok(section.icon&&section.title&&section.description&&section.items.length);
    for(const item of section.items){assert.equal(Object.isFrozen(item),true);assert.ok(item.id&&item.title&&item.description);}
  }
  const text=JSON.stringify(guide.features);
  for(const id of ['priorities','recurring','move','focus','monthly-goals','goal-progress','currencies','income','mandatory','forecast','categories-limits','sync','backup','notifications'])assert.ok(text.includes('"'+id+'"'),id);
  for(const currency of ['BYN','USD','RUB'])assert.ok(text.includes(currency));
  assert.match(text,/Автоматической конвертации по курсу нет/);
  assert.match(text,/включи уведомления отдельно на устройстве/);
  assert.doesNotMatch(text,/<[^>]*>|подключ[иа]й? банк|автоматически.*(?:банк|спишет)|нейросеть|(?:^|[^А-ЯЁ])ИИ(?=$|[^А-ЯЁ])/i);
  assert.throws(()=>{guide.features[0].items[0].title='Changed';},TypeError);
});

test('a ready signed-in device receives an enable offer without side effects',()=>{
  const storage=localStorage();let clockCalls=0;
  const offer=guide.createNotificationOffer({storage,now:()=>{clockCalls++;return 100;}});
  assert.equal(offer.shouldOffer('owner',status()),true);assert.equal(offer.canOffer('owner',status()),true);
  const copy=offer.getOffer('owner',status());
  assert.equal(copy.kind,'enable');assert.equal(copy.action,'enable');assert.equal(copy.actionLabel,'Включить напоминания');
  assert.equal(copy.dismissLabel,'Позже');assert.equal(Object.isFrozen(copy),true);
  assert.equal(clockCalls,0);assert.equal(storage.writes.length,0,'eligibility reads do not count as a shown card');
});

test('markShown persists one offer per device scope and retains the original timestamp',()=>{
  const storage=localStorage();let time=100;
  const offer=guide.createNotificationOffer({storage,now:()=>time});
  assert.equal(offer.markShown('owner').offeredAt,100);assert.equal(offer.shouldOffer('owner',status()),false);
  const saved=JSON.parse(storage.writes[0].value);assert.deepEqual(saved,{version:1,offeredAt:100});
  time=300;assert.equal(offer.markShown('owner').offeredAt,100);
  const revisited=guide.createNotificationOffer({storage,now:()=>500});
  assert.equal(revisited.shouldOffer('owner',status()),false,'a later controller on this device does not nag');
  assert.equal(revisited.canOffer('owner',status()),true,'capability checks can retain an already visible card');
  assert.equal(revisited.getOffer('owner',status(),{ignoreShown:true}).kind,'enable');
  assert.equal(revisited.shouldOffer('other',status('other')),true,'a different Google account has a separate preference');
  const secondDevice=guide.createNotificationOffer({storage:localStorage()});
  assert.equal(secondDevice.shouldOffer('owner',status()),true,'another device can make its own choice');
});

test('dismiss persists locally and never exposes a dismissed card through normal eligibility',()=>{
  const storage=localStorage();let time=10;
  const offer=guide.createNotificationOffer({storage,now:()=>time});offer.markShown('owner');time=20;
  assert.deepEqual(offer.dismiss('owner'),{version:1,offeredAt:10,dismissedAt:20});
  assert.equal(offer.getOffer('owner',status()),null);
  const revisited=guide.createNotificationOffer({storage});assert.equal(revisited.shouldOffer('owner',status()),false);
  assert.equal(revisited.getOffer('owner',status(),{ignoreShown:true}).action,'enable');
  assert.ok(storage.writes.every(({key})=>key.startsWith('hvf-notification-offer:v1:')));
});

test('already enabled, denied, unavailable, busy and incomplete service states suppress the offer',()=>{
  const offer=guide.createNotificationOffer({storage:localStorage()});
  for(const value of [null,{},status('owner',{enabled:true}),status('owner',{permission:'denied'}),status('owner',{configured:false}),status('owner',{configured:undefined}),status('owner',{initialized:false}),status('owner',{busy:true}),status('owner',{supported:false}),status('owner',{permission:'unsupported'}),status('owner',{permission:undefined})]){
    assert.equal(offer.shouldOffer('owner',value),false,JSON.stringify(value));
    assert.equal(offer.getOffer('owner',value,{ignoreShown:true}),null,'ignoreShown never bypasses platform or permission checks');
  }
});

test('a granted browser permission still requires an explicit enable action when no device subscription is active',()=>{
  const offer=guide.createNotificationOffer({storage:localStorage()});
  const copy=offer.getOffer('owner',status('owner',{permission:'granted',enabled:false}));
  assert.equal(copy.kind,'enable');assert.equal(copy.action,'enable');assert.match(copy.description,/Включи уведомления/);
  assert.equal(offer.shouldOffer('owner',status('owner',{permission:'granted',enabled:true})),false);
});

test('uninstalled iPhone gets an installation explanation even when browser push APIs are not yet available',()=>{
  const offer=guide.createNotificationOffer({storage:localStorage()});
  const phone=status('owner',{needsInstall:true,supported:false,permission:'unsupported'});
  assert.equal(offer.getOffer('owner',phone).kind,'install');
  assert.equal(offer.getOffer('owner',phone).action,'install');
  assert.match(offer.getOffer('owner',phone).description,/пока не включены/);
  assert.equal(offer.getOffer('owner',{...phone,permission:'denied'}),null,'a denied permission is not nagged by an installation card');
});

test('anonymous users receive login guidance only after reminder state has no previous account uid',()=>{
  const offer=guide.createNotificationOffer({storage:localStorage()});
  const copy=offer.getOffer('anonymous',status(''));
  assert.equal(copy.kind,'login');assert.equal(copy.action,'login');assert.match(copy.description,/затем включи/);
  assert.equal(offer.shouldOffer('anonymous',status('previous-owner')),false);
  assert.equal(offer.shouldOffer('',status('')),true,'an empty application scope is anonymous');
  assert.equal(offer.getOffer('anonymous',status('',{needsInstall:true,supported:false,permission:'unsupported'})).kind,'install');
});

test('account reconciliation cannot display another owner’s enable offer or mark the new account as shown',()=>{
  const storage=localStorage(),offer=guide.createNotificationOffer({storage});
  assert.equal(offer.getOffer('new-owner',status('old-owner')),null);
  assert.equal(offer.getOffer('new-owner',status('')),null);
  assert.equal(storage.writes.length,0);
  assert.equal(offer.getOffer('new-owner',status('new-owner')).kind,'enable');
  offer.markShown('old-owner');
  assert.equal(offer.shouldOffer('new-owner',status('new-owner')),true);
  assert.equal(offer.getOffer('new-owner',status('old-owner'),{ignoreShown:true}),null);
});

test('blocked or unavailable local storage falls back to session memory without repeating offers',()=>{
  const blocked={getItem(){throw new Error('blocked');},setItem(){throw new Error('quota');}};
  const offer=guide.createNotificationOffer({storage:blocked,now:()=>0});
  assert.equal(offer.shouldOffer('blocked-owner',status('blocked-owner')),true);
  offer.markShown('blocked-owner');assert.equal(offer.shouldOffer('blocked-owner',status('blocked-owner')),false);
  assert.equal(guide.createNotificationOffer({storage:blocked}).shouldOffer('blocked-owner',status('blocked-owner')),false,'recreating the controller does not nag when persistence throws');
  const absent=guide.createNotificationOffer({storage:null});
  assert.equal(absent.shouldOffer('no-storage-owner',status('no-storage-owner')),true);
  absent.dismiss('no-storage-owner');
  assert.equal(guide.createNotificationOffer({storage:null}).shouldOffer('no-storage-owner',status('no-storage-owner')),false);
});

test('malformed persisted preferences do not break the app and valid records are read without rewriting',()=>{
  const key='hvf-notification-offer:v1:owner';
  for(const value of ['{bad','null','{"version":2,"offeredAt":1}','{"version":1,"offeredAt":-1}','{"version":1,"offeredAt":"100"}']){
    const storage=localStorage([[key,value]]),offer=guide.createNotificationOffer({storage});
    assert.equal(offer.shouldOffer('owner',status()),true,value);assert.equal(storage.writes.length,0);
  }
  const storage=localStorage([[key,'{"version":1,"dismissedAt":0}']]),offer=guide.createNotificationOffer({storage});
  assert.equal(offer.shouldOffer('owner',status()),false);assert.equal(storage.writes.length,0);
});

test('browser UMD loading, feature access and policy checks never request permission or call remote services',()=>{
  let permissions=0,requests=0;
  const window={Notification:{requestPermission(){permissions++;}},fetch(){requests++;throw new Error('network forbidden');}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assistant-guide.js'),'utf8'),{window});
  assert.equal(typeof window.HVFGuide.createNotificationOffer,'function');
  assert.equal(window.HVFGuide.getFeatures().length,4);
  const offer=window.HVFGuide.createNotificationOffer({storage:localStorage()});
  assert.equal(offer.getOffer('owner',status()).kind,'enable');offer.markShown('owner');offer.dismiss('owner');
  assert.equal(permissions,0);assert.equal(requests,0);
});

test('guide presentation keeps controls touch-sized and content selectable without decorative movement',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../assistant-guide.css'),'utf8');
  assert.match(css,/\.notification-offer-actions \.button\{[^}]*min-height:44px/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/@starting-style\{\.notification-offer\{opacity:0\}\}/);
  assert.doesNotMatch(css,/transition:\s*all|scale\(0\)|animation:|(?:^|\})\s*body[^}]*user-select:none/);
  assert.doesNotMatch(css,/touch-action:none|maximum-scale|user-scalable/);
});
