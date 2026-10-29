/* Domain commands. Deterministic, inspectable, and deliberately conservative. */
(function(root){
  'use strict';
  const M=typeof module!=='undefined'&&module.exports?require('./core.js'):root.MM;
  const incomeWords=/\b(stipendio|busta paga|tredicesima|quattordicesima|bonus|rimborso|entrata|incassato|ricevuto|accredito|salary|paycheck|paycheque|wages|received|earned|refund|reimbursement)\b/;
  const editWords=/\b(imposta|cambia|modifica|aggiorna|porta|aumenta|riduci|correggi|rettifica)\b|^(?:please\s+)?(?:set|change|edit|update|increase|reduce|correct)\b/;
  // Keep arbitrary instructions and questions outside the transaction fallback.
  // Merchant names may be unknown, so we reject command/question syntax rather
  // than requiring a category keyword for every legitimate expense.
  function unsupportedRequest(text){
    const n=M.norm(text).trim().replace(/^(?:(?:ciao|ehi|senti|scusa|hey|hi|please|per favore)[,\s]+)+/,'');
    if(!/[?？]/.test(n)&&/^(?:vorrei registrare|vorrei aggiungere|i want to record|i want to add|i would like to record|i would like to add)\b/.test(n))return false;
    if(/^(?:crea|create)\s+(?:spesa fissa|abbonamento|subscription)\b/.test(n))return false;
    if(/^(?:crea|creami|create|make|fammi|fai|mostra|mostrami|show|dammi|give|puoi|potresti|mi dici|mi puoi|mi potresti)\b/.test(n)||/^\d+(?:[.,]\d+)?\s*[+*/×÷=]\s*\d/.test(n))return true;
    return /[?？]/.test(n)||/^(?:calcola|calcolami|risolvi|dimmi|racconta|scrivi|scrivimi|spiega|spiegami|traduci|riassumi|consiglia|consigliami|genera|cerca|trova|calculate|compute|solve|tell|write|explain|translate|summarize|recommend|generate|search|find|posso|potrei|possiamo|potremmo|vorrei|mi conviene|riesco|quanto|quanta|quanti|quante|come|quando|perche|dove|chi|cosa|che cosa|e se|se|secondo te|can|could|should|would|what|how|when|why|where|who|do i|do you|is it|are there|i want to|i would|i'd)\b/.test(n);
  }
  function inferType(name){return incomeWords.test(M.norm(name))?'income':'expense';}
  function inferCategory(name,rules){const c=M.classify(name,rules);return c.category||(/\b(tredicesima|quattordicesima|bonus)\b/.test(M.norm(name))?'Stipendio':'Altro');}
  function linkRecurring(d,state){
    if(d.type!=='expense'||!d.date||!d.amountCents)return d;
    const matches=state.recurring.filter(r=>r.active&&r.amountCents===d.amountCents&&r.category===d.category&&M.has(d.note,r.name)&&M.occurrences(r,d.date,M.shiftDays(d.date,1)).length);
    if(matches.length===1){d.recurringId=matches[0].id;d.dueDate=d.date;}
    return d;
  }
  function quickEntry({name,amount,date,category='',type='auto'},state,ref=M.today()){
    name=String(name).trim();if(!name)throw Error('Dai un nome a questo movimento.');if(name.length>150)throw Error('Usa un nome di massimo 150 caratteri.');
    const amountCents=M.cents(amount);if(!amountCents)throw Error('L’importo deve essere maggiore di zero.');
    if(!M.validDate(date))throw Error('Scegli una data valida.');
    const kind=type==='auto'?inferType(name):type;if(!['income','expense'].includes(kind))throw Error('Tipo non valido.');
    const cat=category||inferCategory(name,state.rules);if(!M.CATEGORIES.includes(cat))throw Error('Categoria non valida.');
    return linkRecurring({id:M.id(),date,amountCents,type:kind,category:cat,note:name,status:date>ref?'planned':'paid',includedInOpening:date<state.settings.openingDate,countBudget:true,recurringId:null,dueDate:null,createdAt:new Date().toISOString()},state);
  }
  function command(text,state,ref=M.today()){
    text=String(text).trim();if(!text)throw Error('Scrivi o detta una spesa o una modifica.');if(text.length>4000)throw Error('Usa meno di 4.000 caratteri.');
    if(unsupportedRequest(text)){const e=Error('Posso registrare spese e aggiornare MyMoney. Per cambiare una preferenza, usa un comando esplicito come “Imposta budget a 800 euro”.');e.code='unsupported-intent';throw e;}
    if(/\b(?:ciascuno|ciascuna|cadauno|cadauna|l['’]uno|l['’]una|a testa|a persona|each|apiece|per person|per ticket|unitario)\b/i.test(text)||/\d\s*[x×*]\s*\d/.test(text))throw Error('Per più pezzi, indica il prezzo totale del movimento.');
    const n=M.norm(text), editing=editWords.test(n);
    const extra=/\b(tredicesima|quattordicesima|bonus)\b/.test(n);
    // Only a clear setting instruction changes future salary expectations.
    const setting=(editing&&/\b(budget|obiettivo|risparmio|stipendio|salary|savings goal)\b/.test(n)&&!extra&&!/\b(questo mese|per questo mese|ricevuto|incassato|accreditato|this month|received|earned)\b/.test(n));
    if(setting){
      const keys=[[/\bbudget\b/,'budgetCents','Budget del ciclo'],[/\b(obiettivo|risparmio|savings goal)\b/,'savingsGoalCents','Obiettivo di risparmio'],[/\b(stipendio|salary)\b/,'salaryCents','Stipendio previsto']].filter(([re])=>re.test(n));
      if(keys.length!==1)throw Error('Cambia una preferenza alla volta, per esempio “Imposta budget a 1000 euro”.');
      if(/\b(giorno|ogni|percento|day|payday|every|percent)\b|%/.test(n))throw Error('Per il giorno di accredito usa Preferenze. Per gli importi indica il nuovo valore completo in euro.');
      const a=M.parseAmount(n);if(!a.amountCents)throw Error(a.warning);
      if(/\b(di|del|by)\s+\S/.test(n)&&/\b(aumenta|riduci|increase|reduce)\b/.test(n))throw Error('Indica il nuovo totale, per esempio “Imposta budget a 1200 euro”.');
      const [,key,label]=keys[0];return {kind:'setting',key,value:a.amountCents,title:label,description:`Da ${M.money(state.settings[key])} a ${M.money(a.amountCents)}. ${key==='salaryCents'?'Cambia il riferimento per il futuro, senza registrare un accredito.':'Il piano verrà ricalcolato. Il saldo del conto resta invariato.'}`};
    }
    const recurringMatches=state.recurring.filter(r=>M.has(n,M.norm(r.name)));
    const toggling=/\b(disattiva|sospendi|riattiva|attiva|elimina|cancella|disable|pause|enable|resume|delete|remove)\b/.test(n);
    const recurrence=/\b(ogni mese|al mese|mensile|ogni due mesi|bimestrale|ogni tre mesi|trimestrale|ogni sei mesi|semestrale|ogni anno|annuale|every month|monthly|every two months|every three months|quarterly|every six months|every year|annually|yearly)\b/;
    if((editing||toggling)&&recurringMatches.length){
      if(recurringMatches.length!==1)throw Error('Ho trovato più spese fisse. Usa il nome di una sola.');
      if(/\b(elimina|cancella|delete|remove)\b/.test(n))throw Error('Per eliminare una spesa fissa aprila nel Piano. Puoi dire “Disattiva '+recurringMatches[0].name+'”.');
      const r=M.clone(recurringMatches[0]);
      if(toggling){r.active=!/\b(disattiva|sospendi|disable|pause)\b/.test(n);if(r.active&&!r.startDate)throw Error('Questa spesa non ha ancora una data. Impostala nel Piano prima di attivarla.');}
      else{const dateInfo=M.parseDate(n,ref);if(dateInfo.explicit)throw Error('Per spostare una scadenza o programmare una modifica, apri la spesa nel Piano.');const a=M.parseAmount(dateInfo.masked);if(!a.amountCents)throw Error(a.warning);r.amountCents=a.amountCents;if(recurrence.test(n))throw Error('Per cambiare anche la frequenza, apri la spesa nel Piano. Qui aggiorno solo l’importo.');}
      return {kind:'recurring',recurring:r,isNew:false,action:toggling?'toggle':'amount',title:toggling?(r.active?'Riattiva '+r.name:'Sospendi '+r.name):'Aggiorna '+r.name,description:toggling?'Il piano si aggiornerà. I movimenti già registrati resteranno invariati.':`${M.money(recurringMatches[0].amountCents)} → ${M.money(r.amountCents)} ogni ${r.months} mes${r.months===1?'e':'i'}. Vale per il piano; i pagamenti già registrati restano invariati.`};
    }
    if(recurrence.test(n)){
      if(editing||toggling)throw Error('Non trovo una spesa fissa con quel nome. Controlla il nome nel Piano.');
      const clean=text.replace(new RegExp(recurrence.source,'i'),' '),d=M.parseDate(clean,ref),a=M.parseAmount(d.masked);
      if(!a.amountCents)throw Error(a.warning);if(!d.date)throw Error(d.warning);
      if(incomeWords.test(n))throw Error('Lo stipendio non viene accreditato automaticamente. Puoi impostare lo stipendio previsto oppure registrare una singola entrata.');
      const months=/ogni due mesi|bimestrale|every two months/.test(n)?2:/ogni tre mesi|trimestrale|every three months|quarterly/.test(n)?3:/ogni sei mesi|semestrale|every six months/.test(n)?6:/ogni anno|annuale|every year|annually|yearly/.test(n)?12:1;
      const name=M.entryName(clean,ref,d,a).replace(/^(?:(?:aggiungi|crea|spesa fissa|abbonamento|pago|pagamento|add|create|subscription)\s+)+/i,'');
      if(!name||name.length>150)throw Error('Indica il nome della spesa fissa, per esempio “Netflix 13,99 euro ogni mese”.');
      if(state.recurring.some(r=>M.norm(r.name)===M.norm(name)))throw Error('Questa spesa fissa esiste già. Scrivi “Modifica '+name+' a '+M.money(a.amountCents)+'”.');
      const r={id:M.id(),name,amountCents:a.amountCents,months,startDate:d.date,category:inferCategory(name,state.rules),active:true,automatic:false,estimated:false};
      return {kind:'recurring',recurring:r,isNew:true,title:'Nuova spesa fissa: '+r.name,description:`${M.money(r.amountCents)} ogni ${months} mes${months===1?'e':'i'}, prima scadenza ${d.date.split('-').reverse().join('/')}. Nessun pagamento viene registrato.`};
    }
    // A monthly salary replaces a unique salary in the same calendar month; bonuses never do.
    const received=/\b(ricevuto|incassato|accreditato|arrivato|received|credited)\b/.test(n);
    if(received&&/\b(stipendio|busta paga|salary|paycheck|paycheque|wages)\b/.test(n)&&/\b(?:non|not|never|mai|haven't|hasn't|didn't)\b/.test(n))throw Error('Non registro un accredito che non è arrivato. Mantieni lo stipendio previsto nel Piano o modifica la sua data.');
    if(/\b(stipendio|busta paga|salary|paycheck|paycheque|wages)\b/.test(n)&&!extra&&(/\b(questo mese|per questo mese|this month)\b/.test(n)||received)){
      const d=M.parseEntry(n.replace(/\b(?:(?:per )?questo mese|(?:for )?this month)\b/g,''),ref,state.rules);
      if(!d.amountCents)throw Error(d.warnings.join(' '));if(!d.date)throw Error(d.warnings.join(' '));
      const correctingMonth=/\b(questo mese|per questo mese|this month)\b/.test(n);
      const candidates=state.transactions.filter(t=>t.type==='income'&&t.category==='Stipendio'&&t.date.slice(0,7)===d.date.slice(0,7)&&(!received||correctingMonth||t.status==='planned')&&! /\b(tredicesima|quattordicesima|bonus)\b/.test(M.norm(t.note)));
      if(candidates.length>1)throw Error('Ci sono più stipendi questo mese. Apri il movimento da correggere nello storico.');
      const existing=candidates[0];
      const t=existing?{...M.clone(existing),amountCents:d.amountCents}:{...d,category:'Stipendio',type:'income',note:/\b(salary|paycheck|paycheque|wages)\b/.test(n)?'Salary':'Stipendio',createdAt:new Date().toISOString()};
      if(received){
        if(d.date>ref)throw Error('Un accredito ricevuto non può avere una data futura.');
        if(!existing||existing.status==='planned'){t.status='paid';t.date=d.date;t.includedInOpening=d.date<state.settings.openingDate;}
      }
      if(!existing&&t.date<state.settings.openingDate)t.includedInOpening=true;
      return {kind:'salary',transaction:t,existingId:existing?.id||null,title:existing?'Aggiorna lo stipendio del mese':'Registra lo stipendio del mese',description:existing?`${M.money(existing.amountCents)} → ${M.money(t.amountCents)}. ${t.includedInOpening?'È già compreso nel saldo iniziale: il saldo resta invariato.':'Corregge il movimento esistente, senza duplicarlo.'}`:'Una sola entrata per questo mese. Lo stipendio previsto dei mesi successivi non cambia.'};
    }
    if(editing||toggling)throw Error('Non ho individuato la modifica. Prova “Imposta stipendio a 2200 euro”, “Questo mese stipendio 2100 euro” oppure “Modifica Netflix a 15 euro”.');
    const items=M.interpret(text,ref,state.rules).map(d=>{
      d.category=d.category||inferCategory(d.note,state.rules);
      if(d.date&&d.date<state.settings.openingDate&&d.status==='paid')d.includedInOpening=true;
      return linkRecurring(d,state);
    });
    return {kind:'transactions',items,title:items.length===1?(items[0].type==='income'?'Nuova entrata':'Nuova spesa'):`${items.length} movimenti`,description:'Controlla importo e data, poi conferma. Puoi correggere i dettagli o annullare dopo il salvataggio.'};
  }
  function applyCommand(state,proposal){
    const next=M.clone(state);
    if(proposal.kind==='setting')next.settings[proposal.key]=proposal.value;
    else if(proposal.kind==='recurring'){
      if(proposal.isNew)next.recurring.push(proposal.recurring);
      else{if(!next.recurring.some(r=>r.id===proposal.recurring.id))throw Error('La ricorrenza è cambiata. Ripeti la richiesta.');next.recurring=next.recurring.map(r=>r.id===proposal.recurring.id?proposal.recurring:r);}
    }else{
      const items=proposal.kind==='salary'?[proposal.transaction]:proposal.items;
      M.validateTransactionBatch(items,next.transactions,{replacingIds:proposal.kind==='salary'&&proposal.existingId?[proposal.existingId]:[]});
      if(proposal.kind==='salary'&&proposal.existingId)next.transactions=next.transactions.filter(t=>t.id!==proposal.existingId);
      for(const d of items){
        next.transactions.push({...d,createdAt:d.createdAt||new Date().toISOString()});
      }
    }
    return M.validate(next);
  }
  const api={inferType,inferCategory,quickEntry,command,applyCommand,linkRecurring,unsupportedRequest};Object.assign(M,api);
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
