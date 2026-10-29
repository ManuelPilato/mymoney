/* Device-local opt-in; no permission prompt during launch or account changes. */
(function(root){
  'use strict';
  const $=id=>document.getElementById(id);
  let client=null,getState=null,openView=null,archive=null,timer=0,busy=false,version=0;
  const copy={
    title:['Notifiche','Notifications'],intro:['Solo quando serve. Massimo un promemoria al giorno, tra le 10 e le 20.','Only when useful. At most one reminder a day, between 10 am and 8 pm.'],
    off:['Disattivate','Off'],on:['Promemoria attivi su questo dispositivo.','Reminders active on this device.'],
    unsupported:['Notifiche non disponibili in questo browser.','Notifications are unavailable in this browser.'],
    home:['Su iPhone, aggiungi MyMoney alla Home e aprila dall’icona per usare le notifiche.','On iPhone, add MyMoney to your Home Screen and open its icon to use notifications.'],
    backend:['Invio automatico da collegare. Puoi già provare una notifica su questo dispositivo.','Automatic delivery still needs to be connected. You can already test a notification on this device.'],
    denied:['Permesso disattivato. Puoi cambiarlo nelle impostazioni del dispositivo.','Permission is off. You can change it in your device settings.'],
    enable:['Attiva promemoria','Enable reminders'],disable:['Disattiva','Turn off'],test:['Prova notifica','Test notification'],
    tested:['Notifica di prova inviata. I promemoria automatici hanno un’attivazione separata.','Test notification sent. Automatic reminders are enabled separately.'],
    signin:['Accedi con Google per collegare le notifiche al tuo archivio.','Sign in with Google to connect notifications to your records.'],
    failed:['Invio non riuscito. Controlla la connessione e riprova.','Delivery failed. Check your connection and try again.'],
    due:['Scadenze di domani','Tomorrow’s payments'],budget:['Budget da rivedere','Budget check-ins'],weekly:['Un check il lunedì','A Monday check-in'],reminder:['Promemoria spese serale','Evening expense reminder'],details:['Mostra nomi e importi nelle notifiche','Show names and amounts in notifications'],
    privacy:['Nomi e importi restano nascosti per impostazione predefinita. Scadenze e stime si aggiornano quando apri MyMoney.','Names and amounts stay hidden by default. Dates and estimates update when you open MyMoney.']
  };
  const text=key=>copy[key]?.[root.MyMoneyI18n.language==='en'?1:0]||key;
  function error(error){const key={'home-screen-required':'home','unsupported':'unsupported','backend-required':'backend','permission-denied':'denied','sign-in-required':'signin'}[error?.code]||'failed';$('notification-feedback').textContent=text(key);}
  async function render(){
    if(!client)return;const ticket=++version,status=await client.status();if(ticket!==version)return;
    document.querySelectorAll('[data-notification-copy]').forEach(el=>el.textContent=text(el.dataset.notificationCopy));
    const key=status.needsHomeScreen?'home':!status.supported?'unsupported':status.permission==='denied'?'denied':!status.configured?'backend':status.enabled?'on':'off';
    $('notification-status').textContent=text(key);
    $('notification-enable').textContent=text(status.enabled?'disable':'enable');
    $('notification-enable').disabled=busy||!status.configured||!status.supported||status.needsHomeScreen||status.permission==='denied';
    $('notification-enable').dataset.enabled=String(status.enabled);
    $('notification-test').disabled=busy||!status.supported||status.needsHomeScreen||status.permission==='denied';
    for(const key of Object.keys(client.preferences))$(`notification-${key}`).checked=client.preferences[key];
  }
  async function act(callback){if(busy)return;busy=true;$('notification-feedback').textContent='';render();try{await callback();}catch(e){error(e);}finally{busy=false;render();refresh();}}
  function refresh(){
    if(!client||busy)return;clearTimeout(timer);timer=setTimeout(async()=>{
      if(busy)return;
      const current=root.MMSync?.archiveKey()||'local';
      try{
        if(current!==archive){archive=current;await client.disable({resetPreferences:true});}
        await client.sync(getState());await render();
      }catch(e){error(e);render();}
    },180);
  }
  function route(value){if(value==='plan'||value==='history')openView?.(value);}
  function init(options){
    if(client)return;getState=options.getState;openView=options.openView;archive=root.MMSync?.archiveKey()||'local';
    client=root.MMNotifications.createClient({getToken:()=>root.MMSync?.getIdToken(),getOwner:()=>root.MMSync?.archiveKey()||'local'});
    $('notification-enable').addEventListener('click',()=>act(async()=>{
      // enable() must run before the first await to preserve Safari's user gesture.
      if($('notification-enable').dataset.enabled==='true')await client.disable();
      else{await client.enable();await client.sync(getState());}
    }));
    $('notification-test').addEventListener('click',()=>act(async()=>{await client.test();$('notification-feedback').textContent=text('tested');}));
    Object.keys(client.preferences).forEach(key=>$(`notification-${key}`).addEventListener('change',event=>{client.setPreferences({[key]:event.target.checked});refresh();}));
    root.addEventListener('mm:languagechange',()=>{$('notification-feedback').textContent='';refresh();});
    root.addEventListener('mm:archivechange',()=>{clearTimeout(timer);client.disable({resetPreferences:true}).then(()=>{archive=root.MMSync?.archiveKey()||'local';render();}).catch(error);});
    root.addEventListener('focus',refresh);root.document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
    root.navigator.serviceWorker?.addEventListener('message',event=>{if(event.data?.type==='MM_NOTIFICATION_OPEN')route(event.data.route);});
    root.addEventListener('mm:notificationopen',event=>route(event.detail?.route));
    const url=new URL(location.href),target=url.searchParams.get('notification');if(target){route(target);url.searchParams.delete('notification');history.replaceState(null,'',url);}
    refresh();
  }
  root.MMNotificationUI={init,refresh};
})(window);
