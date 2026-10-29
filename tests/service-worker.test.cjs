'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../app/sw.js'),'utf8');
const SCOPE='https://manuelpilato.github.io/mymoney/';
function harness({language='it',controlled=[],windows=[]}={}){
  const handlers=new Map(),notifications=[],opened=[],queries=[],cached=[];
  const self={location:{origin:new URL(SCOPE).origin},navigator:{language},
    registration:{scope:SCOPE,showNotification:(title,options)=>{notifications.push({title,options});return Promise.resolve();}},
    clients:{matchAll:async options=>{queries.push(options);return options.includeUncontrolled?windows:controlled;},
      openWindow:async url=>{opened.push(url);return {};},claim:async()=>{}},
    addEventListener:(name,fn)=>handlers.set(name,fn)};
  const caches={open:async name=>({addAll:async files=>cached.push({name,files}),match:async()=>undefined}),keys:async()=>[],delete:async()=>true};
  vm.runInNewContext(source,{self,caches,URL,Set,fetch:()=>{throw Error('No network needed for push');}});
  const dispatch=(name,event={})=>{let promise;handlers.get(name)({...event,waitUntil:p=>{promise=p;}});return promise;};
  const push=payload=>dispatch('push',{data:{json:()=>payload}});
  return {push,dispatch,notifications,opened,queries,cached};
}
function client(url=SCOPE,{visible=false,failFocus=false,failNavigate=false}={}){
  const calls=[];
  const result={url,visibilityState:visible?'visible':'hidden',calls,
    focus:async()=>{calls.push(['focus']);if(failFocus)throw Error('Window closed');return result;},
    navigate:async url=>{calls.push(['navigate',url]);if(failNavigate)throw Error('Window closed');return result;},
    postMessage:data=>calls.push(['message',data])};return result;
}
function click(h,data){let closed=0;const promise=h.dispatch('notificationclick',{notification:{data,close:()=>closed++}});assert.equal(closed,1);return promise;}

test('every push immediately shows branded copy without network or an app window',async()=>{
  const h=harness();const pending=h.push({title:'Domani, senza sorprese.',body:'Il tuo piano ti aspetta.',language:'it',kind:'due',tag:'mymoney-due-2026-10-30',icon:'https://elsewhere.invalid/private.png',data:{url:'./?notification=plan'}});
  assert.equal(h.notifications.length,1,'showNotification must run immediately inside the push handler');await pending;
  const {title,options}=h.notifications[0];assert.equal(title,'Domani, senza sorprese.');assert.equal(options.body,'Il tuo piano ti aspetta.');
  assert.equal(options.icon,SCOPE+'icon-192-v2.png');assert.equal(options.badge,options.icon);
  assert.equal(options.data.url,SCOPE+'?notification=plan');assert.equal(options.lang,'it');assert.equal(options.renotify,false);
  assert.equal(h.queries.length,0);
});

test('missing and malformed payloads still display safe localized notifications',async()=>{
  const h=harness({language:'en-GB'});
  await h.dispatch('push',{});await h.dispatch('push',{data:{json(){throw new SyntaxError('bad json');}}});await h.push([]);
  assert.equal(h.notifications.length,3);
  for(const {title,options} of h.notifications){assert.equal(title,'MyMoney.');assert.equal(options.lang,'en');assert.match(options.body,/Open MyMoney/);assert.equal(options.data.route,'history');}
  await h.push({language:'it',body:null,title:{html:'unsafe'}});assert.equal(h.notifications[3].options.lang,'it');assert.match(h.notifications[3].options.body,/Apri MyMoney/);
});

test('titles and bodies are bounded by Unicode characters and control characters are removed',async()=>{
  const h=harness();await h.push({title:'\u202e'+ '🌊'.repeat(100),body:'\n'+ 'x'.repeat(300),tag:'https://untrusted.invalid',kind:'unknown'});
  const {title,options}=h.notifications[0];assert.equal(Array.from(title).length,80);assert.ok(!title.includes('\u202e'));
  assert.equal(options.body.length,240);assert.equal(options.tag,'mymoney-general');assert.equal(options.data.kind,'general');
});

test('payload links can only select plan or history inside this exact app scope',async()=>{
  const rejected=['https://attacker.invalid/?notification=plan','https://manuelpilato.github.io/another/?notification=plan',
    'javascript:alert(1)','../?notification=plan','./?notification=plan&next=evil','./?notification=plan#outside',
    './?notification=plan&notification=history','./?notification=admin','https://user:password@manuelpilato.github.io/mymoney/?notification=plan'];
  const h=harness();
  for(const url of rejected){await h.push({kind:'weekly',data:{url}});assert.equal(h.notifications.at(-1).options.data.url,SCOPE+'?notification=history',url);}
  await h.push({kind:'due',data:{url:'https://attacker.invalid'}});assert.equal(h.notifications.at(-1).options.data.route,'plan');
  await h.push({kind:'weekly',data:{url:'./index.html?notification=plan'}});assert.equal(h.notifications.at(-1).options.data.url,SCOPE+'?notification=plan');
});

test('click focuses a controlled app and sends a route without destroying its current draft',async()=>{
  const hidden=client(),visible=client(SCOPE+'?old=1',{visible:true}),foreign=client('https://manuelpilato.github.io/another/');
  const h=harness({controlled:[foreign,hidden,visible]});await click(h,{kind:'due',url:SCOPE+'?notification=plan'});
  assert.equal(hidden.calls.length,0);assert.equal(foreign.calls.length,0);assert.equal(h.opened.length,0);
  assert.equal(visible.calls[0][0],'focus');const message=visible.calls[1][1];assert.equal(message.type,'MM_NOTIFICATION_OPEN');assert.equal(message.route,'plan');
  assert.ok(!visible.calls.some(([name])=>name==='navigate'));
});

test('uncontrolled app windows are navigated to a canonical route before being focused',async()=>{
  const old=client(SCOPE+'index.html'),foreign=client('https://manuelpilato.github.io/elsewhere/');
  const h=harness({windows:[foreign,old]});await click(h,{kind:'weekly',url:'./?notification=history'});
  assert.equal(old.calls[0][0],'navigate');assert.equal(old.calls[0][1],SCOPE+'?notification=history');
  assert.equal(old.calls[1][0],'focus');assert.equal(old.calls[2][1].type,'MM_NOTIFICATION_OPEN');assert.equal(foreign.calls.length,0);assert.equal(h.opened.length,0);
});

test('closed windows and hostile persisted links fall back to one safe new app window',async()=>{
  const stale=client(SCOPE,{failFocus:true,failNavigate:true});const h=harness({controlled:[stale],windows:[stale]});
  await click(h,{kind:'dueMany',url:'https://attacker.invalid/'});assert.deepEqual(h.opened,[SCOPE+'?notification=plan']);
});

test('release caches the native bridge alongside the public app shell',async()=>{
  const h=harness();await h.dispatch('install');assert.equal(h.cached[0].name,'mymoney-local-shell-v6.6.0');
  assert.ok(h.cached[0].files.includes('./native.js'));assert.ok(!h.cached[0].files.some(file=>/PRIVATI|backup|\.env/.test(file)));
});
