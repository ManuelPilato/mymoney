'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../src/core.js');require('../src/intelligence.js');const A=require('../src/advisor.js');
const ref='2026-10-28';M.today=()=>ref;
function fresh(){const s=M.blank();Object.assign(s.settings,{initialized:true,openingDate:'2026-10-01',openingBalanceCents:100000,salaryCents:200000});return s;}
function salary(date='2026-10-30',status='planned'){return{id:'salary',date,type:'income',amountCents:200000,category:'Stipendio',note:'Stipendio',status,includedInOpening:false,countBudget:true,recurringId:null,dueDate:null};}

test('Non-domain instructions and unrecognized questions cannot become transaction drafts',()=>{
  const s=fresh();
  for(const q of ['calcola 2+2','dimmi 3 consigli','posso aumentare il budget a 800 euro','calculate 2+2','tell me 3 tips','scrivi 3 frasi','crea 3 consigli','puoi spiegarmi 3 teoremi','2+2']){
    assert.throws(()=>M.command(q,s,ref),e=>e.code==='unsupported-intent',q);
    const answer=A.interpret(q,s,ref,'it');assert.equal(answer.verdict,'unknown',q);assert.equal(answer.canRecord,false);
  }
  assert.equal(M.command('Imposta budget a 800 euro',s,ref).kind,'setting');
  assert.equal(M.command('Negozio sconosciuto 20 euro',s,ref).items[0].amountCents,2000);
  assert.equal(M.command('Vorrei aggiungere benzina 20 euro',s,ref).items[0].note,'Benzina');
  assert.equal(M.command('I want to record fuel 20 euros',s,ref).items[0].note,'Fuel');
  assert.throws(()=>M.command('Se costasse 80 euro',s,ref),e=>e.code==='unsupported-intent');
  assert.throws(()=>M.command('Ho comprato 2 biglietti da 50 euro ciascuno',s,ref),/totale/);
});

test('A first expense or plan edit never declares an initial balance',()=>{
  const s=M.blank();const p=M.command('Benzina 20 euro',s,ref);
  const next=M.applyCommand(s,p);assert.equal(next.transactions.length,1);assert.equal(next.settings.initialized,false);
  assert.equal(A.interpret('Posso comprare scarpe da 80 euro',next,ref).reasons[0],'missing-balance');
  assert.equal(M.applyCommand(s,M.command('Imposta stipendio a 2000 euro',s,ref)).settings.initialized,false);
});

test('Explicit received salary settles a planned salary once, on the stated date',()=>{
  const s=fresh();s.transactions.push(salary());
  const p=M.command('Ho ricevuto lo stipendio di 2100 euro ieri',s,ref);
  assert.equal(p.kind,'salary');assert.equal(p.existingId,'salary');assert.equal(p.transaction.status,'paid');assert.equal(p.transaction.date,'2026-10-27');
  const next=M.applyCommand(s,p);assert.equal(next.transactions.length,1);assert.equal(M.totals(next,ref).balance,310000);
  const today=M.command('I received my salary of 2200 euros',s,ref);assert.equal(today.transaction.date,ref);assert.equal(today.transaction.status,'paid');
  const alreadyPaid=fresh();alreadyPaid.transactions.push(salary('2026-10-15','paid'));
  const additional=M.command('Ho ricevuto stipendio 500 euro oggi',alreadyPaid,ref);
  assert.equal(additional.existingId,null,'a new receipt must not overwrite an earlier paid salary without a monthly correction');
  assert.equal(M.applyCommand(alreadyPaid,additional).transactions.length,2);
});

test('Salary amount correction alone leaves planned status and due date unchanged',()=>{
  const s=fresh();s.transactions.push(salary());
  const p=M.command('Questo mese stipendio 2100 euro',s,ref);
  assert.equal(p.transaction.status,'planned');assert.equal(p.transaction.date,'2026-10-30');
  assert.equal(M.totals(M.applyCommand(s,p),ref).balance,100000);
});

test('Received salary respects opening balance and rejects an impossible future receipt',()=>{
  const s=fresh();s.settings.openingDate='2026-10-28';s.transactions.push(salary());
  const p=M.command('Ho ricevuto stipendio 2100 euro ieri',s,ref);assert.equal(p.transaction.includedInOpening,true);
  assert.equal(M.totals(M.applyCommand(s,p),ref).balance,100000);
  assert.throws(()=>M.command('Ho ricevuto stipendio 2100 euro domani',s,ref));
  assert.throws(()=>M.command('Non ho ricevuto stipendio 2100 euro',s,ref));
  assert.throws(()=>M.command("I haven't received my salary of 2100 euros",s,ref));
  const paid=salary('2026-10-01','paid');paid.includedInOpening=true;s.transactions=[paid];
  assert.equal(M.command('Questo mese stipendio 2200 euro',s,ref).transaction.includedInOpening,true);
});

test('Batch validator rejects a duplicate occurrence inside a batch and against existing rows',()=>{
  const s=fresh();s.recurring.push({id:'netflix',name:'Netflix',amountCents:1000,months:1,startDate:ref,category:'Abbonamenti',active:true,automatic:false});
  const a=M.quickEntry({name:'Netflix',amount:'10',date:ref},s,ref),b={...a,id:'second'};
  assert.throws(()=>M.validateTransactionBatch([a,b],[],{ref}),/rata/);
  assert.throws(()=>M.validateTransactionBatch([b],[a],{ref}),/rata/);
  assert.throws(()=>M.applyCommand(s,{kind:'transactions',items:[a,b]}),/rata/);
  assert.equal(s.transactions.length,0,'failed proposal is atomic');
  assert.equal(M.validateTransactionBatch([{...a,amountCents:1100}],[a],{ref,replacingIds:[a.id]}),true);
});

test('Ordinary equal expenses on different dates, or deliberately repeated on one date, remain valid',()=>{
  const s=fresh();const a=M.quickEntry({name:'Benzina',amount:'20',date:ref},s,ref);
  const b={...a,id:'next',date:'2026-10-27'},c={...a,id:'again'};
  assert.equal(M.validateTransactionBatch([a,b,c],[],{ref}),true);
  assert.equal(M.applyCommand(s,{kind:'transactions',items:[a,b,c]}).transactions.length,3);
});
