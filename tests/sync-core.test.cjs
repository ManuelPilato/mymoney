'use strict';
const assert=require('node:assert/strict'),M=require('../src/core.js'),C=require('../src/sync-core.js');
let passed=0;function test(name,fn){fn();console.log('PASS '+name);passed++;}
const tx=(id='first',extra={})=>({id,date:'2026-10-27',amountCents:150,type:'expense',category:'Mangiare fuori',note:'Caffè',status:'paid',includedInOpening:false,countBudget:true,recurringId:null,dueDate:null,...extra});
const rec=()=>({id:'rent',name:'Affitto',amountCents:50000,category:'Casa',months:1,startDate:'2026-10-01',active:true,automatic:false});
const server=state=>Object.fromEntries(Object.entries(C.flatten(state)).map(([id,r])=>[id,{...r,schemaVersion:1,version:1,mutationId:'baseline-00000000'}]));
const envFor=state=>({schemaVersion:1,accepted:true,state:M.clone(state),records:server(state),outbox:[],conflict:null});
const commit=(env,next,id='operation-00000001')=>C.append(env,env.state,next,id);
test('round trip keeps money, references, settings and learned rules',()=>{
  const s=M.blank();s.recurring=[rec()];s.transactions=[tx('one',{recurringId:'rent',dueDate:'2026-10-01'})];s.rules=[{phrase:'bar sotto casa',category:'Mangiare fuori'}];s.notes=['Un promemoria'];s.settings.salaryCents=150000;
  const round=C.materialize(server(s),s);assert.deepEqual(round,s);
});
test('each setting has a separate record',()=>{
  const s=M.blank(),env=envFor(s),next=M.clone(s);next.settings.salaryCents=200000;
  const saved=commit(env,next);assert.equal(saved.outbox[0].changes.length,1);assert.equal(saved.outbox[0].changes[0].key,'salaryCents');
});
test('independent transactions merge and no old snapshot overwrites cloud',()=>{
  const s=M.blank(),env=envFor(s),next=M.clone(s);next.transactions.push(tx());const saved=commit(env,next);
  saved.records.transaction_remote={...C.flatten({...s,transactions:[tx('remote')]}).transaction_remote,version:1,mutationId:'remote-operation'};
  const merged=C.materialize(C.overlay(saved.records,saved.outbox),s);assert.deepEqual(merged.transactions.map(t=>t.id).sort(),['first','remote']);assert.deepEqual(C.conflicts(saved.outbox[0],saved.records),[]);
});
test('same entity edit is an explicit conflict',()=>{
  const s=M.blank();s.transactions=[tx()];const env=envFor(s),next=M.clone(s);next.transactions[0].amountCents=200;const saved=commit(env,next);
  saved.records.transaction_first.version=2;saved.records.transaction_first.value.amountCents=300;
  assert.equal(C.conflicts(saved.outbox[0],saved.records).length,1);
});
test('identical settings from concurrent first expenses do not conflict',()=>{
  const s=M.blank(),next=M.clone(s);next.settings.initialized=true;next.transactions=[tx()];
  const env=C.append({state:s,records:{},outbox:[]},s,next,'first-operation');
  const remote=server(next);remote.transaction_first=undefined;delete remote.transaction_first;
  assert.deepEqual(C.conflicts(env.outbox[0],remote),[]);
});
test('delete is a versioned tombstone and initial merge cannot resurrect it',()=>{
  const s=M.blank();s.transactions=[tx()];const env=envFor(s),saved=commit(env,{...s,transactions:[]});
  const c=saved.outbox[0].changes[0];assert.equal(c.deleted,true);assert.equal(c.value,null);
  const remote=C.overlay(saved.records,saved.outbox);assert.equal(C.mergeInitial(s,remote).transactions.length,0);
});
test('linked transaction and parent recurrence are one atomic operation',()=>{
  const s=M.blank();s.recurring=[rec()];const env=envFor(s),next=M.clone(s);next.transactions=[tx('rent-paid',{recurringId:'rent',dueDate:'2026-10-01'})];
  const saved=commit(env,next);assert.deepEqual(saved.outbox[0].changes.map(c=>c.kind).sort(),['recurring','transaction']);
  saved.records.recurring_rent.version++;assert.equal(C.conflicts(saved.outbox[0],saved.records)[0].kind,'recurring');
});
test('recurrence deletion unlinks payments atomically and stays valid',()=>{
  const s=M.blank();s.recurring=[rec()];s.transactions=[tx('rent-paid',{recurringId:'rent',dueDate:'2026-10-01'})];
  const next=M.clone(s);next.recurring=[];next.transactions[0].recurringId=null;next.transactions[0].dueDate=null;
  const saved=commit(envFor(s),next);assert.equal(saved.outbox[0].changes.length,2);assert.doesNotThrow(()=>C.materialize(C.overlay(saved.records,saved.outbox),s));
});
test('outbox survives JSON reload with sequential version bases',()=>{
  const s=M.blank();s.transactions=[tx()];let env=envFor(s),next=M.clone(s);next.transactions[0].amountCents=200;env=commit(env,next);
  next=M.clone(next);next.transactions[0].amountCents=300;env=commit(env,next,'operation-00000002');env=JSON.parse(JSON.stringify(env));
  assert.deepEqual(env.outbox.map(op=>op.changes[0].baseVersion),[1,2]);assert.equal(C.materialize(C.overlay(env.records,env.outbox),s).transactions[0].amountCents,300);
});
test('server acknowledgement is idempotent by mutation and version',()=>{
  const s=M.blank(),next=M.clone(s);next.transactions=[tx()];const env=commit(envFor(s),next),applied=C.overlay(env.records,env.outbox);
  assert.equal(C.acknowledged(env.outbox[0],applied),true);applied.transaction_first.mutationId='different-operation';assert.equal(C.acknowledged(env.outbox[0],applied),false);
});
test('initial migration is idempotent and cloud versions win conflicts',()=>{
  const local=M.blank();local.transactions=[tx()];local.settings.salaryCents=100000;const cloud=M.clone(local);cloud.transactions[0].amountCents=999;cloud.settings.salaryCents=200000;
  const records=server(cloud),merged=C.mergeInitial(local,records),again=C.mergeInitial(merged,records);
  assert.equal(merged.transactions.length,1);assert.equal(merged.transactions[0].amountCents,999);assert.equal(merged.settings.salaryCents,200000);assert.deepEqual(merged,again);
});
test('large initial import splits valid archives and guards parent references',()=>{
  const local=M.blank();local.recurring=[rec()];local.transactions=Array.from({length:500},(_,i)=>tx('entry-'+i));local.transactions[0].recurringId='rent';local.transactions[0].dueDate='2026-10-01';
  const env={schemaVersion:1,accepted:true,state:local,records:{},outbox:[],conflict:null};let id=0;const migrated=C.importGroups(env,local,()=>`operation-${++id}`);let records={};
  assert.ok(migrated.outbox.length>1);
  for(const op of migrated.outbox){assert.ok(op.changes.length<=C.MAX_WRITES);records=C.overlay(records,[op]);assert.doesNotThrow(()=>C.materialize(records,local));}
  assert.equal(C.materialize(records,local).transactions.length,500);
});
test('explicit local resolution keeps unrelated cloud edits',()=>{
  const s=M.blank();s.transactions=[tx()];const next=M.clone(s);next.transactions[0].amountCents=200;const env=commit(envFor(s),next);
  env.records.transaction_first.value.amountCents=300;env.records.transaction_first.version=2;env.records.setting_salaryCents.value=240000;env.records.setting_salaryCents.version=2;
  const resolved=C.rebaseLocal(env);assert.equal(resolved.transactions[0].amountCents,200);assert.equal(resolved.settings.salaryCents,240000);
});
test('local resolution of recurrence deletion preserves concurrent payment unlinked',()=>{
  const s=M.blank();s.recurring=[rec()];const next=M.clone(s);next.recurring=[];const env=commit(envFor(s),next);
  const remote=tx('new-paid',{recurringId:'rent',dueDate:'2026-10-01'});env.records.transaction_new={...C.flatten({...s,transactions:[remote]})['transaction_new-paid'],key:'new-paid'};
  delete env.records.transaction_new;env.records['transaction_new-paid']={...C.flatten({...s,transactions:[remote]})['transaction_new-paid'],version:1,mutationId:'another-device'};
  const resolved=C.rebaseLocal(env);assert.equal(resolved.recurring.length,0);assert.equal(resolved.transactions[0].recurringId,null);
});
test('oversized destructive operation is rejected before writing data',()=>{
  const s=M.blank();s.transactions=Array.from({length:401},(_,i)=>tx('entry-'+i));const env=envFor(s);assert.throws(()=>commit(env,{...s,transactions:[]}),/troppi dati/);assert.equal(env.state.transactions.length,401);assert.equal(env.outbox.length,0);
});
test('unsupported oversized notes are rejected instead of truncated',()=>{
  const s=M.blank();s.notes=Array.from({length:21},()=> 'nota');assert.throws(()=>C.flatten(s),/20 note/);assert.equal(s.notes.length,21);
});
console.log(`${passed} sync model tests passed.`);
