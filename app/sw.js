/* Cache only the public application shell, never backup files. */
'use strict';
const CACHE='mymoney-local-shell-v6.6.0';
const FILES=['./','./index.html','./firebase-sdk.js','./native.js','./manifest.webmanifest','./icon-180-v2.png','./icon-192-v2.png','./icon-512-v2.png','./preview-wordmark-v2.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)));
  // Wait for existing windows to close before activating a new release.
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    for(const key of await caches.keys())if(key.startsWith('mymoney-local-shell-')&&key!==CACHE)await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  // Use the installed shell offline; app updates are versioned through this worker.
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    if(event.request.mode==='navigate')return (await cache.match('./index.html'))||fetch(event.request);
    return (await cache.match(event.request))||fetch(event.request);
  })());
});


// Display every push immediately; Safari does not permit silent background push.
// Payloads may contain financial details only when the person opted in upstream.
const NOTIFICATION_KINDS=new Set(['test','due','dueMany','budgetLow','budgetExceeded','weekly','reminder']);
const NOTIFICATION_ROUTES=new Set(['plan','history']);
const APP_SCOPE=new URL(self.registration.scope);
const APP_ICON=new URL('./icon-192-v2.png',APP_SCOPE).href;
function notificationText(value,fallback,limit){
  if(typeof value!=='string')return fallback;
  const text=value.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,' ').trim();
  return text?Array.from(text).slice(0,limit).join(''):fallback;
}
function appWindow(url){
  try{
    const value=new URL(url,APP_SCOPE);
    return value.origin===APP_SCOPE.origin&&!value.username&&!value.password&&
      (value.pathname===APP_SCOPE.pathname||value.pathname===APP_SCOPE.pathname+'index.html');
  }catch(_){return false;}
}
function notificationDestination(raw,kind){
  let route=kind==='due'||kind==='dueMany'?'plan':'history';
  if(typeof raw==='string')try{
    const value=new URL(raw,APP_SCOPE),entries=[...value.searchParams.entries()];
    if(appWindow(value.href)&&!value.hash&&entries.length===1&&entries[0][0]==='notification'&&NOTIFICATION_ROUTES.has(entries[0][1]))route=entries[0][1];
  }catch(_){}
  const destination=new URL('./',APP_SCOPE);destination.searchParams.set('notification',route);
  return {url:destination.href,route,kind};
}
self.addEventListener('push',event=>{
  let payload={};
  try{const data=event.data?.json();if(data&&typeof data==='object'&&!Array.isArray(data))payload=data;}catch(_){}
  const language=payload.language==='en'?'en':payload.language==='it'?'it':String(self.navigator?.language||'it').startsWith('en')?'en':'it';
  const kind=NOTIFICATION_KINDS.has(payload.kind)?payload.kind:'general';
  const fallback=language==='en'?'There’s an update for you. Open MyMoney to take a look.':'C’è un aggiornamento per te. Apri MyMoney per vederlo.';
  const title=notificationText(payload.title,'MyMoney.',80),body=notificationText(payload.body,fallback,240);
  const tag=typeof payload.tag==='string'&&/^mymoney-[A-Za-z0-9_.:-]{1,96}$/.test(payload.tag)?payload.tag:'mymoney-'+kind;
  event.waitUntil(self.registration.showNotification(title,{
    body,tag,lang:language,dir:'auto',icon:APP_ICON,badge:APP_ICON,
    renotify:false,requireInteraction:false,
    data:notificationDestination(payload.data?.url,kind)
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const data=event.notification.data||{},kind=NOTIFICATION_KINDS.has(data.kind)?data.kind:'general';
  // Revalidate persisted data as well: it may originate from an older release.
  const destination=notificationDestination(data.url,kind);
  const message={type:'MM_NOTIFICATION_OPEN',...destination};
  event.waitUntil((async()=>{
    const controlled=(await self.clients.matchAll({type:'window'})).filter(client=>appWindow(client.url));
    controlled.sort((a,b)=>Number(b.visibilityState==='visible')-Number(a.visibilityState==='visible'));
    for(const client of controlled)try{
      await client.focus();client.postMessage(message);return;
    }catch(_){} // A tab may close between discovery and focus.
    const windows=(await self.clients.matchAll({type:'window',includeUncontrolled:true})).filter(client=>appWindow(client.url));
    for(const client of windows)try{
      const navigated=await client.navigate(destination.url);
      if(navigated){await navigated.focus();navigated.postMessage(message);return;}
    }catch(_){}
    await self.clients.openWindow(destination.url);
  })());
});
