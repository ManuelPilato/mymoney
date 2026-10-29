'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/core.js');
const V = require('../src/views-model.js');
const tx = (id,date,amountCents=2000,extra={}) => ({id,date,amountCents,note:'Benzina',category:'Trasporti',type:'expense',status:'paid',recurringId:null,dueDate:null,...extra});
const rec = (id,startDate,extra={}) => ({id,name:id,startDate,amountCents:3000,category:'Abbonamenti',months:1,active:true,automatic:false,estimated:false,...extra});
const state = (recurring=[],transactions=[]) => ({settings:{openingDate:'2026-10-01'},recurring,transactions});

test('inclusive combined filters keep repeated fuel purchases and both directions', () => {
  const list=[tx('a','2026-10-01'),tx('b','2026-10-02'),tx('c','2026-10-03'),tx('d','2026-10-02',2000,{type:'income'}),tx('e','2026-10-02',2100)];
  const filtered=V.filterTransactions(list,{query:'benzina',from:'2026-10-01',to:'2026-10-02',category:'Trasporti',minCents:2000,maxCents:2000});
  assert.deepEqual(filtered.map(t=>t.id),['a','b','d']);
  assert.equal(filtered[0],list[0]);assert.equal(list.length,5);
  assert.equal(V.filterTransactions([tx('negative','2026-10-01',-2000)],{minCents:2000,maxCents:2000}).length,1);
});

test('query supports accents and translated categories; status stays explicit', () => {
  const list=[tx('a','2026-10-01',200,{note:'Caffè',category:'Mangiare fuori'}),tx('b','2026-10-02',200,{note:'Caffè',category:'Mangiare fuori',status:'planned'})];
  assert.deepEqual(V.filterTransactions(list,{query:' caffe ',status:'paid'}).map(t=>t.id),['a']);
  assert.equal(V.filterTransactions(list,{query:'dining',categoryLabel:()=> 'Dining out'}).length,2);
});

test('invalid dates, reversed ranges and euro strings are explicit errors', () => {
  for (const [options,code] of [[{from:'2026-02-30'},'invalid-date'],[{from:0},'invalid-date'],[{from:'2026-10-03',to:'2026-10-01'},'reversed-date-range'],[{minCents:3000,maxCents:2000},'reversed-amount-range'],[{minCents:'20,00'},'invalid-amount'],[{maxCents:20.5},'invalid-amount'],[{minCents:-1},'invalid-amount'],[{category:'Unknown'},'invalid-category'],[{status:'future'},'invalid-status']]) {
    assert.ok(V.validateFilters(options).errors.some(e=>e.code===code));
    assert.throws(()=>V.filterTransactions([],options),error=>error.code==='invalid-filters'&&error.errors.some(e=>e.code===code));
  }
  assert.equal(V.validateFilters({minCents:0,maxCents:0,from:'',to:''}).valid,true);
});

test('one date per fixed expense includes distant commitments and excludes paid dates', () => {
  const s=state([rec('insurance','2027-03-16',{months:6,estimated:true,automatic:true}),rec('long','2026-10-05',{months:60})],[tx('paid','2026-10-05',3000,{recurringId:'long',dueDate:'2026-10-05'})]);
  const snapshot=JSON.stringify(s),rows=V.planRows(s,'2026-10-28').recurring;
  assert.equal(rows.length,2);assert.equal(rows[0].nextDate,'2027-03-16');assert.equal(rows[0].state,'upcoming');
  assert.equal(rows[0].automatic,true);assert.equal(rows[0].estimated,true);
  assert.equal(rows[1].nextDate,'2031-10-05');assert.equal(JSON.stringify(s),snapshot);
  assert.equal(V.planRows(state([rec('today','2026-10-28')]),'2026-10-28').recurring[0].state,'today');
});

test('earliest unpaid overdue occurrence stays visible instead of skipping ahead', () => {
  const s=state([rec('rent','2026-08-10')]);s.settings.openingDate='2026-08-01';
  s.transactions.push(tx('august','2026-08-10',3000,{recurringId:'rent',dueDate:'2026-08-10'}));
  const row=V.planRows(s,'2026-10-28').recurring[0];
  assert.equal(row.nextDate,'2026-09-10');assert.equal(row.state,'overdue');assert.equal(row.overdueCount,2);
});

test('linked plan displays its payment date and amount, keeping the original due key', () => {
  const plan=tx('plan','2026-10-30',2800,{status:'planned',recurringId:'netflix',dueDate:'2026-10-27'});
  const s=state([rec('netflix','2026-10-27')],[plan]);
  const result=V.planRows(s,'2026-10-28'),row=result.recurring[0];
  assert.equal(row.nextDate,'2026-10-30');assert.equal(row.dueDate,'2026-10-27');assert.equal(row.amountCents,2800);assert.equal(row.transaction,plan);assert.equal(row.overdue,false);assert.equal(result.planned.length,0);
  s.transactions.push(tx('paid','2026-10-28',2800,{recurringId:'netflix',dueDate:'2026-10-27'}));
  assert.equal(V.planRows(s,'2026-10-28').recurring[0].nextDate,'2026-11-27');
});

test('inactive and missing-date fixed costs remain visible; explicit plans survive pause', () => {
  const s=state([rec('inactive','2026-10-02',{active:false}),rec('unknown',null),rec('paused','2026-10-03',{active:false})],[tx('plan','2026-10-29',2500,{status:'planned',recurringId:'paused',dueDate:'2026-10-03'})]);
  const [inactive,unknown,paused]=V.planRows(s,'2026-10-28').recurring;
  assert.equal(inactive.state,'inactive');assert.equal(inactive.nextDate,null);
  assert.equal(unknown.state,'missing-date');assert.equal(unknown.nextDate,null);
  assert.equal(paused.state,'inactive');assert.equal(paused.nextDate,'2026-10-29');assert.equal(paused.transaction.id,'plan');
});

test('one-off plans stay separate, repeated purchases stay distinct, duplicates are flagged', () => {
  const s=state([rec('rent','2026-10-29')],[tx('gas1','2026-10-29',2000,{status:'planned'}),tx('gas2','2026-10-30',2000,{status:'planned'}),tx('salary','2026-10-31',200000,{status:'planned',type:'income'}),tx('rent1','2026-10-29',3000,{status:'planned',recurringId:'rent',dueDate:'2026-10-29'}),tx('rent2','2026-10-29',3000,{status:'planned',recurringId:'rent',dueDate:'2026-10-29'})]);
  const result=V.planRows(s,'2026-10-28');
  assert.deepEqual(result.planned.map(t=>t.id),['gas1','gas2','salary']);
  assert.equal(result.recurring.length,1);assert.deepEqual(result.recurring[0].issues,['duplicate-planned-occurrence']);
});
