'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/native.js'),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function environment({native=true,permission='granted',pending=[]}={}){
  let time=Date.parse('2026-10-29T12:00:00Z'),listener,notificationListener;
  const calls=[],events={},dispatched=[];
  class Clock extends Date { static now(){return time;} }
  const system={
    feedback:async args=>calls.push(['haptic',args]),
    addListener:async(name,fn)=>{listener=fn;return {remove:async()=>calls.push(['remove-listener'])};},
    startSpeech:async args=>calls.push(['start',args]),stopSpeech:async args=>calls.push(['stop',args]),cancelSpeech:async args=>calls.push(['cancel',args]),
    signInGoogle:async()=>({idToken:'ephemeral-test-id',accessToken:'ephemeral-test-access'}),signOutGoogle:async()=>calls.push(['signout']),openWebApp:async()=>calls.push(['open-web'])
  };
  const local={addListener:async(name,fn)=>{notificationListener=fn;return {remove:async()=>{}};},checkPermissions:async()=>({display:permission}),requestPermissions:async()=>{calls.push(['permission']);return {display:permission};},getPending:async()=>({notifications:pending}),cancel:async args=>calls.push(['cancel-notifications',args]),schedule:async args=>calls.push(['schedule',args])};
  const context={Date:Clock,console,dispatchEvent:event=>dispatched.push(event),CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}},document:{hidden:false,addEventListener:(name,fn)=>{events[name]=fn;}},MMParticles:{setAudioLevel:()=>{}},Capacitor:native?{isNativePlatform:()=>true,Plugins:{MyMoneyNative:system,LocalNotifications:local}}:undefined};
  vm.runInNewContext(source,context);
  return {api:context.MMNative,context,calls,events,system,local,dispatched,tick:ms=>time+=ms,emit:event=>listener?.(event),emitNotification:event=>notificationListener?.(event)};
}
test('Safari has no native side effects or faux permission prompts',async()=>{
  const e=environment({native:false});assert.equal(e.api.isNative,false);assert.equal(e.api.SpeechRecognition,null);
  await e.api.haptic('success');assert.equal(await e.api.notificationPermission(),'denied');assert.equal(await e.api.testNotification({body:'test'}),false);assert.equal(e.calls.length,0);
  await flush();e.emitNotification({actionId:'tap',notification:{extra:{mymoney:true,kind:'due'}}});assert.equal(e.dispatched.length,0);
});
test('native notification taps route to known panels, never foreign URLs or dismissed notices',async()=>{
  const e=environment();await flush();
  const tap=extra=>e.emitNotification({actionId:'tap',notification:{extra}});
  tap({mymoney:true,kind:'due',data:{url:'./?notification=plan'}});
  tap({mymoney:true,kind:'weekly',data:{url:'./?notification=history'}});
  tap({mymoney:true,data:{route:'https://example.invalid'}});
  tap({mymoney:true,data:{url:'https://example.invalid'}});
  tap({mymoney:false,data:{route:'history'}});
  e.emitNotification({actionId:'dismiss',notification:{extra:{mymoney:true,kind:'due'}}});
  assert.deepEqual(e.dispatched.map(e=>[e.type,e.detail.route]),[['mm:notificationopen','plan'],['mm:notificationopen','history']]);
});
test('native semantic haptics are throttled and quiet in the background',async()=>{
  const e=environment();await e.api.haptic('selection');await e.api.haptic('success');e.tick(120);await e.api.haptic('success');e.context.document.hidden=true;e.tick(120);await e.api.haptic('selection');
  assert.deepEqual(e.calls.map(c=>c[1].kind),['selection','success']);
});
test('permission status never asks for consent by itself',async()=>{
  const e=environment({permission:'prompt'});assert.equal(await e.api.notificationPermission(),'prompt');await e.api.scheduleNotifications([]);assert.equal(e.calls.length,0);
  await e.api.requestNotificationPermission();assert.equal(e.calls[0][0],'permission');
});
test('native reminders replace only owned records, preserve the test, reject invalid IDs and stay capped',async()=>{
  const e=environment({pending:[{id:42,extra:{mymoney:true}},{id:99,extra:{anotherApp:true}},{id:2147483000,extra:{mymoney:true,kind:'test'}}]}),list=[];
  for(let n=0;n<70;n++)list.push({id:10000+n,title:'MyMoney.',body:'Synthetic reminder',at:new Date(Date.now()+1e12+n*1000).toISOString(),kind:'due'});
  list.unshift({...list[0],id:-1},{...list[0],at:'not a date'},{...list[0],id:1,at:'2000-01-01'});
  const result=await e.api.scheduleNotifications(list);assert.equal(result.scheduled,48);
  const removed=e.calls.find(c=>c[0]==='cancel-notifications')[1].notifications;assert.equal(removed.length,1);assert.equal(removed[0].id,42);
  const scheduled=e.calls.find(c=>c[0]==='schedule')[1].notifications;assert.equal(scheduled.length,48);assert.equal(scheduled[0].extra.mymoney,true);assert.equal(scheduled[0].sound,null);
});
test('disable waits for any in-flight schedule before canceling reminders',async()=>{
  const e=environment();let pending=[];
  e.local.getPending=async()=>({notifications:pending});
  e.local.schedule=async({notifications})=>{await flush();pending=notifications;e.calls.push(['schedule']);};
  e.local.cancel=async()=>{pending=[];e.calls.push(['cancel']);};
  const scheduling=e.api.scheduleNotifications([{id:10000,title:'MyMoney.',body:'Test schedule',at:'2090-01-01T12:00:00Z'}]);
  const disabling=e.api.cancelNotifications([10000]);await Promise.all([scheduling,disabling]);assert.deepEqual(e.calls.map(c=>c[0]),['schedule','cancel']);assert.equal(pending.length,0);
});
test('test notification adds one scheduled event without replacing existing reminders',async()=>{
  const e=environment();await e.api.testNotification({title:'MyMoney.',body:'Test'});assert.deepEqual(e.calls.map(c=>c[0]),['schedule']);
  assert.equal(e.calls[0][1].notifications[0].schedule.at.getTime(),Date.parse('2026-10-29T12:00:03Z'));
});
test('native speech replaces the transcript and ignores stale sessions',async()=>{
  const e=environment(),speech=new e.api.SpeechRecognition(),results=[];let started=0,ended=0;
  speech.onstart=()=>started++;speech.onresult=event=>results.push([event.results[0][0].transcript,event.results[0].isFinal]);speech.onend=()=>ended++;
  speech.start();await flush();const session=e.calls.find(c=>c[0]==='start')[1].session;
  e.emit({session:'old',type:'result',text:'wrong',final:true});e.emit({session,type:'start'});e.emit({session,type:'result',text:'benzina',final:false});e.emit({session,type:'result',text:'benzina 20 euro',final:true});e.emit({session,type:'end'});e.emit({session,type:'result',text:'late',final:true});
  assert.equal(started,1);assert.equal(ended,1);assert.deepEqual(results,[['benzina',false],['benzina 20 euro',true]]);
});
test('aborting before listener registration never starts the microphone',async()=>{
  const e=environment(),speech=new e.api.SpeechRecognition();speech.start();speech.abort();await flush();assert.ok(!e.calls.some(c=>c[0]==='start'));assert.ok(e.calls.some(c=>c[0]==='remove-listener'));
});
test('backgrounding ends the JS listening state and cancels capture',async()=>{
  const e=environment(),speech=new e.api.SpeechRecognition();let ended=0;speech.onend=()=>ended++;speech.start();await flush();e.context.document.hidden=true;e.events.visibilitychange();await flush();assert.equal(ended,1);assert.ok(e.calls.some(c=>c[0]==='cancel'));assert.equal(speech.running,false);
});
test('Google authentication returns credentials without opening an embedded OAuth popup',async()=>{
  const e=environment();const tokens=await e.api.signInGoogle();assert.equal(tokens.idToken,'ephemeral-test-id');await e.api.signOutGoogle();assert.equal(e.calls[0][0],'signout');
});
