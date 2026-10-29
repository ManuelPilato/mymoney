/* Firebase is an optional transport. The durable per-account outbox is local. */
(function(root){
  'use strict';
  const I=root.MyMoneyI18n,tr=I.t;
  const M=root.MM,C=root.MMSyncCore,KEY='mymoney-local-v2',GUEST='mymoney-sync-guest-v1',META='mymoney-sync-session-v1',PREFIX='mymoney-sync-account-v1:';
  const $=id=>document.getElementById(id);
  let bridge=null,sdk=null,auth=null,db=null,user=null,uid=null,env=null,unlisten=null,generation=0,flushing=false,ready=false,serverReady=false,issue='',loading=null,retryTimer=null;
  const clone=M.clone;
  function read(key){const raw=localStorage.getItem(key);return raw?JSON.parse(raw):null;}
  function accountKey(id){return PREFIX+id;}
  function validEnv(value){
    if(!value||value.schemaVersion!==1||!value.records||!Array.isArray(value.outbox))throw Error(tr('Archivio di sincronizzazione non leggibile. La copia locale è conservata.'));
    M.validate(value.state);return value;
  }
  function storedAccount(id){const raw=read(accountKey(id));return raw?validEnv(raw):null;}
  function guest(){const saved=read(GUEST);return saved?M.validate(saved):M.blank();}
  function initialState(){
    let session=null;
    try{
      session=read(META);const owner=session?.uid;
      if(owner){const cached=storedAccount(owner);if(cached){uid=owner;env=cached;return clone(cached.state);}return guest();}
      if(session)return guest();
    }catch(error){
      if(session){issue=readableError(error);try{return guest();}catch(_){return M.blank();}}
      /* With no sync session, App keeps its original protected loader. */
    }
    return null;
  }
  function mirror(state){try{localStorage.setItem(KEY,JSON.stringify(state));}catch(_){/* The account archive remains the authoritative durable copy. */}}
  function saveEnv(next,{initial=false}={}){
    const current=read(accountKey(uid));
    if(!initial&&current&&(current.serial||0)!==(env?.serial||0))throw Error(tr('Dati aggiornati in un’altra finestra. Riapri la modifica.'));
    next.serial=(current?.serial||0)+1;
    localStorage.setItem(accountKey(uid),JSON.stringify(next));env=next;
  }
  function apply(state){
    if(!bridge)return;
    const before=bridge.getState();
    if(C.equal(C.flatten(before),C.flatten(state))&&before.lastBackup===state.lastBackup){
      if(uid&&env&&env.state.revision!==before.revision){const copy=clone(env);copy.state=clone(before);saveEnv(copy);}
      if(!uid&&read(META))localStorage.setItem(GUEST,JSON.stringify(before));
      mirror(before);return;
    }
    const next=M.validate(state);next.revision=(before.revision||0)+1;next.updatedAt=new Date().toISOString();
    if(uid&&env){const copy=clone(env);copy.state=next;saveEnv(copy);}
    if(!uid&&read(META))localStorage.setItem(GUEST,JSON.stringify(next));
    mirror(next);bridge.replaceState(next);
  }
  function setState(label,state,detail){
    if($('sync-status')){$('sync-status').textContent=label;$('sync-status').dataset.state=state;}
    if($('sync-detail'))$('sync-detail').textContent=I.text(detail);
  }
  function render(){
    if(!$('sync-connect'))return;
    const config=!!root.MM_FIREBASE_CONFIG,connected=!!uid,accepted=!!env?.accepted,conflict=!!env?.conflict;
    $('sync-connect').hidden=connected;$('sync-connect').disabled=!config||(!ready&&!!loading);
    $('sync-disconnect').hidden=!connected;$('sync-disconnect').disabled=false;
    $('sync-retry').hidden=!(config&&(!!issue||connected&&!serverReady));
    $('sync-account').hidden=!connected;$('sync-account').textContent=connected?(user?.email||env?.email||tr('Account collegato')):'';
    $('sync-import').hidden=!connected||accepted||!serverReady||conflict;
    $('sync-conflicts').hidden=!conflict;
    if(conflict){
      $('sync-conflict-detail').textContent=tr('{count} operazioni locali richiedono una scelta. Un altro dispositivo ha cambiato gli stessi dati. “Usa la versione online” scarta le modifiche in attesa; “Usa la mia modifica” le applica ai dati aggiornati. Per una rata duplicata resta la versione scelta. Una copia delle modifiche resta su questo dispositivo.',{count:env.outbox.length});
      setState(tr('Da verificare'),'conflict',tr('Scegli quale versione conservare prima di aggiungere altre modifiche.'));return;
    }
    if(!config){setState(tr('Solo su questo dispositivo'),'local',tr('Il collegamento Firebase non è ancora configurato. Puoi continuare a usare MyMoney in locale.'));return;}
    if(issue){setState(tr('Sincronizzazione in pausa'),'error',issue);return;}
    if(!connected){setState(tr('Solo su questo dispositivo'),'local',tr('Accedi con lo stesso account Google su iPhone e Mac per ritrovare spese e impostazioni.'));return;}
    if(!accepted){setState(serverReady?tr('Collega il tuo archivio'):tr('Connessione…'),serverReady?'local':'syncing',serverReady?tr('Scegli come iniziare. Nessun dato locale viene caricato prima della tua scelta.'):tr('Verifico l’account e l’archivio online. I dati locali sono al sicuro.'));return;}
    if(!navigator.onLine||!serverReady){setState(tr('Salvato sul dispositivo'),'offline',env.outbox.length?tr('{count} operazioni pronte da inviare appena torna la connessione.',{count:env.outbox.length}):tr('Le modifiche restano qui e si sincronizzano alla riconnessione.'));return;}
    if(env.outbox.length||flushing){setState(tr('Sincronizzazione…'),'syncing',tr('{count} operazioni in attesa di conferma dal server.',{count:env.outbox.length}));return;}
    setState(tr('Tutto sincronizzato'),'synced',tr('Salvato nel tuo account. Gli altri dispositivi online si aggiornano automaticamente.'));
  }
  function readableError(error){
    const code=error?.code||'';
    if(code.includes('popup-blocked'))return tr('Consenti la finestra di accesso e tocca di nuovo “Accedi con Google”.');
    if(code.includes('popup-closed-by-user')||code.includes('cancelled-popup-request'))return tr('Accesso annullato. Il tuo archivio locale è intatto.');
    if(code.includes('unauthorized-domain'))return tr('Questo indirizzo non è ancora autorizzato in Firebase. Il tuo archivio locale è intatto.');
    if(code.includes('permission-denied'))return tr('Il server non ha autorizzato la sincronizzazione. Nessun dato in attesa è stato eliminato.');
    if(code.includes('resource-exhausted'))return tr('Quota gratuita temporaneamente esaurita. I dati restano salvati sul dispositivo; riprova più tardi.');
    if(code.includes('network')||code.includes('unavailable'))return tr('Connessione non disponibile. I dati restano salvati sul dispositivo.');
    return I.text(error?.message)||tr('Sincronizzazione non disponibile. I dati locali sono conservati.');
  }
  function report(error){issue=readableError(error);render();}
  function saveLocal(next,before){
    if(!uid){
      if(!read(META))return false;
      const disk=guest();if(disk.revision!==before.revision)throw Error(tr('L’archivio locale è cambiato in un’altra finestra. Riapri la modifica.'));
      localStorage.setItem(GUEST,JSON.stringify(next));mirror(next);return true;
    }
    if(!env?.accepted)throw Error(tr('Completa il collegamento dell’archivio in Preferenze, oppure scollega l’account per continuare in locale.'));
    if(env.conflict)throw Error(tr('C’è una modifica da verificare in Preferenze → Sincronizzazione.'));
    const disk=storedAccount(uid);
    if(!disk||disk.serial!==env.serial||disk.state.revision!==before.revision)throw Error(tr('L’archivio è cambiato. Chiudi e riapri la modifica.'));
    const changed=C.append(env,before,next,M.id());saveEnv(changed);mirror(next);render();queueMicrotask(flush);return true;
  }
  function recordsFrom(snapshot){
    const records={};
    for(const d of snapshot.docs){
      const r=d.data();
      if(r.schemaVersion!==1||!Number.isSafeInteger(r.version)||r.version<1||typeof r.deleted!=='boolean'||typeof r.mutationId!=='string'||C.docId(r.kind,r.key)!==d.id)throw Error(tr('I dati online richiedono una versione più recente dell’app. La copia locale è conservata.'));
      records[d.id]={schemaVersion:r.schemaVersion,kind:r.kind,key:r.key,value:r.value,deleted:r.deleted,version:r.version,mutationId:r.mutationId};
    }
    C.materialize(records,env?.state||M.blank());return records;
  }
  function refreshProjection(next){
    while(next.outbox.length&&C.acknowledged(next.outbox[0],next.records))next.outbox.shift();
    if(next.conflict)return next;
    try{next.state=C.materialize(C.overlay(next.records,next.outbox),next.state);}
    catch(error){next.conflict={reason:'linked-change',message:error.message};}
    return next;
  }
  function receive(snapshot,token){
    if(token!==generation||!uid)return;
    if(snapshot.metadata.fromCache){serverReady=false;render();return;}
    if(snapshot.metadata.hasPendingWrites){render();return;}
    try{
      const records=recordsFrom(snapshot),next=clone(env);next.records=records;serverReady=true;issue='';
      if(!next.accepted){
        if(!C.hasData(next.state)){next.accepted=true;next.state=C.materialize(records,next.state);}
        saveEnv(next);if(next.accepted)apply(next.state);render();if(next.accepted)flush();return;
      }
      refreshProjection(next);saveEnv(next);if(!next.conflict)apply(next.state);render();flush();
    }catch(error){report(error);}
  }
  async function authChanged(account){
    const token=++generation;unlisten?.();unlisten=null;flushing=false;serverReady=false;issue='';user=account;
    try{
      if((account?.uid||null)!==uid){bridge.resetDrafts?.();root.dispatchEvent(new CustomEvent('mm:archivechange'));}
      if(!account){
        const wasOwner=uid;uid=null;env=null;localStorage.setItem(META,JSON.stringify({uid:null}));
        if(wasOwner)apply(guest());render();return;
      }
      if(!uid&&!read(META)){
        // Only the explicitly local archive is a migration candidate. An old
        // account's cache can never become another account's initial upload.
        localStorage.setItem(GUEST,JSON.stringify(bridge.getState()));
      }
      uid=account.uid;env=storedAccount(uid);
      if(!env){env={schemaVersion:1,serial:0,accepted:false,email:account.email||'',state:guest(),records:{},outbox:[],conflict:null};saveEnv(env,{initial:true});}
      else if(env.email!==account.email){const next=clone(env);next.email=account.email||'';saveEnv(next);}
      localStorage.setItem(META,JSON.stringify({uid}));
      apply(env.state);render();
      unlisten=sdk.onSnapshot(sdk.collection(db,'users',uid,'records'),{includeMetadataChanges:true},snapshot=>receive(snapshot,token),error=>{if(token===generation){serverReady=false;report(error);}});
    }catch(error){report(error);}
  }
  async function loadSDK(){
    if(ready)return;
    if(loading)return loading;
    if(!root.MM_FIREBASE_CONFIG)return;
    loading=(async()=>{
      sdk=await import('./firebase-sdk.js');
      const app=sdk.initializeApp(root.MM_FIREBASE_CONFIG);auth=sdk.getAuth(app);db=sdk.getFirestore(app);ready=true;
      sdk.onAuthStateChanged(auth,authChanged,error=>report(error));
    })().catch(error=>{loading=null;report(error);throw error;});
    render();return loading;
  }
  async function connect(){
    issue='';
    // SDK is preloaded. Keeping signInWithPopup in this user gesture also works
    // with Safari's stricter popup policy; no cross-origin redirect storage.
    if(!ready){try{await loadSDK();issue=tr('Pronto. Tocca di nuovo “Accedi con Google” per aprire l’accesso.');render();}catch(_){}return;}
    try{
      if(root.MMNative?.isNative){const tokens=await root.MMNative.signInGoogle();await sdk.signInWithCredential(auth,sdk.GoogleAuthProvider.credential(tokens.idToken,tokens.accessToken));}
      else{const provider=new sdk.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});await sdk.signInWithPopup(auth,provider);}
    }catch(error){report(error);}
  }
  async function disconnect(){
    if(!ready){issue=tr('Connettiti a Internet per completare l’uscita dall’account. Le modifiche locali sono conservate.');render();return;}
    try{await sdk.signOut(auth);if(root.MMNative?.isNative)await root.MMNative.signOutGoogle();}catch(error){report(error);}
  }
  function acceptInitial(merge){
    if(!uid||!env||env.accepted||!serverReady)return;
    try{
      const original=clone(env.state),target=merge?C.mergeInitial(original,env.records):C.materialize(env.records,original);
      localStorage.setItem(accountKey(uid)+':before-import',JSON.stringify(original));
      let next=clone(env);next.accepted=true;next.conflict=null;
      if(merge)next=C.importGroups(next,target,M.id);else next.state=target;
      saveEnv(next);apply(next.state);issue='';render();flush();
    }catch(error){report(error);}
  }
  async function flush(){
    if(flushing||!ready||!user||user.uid!==uid||!serverReady||!navigator.onLine||!env?.accepted||env.conflict||!env.outbox.length)return;
    const token=generation,owner=uid;flushing=true;render();
    try{
      while(token===generation&&env.outbox.length&&!env.conflict){
        const op=clone(env.outbox[0]);
        const confirmed=await sdk.runTransaction(db,async transaction=>{
          if(token!==generation)throw Error(tr('Account cambiato durante la sincronizzazione.'));
          const refs=op.changes.map(c=>sdk.doc(db,'users',owner,'records',c.id));
          const snapshots=await Promise.all(refs.map(ref=>transaction.get(ref))),actual={};
          snapshots.forEach((snap,index)=>{if(snap.exists())actual[op.changes[index].id]=snap.data();});
          if(C.acknowledged(op,actual))return op.changes.map(c=>({...c,record:actual[c.id]}));
          if(C.conflicts(op,actual).length){const error=Error(tr('Gli stessi dati sono stati modificati su un altro dispositivo.'));error.code='mymoney/conflict';throw error;}
          if(token!==generation)throw Error(tr('Account cambiato durante la sincronizzazione.'));
          return op.changes.map((c,index)=>{
            const existing=actual[c.id];
            // Two devices may initialize the same default setting together.
            // Identical values need no overwrite; recurrence guards still
            // advance so linked payment/deletion races remain detectable.
            if(C.equivalent(c,existing)&&(c.kind!=='recurring'||existing.mutationId===op.id))return {...c,record:existing};
            const record={schemaVersion:1,kind:c.kind,key:c.key,value:c.value,deleted:c.deleted,version:c.baseVersion+1,mutationId:op.id};
            transaction.set(refs[index],{...record,updatedAt:sdk.serverTimestamp()});return {...c,record};
          });
        });
        if(token!==generation)return;
        // The transaction is confirmed, not merely queued in the SDK. Updating
        // the baseline here also handles a slow realtime acknowledgement.
        const next=clone(env);
        if(next.outbox[0]?.id===op.id){
          next.outbox.shift();
          for(const c of confirmed){
            const current=next.records[c.id],record=c.record;
            if(!current||current.version<=record.version){const {updatedAt,...stored}=record;next.records[c.id]=stored;}
            const offset=record.version-(c.baseVersion+1);
            if(offset)for(const queued of next.outbox)for(const change of queued.changes)if(change.id===c.id)change.baseVersion+=offset;
          }
          refreshProjection(next);saveEnv(next);if(!next.conflict)apply(next.state);
        }
        issue='';
      }
    }catch(error){
      if(token!==generation)return;
      if(error.code==='mymoney/conflict'){
        const next=clone(env);next.conflict={reason:'version',message:error.message};saveEnv(next);issue='';
        try{const snapshot=await sdk.getDocsFromServer(sdk.collection(db,'users',uid,'records'));if(token===generation){const latest=clone(env);latest.records=recordsFrom(snapshot);saveEnv(latest);}}catch(_){}
      }else{report(error);if(navigator.onLine&&/(unavailable|network|aborted)/.test(error.code||'')){clearTimeout(retryTimer);retryTimer=setTimeout(()=>{if(token===generation)retry();},15000);}}
    }finally{if(token===generation){flushing=false;render();}}
  }
  async function resolveConflict(keepLocal){
    if(!uid||!env?.conflict||!ready)return;
    const token=generation;
    try{
      const snapshot=await sdk.getDocsFromServer(sdk.collection(db,'users',uid,'records'));if(token!==generation)return;
      const records=recordsFrom(snapshot),original=clone(env);localStorage.setItem(accountKey(uid)+':before-conflict',JSON.stringify(original));
      let next=clone(env);next.records=records;const target=keepLocal?C.rebaseLocal(next):C.materialize(records,next.state);
      next.outbox=[];next.conflict=null;
      // Reapply the explicitly chosen local intent. Unrelated cloud changes
      // remain in target; all affected records are version checked again.
      if(keepLocal)next=C.append(next,C.materialize(records,next.state),target,M.id());else next.state=target;
      saveEnv(next);apply(next.state);issue='';serverReady=true;render();flush();
    }catch(error){report(error);}
  }
  async function retry(){
    issue='';render();
    try{if(!ready){await loadSDK();return;}if(user)await authChanged(user);else render();}catch(error){report(error);}
  }
  function handlesStorage(event){
    if(event.key===KEY&&(uid||read(META)))return true;
    return false;
  }
  function init(api){
    bridge=api;
    try{if(!read(META)){localStorage.setItem(GUEST,JSON.stringify(bridge.getState()));localStorage.setItem(META,JSON.stringify({uid:null}));}}
    catch(error){report(error);}
    $('sync-connect')?.addEventListener('click',connect);$('sync-disconnect')?.addEventListener('click',disconnect);$('sync-retry')?.addEventListener('click',retry);
    $('sync-import-merge')?.addEventListener('click',()=>acceptInitial(true));$('sync-import-cloud')?.addEventListener('click',()=>acceptInitial(false));
    $('sync-use-cloud')?.addEventListener('click',()=>resolveConflict(false));$('sync-use-local')?.addEventListener('click',()=>resolveConflict(true));
    root.addEventListener('online',()=>{issue='';retry();});root.addEventListener('offline',()=>{serverReady=false;render();});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){render();if(ready&&user&&!flushing)flush();}});
    root.addEventListener('storage',event=>{
      if(uid&&event.key===accountKey(uid)&&event.newValue){try{env=validEnv(JSON.parse(event.newValue));mirror(env.state);bridge.replaceState(env.state);render();flush();}catch(error){report(error);}}
      if(!uid&&event.key===GUEST&&event.newValue){try{const state=M.validate(JSON.parse(event.newValue));mirror(state);bridge.replaceState(state);}catch(error){report(error);}}
    });
    root.addEventListener('mm:languagechange',render);
    render();if(root.MM_FIREBASE_CONFIG)loadSDK().catch(()=>{});
  }
  root.MMSync={getIdToken:async()=>user?.getIdToken()||null,archiveKey:()=>uid?accountKey(uid):GUEST,initialState,init,saveLocal,handlesStorage,ownsArchive:()=>!!uid||!!read(META)};
})(window);
