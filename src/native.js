/* Native capabilities stay behind a feature boundary; the Safari build is unchanged. */
(function(root){
  'use strict';
  const cap=root.Capacitor,isNative=!!cap?.isNativePlatform?.(),plugins=cap?.Plugins||{};
  const system=plugins.MyMoneyNative,haptics=plugins.Haptics,local=plugins.LocalNotifications;
  let lastHaptic=-Infinity,notificationQueue=Promise.resolve(),activeSpeech=null;
  const available=name=>isNative&&!!plugins[name];
  const safe=action=>Promise.resolve().then(action).catch(()=>false);
  function haptic(kind='selection'){
    if(!isNative||root.document?.hidden)return Promise.resolve(false);
    const now=Date.now();if(now-lastHaptic<110)return Promise.resolve(false);lastHaptic=now;
    // Semantic impulses only: no continuous vibration and no haptic on every frame.
    if(system?.feedback)return safe(()=>system.feedback({kind}));
    if(!haptics)return Promise.resolve(false);
    return safe(()=>kind==='success'?haptics.notification({type:'SUCCESS'}):kind==='selection'?haptics.selectionChanged():haptics.impact({style:'LIGHT'}));
  }
  async function notificationPermission(){if(!available('LocalNotifications'))return 'denied';return (await local.checkPermissions()).display;}
  async function requestNotificationPermission(){if(!available('LocalNotifications'))return 'denied';return (await local.requestPermissions()).display;}
  function scheduleNotifications(list){
    // Serialize replacements so a previous render can never restore stale reminders.
    const run=async()=>{
      if(!available('LocalNotifications')||await notificationPermission()!=='granted')return {scheduled:0};
      const now=Date.now(),seen=new Set(),next=[];
      for(const item of [...list].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at))){
        const at=Date.parse(item.at);
        if(!Number.isSafeInteger(item.id)||item.id<1||item.id>2147483647||seen.has(item.id)||!Number.isFinite(at)||at<=now||!item.title||!item.body)continue;
        seen.add(item.id);next.push({id:item.id,title:String(item.title).slice(0,120),body:String(item.body).slice(0,500),schedule:{at:new Date(at)},extra:{mymoney:true,kind:item.kind||'',tag:item.tag||'',data:item.data||{}},sound:null});
        if(next.length===48)break;
      }
      const pending=await local.getPending();
      const owned=pending.notifications.filter(n=>n.extra?.mymoney===true&&n.extra.kind!=='test').map(n=>({id:n.id}));
      if(owned.length)await local.cancel({notifications:owned});
      if(next.length)await local.schedule({notifications:next});
      return {scheduled:next.length};
    };
    const task=notificationQueue.then(run,run);notificationQueue=task.catch(()=>{});return task;
  }
  function cancelNotifications(ids){
    // Disabling must run after any pending refresh, otherwise it can re-enable reminders.
    const selected=new Set(ids),run=async()=>{
      if(!available('LocalNotifications'))return;
      const pending=await local.getPending();
      const owned=pending.notifications.filter(n=>n.extra?.mymoney===true&&selected.has(n.id)).map(n=>({id:n.id}));
      if(owned.length)await local.cancel({notifications:owned});
    };
    const task=notificationQueue.then(run,run);notificationQueue=task.catch(()=>{});return task;
  }
  async function testNotification(message){
    if(!available('LocalNotifications')||await notificationPermission()!=='granted')return false;
    await local.schedule({notifications:[{id:2147483000,title:String(message.title||'MyMoney.'),body:String(message.body||''),schedule:{at:new Date(Date.now()+3000)},extra:{mymoney:true,kind:'test'},sound:null}]});return true;
  }
  if(available('LocalNotifications')&&local.addListener)safe(()=>local.addListener('localNotificationActionPerformed',event=>{
    const extra=event.notification?.extra;
    if(event.actionId==='dismiss'||extra?.mymoney!==true)return;
    // Translate only known app destinations; notification payloads never navigate arbitrary URLs.
    const route=extra.data?.route||({'./?notification=plan':'plan','./?notification=history':'history'})[extra.data?.url]
      ||(['due','dueMany'].includes(extra.kind)?'plan':['weekly','reminder','budgetLow','budgetExceeded','test'].includes(extra.kind)?'history':null);
    if(route==='plan'||route==='history')root.dispatchEvent(new root.CustomEvent('mm:notificationopen',{detail:{route}}));
  }));
  class SpeechRecognition {
    constructor(){this.lang='it-IT';this.interimResults=true;this.continuous=false;this.running=false;this.handles=[];this.generation=0;this.session='';}
    start(){
      if(this.running)throw Error('Recognition already active');
      if(!system?.startSpeech)throw Error('Native speech unavailable');
      activeSpeech?.abort();activeSpeech=this;this.running=true;const token=++this.generation;
      this.session=`${Date.now()}-${token}-${Math.random().toString(36).slice(2)}`;
      const receive=e=>{if(!this.running||token!==this.generation||e.session!==this.session)return;
        if(e.type==='start')this.onstart?.();
        if(e.type==='result'){const result=[{transcript:e.text||'',confidence:1}];result.isFinal=!!e.final;this.onresult?.({resultIndex:0,results:[result]});}
        if(e.type==='level')root.MMParticles?.setAudioLevel(Math.min(1,Math.max(0,e.level||0)),{bass:e.bass||0,treble:0});
        if(e.type==='error'){this.onerror?.({error:e.code||'audio-capture'});this.finish();}
        if(e.type==='end')this.finish();
      };
      Promise.resolve(system.addListener('speech',receive)).then(async handle=>{
        if(!this.running||token!==this.generation){await handle.remove();return;}
        this.handles.push(handle);await system.startSpeech({locale:this.lang,session:this.session});
      }).catch(error=>{if(this.running&&token===this.generation){this.onerror?.({error:error.code||'audio-capture'});this.finish();}});
    }
    stop(){if(this.running)safe(()=>system.stopSpeech({session:this.session}));}
    abort(){if(!this.running)return;const session=this.session;this.running=false;++this.generation;this.dispose();safe(()=>system.cancelSpeech({session}));if(activeSpeech===this)activeSpeech=null;}
    dispose(){for(const handle of this.handles.splice(0))safe(()=>handle.remove());root.MMParticles?.setAudioLevel(0,{bass:0,treble:0});}
    finish(){if(!this.running)return;this.running=false;this.dispose();if(activeSpeech===this)activeSpeech=null;this.onend?.();}
  }
  function openWebApp(){return isNative&&system?.openWebApp?safe(()=>system.openWebApp()):Promise.resolve(false);}
  function signInGoogle(){if(!isNative||!system?.signInGoogle)return Promise.reject(Error('Native sign-in unavailable'));return system.signInGoogle();}
  function signOutGoogle(){return isNative&&system?.signOutGoogle?system.signOutGoogle():Promise.resolve();}
  root.document?.addEventListener('visibilitychange',()=>{
    if(root.document.hidden&&activeSpeech){const current=activeSpeech;safe(()=>system.cancelSpeech({session:current.session}));current.finish();}
  });
  root.MMNative=Object.freeze({isNative,hasSpeech:available('MyMoneyNative'),SpeechRecognition:isNative&&system?.startSpeech?SpeechRecognition:null,haptic,notificationPermission,requestNotificationPermission,scheduleNotifications,cancelNotifications,testNotification,openWebApp,signInGoogle,signOutGoogle});
})(typeof window==='undefined'?globalThis:window);
