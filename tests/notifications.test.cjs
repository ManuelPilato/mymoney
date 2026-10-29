'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../src/core.js'),N=require('../src/notifications.js'),policy=require('../server/notifications/policy.cjs');
function state(){const s=M.blank();Object.assign(s.settings,{initialized:true,openingDate:'2026-10-01',budgetCents:100000,payday:1});return s;}
function rec(id='rent',date='2026-10-30'){return {id,name:'Affitto',amountCents:50000,months:1,startDate:date,active:true,automatic:true,estimated:false,category:'Casa'};}
const morning=new Date('2026-10-29T09:00:00');
const atHour=notification=>new Date(notification.at).getHours();
function browser(overrides={}){let asked=0,shown=0;const data=new Map();const env={isSecureContext:true,Notification:{permission:'default',requestPermission:()=>{asked++;env.Notification.permission='granted';return Promise.resolve('granted');}},navigator:{userAgent:'iPhone',standalone:true,serviceWorker:{ready:Promise.resolve({showNotification:async()=>{shown++;}})}},PushManager:function(){},matchMedia:()=>({matches:false}),localStorage:{getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)},...overrides};return {env,get asked(){return asked;},get shown(){return shown;}};}

test('Schedules a private reminder the morning before a fixed expense',()=>{
  const s=state();s.recurring.push(rec());const before=JSON.stringify(s),plan=N.schedule(s,{}, {now:morning});
  assert.equal(plan[0].kind,'due');assert.equal(atHour(plan[0]),10);assert.equal(plan[0].icon,'./icon-192-v2.png');
  assert.doesNotMatch(plan[0].body,/Affitto|500/);assert.ok(plan.every(p=>new Date(p.at)>morning));
  assert.equal(JSON.stringify(s),before);
});
test('Detailed copy and English use the same dynamic names and amounts',()=>{
  const s=state();s.recurring.push(rec());const p=N.schedule(s,{details:true},{now:morning,language:'en'})[0];
  assert.equal(p.title,'Tomorrow, no surprises.');assert.match(p.body,/Affitto/);assert.match(p.body,/€500\.00/);assert.equal(p.data.url,'./?notification=plan');
});
test('Paid recurring occurrences and moved plans never generate stale duplicate reminders',()=>{
  const s=state();s.recurring.push(rec());s.transactions.push({id:'paid',type:'expense',status:'paid',date:'2026-10-29',dueDate:'2026-10-30',recurringId:'rent',amountCents:50000});
  assert.equal(N.upcomingExpenses(s,'2026-10-30').length,0);
  s.transactions[0]={...s.transactions[0],status:'planned',date:'2026-11-02'};
  assert.equal(N.upcomingExpenses(s,'2026-10-30').length,0);assert.equal(N.upcomingExpenses(s,'2026-11-02').length,1);
});
test('Identical ordinary planned expenses remain separate and are grouped in one notification',()=>{
  const s=state();s.transactions=[1,2].map(id=>({id:String(id),type:'expense',status:'planned',date:'2026-10-30',amountCents:2000,note:'Benzina'}));
  const p=N.schedule(s,{details:true},{now:morning})[0];assert.equal(p.kind,'dueMany');assert.match(p.body,/2 scadenze/);assert.match(p.body,/40,00/);
});
test('Only one reminder per day, no nighttime alerts, due dates win over opt-in reminders',()=>{
  const s=state();s.recurring.push(rec());const plan=N.schedule(s,{weekly:true,reminder:true},{now:morning});
  assert.equal(plan.length,14);assert.equal(new Set(plan.map(p=>new Date(p.at).toDateString())).size,14);
  assert.equal(plan[0].kind,'due');assert.ok(plan.every(p=>[10,18,20].includes(atHour(p))));
});
test('Low-budget warning accounts for days remaining and is not generated at cycle end',()=>{
  const s=state();s.transactions.push({id:'spent',type:'expense',status:'paid',date:'2026-10-01',amountCents:85000,countBudget:true});
  assert.equal(N.schedule(s,{due:false},{now:new Date('2026-10-05T09:00:00')})[0].kind,'budgetLow');
  assert.equal(N.schedule(s,{due:false},{now:new Date('2026-10-30T09:00:00')}).length,0);
});
test('Empty or zero-budget archives do not emit financial claims; scheduler is pure',()=>{
  const s=M.blank(),before=JSON.stringify(s);assert.deepEqual(N.schedule(s,{reminder:true},{now:morning}),[]);assert.equal(JSON.stringify(s),before);
  s.settings.initialized=true;assert.deepEqual(N.schedule(s,{},{now:morning}),[]);
});
test('All notification copy is available in Italian and English, with no unresolved tokens',()=>{
  for(const language of ['it','en'])for(const kind of Object.keys(N.CATALOG))for(const details of [false,true]){
    const p=N.packet(kind,{name:'Test',amount:'20 €',count:2,days:'4 giorni'},language,details,'mymoney-'+kind+'-2026-10-29');
    assert.ok(p.title&&p.body);assert.doesNotMatch(p.title+p.body,/\{\w+\}/);assert.ok(p.id>=10000&&p.id<2147483647);
  }
});
test('Opening the app never prompts; missing web backend cannot report automatic delivery enabled',async()=>{
  const b=browser(),client=N.createClient({env:b.env});assert.equal(b.asked,0);assert.equal((await client.status()).configured,false);
  await assert.rejects(client.enable(),{code:'backend-required'});assert.equal(b.asked,0);assert.equal((await client.status()).enabled,false);
});
test('iPhone browser explains Home Screen prerequisite before requesting permission',async()=>{
  const b=browser();b.env.navigator.standalone=false;const client=N.createClient({env:b.env});assert.equal(client.capabilities().needsHomeScreen,true);
  await assert.rejects(client.test(),{code:'home-screen-required'});assert.equal(b.asked,0);
});
test('Explicit test can show logo notification without falsely enabling remote push',async()=>{
  const b=browser(),client=N.createClient({env:b.env});const response=await client.test();assert.equal(b.asked,1);assert.equal(b.shown,1);assert.equal(response.automatic,false);assert.equal((await client.status()).enabled,false);
});
test('Native path schedules real device reminders and cancellation only uses owned IDs',async()=>{
  const b=browser();let scheduled=[],cancelled=[];b.env.MMNative={isNative:true,notificationPermission:async()=>b.env.Notification.permission,requestNotificationPermission:()=>b.env.Notification.requestPermission(),scheduleNotifications:async list=>{scheduled=list;},cancelNotifications:async ids=>{cancelled=ids;},testNotification:async()=>{}};
  const client=N.createClient({env:b.env});assert.equal((await client.enable()).enabled,true);
  client.setPreferences({reminder:true});await client.sync(state());assert.ok(scheduled.length>0);await client.disable();assert.deepEqual(cancelled,scheduled.map(p=>p.id));assert.equal((await client.status()).enabled,false);
});
test('Disabling during a slow native update waits and cancels the actual newly scheduled IDs',async()=>{
  const b=browser();let release,started;const entered=new Promise(resolve=>{started=resolve;}),pending=new Promise(resolve=>{release=resolve;}),events=[];let cancelled=[];
  b.env.MMNative={isNative:true,notificationPermission:async()=>b.env.Notification.permission,requestNotificationPermission:()=>b.env.Notification.requestPermission(),scheduleNotifications:async()=>{events.push('schedule');started();await pending;events.push('scheduled');},cancelNotifications:async ids=>{cancelled=ids;events.push('cancelled');}};
  const client=N.createClient({env:b.env});await client.enable();client.setPreferences({reminder:true});
  const update=client.sync(state());await entered;const disable=client.disable();release();await Promise.all([update,disable]);
  assert.deepEqual(events,['schedule','scheduled','cancelled']);assert.ok(cancelled.length);assert.equal((await client.status()).enabled,false);
});
test('Backend rejection rolls back a newly created subscription and never reports enabled',async()=>{
  const b=browser();let removed=0;b.env.atob=globalThis.atob;b.env.fetch=async()=>({ok:false});b.env.MM_PUSH_CONFIG={endpoint:'https://sender.example/subscriptions',publicVapidKey:'A'.repeat(87)};
  b.env.navigator.serviceWorker.ready=Promise.resolve({pushManager:{getSubscription:async()=>null,subscribe:async()=>({toJSON:()=>({endpoint:'https://web.push.apple.com/example'}),unsubscribe:async()=>{removed++;}})}});
  const client=N.createClient({env:b.env,getToken:async()=>'synthetic-test-token'});await assert.rejects(client.enable(),{code:'delivery-unavailable'});assert.equal(removed,1);assert.equal((await client.status()).enabled,false);
});
function upload(){return {subscription:{endpoint:'https://web.push.apple.com/example',keys:{p256dh:'A'.repeat(87),auth:'B'.repeat(22)}},notifications:[{kind:'due',tag:'mymoney-due-2026-10-29',title:'Tomorrow',body:'Check your plan',at:'2026-10-29T10:00:00Z',data:{url:'https://evil.example/'}}]};}
test('Account change while permission is open cannot re-enable reminders for the next account',async()=>{
  const b=browser();let owner='A',release;const permission=new Promise(resolve=>{release=resolve;});
  b.env.MMNative={isNative:true,notificationPermission:async()=>'granted',requestNotificationPermission:()=>permission,cancelNotifications:async()=>{}};
  const client=N.createClient({env:b.env,getOwner:()=>owner});client.setPreferences({details:true});const enabling=client.enable();
  owner='B';await client.disable({resetPreferences:true});release('granted');
  await assert.rejects(enabling,{code:'operation-cancelled'});assert.equal((await client.status()).enabled,false);assert.equal(client.preferences.details,false);
});
test('Account change while fetching a token never uploads the previous account plan under the new identity',async()=>{
  const b=browser();let owner='A',release,started,uploads=0,removed=0;const entered=new Promise(resolve=>{started=resolve;}),token=new Promise(resolve=>{release=resolve;});
  b.env.atob=globalThis.atob;b.env.fetch=async()=>{uploads++;return {ok:true};};b.env.MM_PUSH_CONFIG={endpoint:'https://sender.example/subscriptions',publicVapidKey:'A'.repeat(87)};
  b.env.navigator.serviceWorker.ready=Promise.resolve({pushManager:{getSubscription:async()=>null,subscribe:async()=>({toJSON:()=>({endpoint:'https://web.push.apple.com/example'}),unsubscribe:async()=>{removed++;}})}});
  const client=N.createClient({env:b.env,getOwner:()=>owner,getToken:()=>{started();return token;}});const enabling=client.enable();await entered;owner='B';release('new-account-token');
  await assert.rejects(enabling,{code:'operation-cancelled'});assert.equal(uploads,0);assert.equal(removed,1);assert.equal((await client.status()).enabled,false);
});
test('A persisted opt-in cannot follow an account switch while the app was closed',async()=>{
  const b=browser();let owner='A';const cancelled=[];
  b.env.MMNative={isNative:true,notificationPermission:async()=>'granted',requestNotificationPermission:async()=>'granted',scheduleNotifications:async()=>{},cancelNotifications:async ids=>cancelled.push([...ids])};
  const old=N.createClient({env:b.env,getOwner:()=>owner});await old.enable();old.setPreferences({reminder:true,details:true});const scheduled=await old.sync(state());assert.ok(scheduled.scheduled>0);
  owner='B';const next=N.createClient({env:b.env,getOwner:()=>owner});assert.equal((await next.status()).enabled,false);await next.sync(state());assert.ok(cancelled[0].length>0);assert.equal(next.preferences.details,false);
});
test('Server validates push provider and strips caller-controlled click URLs and extra financial fields',()=>{
  const p=upload();p.archive={secret:'never retained'};const clean=policy.clean(p,Date.parse('2026-10-29T09:00:00Z'));assert.equal(clean.archive,undefined);assert.equal(clean.notifications[0].data.url,'./?notification=plan');
  for(const endpoint of ['https://127.0.0.1/','https://evil.example/','https://push.apple.com.evil.example/','http://web.push.apple.com/','https://web.push.apple.com:444/']){p.subscription.endpoint=endpoint;assert.throws(()=>policy.clean(p,Date.parse('2026-10-29T09:00:00Z')));}
});
test('Server refuses excessive, stale and duplicate schedules',()=>{
  const now=Date.parse('2026-10-29T09:00:00Z');let p=upload();p.notifications.push({...p.notifications[0]});assert.throws(()=>policy.clean(p,now));
  p=upload();assert.throws(()=>policy.clean(p,now+86400000));p.notifications[0].at='2027-10-29T10:00:00Z';assert.throws(()=>policy.clean(p,now));
});
