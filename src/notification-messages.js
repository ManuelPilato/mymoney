/* Notification copy is shared by the PWA and the native container. */
(function(root){
  'use strict';
  const CATALOG=Object.freeze({
    test:{it:['Ci siamo.','Un piccolo promemoria, al momento giusto. MyMoney è qui.'],en:['All set.','A little reminder, at the right moment. MyMoney is here.']},
    due:{it:['Domani, senza sorprese.','{name}: {amount} in scadenza domani. Tutto sotto controllo?'],en:['Tomorrow, no surprises.','{name}: {amount} is due tomorrow. All set?'],privateIt:'Hai una scadenza domani. Dai un’occhiata al tuo piano.',privateEn:'Something is due tomorrow. Take a look at your plan.'},
    dueMany:{it:['Domani si gioca d’anticipo.','{count} scadenze domani, per {amount}. Un’occhiata ora, un pensiero in meno.'],en:['A little head start.','{count} payments due tomorrow, totalling {amount}. One quick look, one less thing to think about.'],privateIt:'Hai alcune scadenze domani. Il tuo piano ti aspetta.',privateEn:'A few payments are due tomorrow. Your plan is ready.'},
    budgetLow:{it:['Un piccolo check al budget?','Ultimo aggiornamento: {amount} di budget libero, {days} alla fine del ciclo. Facciamo il punto?'],en:['A quick budget check?','Last update: {amount} of uncommitted budget, {days} until this cycle ends. Shall we check in?'],privateIt:'Il budget libero si sta assottigliando. Facciamo il punto?',privateEn:'Your uncommitted budget is getting low. Shall we check in?'},
    budgetExceeded:{it:['Facciamo il punto, senza stress.','Il budget pianificato risulta superato di {amount}. Apri MyMoney e rivediamo il piano.'],en:['Let’s reset, no stress.','Your planned budget is over by {amount}. Open MyMoney to review the plan.'],privateIt:'Il piano segnala un budget superato. Puoi rivederlo con calma.',privateEn:'Your plan shows an exceeded budget. Take a moment to review it.'},
    weekly:{it:['La settimana, in un colpo d’occhio.','Due minuti per ritrovare il filo: apri MyMoney e guarda i tuoi movimenti.'],en:['Your week at a glance.','Two minutes to catch up: open MyMoney and review your transactions.']},
    reminder:{it:['Manca solo un piccolo check.','Qualche spesa da aggiungere? Un tocco o una frase, e hai finito.'],en:['Just one small check.','Any spending to add? One tap or one sentence, and you’re done.']}
  });
  const replace=(text,values)=>text.replace(/\{(\w+)\}/g,(_,key)=>String(values[key]??''));
  function message(kind,values={},language='it',details=false){
    const entry=CATALOG[kind];if(!entry)throw new RangeError('Unknown notification kind');
    const en=language==='en',pair=entry[en?'en':'it'];
    return {title:replace(pair[0],values),body:replace(!details&&(en?entry.privateEn:entry.privateIt)||pair[1],values)};
  }
  const api={CATALOG,message};if(typeof module!=='undefined'&&module.exports)module.exports=api;root.MMNotificationMessages=api;
})(typeof globalThis!=='undefined'?globalThis:this);
