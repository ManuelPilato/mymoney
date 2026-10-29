/* Local-first UI. Optional, explicitly connected accounts sync through MMSync. */
(function () {
  'use strict';
  const I=window.MyMoneyI18n,tr=I.t,money=I.money;
  const M=window.MM, UI=window.MMUI, KEY='mymoney-local-v2', PREVIOUS=KEY+'-previous', LEGACY='mymoney-ai-v1';
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  let state=M.blank(), storageOK=true, readOnly=false, currentView='home', historyFilter='all', reportMode='month', reportOffset=0, editingId=null, recEditingId=null, drafts=[], speech=null, toastTimer, proposal=null, proposalRevision=null, editingRevision=null, recRevision=null, settingsDirty=false, settingsRevision=null, advisorQuestion=null, lastAnswer=null, advisorAction=null;
  const ICONS={
    check:'<path d="m5 12 4 4L19 6"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    wallet:'<path d="M4 6h14a2 2 0 0 1 2 2v10H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h13v2"/><path d="M20 10h-5v4h5"/>',
    lock:'<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    home:'<path d="m3 10 9-7 9 7v10H3zM9 20v-7h6v7"/>',
    list:'<path d="M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 11h18M8 15h2M14 15h2"/>',
    settings:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="currentColor"/><circle cx="16" cy="12" r="2" fill="currentColor"/><circle cx="10" cy="18" r="2" fill="currentColor"/>',
    mic:'<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
    arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>', left:'<path d="M20 12H4m6-6-6 6 6 6"/>',
    sparkles:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 2v4M18 4h4"/>',
    download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>', plus:'<path d="M12 4v16M4 12h16"/>', close:'<path d="m6 6 12 12M6 18 18 6"/>',
    plane:'<path d="m3 14 7-3 1-8 2-1 2 9 6 4v2l-7-2v5l-2 1-2-6-7 1z"/>',
    cart:'<path d="M2 3h3l3 12h11l3-9H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
    car:'<path d="m4 9 2-5h12l2 5M3 10h18v8H3zM5 18v3M19 18v3M6 13h2M16 13h2"/>',
    cup:'<path d="M4 4h12v9a5 5 0 0 1-10 0V4M16 6h3a3 3 0 0 1 0 6h-3M3 21h16"/>',
    heart:'<path d="M12 21 3 12a5.5 5.5 0 0 1 9-7 5.5 5.5 0 0 1 9 7z"/>',
    bag:'<path d="M4 7h16l1 14H3zM8 7V5a4 4 0 0 1 8 0v2"/>',
    income:'<path d="m6 12 6 6 6-6M12 3v15M4 21h16"/>',
    repeat:'<path d="M4 8a8 8 0 0 1 14-4l3 3M21 2v5h-5M20 16a8 8 0 0 1-14 4l-3-3M3 22v-5h5"/>'
  };
  // Insert only trusted SVG templates; user text always uses textContent.
  function icon(name){const span=document.createElement('span');span.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]||ICONS.wallet}</svg>`;return span.firstChild;}
  function decorate(){for(const e of $$('[data-icon]'))e.replaceChildren(icon(e.dataset.icon));}
  function el(tag, cls, text){const e=document.createElement(tag);if(cls)e.className=cls;if(tag==='button')e.classList.add('button');if(text!==undefined)e.textContent=String(text);return e;}
  function toastHost(){const toast=$('#toast');(UI.dialogs().at(-1)||document.body).append(toast);return toast;}
  function say(message){clearTimeout(toastTimer);toastHost().textContent=I.text(message);$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,4200);}
  function errBox(selector,message){const box=$(selector);box.textContent=I.text(message);box.hidden=!message;}
  const formatDate=(s,year=false)=>M.validDate(s)?new Intl.DateTimeFormat(I.locale,{day:'numeric',month:'short',...(year?{year:'numeric'}:{})}).format(M.dateObj(s)):tr('Da definire');
  const val=I.decimal;
  const catIcon=c=>({Casa:'home',Spesa:'cart','Mangiare fuori':'cup',Auto:'car',Trasporti:'car',Viaggi:'plane',Salute:'heart',Sport:'heart',Shopping:'bag',Stipendio:'income',Rimborsi:'income'})[c]||'repeat';
  function option(select,value,label){const o=el('option',null,label);o.value=value;select.append(o);}
  function categoryOptions(select,value=''){select.replaceChildren();option(select,'',tr('Scegli categoria…'));M.CATEGORIES.forEach(c=>option(select,c,I.category(c)));select.value=value;}


  function balanceSignature(settings=state.settings){return settings.openingDate+':'+settings.openingBalanceCents;}
  function balanceKey(){return 'mymoney-balance-confirmed:'+ (window.MMSync?.archiveKey()||'guest');}
  function balanceConfirmed(){try{return localStorage.getItem(balanceKey())===balanceSignature();}catch(_){return false;}}
  function hasOpeningBalance(){return state.settings.initialized&&(state.settings.openingBalanceCents!==0||balanceConfirmed());}
  function markBalanceConfirmed(){try{localStorage.setItem(balanceKey(),balanceSignature());}catch(_){/* Advisor remains cautious if storage is unavailable. */}}
  function filterCategories(){const select=$('#filter-category'),value=select.value;select.replaceChildren();option(select,'',tr('Tutte le categorie'));M.CATEGORIES.forEach(c=>option(select,c,I.category(c)));select.value=value;}
  function clearHistoryFilters(){for(const id of ['from','to','category','min','max'])$('#filter-'+id).value='';renderHistory();}

  // Never claim a write succeeded when browser storage rejects it.
  function load(){
    let raw=null;
    try{
      const accountState=window.MMSync?.initialState();raw=accountState?JSON.stringify(accountState):localStorage.getItem(KEY);
      if(raw)state=M.validate(JSON.parse(raw));
      else if(localStorage.getItem(LEGACY)){
        state=M.migrate(JSON.parse(localStorage.getItem(LEGACY)));
        localStorage.setItem(KEY,JSON.stringify(state));
        say(tr('Archivio precedente importato. Controlla date e categorie storiche.'));
      }
    }catch(error){
      if(raw){readOnly=true;errBox('#storage-warning',tr('Archivio non leggibile: non lo sovrascrivo. Importa un backup valido per recuperarlo. ')+I.text(error.message));}
      else{storageOK=false;errBox('#storage-warning',tr('Archivio locale non disponibile. Apri l’app in un browser con archiviazione abilitata.'));}
    }
    try{const probe=KEY+'-probe';localStorage.setItem(probe,'1');localStorage.removeItem(probe);}
    catch(_){storageOK=false;errBox('#storage-warning',tr('Salvataggio locale bloccato o spazio esaurito. I dati leggibili restano visibili: esporta un backup prima di liberare spazio.'));}
  }
  function commit(next,{replace=false}={}){
    if(!storageOK)throw Error(tr('Archiviazione locale bloccata. Non ho salvato.'));
    if(readOnly&&!replace)throw Error(tr('Archivio protetto per errore di lettura: importa un backup valido.'));
    const clean=M.validate(next), disk=localStorage.getItem(KEY);
    if(disk&&!replace&&!readOnly&&!window.MMSync?.ownsArchive()){
      const latest=JSON.parse(disk);
      if((latest.revision||0)!==(state.revision||0))throw Error(tr('Archivio modificato in un’altra scheda. Riapri la modifica sui dati aggiornati.'));
    }
    clean.revision=(state.revision||0)+1;clean.updatedAt=new Date().toISOString();
    if(window.MMSync?.saveLocal(clean,state)){
      state=clean;readOnly=false;errBox('#storage-warning','');render();return;
    }
    // Preserve the previous snapshot on a best-effort basis, without blocking the main write.
    if(disk&&!readOnly){try{localStorage.setItem(PREVIOUS,disk);}catch(_){/* Primary storage still gets a chance to save. */}}
    try{localStorage.setItem(KEY,JSON.stringify(clean));}catch(_){throw Error(tr('Spazio locale esaurito o salvataggio bloccato. Nessuna modifica salvata.'));}
    state=clean;readOnly=false;errBox('#storage-warning','');render();
  }
  window.addEventListener('storage',e=>{
    if(window.MMSync?.handlesStorage(e))return;
    if(e.key===null||(e.key===KEY&&!e.newValue)){readOnly=true;errBox('#storage-warning',tr('L’archivio è stato rimosso da un’altra scheda. Esporta i dati ancora visibili prima di ricaricare.'));return;}
    if(e.key===KEY&&e.newValue){try{state=M.validate(JSON.parse(e.newValue));readOnly=false;render();say(tr('Dati aggiornati da un’altra scheda.'));}catch(_){readOnly=true;errBox('#storage-warning',tr('Aggiornamento da un’altra scheda non valido. Esporta i dati visibili prima di ricaricare.'));}}
  });

  function go(view){
    cancelVoice();
    const previous=currentView;currentView=view;
    for(const b of $$('.nav [data-go]')){b.classList.toggle('active',b.dataset.go===view);if(b.dataset.go===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');}
    UI.transitionView(previous,view,()=>{goQuiet(view);$('#data-scroll').scrollTo({top:0,behavior:'auto'});});
    UI.open($('#data-sheet'));
  }
  function transactionRow(t){
    const row=el('button','row');row.type='button';row.setAttribute('aria-label',tr('Modifica {name}, {amount}',{name:t.note||I.category(t.category),amount:money(t.amountCents)}));row.addEventListener('click',()=>editTransaction(t));
    const left=el('span','row-left'), badge=el('span','cat-icon'+(t.type==='income'?' green':''));badge.append(icon(catIcon(t.category)));
    const texts=el('span');texts.append(el('span','row-title',t.note||I.category(t.category)),el('span','row-sub',`${formatDate(t.date)} · ${I.category(t.category)}${t.includedInOpening?tr(' · già nel saldo'):''}`));left.append(badge,texts);
    const right=el('span','row-money'+(t.type==='income'?' income':''),(t.type==='income'?'+ ':'− ')+money(t.amountCents));right.append(el('small',t.status==='planned'?'planned':'',t.status==='planned'?(t.type==='income'?tr('Da incassare'):tr('Da pagare')):tr('Registrato')));
    row.append(left,right);return row;
  }
  function transactionsInto(container,items){container.replaceChildren();if(!items.length){const empty=el('div','empty');empty.append(icon('list'),el('strong',null,container.id==='recent'?tr('Ancora nessun movimento.'):tr('Nessun movimento trovato.')),document.createTextNode(container.id==='recent'?tr('Tocca + per aggiungere una spesa.'):tr('Prova un’altra ricerca o cambia il filtro.')));container.append(empty);}else items.forEach(t=>container.append(transactionRow(t)));}
  function sortedTransactions(){return [...state.transactions].reverse().sort((a,b)=>b.date.localeCompare(a.date)||(b.createdAt||'').localeCompare(a.createdAt||''));}
  function renderHome(){
    const x=M.totals(state), s=state.settings;
    $('#balance').textContent=money(x.balance);$('#balance-caption').textContent=tr('Saldo iniziale {amount} · {date}',{amount:money(s.openingBalanceCents),date:formatDate(s.openingDate,true)});
    $('#available').textContent=money(x.available);$('#available').classList.toggle('negative',s.budgetCents>0&&x.available<0);
    $('#goal').textContent=money(s.savingsGoalCents);$('#fixed').textContent=money(x.fixedEquivalent);
    $('#cycle-label').textContent=`${formatDate(x.start)} — ${formatDate(M.shiftDays(x.end,-1))}`;
    $('#budget-cap').textContent=s.budgetCents?tr('su {amount}',{amount:money(s.budgetCents)}):tr('Imposta in Preferenze');if(!s.budgetCents)$('#available').textContent=tr('Da impostare');
    const used=s.budgetCents-x.available;$('#budget-progress').style.width=Math.max(0,Math.min(100,s.budgetCents?used/s.budgetCents*100:0))+'%';
    $('#budget-caption').textContent=tr('Fisse equivalenti + {paid} variabili pagate + {planned} previste. Gli accantonamenti sono una stima, non denaro spostato.',{paid:money(x.paidVariable),planned:money(x.plannedVariable)});
    const warning=s.budgetCents&&x.available<0?tr('Il budget è superato, considerando anche gli impegni.'):s.budgetCents&&used>=s.budgetCents*.8?tr('Hai impegnato almeno l’80% del budget.'):'';
    errBox('#budget-warning',warning);
    const alerts=$('#home-alerts');alerts.replaceChildren();
    const late=state.transactions.filter(t=>t.status==='planned'&&t.date<=M.today());
    if(late.length)alerts.append(el('div','notice',tr('{count} movimenti da verificare: la scadenza è arrivata, ma non risultano pagati. Apri Movimenti → Previsti.',{count:late.length})));
    const overdue=[];
    for(const r of state.recurring)for(const d of M.occurrences(r,s.openingDate,M.shiftDays(M.today(),1)))if(!isPaidOccurrence(r.id,d))overdue.push({r,d});
    if(overdue.length)alerts.append(el('div','notice',tr('{count} scadenze ricorrenti da confermare nel Piano. Anche gli addebiti automatici richiedono verifica.',{count:overdue.length})));

    transactionsInto($('#recent'),sortedTransactions().slice(0,3));
    const upcoming=window.MMViews.planRows(state,M.today()).recurring.filter(row=>row.nextDate).sort((a,b)=>a.nextDate.localeCompare(b.nextDate));const u=$('#home-upcoming');u.replaceChildren();
    for(const row of upcoming.slice(0,3)){const b=el('button','upcoming-mini'),l=el('span');l.append(el('strong',null,row.record.name),el('small',null,formatDate(row.nextDate)));b.append(l,el('span',null,money(row.amountCents)));b.addEventListener('click',()=>row.transaction?editTransaction(row.transaction):draftRecurring(row.record,row.dueDate));u.append(b);}
    if(!upcoming.length)u.append(el('p','tiny',tr('Nessuna scadenza in arrivo. Aggiungi le tue spese fisse nel Piano.')));
    if(!hasOpeningBalance()){$('#balance').textContent='—';$('#balance-caption').textContent=tr('Conferma il saldo iniziale nelle Preferenze.');}

  }
  function renderHistory(){
    const raw={from:$('#filter-from').value,to:$('#filter-to').value,category:$('#filter-category').value,min:$('#filter-min').value.trim(),max:$('#filter-max').value.trim()};
    let list=[],error='';
    try{
      const opts={query:$('#search').value,status:historyFilter,from:raw.from,to:raw.to,category:raw.category,categoryLabel:I.category};
      for(const bound of ['min','max'])if(raw[bound]){if(!/^(?:\d+(?:[.,]\d{1,2})?|[.,]\d{1,2})$/.test(raw[bound]))throw Error(tr('Inserisci importi positivi con al massimo due decimali.'));opts[bound+'Cents']=M.cents(raw[bound]);}
      const check=window.MMViews.validateFilters(opts);
      if(!check.valid)throw Error(check.errors.some(e=>e.code==='invalid-date'||e.code==='reversed-date-range')?tr('La data iniziale deve precedere quella finale.'):tr('Il minimo deve essere minore o uguale al massimo.'));
      list=window.MMViews.filterTransactions(sortedTransactions(),opts);
    }catch(e){error=e.message;}
    errBox('#filter-error',error);if(error)$('#search-options').open=true;
    const count=Object.values(raw).filter(Boolean).length;$('#filter-count').textContent=count?String(count):'';
    const filtered=count>0||$('#search').value.trim()||historyFilter!=='all';$('#filter-results').hidden=!filtered||!!error;$('#filter-results').textContent=list.length===1?tr('1 movimento'):tr('{count} movimenti',{count:list.length});
    transactionsInto($('#all-transactions'),list);renderReport();
  }
  function reportBounds(){
    const ref=M.today(),d=M.dateObj(ref);let start,end;
    if(reportMode==='week'){start=M.shiftDays(ref,-((d.getDay()+6)%7)+reportOffset*7);end=M.shiftDays(start,7);}
    else if(reportMode==='cycle'){const c=M.cycle(ref,state.settings.payday);start=M.shiftMonths(c.start,reportOffset);end=M.shiftMonths(start,1);}
    else{start=M.iso(new Date(d.getFullYear(),d.getMonth()+reportOffset,1,12));end=M.shiftMonths(start,1);}
    return {start,end};
  }
  function line(parent,label,value,total=false){const row=el('div','line-item'+(total?' total':''));row.append(el('span',null,label),el('strong',null,value));parent.append(row);}
  function renderReport(){
    const b=reportBounds(), paid=state.transactions.filter(t=>t.status==='paid'&&M.within(t.date,b)&&t.date<=M.today());
    const income=paid.filter(t=>t.type==='income').reduce((s,t)=>s+t.amountCents,0),expense=paid.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amountCents,0);
    const p=$('#report');p.replaceChildren();$('#report-title').textContent=`${formatDate(b.start,true)} — ${formatDate(M.shiftDays(b.end,-1),true)}`;
    line(p,tr('Entrate registrate'),money(income));line(p,tr('Uscite registrate'),money(expense));line(p,tr('Differenza del periodo'),money(income-expense),true);
    p.append(el('p','tiny',tr('Solo movimenti confermati. “Già nel saldo iniziale” non duplica il conto, ma resta nello storico. La differenza non è risparmio già accantonato.')));
    const cats=new Map();paid.filter(t=>t.type==='expense').forEach(t=>cats.set(t.category,(cats.get(t.category)||0)+t.amountCents));
    for(const [cat,n] of [...cats].sort((a,b)=>b[1]-a[1])){const box=el('div','category-summary');line(box,I.category(cat),money(n));const bar=el('div','report-bar'),fill=el('div');fill.style.width=(expense?n/expense*100:0)+'%';bar.append(fill);box.append(bar);p.append(box);}
  }
  function isPaidOccurrence(recId,date){return state.transactions.some(t=>t.recurringId===recId&&t.dueDate===date&&t.status==='paid');}
  function renderPlan(){
    const x=M.totals(state),b=$('#plan-budget');b.replaceChildren();b.append(el('h3',null,tr('Dove va il budget')));
    line(b,tr('Budget del ciclo'),money(state.settings.budgetCents));line(b,tr('Fisse: equivalente mensile'),'− '+money(x.fixedEquivalent));line(b,tr('Variabili già pagate'),'− '+money(x.paidVariable));line(b,tr('Variabili previste nel ciclo'),'− '+money(x.plannedVariable));line(b,tr('Libero dopo gli impegni'),money(x.available),true);
    b.append(el('p','tiny',tr('Le spese fisse sono ripartite per mese. Il saldo cambia quando confermi il pagamento.')));
    const rows=window.MMViews.planRows(state,M.today()),list=$('#recurring-list');list.replaceChildren();
    for(const item of rows.recurring){
      const r=item.record,wrap=el('div','plan-item'),row=el('button','row'),left=el('span','plan-copy');row.type='button';
      let status=!r.active?tr('Sospesa'):item.overdue?tr('Da verificare'):tr('Attiva');
      let date=item.nextDate?(r.automatic?tr('Prossimo addebito automatico {date}',{date:formatDate(item.nextDate,true)}):tr('Prossimo pagamento {date}',{date:formatDate(item.nextDate,true)})):tr('Data da definire');
      if(item.overdue)date=tr('Scadenza {date}',{date:formatDate(item.nextDate,true)});
      if(!r.active&&!item.transaction)date=tr('Non inclusa nel budget');
      left.append(el('span','row-title',r.name),el('span','row-sub',status+' · '+date+(r.estimated?tr(' · da verificare'):'')));
      const right=el('span','row-money',money(item.amountCents));right.append(el('small',null,r.months===1?tr('al mese'):tr('ogni {count} mesi',{count:r.months})));
      row.append(left,right);row.setAttribute('aria-label',tr('Modifica {name}',{name:r.name}));row.addEventListener('click',()=>editRecurring(r));wrap.append(row);
      if(item.dueDate){const pay=el('button','quiet plan-pay',item.transaction?tr('Apri movimento'):item.overdue||item.nextDate<=M.today()?tr('Registra pagamento'):tr('Prepara pagamento'));pay.type='button';pay.append(icon('arrow'));pay.addEventListener('click',()=>item.transaction?editTransaction(item.transaction):draftRecurring(r,item.dueDate));wrap.append(pay);}
      list.append(wrap);
    }
    if(!rows.recurring.length)list.append(el('p','empty',tr('Nessuna spesa fissa. Aggiungine una.')));
    $('#planned-section').hidden=!rows.planned.length;transactionsInto($('#planned-list'),rows.planned);
    const notes=$('#plan-notes');notes.replaceChildren();if(state.notes.length)state.notes.forEach(n=>notes.append(el('p','muted',n)));else notes.append(el('p','muted',tr('Nessuna voce in sospeso.')));
  }
  function renderSettings(){
    const s=state.settings;
    if(!settingsDirty){
    $('#s-opening').value=val(s.openingBalanceCents);$('#s-date').value=s.openingDate;$('#s-salary').value=val(s.salaryCents);$('#s-day').value=s.payday;$('#s-budget').value=val(s.budgetCents);$('#s-goal').value=val(s.savingsGoalCents);$('#s-savings').value=s.separateSavingsCents===null?'':val(s.separateSavingsCents);
      settingsRevision=state.revision;$('#s-opening-confirm').checked=hasOpeningBalance();
    }
    $('#backup-status').textContent=state.lastBackup?tr('Ultima esportazione avviata: {date}. Verifica di aver salvato il file.',{date:new Date(state.lastBackup).toLocaleString(I.locale)}):tr('Nessun backup esportato.');
    const r=$('#learned-rules');r.replaceChildren();
    for(const [index,rule] of state.rules.entries()){const row=el('div','row'),text=el('span','row-sub',`${rule.phrase} → ${I.category(rule.category)}`),button=el('button','quiet',tr('Rimuovi'));button.type='button';button.addEventListener('click',()=>{try{const next=M.clone(state);next.rules.splice(index,1);commit(next);say(tr('Preferenza rimossa.'));}catch(e){say(e.message);}});row.append(text,button);r.append(row);}
    if(!state.rules.length)r.append(el('p','tiny',tr('Ancora nessuna preferenza memorizzata.')));
  }
  function render(){
    renderHome();renderHistory();renderPlan();
    renderSettings();goQuiet(currentView);window.MMNotificationUI?.refresh();
    if(advisorQuestion && $('#voice-sheet').open)showAdvice(advisorQuestion);
  }
  function goQuiet(view){
    for(const v of ['home','history','plan','settings'])$(`#view-${v}`).hidden=v!==view;
    $('#welcome').hidden=state.settings.initialized||state.transactions.length>0||state.recurring.length>0||view!=='home';
    $('#data-title').textContent=({home:tr('I tuoi dati'),history:tr('Movimenti'),plan:tr('Il tuo piano'),settings:tr('Preferenze')})[view];
  }

  // Draft fields are editable and no parser output is committed automatically.
  function field(label,type,value){const wrap=el('div','field-group'),input=document.createElement(type==='select'?'select':'input');const id='f-'+M.id();input.id=id;if(type!=='select')input.type=type;input.value=value??'';const lab=el('label',null,tr(label));lab.dataset.i18n=label;lab.htmlFor=id;wrap.append(lab,input);return {wrap,input};}
  function check(label,value){const wrap=el('label','check-label'),input=document.createElement('input');input.type='checkbox';input.checked=!!value;const text=el('span',null,tr(label));text.dataset.i18n=label;wrap.append(input,text);return {wrap,input};}
  function openDrafts(items,editId=null){
    editingRevision=state.revision;editingId=editId;drafts=M.clone(items);const list=$('#drafts');list.replaceChildren();errBox('#editor-error','');
    $('#editor-title').textContent=editId?tr('Modifica movimento'):items.length>1?tr('Controlla {count} movimenti',{count:items.length}):tr('Tutto giusto?');
    $('#delete-transaction').hidden=!editId;$('#save-drafts').textContent=editId?tr('Salva modifiche'):items.length>1?tr('Conferma e salva tutto'):tr('Conferma e salva');
    drafts.forEach((d,i)=>{
      const box=el('section','draft');box.dataset.index=i;
      if(d.warnings?.length)box.append(el('div','notice',d.warnings.map(I.text).join(' ')));
      if(d.reason)box.append(el('p','reason',I.text(d.reason)));
      const grid=el('div','fields'),a=field('Importo (€)','text',d.amountCents!==null?val(d.amountCents):''),date=field('Data del pagamento','date',d.date||'');a.input.inputMode='decimal';a.input.required=true;date.input.required=true;a.input.dataset.field='amount';date.input.dataset.field='date';grid.append(a.wrap,date.wrap);box.append(grid);
      const grid2=el('div','fields'),cat=field('Categoria','select',d.category),status=field('Stato','select',d.status);categoryOptions(cat.input,d.category);cat.input.required=true;cat.input.dataset.field='category';option(status.input,'paid',tr('Pagato'));option(status.input,'planned',tr('Da pagare'));status.input.value=d.status;status.input.dataset.field='status';grid2.append(cat.wrap,status.wrap);
      const note=field('Nome','text',d.note);note.input.maxLength=150;note.input.required=true;note.input.dataset.field='note';box.insertBefore(note.wrap,grid);
      const datePreview=el('p','tiny');box.append(datePreview);
      const info=el('div','notice install-hint');box.append(info);
      const more=el('details'),sum=el('summary',null,tr('{category} · {status} · Personalizza',{category:I.category(d.category||'Altro'),status:d.status==='planned'?tr('Previsto'):tr('Registrato')}));more.append(sum,grid2);cat.input.value=d.category||'Altro';
      const type=field('Tipo di movimento','select',d.type);option(type.input,'expense',tr('Uscita'));option(type.input,'income',tr('Entrata'));type.input.value=d.type;type.input.dataset.field='type';more.append(type.wrap);
      const included=check('Già compreso nel saldo iniziale: non modificare il conto',d.includedInOpening);included.input.dataset.field='included';
      const count=check('Considera nel budget (per le uscite)',d.countBudget);count.input.dataset.field='budget';more.append(included.wrap,count.wrap);
      const rec=field('Collega a una spesa fissa (evita il doppio budget)','select',d.recurringId||'');option(rec.input,'',tr('Nessuna · spesa variabile'));for(const r of state.recurring)option(rec.input,r.id,r.name);rec.input.value=d.recurringId||'';rec.input.dataset.field='recurring';more.append(rec.wrap);
      const due=field('Scadenza della rata collegata','date',d.dueDate||'');due.input.dataset.field='dueDate';more.append(due.wrap);
      const learn=check('Ricorda la categoria per questa frase',false);learn.input.dataset.field='learn';more.append(learn.wrap);
      const phrase=field('Frase da riconoscere (es. tavolo Amazon)','text','');phrase.input.maxLength=100;phrase.input.dataset.i18nPlaceholder='Meglio specifica, non solo “Amazon”';phrase.input.placeholder=tr(phrase.input.dataset.i18nPlaceholder);phrase.input.dataset.field='phrase';more.append(phrase.wrap);
      box.append(more);
      const sync=()=>{
        if(date.input.value>M.today())status.input.value='planned';
        const planned=status.input.value==='planned';
        status.input.options[0].textContent=type.input.value==='income'?tr('Incassato'):tr('Pagato');
        status.input.options[1].textContent=type.input.value==='income'?tr('Da incassare'):tr('Da pagare');
        datePreview.textContent=date.input.value?tr('Data: {date}',{date:formatDate(date.input.value,true)}):tr('Scegli la data del pagamento.');
        if(planned)included.input.checked=false;
        included.input.disabled=planned;
        if(date.input.value&&date.input.value<state.settings.openingDate&&!planned)included.input.checked=true;
        info.textContent=planned?tr('Previsione: nessun addebito sul saldo. Resta da confermare anche quando arriva la data.'):included.input.checked?tr('Già nel saldo iniziale: nessun doppio addebito. Il budget è gestito separatamente.'):tr('Movimento effettivo: modificherà il saldo quando confermi.');
      };
      type.input.addEventListener('change',sync);date.input.addEventListener('change',sync);status.input.addEventListener('change',sync);included.input.addEventListener('change',sync);
      rec.input.addEventListener('change',()=>{if(rec.input.value){const rr=state.recurring.find(r=>r.id===rec.input.value);cat.input.value=rr.category;if(!due.input.value)due.input.value=date.input.value;}});
      sync();list.append(box);
    });
    UI.open($('#editor'));
  }
  function manual(){openDrafts([{id:M.id(),date:M.today(),type:'expense',amountCents:null,category:'Altro',note:'',status:'paid',includedInOpening:false,countBudget:true,recurringId:null,dueDate:null}]);}
  function editTransaction(t){openDrafts([t],t.id);}
  function draftRecurring(r,due){
    const existing=state.transactions.find(t=>t.recurringId===r.id&&t.dueDate===due);
    if(existing){editTransaction(existing);return;}
    openDrafts([{id:M.id(),date:due>M.today()?due:M.today(),amountCents:r.amountCents,type:'expense',category:r.category,note:r.name,status:due>M.today()?'planned':'paid',includedInOpening:false,countBudget:true,recurringId:r.id,dueDate:due,reason:tr('Rata collegata: nel budget è già compresa nelle spese fisse equivalenti.')}]);
  }
  let analysisVersion=0,analysisBusy=false;
  function assistantPhase(phase){window.MyMoneyOrbit?.setAssistantPhase(phase);$('#voice-sheet').dataset.phase=phase;}
  function cancelAnalysis(){analysisVersion++;analysisBusy=false;$('#voice-sheet').removeAttribute('aria-busy');}
  function savedFeedback(){window.MyMoneyOrbit?.confirm();window.MMNative?.haptic('success');}
  function showAdvice(question){
    const answer=window.MyMoneyAdvisor.interpret(question,state,M.today(),I.language,{previousAnswer:lastAnswer,balanceConfirmed:balanceConfirmed()});
    if(!answer)return false;
    // Keep the resolved question for state/language refreshes, not a recursive follow-up.
    advisorQuestion=answer.context?.question||question;lastAnswer=answer;advisorAction=answer.action;assistantPhase('ready');
    UI.swapContent($('#voice-sheet .assistant-content'),()=>{
      $('#voice-compose').hidden=true;$('#command-preview').hidden=true;$('#advisor-answer').hidden=false;
      $('#voice-title').textContent=tr('Facciamo due conti.');
      $('#advisor-item').textContent=answer.mode==='spending-limit'?tr('Il tuo margine'):answer.amountCents?`${answer.item||tr('Il tuo acquisto')} · ${money(answer.amountCents)}`:tr('Il tuo acquisto');
      $('#advisor-title').textContent=answer.title;$('#advisor-explanation').textContent=answer.explanation;
      $('#advisor-answer').dataset.verdict=answer.verdict;
      $('#advisor-lines').replaceChildren(...answer.details.map(line=>el('li',null,line)));
      $('#advisor-quality').textContent=answer.dataQuality?.label||'';
      const hasAction=!!answer.action?.label&&answer.action.type!=='none';
      $('#advisor-action').hidden=!hasAction;$('#advisor-action').textContent=answer.action?.label||'';
      $('#advisor-voice').classList.toggle('quiet',hasAction);$('#advisor-voice').classList.toggle('full-width',!hasAction);
      $('#advisor-details').open=false;$('#advisor-details').hidden=false;$('#advisor-title').tabIndex=-1;$('#advisor-title').focus({preventScroll:true});
    });
    return true;
  }
  function resetAssistantSession(){lastAnswer=null;advisorQuestion=null;advisorAction=null;}
  let composerMeasure=null,composerFrame=0;
  function resizeAssistantText(){
    cancelAnimationFrame(composerFrame);
    composerFrame=requestAnimationFrame(()=>{
      composerFrame=0;
      const field=$('#natural');
      if(!field.getClientRects().length)return;
      // Measure wrapping offscreen; the focused field never collapses while typing.
      if(!composerMeasure){composerMeasure=document.createElement('textarea');composerMeasure.tabIndex=-1;composerMeasure.setAttribute('aria-hidden','true');composerMeasure.readOnly=true;document.body.append(composerMeasure);}
      const style=getComputedStyle(field);
      composerMeasure.style.cssText='position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;min-height:0;max-height:none;height:0;overflow:hidden;resize:none;transition:none;';
      for(const key of ['boxSizing','font','lineHeight','letterSpacing','padding','border','whiteSpace','wordBreak','overflowWrap'])composerMeasure.style[key]=style[key];
      composerMeasure.style.width=field.getBoundingClientRect().width+'px';composerMeasure.value=field.value||' ';
      const border=parseFloat(style.borderTopWidth)+parseFloat(style.borderBottomWidth),min=parseFloat(style.minHeight)||48;
      const max=Math.max(min,Math.min(168,(window.visualViewport?.height||window.innerHeight)*.28));
      const content=composerMeasure.scrollHeight+border;
      field.style.height=Math.max(min,Math.min(max,content))+'px';field.style.overflowY=content>max?'auto':'hidden';
    });
  }
  function composeState(){
    const value=$('#natural').value.trim(),typing=$('#voice-sheet').classList.contains('is-typing');$('#interpret').hidden=!value||!!speech;
    $('#voice-text').hidden=!value&&!typing;$('#voice-text').classList.toggle('glass-panel',typing);
    $('#natural').readOnly=!!speech;
    if($('#voice-text').hidden){$('#natural').style.height='';$('#natural').style.overflowY='hidden';}
    resizeAssistantText();
  }
  function typeToAssistant(){cancelAnalysis();cancelVoice();assistantPhase('idle');closeProposal();voiceStatus('');$('#voice-sheet').classList.add('is-typing');composeState();$('#natural').focus();}
  async function analyze(){
    if(analysisBusy)return;
    cancelVoice();closeProposal();
    const text=$('#natural').value.trim();
    if(!text){voiceStatus(tr('Dimmi una spesa oppure chiedimi se puoi permetterti un acquisto.'));return;}
    const version=++analysisVersion;analysisBusy=true;assistantPhase('processing');
    $('#voice-sheet').setAttribute('aria-busy','true');voiceStatus(tr('Controllo i tuoi dati…'));
    // Let the pending state paint once; never pad real work with a fake loading delay.
    await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
    if(version!==analysisVersion)return;
    try{
      if(showAdvice(text))return;
      // Questions outside this assistant's scope must never become a transaction.
      if(/[?？]/.test(text)||/^(come|perch[eé]|quanto|quanti|quando|dove|cosa|chi|how|why|what|when|where|can|could|should)\b/i.test(text)){
        voiceStatus(tr('Posso registrare spese, aggiornare il piano e valutare un acquisto. Prova: “Posso permettermi scarpe da 180 euro?”'),true);return;
      }
      proposal=M.command(text,state);proposalRevision=state.revision;
      if(proposal.kind==='transactions'&&proposal.items.some(d=>!d.date||!d.amountCents||d.warnings.length)){const items=proposal.items;UI.close($('#voice-sheet'),{immediate:true});openDrafts(items);proposal=null;return;}
      showProposal();
    }catch(e){voiceStatus(I.text(e.message),true);}
    finally{if(version===analysisVersion){analysisBusy=false;$('#voice-sheet').removeAttribute('aria-busy');assistantPhase('ready');}}
  }
  $('#editor-form').addEventListener('submit',event=>{
    event.preventDefault();errBox('#editor-error','');
    try{
      if(editingRevision!==state.revision)throw Error(tr('I dati sono cambiati mentre modificavi. Chiudi e riapri il movimento.'));
      const before=M.clone(state),next=M.clone(state), additions=[], rules=[];
      for(const box of $$('#drafts .draft')){
        const d=drafts[Number(box.dataset.index)],get=k=>box.querySelector(`[data-field="${k}"]`);
        const amountCents=M.cents(get('amount').value),date=get('date').value,status=get('status').value;
        if(!amountCents||!M.validDate(date)||!M.CATEGORIES.includes(get('category').value))throw Error(tr('Completa importo, data e categoria.'));
        if(status==='paid'&&date>M.today())throw Error(tr('Una data futura deve restare “Da pagare”.'));
        const included=status==='paid'&&get('included').checked;
        if(date<state.settings.openingDate&&status==='paid'&&!included)throw Error(tr('Un pagamento precedente al saldo iniziale va segnato come già incluso.'));
        const recurringId=get('recurring').value||null,dueDate=recurringId?(get('dueDate').value||date):null;
        if(recurringId&&next.transactions.some(t=>t.id!==editingId&&t.recurringId===recurringId&&t.dueDate===dueDate))throw Error(tr('Questa rata è già registrata. Modifica il movimento esistente.'));
        if(!get('note').value.trim()||get('note').value.trim().length>150)throw Error(tr('Dai un nome a questo movimento.'));
        const t={id:editingId||d.id||M.id(),date,type:get('type').value,amountCents,category:get('category').value,note:get('note').value.trim(),status,includedInOpening:included,countBudget:get('budget').checked,recurringId,dueDate,createdAt:d.createdAt||new Date().toISOString()};
        additions.push(t);
        if(get('learn').checked){const phrase=M.norm(get('phrase').value).trim();if(phrase.length<3)throw Error(tr('Per memorizzare una preferenza indica una frase di almeno 3 caratteri.'));rules.push({phrase,category:t.category});}
      }
      M.validateTransactionBatch(additions,next.transactions,{replacingIds:editingId?[editingId]:[]});
      if(editingId)next.transactions=next.transactions.filter(t=>t.id!==editingId);
      const duplicates=additions.some(a=>next.transactions.some(t=>t.date===a.date&&t.amountCents===a.amountCents&&t.type===a.type&&t.note===a.note));
      if(duplicates&&!window.confirm(tr('Un movimento uguale esiste già. Aggiungerlo comunque?')))return;
      next.transactions.push(...additions);
      for(const r of rules){next.rules=next.rules.filter(x=>x.phrase!==r.phrase);next.rules.push(r);}
      const message=editingId?tr('Movimento aggiornato.'):tr('Movimento salvato.');
      commit(next);savedFeedback();UI.close($('#editor'));$('#natural').value='';closeProposal();sayUndo(message,before);
    }catch(e){errBox('#editor-error',e.message);}
  });
  $('#delete-transaction').addEventListener('click',()=>{if(!editingId||!confirm(tr('Eliminare questo movimento? Il saldo e il budget saranno ricalcolati.')))return;try{if(editingRevision!==state.revision)throw Error(tr('I dati sono cambiati. Chiudi e riapri il movimento.'));const before=M.clone(state),next=M.clone(state);next.transactions=next.transactions.filter(t=>t.id!==editingId);commit(next);UI.close($('#editor'));sayUndo(tr('Movimento eliminato.'),before);}catch(e){errBox('#editor-error',e.message);}});

  function editRecurring(r=null){
    recRevision=state.revision;recEditingId=r?.id||null;$('#delete-recurring').hidden=!r;$('#r-name').value=r?.name||'';$('#r-amount').value=r?val(r.amountCents):'';$('#r-months').value=r?.months||1;$('#r-date').value=r?.startDate||'';$('#r-category').value=r?.category||'Altro';$('#r-active').checked=r?.active??true;$('#r-auto').checked=!!r?.automatic;$('#r-estimated').checked=!!r?.estimated;errBox('#rec-error','');UI.open($('#rec-editor'));
  }
  $('#rec-form').addEventListener('submit',e=>{e.preventDefault();try{
    if(recRevision!==state.revision)throw Error(tr('Il piano è cambiato. Chiudi e riapri la spesa fissa.'));
    const before=M.clone(state),next=M.clone(state),r={id:recEditingId||M.id(),name:$('#r-name').value.trim(),amountCents:M.cents($('#r-amount').value),months:Number($('#r-months').value),startDate:$('#r-date').value||null,category:$('#r-category').value,active:$('#r-active').checked,automatic:$('#r-auto').checked,estimated:$('#r-estimated').checked};
    if(!r.name||!r.amountCents||r.active&&!r.startDate)throw Error(tr('Indica nome, importo e prima scadenza se la ricorrenza è attiva.'));
    if(recEditingId)next.recurring=next.recurring.map(x=>x.id===recEditingId?r:x);else next.recurring.push(r);
    commit(next);UI.close($('#rec-editor'));sayUndo(tr('Spesa fissa aggiornata.'),before);
  }catch(err){errBox('#rec-error',err.message);}});
  $('#settings-form').addEventListener('input',()=>{if(!settingsDirty)settingsRevision=state.revision;settingsDirty=true;});
  for(const id of ['s-opening','s-date'])$('#'+id).addEventListener('input',()=>{$('#s-opening-confirm').checked=true;});
  $('#settings-form').addEventListener('submit',e=>{e.preventDefault();try{
    if(settingsDirty&&settingsRevision!==state.revision)throw Error(tr('I dati sono cambiati mentre modificavi le preferenze. Ricarica la pagina per vedere i valori aggiornati prima di salvarli.'));
    const next=M.clone(state);next.settings={initialized:hasOpeningBalance()||$('#s-opening-confirm').checked,openingDate:$('#s-date').value,openingBalanceCents:M.cents($('#s-opening').value),salaryCents:M.cents($('#s-salary').value),budgetCents:M.cents($('#s-budget').value),savingsGoalCents:M.cents($('#s-goal').value),payday:Number($('#s-day').value),separateSavingsCents:$('#s-savings').value.trim()?M.cents($('#s-savings').value):null};
    if(state.settings.initialized&&(next.settings.openingBalanceCents!==state.settings.openingBalanceCents||next.settings.openingDate!==state.settings.openingDate)&&!confirm(tr('Modificare la situazione iniziale ricalcolerà tutto il saldo. Non usare questa funzione per registrare una nuova entrata. Continuare?')))return;
    const confirmed=$('#s-opening-confirm').checked;commit(next);if(confirmed)markBalanceConfirmed();settingsDirty=false;render();say(tr('Impostazioni salvate.'));
  }catch(err){say(err.message);}});

  // Offer file sharing on mobile and a download fallback on desktop.
  async function saveFile(content,name,type){
    const blob=new Blob([content],{type}),file=new File([blob],name,{type});
    const mobile=/iPhone|iPad|iPod/.test(navigator.userAgent);
    if(mobile&&navigator.canShare?.({files:[file]})){
      try{await navigator.share({files:[file],title:name});return true;}catch(e){if(e.name==='AbortError')return false;}
    }
    const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);return true;
  }
  async function exportJSON(){try{
    const next=M.clone(state);next.lastBackup=new Date().toISOString();
    const saved=await saveFile(JSON.stringify(next,null,2),`MyMoney-backup-${M.today()}.json`,'application/json');
    if(saved){try{const current=M.clone(state);current.lastBackup=next.lastBackup;commit(current);say(tr('Backup esportato. Verifica il file salvato.'));}catch(_){say(tr('Backup esportato. Lo stato del backup non è aggiornabile nell’archivio locale.'));}}
  }catch(e){say(e.message);}}
  $('#import-file').addEventListener('change',async event=>{
    const file=event.target.files[0];if(!file)return;
    try{
      if(file.size>12*1024*1024)throw Error(tr('File troppo grande. Limite: 12 MB.'));
      const raw=JSON.parse(await file.text()),next=M.migrate(raw,M.today(),state.settings);
      // Preserve known future commitments when importing the older, incomplete schema.
      if(raw.schemaVersion!==2&&state.settings.initialized){
        const names=new Set(next.recurring.map(r=>M.norm(r.name)));
        for(const r of state.recurring)if(!names.has(M.norm(r.name)))next.recurring.push(M.clone(r));
        next.notes=[...new Set([...state.notes,...next.notes])];
      }
      if(state.settings.initialized&&!confirm(tr('L’importazione sostituirà l’archivio locale. Esporta prima un backup. Continuare?')))return;
      commit(next,{replace:true});go('home');say(tr('Archivio importato. Se hai collegato un account, le modifiche saranno sincronizzate.'));
    }catch(e){say(tr('Importazione annullata: ')+I.text(e.message));}
    finally{event.target.value='';}
  });
  function safeCSV(v){let s=String(v??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
  async function exportCSV(){const rows=[[tr('Data'),tr('Tipo'),tr('Importo EUR'),tr('Categoria'),tr('Nota'),tr('Stato'),tr('Gia nel saldo iniziale'),tr('Conta nel budget')],...sortedTransactions().map(t=>[t.date,t.type==='income'?tr('Entrata'):tr('Uscita'),val(t.amountCents),I.category(t.category),t.note,t.status==='paid'?tr('Confermato'):tr('Previsto'),t.includedInOpening?tr('Si'):tr('No'),t.countBudget?tr('Si'):tr('No')])];await saveFile('\ufeff'+rows.map(r=>r.map(safeCSV).join(';')).join('\r\n'),`MyMoney-movimenti-${M.today()}.csv`,'text/csv;charset=utf-8');}
  function icsEscape(s){return String(s).replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');}
  function foldICS(line){let out='',part='',bytes=0;for(const char of line){const n=new TextEncoder().encode(char).length;if(bytes+n>73){out+=part+'\r\n ';part='';bytes=1;}part+=char;bytes+=n;}return out+part;}
  async function exportCalendar(){
    const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//MyMoney Local//Scadenze//IT','CALSCALE:GREGORIAN','X-WR-CALNAME:MyMoney - '+tr('Scadenze')];
    const now=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z/,'Z'),end=M.shiftMonths(M.today(),12);
    const events=[];
    for(const r of state.recurring)for(const d of M.occurrences(r,M.today(),end))if(!isPaidOccurrence(r.id,d))events.push({id:`${r.id}-${d}`,date:d,title:`${r.name}${r.estimated?tr(' (da verificare)'):''}`,note:tr('Importo previsto: {amount}. {method} Apri MyMoney per confermare.',{amount:money(r.amountCents),method:r.automatic?tr('Verifica l’addebito automatico.'):tr('Pagamento manuale.')}),tentative:!!r.estimated});
    for(const t of state.transactions.filter(t=>t.status==='planned'&&!t.recurringId&&t.date>=M.today()&&t.date<end))events.push({id:t.id,date:t.date,title:t.note||I.category(t.category),note:tr('Previsto: {amount}. Conferma nell’app solo dopo il pagamento.',{amount:money(t.amountCents)}),tentative:true});
    if(!events.length){say(tr('Nessuna scadenza futura da esportare.'));return;}
    for(const ev of events){const date=ev.date.replace(/-/g,'');lines.push('BEGIN:VEVENT',`UID:${icsEscape(ev.id)}@mymoney.local`,`DTSTAMP:${now}`,`DTSTART:${date}T090000`,`DTEND:${date}T091500`,`SUMMARY:${icsEscape(ev.title)}`,`DESCRIPTION:${icsEscape(ev.note)}`,`STATUS:${ev.tentative?'TENTATIVE':'CONFIRMED'}`,'BEGIN:VALARM','TRIGGER:-P1D','ACTION:DISPLAY',`DESCRIPTION:${icsEscape(ev.title)}`,'END:VALARM','BEGIN:VALARM','TRIGGER:PT0M','ACTION:DISPLAY',`DESCRIPTION:${icsEscape(ev.title)}`,'END:VALARM','END:VEVENT');}
    lines.push('END:VCALENDAR');await saveFile(lines.map(foldICS).join('\r\n')+'\r\n',`MyMoney-scadenze-${M.today()}.ics`,'text/calendar');
    say(tr('File creato. Importalo nel Calendario e verifica gli avvisi.'));
  }

  // Recognition stays optional. Each callback belongs to exactly one live session.
  let speechTimers=[];
  function voiceStatus(text,attention=false){$('#voice-status').textContent=I.text(text);$('#voice-status').classList.toggle('attention',attention);}
  function voiceUI(active){UI.setVoice(active);window.MMParticles?.setListening(active);$('#voice-sheet').classList.toggle('is-listening',active);$('#mic').classList.toggle('mic-listening',active);$('#mic').setAttribute('aria-pressed',String(active));$('#mic').setAttribute('aria-label',active?tr('Termina dettatura'):tr('Avvia dettatura'));}
  function clearSpeechTimers(){speechTimers.forEach(clearTimeout);speechTimers=[];}
  function cancelVoice(){const previous=speech;speech=null;window.MMVoiceMeter?.stop();clearSpeechTimers();voiceUI(false);composeState();if(previous){try{previous.abort();}catch(_){}}}
  function beginRecognition(){
    cancelAnalysis();cancelVoice();closeProposal();$('#natural').value='';$('#voice-sheet').classList.remove('is-typing');composeState();
    $('#voice-consent').hidden=true;$('#voice-compose').hidden=false;
    const SR=window.MMNative?.isNative?window.MMNative.SpeechRecognition:(window.SpeechRecognition||window.webkitSpeechRecognition);
    if(!SR){$('#voice-sheet').classList.add('is-typing');composeState();voiceStatus(tr('Scrivi qui o usa il microfono della tastiera.'),true);return;}
    try{
      const r=new SR();speech=r;r.lang=I.locale;r.interimResults=true;r.continuous=false;
      let finalText='',failed=false;
      voiceUI(true);$('#voice-title').textContent=tr('Sono qui.');voiceStatus(tr('Attivo il microfono…'));
      const startup=setTimeout(()=>{if(speech!==r)return;cancelVoice();voiceStatus(tr('Tocca il microfono per riprovare, oppure scrivi.'),true);},9000);
      speechTimers.push(startup,setTimeout(()=>{if(speech!==r)return;cancelVoice();voiceStatus(tr('Dettatura terminata. Puoi continuare dal testo.'),true);},45000));
      r.onstart=()=>{if(speech!==r)return;clearTimeout(startup);voiceStatus(tr('Ti ascolto…'));window.MMNative?.haptic('listening');};
      r.onresult=e=>{if(speech!==r)return;let all='';finalText='';for(let i=0;i<e.results.length;i++){all+=e.results[i][0].transcript+' ';if(e.results[i].isFinal)finalText+=e.results[i][0].transcript+' ';}$('#natural').value=all.trim();composeState();};
      r.onerror=e=>{if(speech!==r)return;failed=true;const messages={'not-allowed':tr('Microfono non autorizzato. Puoi abilitarlo in Safari oppure scrivere qui.'),'audio-capture':tr('Microfono non disponibile. Puoi scrivere qui.'),'no-speech':tr('Non ho sentito una frase. Tocca il microfono per riprovare.'),'network':tr('Voce non disponibile. Controlla la connessione oppure scrivi.'),'aborted':tr('Dettatura interrotta. Puoi riprovare.')};cancelVoice();voiceStatus(messages[e.error]||tr('Puoi riprovare con il microfono oppure scrivere.'),true);};
      r.onend=()=>{if(speech!==r)return;speech=null;window.MMVoiceMeter?.stop();clearSpeechTimers();voiceUI(false);composeState();if(!failed&&finalText.trim()){$('#natural').value=finalText.trim();analyze();}else if(!failed)voiceStatus(tr('Puoi riprovare o continuare dal testo.'),true);};
      r.start();composeState();
      if(!window.MMNative?.isNative)window.MMVoiceMeter?.start((level,details)=>{if(speech===r)window.MMParticles?.setAudioLevel(level,details);},{recognitionActive:true,allowConcurrent:true}).catch(()=>{});
    }catch(_){cancelVoice();voiceStatus(tr('Tocca il microfono per riprovare, oppure scrivi.'),true);}
  }
  function startVoice(){
    if(speech){try{speech.stop();}catch(_){cancelVoice();}return;}
    closeProposal();UI.open($('#voice-sheet'));$('#voice-title').textContent=tr('Sono qui.');
    beginRecognition();
  }
  $('#assistant-type').addEventListener('click',typeToAssistant);
  $('#advisor-action').addEventListener('click',()=>{const action=advisorAction;if(!action)return;if(action.type==='open-preferences'){UI.close($('#voice-sheet'),{immediate:true});go('settings');const target=$(action.field==='salary'?'#s-salary':'#s-opening');target.closest('details')?.setAttribute('open','');target.scrollIntoView({block:'center'});target.focus({preventScroll:true});}else if(action.type==='open-plan'||action.type==='open-history'){UI.close($('#voice-sheet'),{immediate:true});go(action.type==='open-plan'?'plan':'history');}else typeToAssistant();});
  $('#advisor-voice').addEventListener('click',beginRecognition);
  $('#advisor-write').addEventListener('click',typeToAssistant);
  $('#voice-enable').addEventListener('click',beginRecognition);
  $('#voice-write').addEventListener('click',()=>{$('#voice-consent').hidden=true;$('#voice-compose').hidden=false;typeToAssistant();});
  $('#close-voice').addEventListener('click',()=>UI.close($('#voice-sheet')));
  $('#close-quick').addEventListener('click',()=>UI.close($('#quick-sheet')));
  $('#settings-voice').addEventListener('click',startVoice);
  document.addEventListener('mm:closing',e=>{
    if(e.target.id==='voice-sheet'){cancelAnalysis();cancelVoice();resetAssistantSession();}
    const toast=$('#toast');if(e.target.contains(toast))(UI.dialogs().filter(d=>d!==e.target).at(-1)||document.body).append(toast);
  });
  // Discard drafts after the exit animation, without collapsing the visible panel.
  document.addEventListener('close',e=>{
    if(e.target.tagName!=='DIALOG'||e.target.open)return;
    if(e.target.id==='voice-sheet'){cancelVoice();closeProposal();resetAssistantSession();$('#natural').value='';$('#voice-sheet').classList.remove('is-typing');composeState();voiceStatus('');$('#command-lines').replaceChildren();}
    if(e.target.id==='quick-sheet'){resetQuick();}
    if(e.target.id==='editor'){drafts=[];editingId=null;editingRevision=null;$('#drafts').replaceChildren();errBox('#editor-error','');}
    if(e.target.id==='rec-editor'){$('#rec-form').reset();recEditingId=null;recRevision=null;errBox('#rec-error','');}
    if(e.target.id==='data-sheet'){
      settingsDirty=false;settingsRevision=null;$('#search').value='';clearHistoryFilters();historyFilter='all';reportMode='month';reportOffset=0;
      $('#history-filters [data-filter="all"]').click();$('#report-modes [data-report="month"]').click();
      renderSettings();
    }
    e.target.querySelectorAll('details').forEach(d=>{d.open=d.dataset.initialOpen==='true';});
  },true);
  async function setupOffline(){
    if(window.MMNative?.isNative){$('#install-status').textContent=tr('Versione iPhone installata. Interfaccia disponibile anche offline.');return;}
    const local=location.protocol==='file:';
    if(local){errBox('#environment',tr('Anteprima da file: funziona per la prova su computer. Su iPhone usa la versione HTTPS installata dalla Home. Fai sempre un backup.'));$('#install-status').textContent=tr('File locale: nessuna installazione offline PWA attiva.');return;}
    if(!('serviceWorker' in navigator)||!window.isSecureContext){$('#install-status').textContent=tr('Offline non disponibile in questo contesto: serve HTTPS per installare questa PWA.');return;}
    try{
      const registration=await navigator.serviceWorker.register('./sw.js',{scope:'./'});await navigator.serviceWorker.ready;
      $('#install-status').textContent=tr('App predisposta per l’uso offline. Installa dalla Home e aprila almeno una volta con connessione.');
      if(registration.waiting)$('#install-status').textContent+=tr(' Una nuova versione sarà usata dopo la chiusura di tutte le finestre dell’app.');
    }catch(_){$('#install-status').textContent=tr('Cache offline non attiva. Verifica che sw.js e gli altri file siano pubblicati insieme all’HTML.');}
    if(navigator.storage?.persisted){try{$('#persistent-status').textContent=await navigator.storage.persisted()?tr('Conservazione persistente concessa. Il backup resta necessario.'):tr('Conservazione standard: il sistema può eliminare i dati in alcune condizioni. Fai backup regolari.');}catch(_){/* Storage status is informative only. */}}
  }
  $('#request-storage').addEventListener('click',async()=>{try{const granted=await navigator.storage?.persist?.();$('#persistent-status').textContent=granted?tr('Conservazione persistente concessa. La cancellazione manuale elimina comunque i dati.'):tr('Conservazione persistente non concessa o non disponibile. Mantieni un backup.');}catch(e){say(tr('Richiesta non disponibile in questo browser.'));}});

  function sayUndo(message,before){
    clearTimeout(toastTimer);const toast=toastHost(),revision=state.revision;
    toast.replaceChildren(el('span',null,message));const button=el('button',null,tr('Annulla'));button.dataset.i18n='Annulla';
    button.addEventListener('click',()=>{try{if(state.revision!==revision)throw Error(tr('Ci sono modifiche successive. Apri il movimento per correggerlo.'));commit(before);say(tr('Operazione annullata.'));}catch(e){say(e.message);}});
    toast.append(button);toast.hidden=false;toastTimer=setTimeout(()=>{if(!toast.contains(document.activeElement))toast.hidden=true;},12000);
  }
  function resetQuick(){
    $('#quick-form').reset();$('#q-date').value=M.today();$('#q-date').dataset.chosen='false';
    $('#quick-details').hidden=true;$('#quick-options').setAttribute('aria-expanded','false');errBox('#quick-error','');updateQuickHint();
  }
  function quickFocus(){window.MMNative?.haptic('selection');if(!$('#quick-sheet').open||$('#quick-sheet').classList.contains('is-closing'))resetQuick();UI.open($('#quick-sheet'));}
  function updateQuickHint(){
    const name=$('#q-name').value.trim(),type=$('#q-type').value==='auto'?M.inferType(name):$('#q-type').value;
    const category=$('#q-category').value||M.inferCategory(name,state.rules),future=$('#q-date').value>M.today();
    $('#quick-hint').textContent=name?`${I.category(category)} · ${type==='income'?tr('Entrata'):tr('Uscita')}${future?tr(' · Prevista'):''}${$('#q-date').value<state.settings.openingDate?tr(' · Già nel saldo iniziale'):''}`:'';
  }
  function closeProposal(){proposal=null;proposalRevision=null;advisorQuestion=null;$('#advisor-answer').hidden=true;$('#command-preview').hidden=true;$('#voice-compose').hidden=false;$('#voice-title').textContent=tr('Sono qui.');errBox('#command-error','');}
  function showProposal(){
    UI.swapContent($('#voice-sheet .assistant-content'),()=>{
    if(!proposal)return;assistantPhase('ready');$('#command-details').open=false;
    const copy=I.proposal(proposal,state);$('#command-title').textContent=copy.title;$('#command-description').textContent=copy.description;
    const list=$('#command-lines');list.replaceChildren();
    const items=proposal.kind==='transactions'?proposal.items:proposal.kind==='salary'?[proposal.transaction]:[];
    for(const d of items){const row=el('div','preview-line'),text=el('span',null,d.note);text.append(el('small',null,`${formatDate(d.date,true)} · ${I.category(d.category)} · ${d.status==='planned'?tr('Previsto'):tr('Confermato')}${d.includedInOpening?tr(' · Già nel saldo iniziale'):''}`));row.append(text,el('strong',null,(d.type==='income'?'+ ':'− ')+money(d.amountCents)));list.append(row);}
    $('#command-edit').hidden=!['transactions','salary','recurring'].includes(proposal.kind);
    $('#command-preview').hidden=false;$('#voice-compose').hidden=true;$('#voice-consent').hidden=true;$('#voice-title').textContent=tr('Tutto giusto?');errBox('#command-error','');UI.open($('#voice-sheet'));$('#command-title').tabIndex=-1;$('#command-title').focus({preventScroll:true});
    });
  }
  function duplicateTransaction(items,existingId=null){return items.some(a=>state.transactions.some(t=>t.id!==existingId&&t.date===a.date&&t.amountCents===a.amountCents&&t.type===a.type&&M.norm(t.note)===M.norm(a.note)));}
  function setupQuick(){
    $('#q-date').value=M.today();option($('#q-category'),'',tr('Automatica'));for(const c of M.CATEGORIES)option($('#q-category'),c,I.category(c));
    $('#q-name').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();$('#q-amount').focus();}});
    $('#q-name').addEventListener('input',updateQuickHint);$('#q-category').addEventListener('change',updateQuickHint);$('#q-type').addEventListener('change',updateQuickHint);$('#q-date').addEventListener('change',()=>{$('#q-date').dataset.chosen='true';updateQuickHint();});$('#q-name').addEventListener('focus',()=>{if($('#q-date').dataset.chosen!=='true')$('#q-date').value=M.today();updateQuickHint();});
    $('#quick-options').addEventListener('click',()=>{const open=$('#quick-details').hidden;$('#quick-details').hidden=!open;$('#quick-options').setAttribute('aria-expanded',String(open));});
    $('#quick-form').addEventListener('submit',e=>{e.preventDefault();errBox('#quick-error','');try{
      const before=M.clone(state),t=M.quickEntry({name:$('#q-name').value,amount:$('#q-amount').value,date:$('#q-date').value,category:$('#q-category').value,type:$('#q-type').value},state);
      if(duplicateTransaction([t])&&!confirm(tr('Un movimento uguale esiste già. Vuoi aggiungerne un altro?')))return;
      const next=M.applyCommand(state,{kind:'transactions',items:[t]});
      if($('#q-category').value&&$('#q-learn').checked&&t.note.length>=3){next.rules=next.rules.filter(r=>r.phrase!==M.norm(t.note));next.rules.push({phrase:M.norm(t.note).slice(0,100),category:t.category});}
      commit(next);savedFeedback();$('#q-name').value='';$('#q-amount').value='';$('#q-category').value='';$('#q-type').value='auto';$('#q-date').value=M.today();$('#q-date').dataset.chosen='false';updateQuickHint();closeProposal();$('#quick-details').hidden=true;$('#quick-options').setAttribute('aria-expanded','false');UI.close($('#quick-sheet'));
      sayUndo(tr('{type} {status} · {amount}',{type:t.type==='income'?tr('Entrata'):tr('Spesa'),status:t.status==='planned'?tr('prevista'):tr('salvata'),amount:money(t.amountCents)}),before);
    }catch(error){errBox('#quick-error',error.message);}});
    $('#top-add').addEventListener('click',quickFocus);
    $('#natural').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();analyze();}});
    $('#natural').addEventListener('input',()=>{cancelAnalysis();assistantPhase('idle');closeProposal();composeState();});
    window.addEventListener('resize',resizeAssistantText);
    window.visualViewport?.addEventListener('resize',resizeAssistantText);
    $$('[data-example]').forEach(b=>b.addEventListener('click',()=>{$('#natural').value=b.dataset.example;closeProposal();$('#natural').focus();}));
    $('#command-close').addEventListener('click',beginRecognition);
    $('#command-edit').addEventListener('click',()=>{
      if(proposalRevision!==state.revision){errBox('#command-error',tr('I dati sono cambiati. Ripeti la richiesta.'));return;}
      const p=proposal;UI.close($('#voice-sheet'),{immediate:true});closeProposal();if(p.kind==='transactions')openDrafts(p.items);else if(p.kind==='salary')openDrafts([p.transaction],p.existingId);else if(p.kind==='recurring'){editRecurring(p.recurring);if(p.isNew){recEditingId=null;$('#delete-recurring').hidden=true;}}
    });
    $('#command-save').addEventListener('click',()=>{try{
      if(!proposal)return;if(proposalRevision!==state.revision)throw Error(tr('I dati sono cambiati. Ripeti la richiesta per aggiornare la proposta.'));
      const items=proposal.kind==='transactions'?proposal.items:proposal.kind==='salary'?[proposal.transaction]:[];
      if(duplicateTransaction(items,proposal.existingId)&&!confirm(tr('Un movimento uguale esiste già. Aggiungerlo comunque?')))return;
      const before=M.clone(state),next=M.applyCommand(state,proposal),message=proposal.kind==='setting'?tr('Preferenza aggiornata.'):proposal.kind==='recurring'?tr('Piano aggiornato.'):tr('Movimento salvato.');
      commit(next);savedFeedback();closeProposal();$('#natural').value='';UI.close($('#voice-sheet'));sayUndo(message,before);
    }catch(e){errBox('#command-error',e.message);}});
    $('#delete-recurring').addEventListener('click',()=>{
      if(!recEditingId||!confirm(tr('Eliminare questa spesa fissa? I movimenti già registrati saranno conservati come movimenti indipendenti.')))return;
      try{if(recRevision!==state.revision)throw Error(tr('Il piano è cambiato. Chiudi e riapri la spesa fissa.'));const before=M.clone(state),next=M.clone(state);next.recurring=next.recurring.filter(r=>r.id!==recEditingId);for(const t of next.transactions)if(t.recurringId===recEditingId){t.recurringId=null;t.dueDate=null;}commit(next);UI.close($('#rec-editor'));sayUndo(tr('Spesa fissa eliminata.'),before);}catch(e){errBox('#rec-error',e.message);}
    });
    document.addEventListener('keydown',e=>{
      if(e.defaultPrevented||e.metaKey||e.ctrlKey||e.altKey||e.isComposing||/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)||e.target.isContentEditable||$('dialog[open]'))return;
      if(e.key.toLowerCase()==='n'){e.preventDefault();quickFocus();}if(e.key.toLowerCase()==='v'){e.preventDefault();startVoice();}if(e.key.toLowerCase()==='d'){e.preventDefault();go('home');}if(e.key==='Escape'&&speech)cancelVoice();
    });
  }

  // Bind controls after the document is loaded; no inline event attributes are used.
  I.apply();decorate();categoryOptions($('#r-category'),'Altro');
  $('#s-language').addEventListener('change',event=>{if(!I.setLanguage(event.target.value))say(tr('Lingua aggiornata per questa sessione. Il browser non consente di ricordarla.'));});
  window.addEventListener('mm:languagechange',()=>{
    const wasSpeaking=!!speech;cancelVoice();
    render();categoryOptions($('#r-category'),$('#r-category').value);
    const quickCategory=$('#q-category').value;$('#q-category').replaceChildren();option($('#q-category'),'',tr('Automatica'));for(const category of M.CATEGORIES)option($('#q-category'),category,I.category(category));$('#q-category').value=quickCategory;
    for(const box of $$('#drafts .draft')){
      const get=key=>box.querySelector(`[data-field="${key}"]`),category=get('category'),type=get('type'),status=get('status');
      categoryOptions(category,category.value);
      for(const option of type.options)option.textContent=tr(option.value==='income'?'Entrata':'Uscita');
      get('recurring').options[0].textContent=tr('Nessuna · spesa variabile');
      get('date').dispatchEvent(new Event('change'));
      box.querySelector('summary').textContent=tr('{category} · {status} · Personalizza',{category:I.category(category.value||'Altro'),status:status.value==='planned'?tr('Previsto'):tr('Registrato')});
      for(const node of box.querySelectorAll('.notice,.reason'))node.textContent=I.text(node.textContent);
    }
    if($('#editor').open){$('#editor-title').textContent=editingId?tr('Modifica movimento'):drafts.length>1?tr('Controlla {count} movimenti',{count:drafts.length}):tr('Tutto giusto?');$('#save-drafts').textContent=editingId?tr('Salva modifiche'):drafts.length>1?tr('Conferma e salva tutto'):tr('Conferma e salva');}
    filterCategories();updateQuickHint();if(proposal)showProposal();
    if(wasSpeaking)voiceStatus(tr('Dettatura interrotta. Tocca il microfono per riprendere.'));
    for(const selector of ['#voice-status','#install-status','#persistent-status','#environment','#storage-warning','#quick-error','#editor-error','#rec-error','#command-error']){const node=$(selector);node.textContent=I.text(node.textContent);}
  });
  $$('[data-go]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.go)));
  $$('[data-import]').forEach(b=>b.addEventListener('click',()=>$('#import-file').click()));
  $('#setup-new').addEventListener('click',quickFocus);$('#interpret').addEventListener('click',analyze);$('#history-add').addEventListener('click',quickFocus);
  $('#close-editor').addEventListener('click',()=>UI.close($('#editor')));$('#close-rec').addEventListener('click',()=>UI.close($('#rec-editor')));$('#new-recurring').addEventListener('click',()=>editRecurring());
  filterCategories();
  $('#search').addEventListener('input',renderHistory);
  for(const id of ['from','to','category','min','max'])$('#filter-'+id).addEventListener('input',renderHistory);
  $('#clear-filters').addEventListener('click',clearHistoryFilters);
  $$('#history-filters button').forEach(b=>b.addEventListener('click',()=>{historyFilter=b.dataset.filter;$$('#history-filters button').forEach(x=>x.classList.toggle('active',x===b));renderHistory();}));
  $$('#report-modes button').forEach(b=>b.addEventListener('click',()=>{reportMode=b.dataset.report;reportOffset=0;$$('#report-modes button').forEach(x=>x.classList.toggle('active',x===b));renderReport();}));
  $('#report-prev').addEventListener('click',()=>{reportOffset--;renderReport();});$('#report-next').addEventListener('click',()=>{reportOffset++;renderReport();});
  $('#export-json').addEventListener('click',exportJSON);$('#export-csv').addEventListener('click',()=>exportCSV().catch(e=>say(e.message)));$('#export-calendar').addEventListener('click',()=>exportCalendar().catch(e=>say(e.message)));$('#mic').addEventListener('click',startVoice);
  $$('dialog details').forEach(d=>d.dataset.initialOpen=String(d.open));
  load();render();setupQuick();window.MMNotificationUI?.init({getState:()=>state,openView:go});UI.init({manual:quickFocus,voice:startVoice,data:()=>go('home'),suspend:()=>{if(speech){cancelVoice();voiceStatus(tr('Dettatura interrotta. Tocca il microfono per riprendere.'));}}});setupOffline();
  window.MMSync?.init({getState:()=>M.clone(state),replaceState:next=>{state=M.validate(next);readOnly=false;render();},notify:say,resetDrafts:()=>{
    cancelVoice();closeProposal();resetAssistantSession();settingsDirty=false;editingId=null;recEditingId=null;drafts=[];editingRevision=null;recRevision=null;proposalRevision=null;
    clearTimeout(toastTimer);$('#toast').replaceChildren();$('#toast').hidden=true;$('#drafts').replaceChildren();
    for(const dialog of UI.dialogs())if(dialog.id!=='data-sheet')UI.close(dialog,{immediate:true});
    $('#natural').value='';$('#q-name').value='';$('#q-amount').value='';$('#q-category').value='';$('#q-type').value='auto';$('#q-date').value=M.today();
  }});
  // Refresh date-sensitive views when the user returns, never in the background.
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){renderHome();renderHistory();renderPlan();if(advisorQuestion&&$('#voice-sheet').open)showAdvice(advisorQuestion);}});
})();
