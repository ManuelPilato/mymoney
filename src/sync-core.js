/* Pure synchronization model. Financial entities retain their original IDs. */
(function(root){
  'use strict';
  const M=typeof module==='object'&&module.exports?require('./core.js'):root.MM;
  const SETTINGS=['initialized','openingDate','openingBalanceCents','salaryCents','budgetCents','savingsGoalCents','separateSavingsCents','payday'];
  const MAX_WRITES=400;
  const clone=M.clone;
  const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
  const equal=(a,b)=>stable(a)===stable(b);
  const docId=(kind,key)=>kind+'_'+encodeURIComponent(key);
  const payload=r=>r&&!r.deleted?r.value:null;
  function entry(kind,key,value){
    if(typeof key!=='string'||!key||key.length>200||docId(kind,key).length>1500)throw Error('Un identificativo dell’archivio è troppo lungo per la sincronizzazione.');
    return {kind,key,value:clone(value),deleted:false};
  }
  function flatten(raw){
    const s=M.validate(raw),records={};
    const add=(kind,key,value)=>{records[docId(kind,key)]=entry(kind,key,value);};
    for(const key of SETTINGS)add('setting',key,s.settings[key]);
    for(const t of s.transactions){
      const v={};for(const key of ['id','date','amountCents','type','category','note','status','includedInOpening','countBudget','recurringId','dueDate'])v[key]=t[key];
      if(typeof t.createdAt==='string'&&t.createdAt.length<=40)v.createdAt=t.createdAt;
      add('transaction',t.id,v);
    }
    for(const r of s.recurring){
      const v={};for(const key of ['id','name','amountCents','months','startDate','active','automatic','category'])v[key]=r[key];
      if(typeof r.estimated==='boolean')v.estimated=r.estimated;
      add('recurring',r.id,v);
    }
    for(const r of s.rules)add('rule',M.norm(r.phrase).trim(),{phrase:r.phrase,category:r.category});
    if(s.notes.length>20)throw Error('La sincronizzazione supporta fino a 20 note. L’archivio locale è intatto.');
    add('notes','all',s.notes);
    return records;
  }
  function materialize(records,local=M.blank()){
    const state=M.blank();state.lastBackup=local.lastBackup;state.revision=local.revision;state.updatedAt=local.updatedAt;
    for(const [id,r] of Object.entries(records)){
      if(!r||r.deleted)continue;
      if(docId(r.kind,r.key)!==id)throw Error('Documento cloud non riconosciuto.');
      const v=clone(r.value);
      if(r.kind==='setting'&&SETTINGS.includes(r.key))state.settings[r.key]=v;
      else if(r.kind==='transaction')state.transactions.push(v);
      else if(r.kind==='recurring')state.recurring.push(v);
      else if(r.kind==='rule')state.rules.push(v);
      else if(r.kind==='notes'&&r.key==='all')state.notes=v;
      else throw Error('Versione dei dati cloud non supportata.');
    }
    return M.validate(state);
  }
  function hasData(state){return !!(state.settings.initialized||state.transactions.length||state.recurring.length||state.rules.length||state.notes.length);}
  function overlay(records,outbox){
    const result=clone(records);
    for(const op of outbox)for(const c of op.changes)result[c.id]={schemaVersion:1,kind:c.kind,key:c.key,value:clone(c.value),deleted:c.deleted,version:c.baseVersion+1,mutationId:op.id};
    return result;
  }
  function change(id,value,base){
    const r=value||base;
    return {id,kind:r.kind,key:r.key,value:value?clone(value.value):null,deleted:!value,baseVersion:base?.version||0};
  }
  function changes(before,after,expected,{seed=false}={}){
    const a=flatten(before),b=flatten(after),result=new Map();
    for(const id of new Set([...Object.keys(a),...Object.keys(b)])){
      if(!equal(payload(a[id]),payload(b[id]))||(seed&&!expected[id]&&b[id]))result.set(id,change(id,b[id],expected[id]||a[id]));
    }
    // Every linked movement also versions its recurring parent. A concurrent
    // deletion/payment therefore conflicts instead of leaving a broken link.
    for(const c of [...result.values()])if(c.kind==='transaction'){
      for(const rec of [a[c.id]?.value?.recurringId,b[c.id]?.value?.recurringId].filter(Boolean)){
        const id=docId('recurring',rec);
        if(!result.has(id))result.set(id,change(id,b[id],expected[id]||a[id]));
      }
    }
    return [...result.values()];
  }
  function append(env,before,after,id,now=new Date().toISOString()){
    const expected=overlay(env.records,env.outbox),list=changes(before,after,expected,{seed:!Object.keys(env.records).length&&!env.outbox.length});
    if(list.length>MAX_WRITES)throw Error('Questa modifica coinvolge troppi dati insieme. Importa l’archivio prima di collegare l’account, oppure suddividi le modifiche. Nessun dato è stato cambiato.');
    const next=clone(env);next.state=clone(after);if(list.length)next.outbox.push({id,createdAt:now,changes:list});return next;
  }
  function acknowledged(op,records){return op.changes.every(c=>records[c.id]?.mutationId===op.id&&records[c.id]?.version===c.baseVersion+1&&equal(payload(records[c.id]),c.deleted?null:c.value));}
  function equivalent(c,record){return !!record&&record.deleted===c.deleted&&equal(payload(record),c.deleted?null:c.value);}
  function conflicts(op,records){return op.changes.filter(c=>{
    const record=records[c.id];
    return (record?.version||0)!==c.baseVersion&&!(record?.mutationId===op.id&&equivalent(c,record))&&!(c.kind!=='recurring'&&equivalent(c,record));
  });}
  function mergeInitial(local,records){
    const merged=clone(records);for(const [id,r] of Object.entries(flatten(local)))if(!Object.hasOwn(merged,id))merged[id]=r;
    // An existing cloud tombstone stays authoritative, including its linked
    // recurrence. A unique imported payment remains, without a broken link.
    for(const r of Object.values(merged))if(r.kind==='transaction'&&!r.deleted&&r.value.recurringId){
      const parent=merged[docId('recurring',r.value.recurringId)];
      if(!parent||parent.deleted){r.value.recurringId=null;r.value.dueDate=null;}
    }
    return materialize(merged,local);
  }
  function importGroups(env,target,makeId){
    const next=clone(env),destination=flatten(target);let current=materialize(next.records,target);
    // Parents/settings first; each subsequent transaction chunk is a valid
    // archive. A destructive edit remains one atomic operation via append().
    const ordered=Object.values(destination).sort((a,b)=>(a.kind==='transaction'?1:0)-(b.kind==='transaction'?1:0));
    for(let offset=0;offset<ordered.length;offset+=150){
      const base=flatten(current);
      for(const r of ordered.slice(offset,offset+150))base[docId(r.kind,r.key)]=r;
      const state=materialize(base,current),expected=overlay(next.records,next.outbox),list=changes(current,state,expected,{seed:!Object.keys(next.records).length&&!next.outbox.length});
      if(list.length)next.outbox.push({id:makeId(),createdAt:new Date().toISOString(),changes:list});
      current=state;
    }
    next.state=clone(target);return next;
  }
  function rebaseLocal(env){
    const projected=overlay(env.records,env.outbox),localPayment=new Map();
    for(const op of env.outbox)for(const c of op.changes)if(c.kind==='transaction'&&!c.deleted&&c.value.recurringId&&c.value.dueDate)localPayment.set(c.value.recurringId+'|'+c.value.dueDate,c.id);
    for(const [id,r] of Object.entries(projected))if(r.kind==='transaction'&&!r.deleted){
      const t=r.value;
      if(t.recurringId&&projected[docId('recurring',t.recurringId)]?.deleted){t.recurringId=null;t.dueDate=null;}
      const preferred=localPayment.get(t.recurringId+'|'+t.dueDate);
      if(preferred&&preferred!==id)projected[id]={...r,deleted:true,value:null};
    }
    return materialize(projected,env.state);
  }
  const api={SETTINGS,MAX_WRITES,stable,equal,docId,payload,flatten,materialize,hasData,overlay,changes,append,acknowledged,equivalent,conflicts,mergeInitial,importGroups,rebaseLocal};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.MMSyncCore=api;
})(typeof window!=='undefined'?window:globalThis);
