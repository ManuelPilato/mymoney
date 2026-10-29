'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/core.js');
const A = require('../src/advisor.js');

function state(balance = 30000, payday = 1) {
  const s = M.blank();
  Object.assign(s.settings, {initialized:true, openingDate:'2026-08-01', openingBalanceCents:balance, salaryCents:180000, payday});
  return s;
}
function expense(id, date, amountCents, extra = {}) {
  return {id,date,amountCents,type:'expense',category:'Spesa',note:'Spesa',status:'paid',includedInOpening:false,countBudget:true,recurringId:null,dueDate:null,...extra};
}
function history(s, ref, daily = 500) {
  const start = M.shiftMonths(ref, -1);
  for (let d = start; d < ref; d = M.shiftDays(d, 1)) {
    s.transactions.push(expense('history-' + d, d, daily));
    s.settings.openingBalanceCents += daily;
  }
  return s;
}
const ask = (s, ref = '2026-10-27', text = 'Posso comprare scarpe da 180 euro?', language = 'it') => A.interpret(text,s,ref,language);

test('Questions are separate from paid expenses and never mutate state', () => {
  const s = history(state(), '2026-10-27'), original = JSON.stringify(s);
  assert.equal(A.interpret('Ieri ho comprato scarpe da 180 euro',s,'2026-10-27'), null);
  assert.equal(A.interpret('Cena fuori 18 euro',s,'2026-10-27'), null);
  const answer = ask(s);
  assert.equal(answer.kind, 'affordability'); assert.equal(answer.canRecord, false);
  assert.equal(JSON.stringify(s), original);
  assert.equal(answer.item, 'Scarpe'); assert.equal(answer.amountCents, 18000);
});

test('Unsupported questions and contextual follow-ups never fall back to an expense', () => {
  const s = history(state(), '2026-10-27');
  for (const q of ['E se costassero 80 euro?', 'E se costassero 80 euro', 'What if they cost 80 euros?', 'Quanto ho speso ieri?', 'Ho speso 80 euro?', 'Secondo te 80 euro sono tanti']) {
    const result = ask(s, '2026-10-27', q);
    assert.equal(result.kind, 'affordability', q); assert.equal(result.verdict, 'unknown', q);
    assert.equal(result.canRecord, false, q);
  }
  assert.equal(ask(s, '2026-10-27', 'Ho speso 80 euro per una visita perché stavo male'), null);
});

test('Spending limits use the same commitments and history, without creating a purchase', () => {
  const s = history(state(30000), '2026-10-27');
  const today = ask(s, '2026-10-27', 'Quanto posso spendere oggi?');
  assert.equal(today.mode, 'spending-limit'); assert.equal(today.dailyLimitCents, 6000);
  assert.equal(today.spendingLimitCents, 27500); assert.equal(today.canRecord, false);
  assert.equal(today.dataQuality.level, 'ready'); assert.equal(today.amountCents, 0);
  const period = ask(s, '2026-10-27', 'How much can I spend until payday?', 'en');
  assert.equal(period.spendingLimitCents, 27500); assert.match(period.title, /extra headroom/);
  s.settings.openingDate='2026-10-26';
  const limited = ask(s, '2026-10-27', 'Quanto posso spendere?');
  assert.equal(limited.verdict,'caution');assert.equal(limited.dataQuality.level,'limited');
});

test('Scoped price follow-ups recalculate using the latest state and expire with context', () => {
  const s = history(state(), '2026-10-27');
  const previousAnswer = ask(s);
  const result = A.interpret('E se costassero 80 euro?',s,'2026-10-27','it',{previousAnswer});
  assert.equal(result.amountCents,8000);assert.equal(result.item,'Scarpe');assert.equal(result.remainingCents,22000);
  assert.match(result.context.question,/Scarpe/);assert.equal(result.canRecord,false);
  s.settings.openingBalanceCents += 5000;
  const updated = A.interpret('What if they cost 80 euros?',s,'2026-10-27','en',{previousAnswer});
  assert.equal(updated.remainingCents,27000);
  assert.equal(A.interpret('E se costassero 80 euro?',s,'2026-10-28','it',{previousAnswer}).verdict,'unknown');
  assert.equal(A.interpret('E se costassero 80 euro o 180?',s,'2026-10-27','it',{previousAnswer}).verdict,'unknown');
});

test('Unknown opening balance is never inferred from an initialized legacy zero', () => {
  const s=state(0);s.transactions.push(expense('salary','2026-10-27',200000,{type:'income',category:'Stipendio'}));
  const uncertain=ask(s);
  assert.equal(uncertain.verdict,'unknown');assert.equal(uncertain.action.type,'open-preferences');assert.equal(uncertain.action.field,'opening');
  assert.equal(uncertain.dataQuality.level,'missing');
  const confirmed=A.interpret('Posso comprare scarpe da 180 euro',s,'2026-10-27','it',{balanceConfirmed:true});
  assert.equal(confirmed.model.balanceCents,200000);assert.notEqual(confirmed.verdict,'unknown');
});

test('Instalments and unit prices require the total rather than optimistic single-unit approval', () => {
  for(const q of ['Posso comprare un telefono in 3 rate da 50 euro','Posso comprare 2 biglietti da 50 euro ciascuno','Can I buy two tickets for 50 euros each?','Posso comprare due biglietti da 50 euro']) {
    const answer=ask(history(state(300000),'2026-10-27'),'2026-10-27',q);
    assert.equal(answer.verdict,'unknown',q);assert.equal(answer.action.type,'rephrase');
  }
  const total=ask(history(state(300000),'2026-10-27'),'2026-10-27','Posso spendere 100 euro in biglietti');
  assert.equal(total.amountCents,10000);assert.equal(total.verdict,'yes');
});

test('Same cash and price: five days left are affordable, a full month is tight', () => {
  const late = ask(history(state(), '2026-10-27'));
  const early = ask(history(state(), '2026-10-01'), '2026-10-01');
  assert.equal(late.daysRemaining, 5); assert.equal(late.verdict, 'yes');
  assert.equal(late.remainingCents, 12000); assert.equal(late.remainingDailyCents, 2400);
  assert.equal(early.daysRemaining, 31); assert.equal(early.verdict, 'caution');
  assert.ok(early.reasons.includes('daily-spending-shortfall'));
});

test('Payday on the 27th means another full cycle, not just October remaining', () => {
  const answer = ask(history(state(30000, 27), '2026-10-27'));
  assert.equal(answer.horizonEnd, '2026-11-27'); assert.equal(answer.daysRemaining, 31);
  assert.equal(answer.verdict, 'caution');
});

test('Italian and English purchase questions preserve item and product digits', () => {
  const s = history(state(300000), '2026-10-27');
  for (const [question, name] of [
    ['Posso permettermi queste scarpe da 180 euro?', 'Scarpe'],
    ['Mi posso permettere queste scarpe da 180 euro?', 'Scarpe'],
    ['Mi conviene comprare scarpe da 180 euro', 'Scarpe'],
    ['Riesco a permettermi scarpe da 180 euro', 'Scarpe'],
    ['Vorrei comprare un paio di scarpe da 180 euro', 'Scarpe'],
    ['Can I afford an iPhone 17 for 180 euros?', 'iPhone 17'],
    ['I would like to buy shoes for one hundred and eighty euros', 'Shoes'],
    ['Mi piacerebbe acquistare un divano da 180 euro', 'Divano']
  ]) {
    const answer = ask(s, '2026-10-27', question, 'en');
    assert.equal(answer.amountCents, 18000, question); assert.equal(answer.item, name, question);
    assert.match(answer.title, /Yes/); assert.match(answer.explanation, /days/);
  }
});

test('Missing, negative, multiple prices and incomplete setup cannot get approval', () => {
  for (const q of ['Posso comprare scarpe?', 'Can I afford shoes for -180 euros?', 'Posso comprare scarpe da 180 euro e giacca da 300 euro?',
    'Posso comprare un iPhone 17', 'Can I afford the iPhone 17', 'Posso comprare un iPhone17',
    'Posso comprare scarpe per 80 euro o 180', 'Can I afford shoes for 80 euros or 180',
    'Posso comprare scarpe per 80 euro oppure centottanta', 'Can I afford shoes for 80 euros or one hundred and eighty']) {
    assert.equal(ask(state(), '2026-10-27', q).verdict, 'unknown');
  }
  assert.equal(ask(M.blank()).verdict, 'unknown');
});

test('Explicit price context remains valid without currency and model numbers remain names', () => {
  const s = history(state(300000), '2026-10-27');
  for (const q of ['Posso comprare scarpe da 180', 'Can I afford shoes for 180', 'Can I afford an iPhone 17 for 180 euros', 'Posso comprare un iPhone17 per 180 euro']) {
    const answer = ask(s, '2026-10-27', q);
    assert.equal(answer.amountCents, 18000, q); assert.equal(answer.verdict, 'yes', q);
  }
});

test('Insufficient history is conditional even with a large balance', () => {
  const s = state(900000); s.settings.openingDate = '2026-10-25';
  const answer = ask(s);
  assert.equal(answer.verdict, 'caution'); assert.ok(answer.reasons.includes('limited-history'));
  assert.equal(answer.model.completeHistory, false); assert.equal(answer.model.dailyBaselineCents, 0);
});

test('Known insufficient cash or budget gives a concrete shortfall', () => {
  const cash = ask(history(state(15000), '2026-10-27'));
  assert.equal(cash.verdict, 'no'); assert.equal(cash.model.cashRemainingCents, -3000);
  const s = history(state(300000), '2026-10-27'); s.settings.budgetCents = 10000;
  const budget = ask(s);
  assert.equal(budget.verdict, 'no'); assert.ok(budget.reasons.includes('budget-shortfall'));
  assert.ok(budget.model.cashRemainingCents > 0);
});

test('A future variable salary changes the date but never credits future money', () => {
  const s = history(state(30000, 27), '2026-10-28');
  s.transactions.push(expense('salary', '2026-11-05', 255000, {type:'income',category:'Stipendio',note:'Stipendio novembre',status:'planned'}));
  s.transactions.push(expense('bonus', '2026-10-30', 100000, {type:'income',category:'Stipendio',note:'Bonus',status:'planned'}));
  const answer = ask(s, '2026-10-28');
  assert.equal(answer.horizonEnd, '2026-11-05'); assert.equal(answer.daysRemaining, 8);
  assert.equal(answer.model.expectedSalaryCents, 255000);
  assert.equal(answer.model.balanceCents, 30000); assert.equal(answer.model.futureIncomeIncludedCents, 0);
});

test('Recurring dates, linked payments and planned amounts are counted once', () => {
  const s = history(state(100000), '2026-10-27');
  s.settings.openingDate = '2026-09-01';
  s.recurring.push({id:'rent',name:'Affitto',amountCents:50000,months:1,startDate:'2026-09-28',active:true});
  s.transactions.push(expense('september-rent','2026-09-28',50000,{recurringId:'rent',dueDate:'2026-09-28'}));
  s.settings.openingBalanceCents += 50000;
  s.transactions.push(expense('october-rent','2026-10-28',45000,{status:'planned',recurringId:'rent',dueDate:'2026-10-28'}));
  let answer = ask(s);
  assert.equal(answer.model.committedCents, 45000); assert.equal(answer.model.obligations.length, 1);
  assert.equal(answer.model.historyCents, 15000, 'fixed payments are absent from everyday spending');
  const payment = s.transactions.find(t => t.id === 'october-rent');
  payment.status = 'paid'; payment.date = '2026-10-27';
  answer = ask(s);
  assert.equal(answer.model.committedCents, 0); assert.equal(answer.model.balanceCents, 55000);
});

test('Overdue commitments remain reserved; a stale linked plan does not duplicate payment', () => {
  const s = history(state(100000), '2026-10-27');
  s.recurring.push({id:'bill',name:'Bolletta',amountCents:8000,months:1,startDate:'2026-10-20',active:true});
  let answer = ask(s);
  assert.equal(answer.model.overdueCents, 8000);
  s.transactions.push(expense('paid-bill','2026-10-20',8000,{recurringId:'bill',dueDate:'2026-10-20'}));
  s.transactions.push(expense('old-plan','2026-10-20',8000,{status:'planned',recurringId:'bill',dueDate:'2026-10-20'}));
  answer = ask(s);
  assert.equal(answer.model.committedCents, 0); assert.equal(answer.model.overdueCents, 0);
});

test('Future variable plans are not counted twice in everyday spending forecast', () => {
  const s = history(state(30000), '2026-10-27');
  s.transactions.push(expense('groceries','2026-10-28',2000,{status:'planned'}));
  const answer = ask(s);
  assert.equal(answer.model.committedCents, 2000);
  assert.equal(answer.model.forecastCents, 500); // 5 × €5 historical spending, less €20 already planned.
  assert.equal(answer.remainingCents, 10000); assert.equal(answer.verdict, 'yes');
});

test('Savings are protected and separate funds are not silently spent', () => {
  const s = history(state(30000), '2026-10-27');
  Object.assign(s.settings, {savingsGoalCents:15000,separateSavingsCents:2000000});
  const answer = ask(s);
  assert.equal(answer.verdict, 'no'); assert.equal(answer.model.cashRemainingCents, -3000);
  assert.equal(answer.model.separateSavingsUsedCents, 0);
});

test('Opening-included transactions and future paid records do not inflate current cash', () => {
  const s = history(state(), '2026-10-27');
  s.transactions.push(expense('old-income','2026-08-01',500000,{type:'income',includedInOpening:true}));
  s.transactions.push(expense('future-income','2026-11-01',500000,{type:'income'}));
  assert.equal(ask(s).model.balanceCents, 30000);
});

test('Unsupported instalments, future-cycle and past purchases stay explicit', () => {
  const s = history(state(), '2026-10-27');
  for (const q of ['Posso comprare un telefono a rate da 40 euro al mese?', 'Can I afford shoes for 180 euros on 5 November 2026?', 'Posso comprare scarpe da 180 euro ieri?', 'Can I afford shoes for 180 dollars?']) {
    assert.equal(ask(s, '2026-10-27', q).verdict, 'unknown', q);
  }
});

test('DST does not alter remaining day count and no income date means a conditional result', () => {
  const s = history(state(), '2026-10-24');
  assert.equal(ask(s, '2026-10-24').daysRemaining, 8);
  s.settings.salaryCents = 0;
  const answer = ask(s,'2026-10-24');
  assert.equal(answer.verdict, 'caution'); assert.equal(answer.model.horizonSource, 'calendar-month');
});
