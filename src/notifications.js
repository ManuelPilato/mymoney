/* Opt-in only. No background delivery is claimed without a real native or push transport. */
(function(root){
  'use strict';
  const node=typeof module!=='undefined'&&module.exports;
  const M=node?require('./core.js'):root.MM,Copy=node?require('./notification-messages.js'):root.MMNotificationMessages;
  const DEFAULTS=Object.freeze({due:true,budget:true,weekly:false,reminder:false,details:false});
  const KEY='mymoney-notifications-v1',ICON='./icon-192-v2.png';
  function preferences(value={}){return Object.fromEntries(Object.entries(DEFAULTS).map(([key,fallback])=>[key,typeof value[key]==='boolean'?value[key]:fallback]));}
  function hash(text){let h=2166136261;for(const c of text){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return 10000+(h>>>0)%2000000000;}
  function packet(kind,values,language,details,tag){
    return {...Copy.message(kind,values,language,details),kind,language:language==='en'?'en':'it',tag,id:hash(tag),icon:ICON,badge:ICON,data:{url:kind==='due'||kind==='dueMany'?'./?notification=plan':'./?notification=history',kind}};
  }
  function upcomingExpenses(state,date){
    const transactions=state.transactions||[],paid=new Set(transactions.filter(t=>t.type==='expense'&&t.status==='paid'&&t.recurringId).map(t=>`${t.recurringId}:${t.dueDate||t.date}`));
    const plannedKeys=new Set(),items=[];
    for(const t of transactions.filter(t=>t.type==='expense'&&t.status==='planned')){
      const key=t.recurringId?`${t.recurringId}:${t.dueDate||t.date}`:null;
      if(key&&(paid.has(key)||plannedKeys.has(key)))continue;
      if(key)plannedKeys.add(key);
      if(t.date===date)items.push({name:t.note||'',amountCents:t.amountCents});
    }
    for(const r of state.recurring||[])for(const due of M.occurrences(r,date,M.shiftDays(date,1))){
      const key=`${r.id}:${due}`;if(paid.has(key)||plannedKeys.has(key))continue;
      items.push({name:r.name||'',amountCents:r.amountCents});
    }
    return items;
  }
  // One scheduled reminder a day, 10:00–20:00 local time. Due dates take priority.
  // Future budget figures are never forecast; only today's known budget is used.
  function schedule(state,input={},options={}){
    const prefs=preferences(input),now=options.now?new Date(options.now):new Date(),language=options.language==='en'?'en':'it';
    if(!Number.isFinite(+now)||!state?.settings?.initialized)return [];
    const today=M.iso(now),days=Math.max(1,Math.min(14,options.days||14));
    const money=n=>new Intl.NumberFormat(language==='en'?'en-IE':'it-IT',{style:'currency',currency:'EUR'}).format(n/100);
    const daily=new Map(),put=(date,hour,priority,kind,values={})=>{
      const at=new Date(`${date}T${String(hour).padStart(2,'0')}:00:00`);if(+at<=+now)return;
      const tag=`mymoney-${kind}-${date}`,item={...packet(kind,values,language,prefs.details,tag),at:at.toISOString(),priority};
      if(!daily.has(date)||priority>daily.get(date).priority)daily.set(date,item);
    };
    for(let i=0;i<days;i++){
      const date=M.shiftDays(today,i),due=upcomingExpenses(state,M.shiftDays(date,1));
      if(prefs.due&&due.length){
        const amount=money(due.reduce((sum,item)=>sum+item.amountCents,0));
        put(date,10,100,due.length===1?'due':'dueMany',{name:due[0].name.slice(0,70),amount,count:due.length});
      }
      if(prefs.weekly&&M.dateObj(date).getDay()===1)put(date,18,40,'weekly');
      if(prefs.reminder)put(date,20,20,'reminder');
    }
    if(prefs.budget&&state.settings.budgetCents>0){
      const t=M.totals(state,today),daysLeft=Math.round((Date.UTC(...t.end.split('-').map((n,i)=>+n-(i===1?1:0)))-Date.UTC(...today.split('-').map((n,i)=>+n-(i===1?1:0))))/86400000);
      const periodDays=Math.round((+M.dateObj(t.end)-+M.dateObj(t.start))/86400000),remainingFraction=Math.max(0,daysLeft)/Math.max(1,periodDays);
      // No "low" warning just because the cycle is almost over: compare with time left.
      if(t.available<0)put(today,18,80,'budgetExceeded',{amount:money(-t.available)});
      else if(daysLeft>2&&t.available/state.settings.budgetCents<Math.min(.2,remainingFraction*.5))put(today,18,80,'budgetLow',{amount:money(t.available),days:`${daysLeft} ${language==='en'?'days':'giorni'}`});
    }
    return [...daily.values()].sort((a,b)=>a.at.localeCompare(b.at)).map(({priority,...item})=>item);
  }
  function configValid(config){
    if(!config||typeof config.publicVapidKey!=='string'||!/^[A-Za-z0-9_-]{87}$/.test(config.publicVapidKey))return false;
    try{const url=new URL(config.endpoint);return url.protocol==='https:'&&!url.username&&!url.password;}catch(_){return false;}
  }
  function createClient(options={}){
    const env=options.env||root,storage=options.storage||env.localStorage,getConfig=options.getConfig||(()=>env.MM_PUSH_CONFIG),getLanguage=options.getLanguage||(()=>env.MyMoneyI18n?.language||'it'),getOwner=options.getOwner||(()=>'local');
    let record={enabled:false,owner:null,preferences:{...DEFAULTS},ids:[]},revision=0,queue=Promise.resolve();
    try{const saved=JSON.parse(storage?.getItem(KEY)||'null');if(saved)record={enabled:!!saved.enabled,owner:typeof saved.owner==='string'?saved.owner:null,preferences:preferences(saved.preferences),ids:Array.isArray(saved.ids)?saved.ids.filter(Number.isInteger):[]};}catch(_){}
    const native=()=>env.MMNative?.isNative===true;
    function persist(){storage?.setItem(KEY,JSON.stringify(record));}
    function capabilities(){
      const ios=/iP(hone|ad|od)/.test(env.navigator?.userAgent||'')||env.navigator?.platform==='MacIntel'&&env.navigator?.maxTouchPoints>1;
      const standalone=!!env.navigator?.standalone||!!env.matchMedia?.('(display-mode: standalone)').matches;
      const web=!!env.isSecureContext&&!!env.navigator?.serviceWorker&&!!env.Notification&&!!env.PushManager;
      return {native:native(),supported:native()||web,needsHomeScreen:!native()&&ios&&!standalone,configured:native()||configValid(getConfig())};
    }
    async function status(){
      const caps=capabilities(),permission=caps.native?await env.MMNative.notificationPermission():env.Notification?.permission||'unsupported';
      return {...caps,permission,enabled:record.enabled&&record.owner===getOwner()&&permission==='granted'&&caps.configured,preferences:{...record.preferences}};
    }
    function fail(code){const error=new Error(code);error.code=code;throw error;}
    function check({requireBackend=false}={}){const caps=capabilities();if(caps.needsHomeScreen)fail('home-screen-required');if(!caps.supported)fail('unsupported');if(requireBackend&&!caps.configured)fail('backend-required');return caps;}
    function permissionRequest(caps){
      // Invoked synchronously from the button handler, before awaiting worker readiness.
      return caps.native?env.MMNative.requestNotificationPermission():env.Notification.requestPermission();
    }
    async function registration(){return env.navigator.serviceWorker.ready;}
    function applicationServerKey(key){const base=key.replace(/-/g,'+').replace(/_/g,'/'),raw=env.atob(base+'='.repeat((4-base.length%4)%4));return Uint8Array.from(raw,c=>c.charCodeAt(0));}
    function guard(ticket,owner){if(ticket!==revision||owner!==getOwner())fail('operation-cancelled');}
    async function backend(method,body,validate=()=>{}){
      const config=getConfig();if(!configValid(config))fail('backend-required');
      validate();const token=await options.getToken?.();validate();if(!token)fail('sign-in-required');
      const response=await env.fetch(config.endpoint,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body),credentials:'omit',cache:'no-store'});
      if(!response.ok)fail('delivery-unavailable');
    }
    async function enable(){
      const caps=check({requireBackend:true}),ticket=++revision,owner=getOwner(),request=permissionRequest(caps),permission=await request;
      guard(ticket,owner);
      if(permission!=='granted')fail('permission-denied');
      await queue.catch(()=>{});guard(ticket,owner);
      if(!caps.native){
        const worker=await registration();guard(ticket,owner);const existing=await worker.pushManager.getSubscription();guard(ticket,owner);
        let subscription;
        try{subscription=existing||await worker.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:applicationServerKey(getConfig().publicVapidKey)});guard(ticket,owner);
          await backend('PUT',{subscription:subscription.toJSON(),language:getLanguage(),preferences:record.preferences,notifications:[]},()=>guard(ticket,owner));guard(ticket,owner);
        }catch(error){if(!existing&&subscription)await subscription.unsubscribe().catch(()=>{});throw error;}
      }
      guard(ticket,owner);record.enabled=true;record.owner=owner;persist();return status();
    }
    function disable({resetPreferences=false}={}){
      ++revision;
      // Change ownership/opt-in synchronously; queued work cannot show old data as active.
      record.enabled=false;if(resetPreferences)record.preferences={...DEFAULTS};persist();
      // A late native scheduling promise must finish before cancellation.
      const task=queue.catch(()=>{}).then(async()=>{
        if(native())await env.MMNative.cancelNotifications(record.ids);
        else if(env.navigator?.serviceWorker){const worker=await registration(),subscription=await worker.pushManager.getSubscription();if(subscription){
          if(configValid(getConfig()))await backend('DELETE',{subscription:subscription.toJSON(),notifications:[]}).catch(()=>{});
          await subscription.unsubscribe();
        }}
        record.enabled=false;record.owner=null;record.ids=[];persist();return status();
      });queue=task;return task;
    }
    async function test(){
      const caps=check(),request=permissionRequest(caps),permission=await request;if(permission!=='granted')fail('permission-denied');
      const notification=packet('test',{},getLanguage(),false,'mymoney-test');
      if(caps.native){
        // Native bridge has a separate test path so testing never replaces scheduled reminders.
        if(!env.MMNative.testNotification)fail('test-unavailable');await env.MMNative.testNotification(notification);
      }else{const worker=await registration();await worker.showNotification(notification.title,{body:notification.body,icon:notification.icon,badge:notification.badge,tag:notification.tag,data:notification.data});}
      return {shown:true,automatic:record.enabled&&caps.configured};
    }
    function setPreferences(next){record.preferences=preferences({...record.preferences,...next});persist();return {...record.preferences};}
    function sync(state){
      const ticket=++revision,owner=getOwner();
      const task=queue.catch(()=>{}).then(async()=>{
        if(ticket!==revision||owner!==getOwner())return {scheduled:0,stale:true};
        const current=await status();if(!current.enabled)return {scheduled:0,enabled:false};
        const notifications=schedule(state,record.preferences,{language:getLanguage()});if(ticket!==revision||owner!==getOwner())return {scheduled:0,stale:true};
        if(current.native)await env.MMNative.scheduleNotifications(notifications);
        else{const worker=await registration();guard(ticket,owner);const subscription=await worker.pushManager.getSubscription();guard(ticket,owner);if(!subscription){record.enabled=false;persist();return {scheduled:0,enabled:false};}await backend('PUT',{subscription:subscription.toJSON(),language:getLanguage(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,preferences:record.preferences,notifications},()=>guard(ticket,owner));}
        // Preserve actual scheduled IDs even if disable() arrived during the await.
        record.ids=notifications.map(n=>n.id);persist();return {scheduled:notifications.length,enabled:true};
      });queue=task;return task;
    }
    // A different account may have become active while the application was closed.
    if((record.enabled||record.ids.length)&&record.owner!==getOwner())void disable({resetPreferences:true}).catch(()=>{});
    return {capabilities,status,enable,disable,test,setPreferences,sync,get preferences(){return {...record.preferences};}};
  }
  const api={DEFAULTS,ICON,preferences,packet,schedule,upcomingExpenses,configValid,createClient,CATALOG:Copy.CATALOG};if(node)module.exports=api;root.MMNotifications=api;
})(typeof globalThis!=='undefined'?globalThis:this);
