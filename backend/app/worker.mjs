import {createBilling} from '../billing/worker.mjs';
const billing=createBilling();
const FIREBASE_AUTH_ORIGIN='https://daily-schedule-sync-fc374.firebaseapp.com';
export function createApp({billingHandler=billing,fetcher=globalThis.fetch.bind(globalThis)}={}){
  return {
    async fetch(request,env){
      const url=new URL(request.url);
      if(url.pathname==='/health')return Response.json({ok:true,app:'HVF',payments:'disabled'},{headers:{'Cache-Control':'no-store'}});
      if(url.pathname.startsWith('/api/billing/'))return billingHandler.fetch(request,env);
      if(url.pathname.startsWith('/__/auth/')){
        if(!['GET','POST'].includes(request.method))return new Response('Method not allowed',{status:405});
        // Firebase's documented same-origin reverse proxy. The host is fixed,
        // never taken from a user argument; OAuth parameters are passed unchanged.
        const target=new URL(url.pathname+url.search,FIREBASE_AUTH_ORIGIN);
        const headers=new Headers();
        for(const name of ['Accept','Accept-Language','Content-Type'])if(request.headers.has(name))headers.set(name,request.headers.get(name));
        const response=await fetcher(target.href,{method:request.method,headers,body:request.method==='GET'?undefined:request.body,redirect:'manual'});
        const resultHeaders=new Headers(response.headers);resultHeaders.set('Cache-Control','no-store');
        const location=resultHeaders.get('Location');
        if(location){const destination=new URL(location,target);if(destination.origin===FIREBASE_AUTH_ORIGIN)resultHeaders.set('Location',url.origin+destination.pathname+destination.search+destination.hash);}
        return new Response(response.body,{status:response.status,headers:resultHeaders});
      }
      if(url.pathname==='/api'||url.pathname.startsWith('/api/'))return Response.json({error:{code:'not_found',message:'Маршрут не найден.'}},{status:404,headers:{'Cache-Control':'no-store'}});
      // HTML paths are literal so the offline shell can reject redirects safely.
      if(url.pathname==='/'&&['GET','HEAD'].includes(request.method)){
        url.pathname='/index.html';
        return env.ASSETS.fetch(new Request(url,request));
      }
      return env.ASSETS.fetch(request);
    }
  };
}
export default createApp();
