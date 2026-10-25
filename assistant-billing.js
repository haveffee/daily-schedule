(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HVFBilling = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PLANS = Object.freeze([
    Object.freeze({ id:'monthly',title:'Месяц',amount:800,currency:'BYN',interval:'month' }),
    Object.freeze({ id:'yearly',title:'Год',amount:7200,currency:'BYN',interval:'year' })
  ]);
  function create(options={}) {
    const endpoint=String(options.endpoint||'/api/billing').replace(/\/$/,'');
    const fetcher=options.fetch||globalThis.fetch?.bind(globalThis);
    const listeners=new Set();
    let generation=0,user=null;
    let state={catalog:null,account:null,loading:false,error:''};
    const getState=()=>({...state,plans:state.catalog?.plans||PLANS,user});
    function emit(){const snapshot=getState();listeners.forEach(fn=>fn(snapshot));}
    async function request(path,{method='GET',body,authenticated=false,expectedScope=user?.uid||'',expectedGeneration=generation}={}) {
      if(!fetcher)throw new Error('Сервис подписки временно недоступен.');
      const headers={Accept:'application/json'};
      if(authenticated){
        const current=()=>{if(expectedScope!==(user?.uid||'')||expectedGeneration!==generation)throw new Error('Аккаунт изменился. Повтори действие.');};
        current();
        const token=await options.getToken?.();
        current();
        if(!token)throw new Error('Войди через Google для управления подпиской.');
        headers.Authorization='Bearer '+token;
      }
      if(body)headers['Content-Type']='application/json';
      const controller=typeof AbortController==='function'?new AbortController():null;
      const timer=controller?setTimeout(()=>controller.abort(),12000):null;
      try{
        const response=await fetcher(endpoint+path,{method,headers,body:body?JSON.stringify(body):undefined,credentials:'omit',cache:'no-store',redirect:'error',signal:controller?.signal});
        let data;try{data=await response.json();}catch{throw new Error('Сервис вернул неожиданный ответ. Попробуй позже.');}
        if(!response.ok)throw new Error(data?.error?.message||'Не удалось получить данные подписки.');
        return data;
      }finally{if(timer!==null)clearTimeout(timer);}
    }
    function validateCatalog(value){
      if(!value||!['disabled','live'].includes(value.mode)||typeof value.paymentsReady!=='boolean'||!Array.isArray(value.plans)||value.plans.length!==2)throw new Error('Не удалось проверить тарифы сервиса.');
      for(const plan of PLANS){const received=value.plans.find(p=>p.id===plan.id);if(!received||received.amount!==plan.amount||received.currency!=='BYN'||received.interval!==plan.interval)throw new Error('Тарифы изменились. Обнови приложение перед оплатой.');}
      if(value.paymentsReady&&value.mode!=='live')throw new Error('Не удалось проверить доступность оплаты.');
      return value;
    }
    function setUser(next){
      const current=user?.uid||'',incoming=next?.uid||'';
      user=next?{uid:next.uid}:null;
      if(current===incoming)return;
      generation++;state={...state,account:null,loading:false,error:''};emit();
    }
    async function refresh(){
      const current=++generation,scope=user?.uid||'';
      state={...state,loading:true,error:''};emit();
      try{
        const catalog=validateCatalog(await request('/catalog'));
        if(current!==generation||scope!==(user?.uid||''))return false;
        const account=scope?await request('/status',{authenticated:true,expectedScope:scope,expectedGeneration:current}):null;
        if(current!==generation||scope!==(user?.uid||''))return false;
        if(account&&(!['free','plus'].includes(account.plan)||typeof account.status!=='string'))throw new Error('Не удалось подтвердить доступ аккаунта.');
        state={catalog,account,loading:false,error:''};emit();return true;
      }catch(error){
        if(current!==generation)return false;
        // A stale active state must never survive a failed entitlement check.
        state={...state,catalog:null,account:null,loading:false,error:error.message||'Сервис подписки недоступен.'};emit();return false;
      }
    }
    async function checkout(plan){
      if(!PLANS.some(p=>p.id===plan))throw new Error('Выбери месячный или годовой тариф.');
      if(!state.catalog?.paymentsReady)throw new Error('Оплата пока не подключена. Все возможности доступны в бесплатной бете.');
      const scope=user?.uid||'',current=generation;
      if(!scope)throw new Error('Сначала войди через Google.');
      const result=await request('/checkout',{method:'POST',body:{plan},authenticated:true,expectedScope:scope,expectedGeneration:current});
      if(current!==generation||scope!==(user?.uid||''))throw new Error('Аккаунт изменился. Выбери тариф заново.');
      let url;try{url=new URL(result.checkoutUrl);}catch{throw new Error('Платёжная страница недоступна.');}
      if(url.origin!=='https://checkout.bepaid.by'||url.username||url.password||!url.pathname.startsWith('/v2/'))throw new Error('Платёжная страница не прошла проверку.');
      return url.href;
    }
    async function cancel(){
      if(!state.catalog?.paymentsReady)throw new Error('Платных подписок пока нет.');
      const scope=user?.uid||'',current=generation;
      if(!scope)throw new Error('Сначала войди через Google.');
      const result=await request('/cancel',{method:'POST',body:{},authenticated:true,expectedScope:scope,expectedGeneration:current});
      if(current!==generation||scope!==(user?.uid||''))throw new Error('Аккаунт изменился. Обнови статус подписки.');
      await refresh();return result;
    }
    return Object.freeze({getState,setUser,refresh,checkout,cancel,subscribe(fn){listeners.add(fn);fn(getState());return()=>listeners.delete(fn);}});
  }
  return Object.freeze({create,plans:PLANS});
});
