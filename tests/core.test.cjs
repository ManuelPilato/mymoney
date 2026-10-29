/* Regression tests for dates, merchant context, integer money, and opening balances. */
'use strict';
const assert=require('node:assert/strict');
const M=require('../src/core.js'),ref='2026-10-27';let tests=0;
function test(name,fn){try{fn();tests++;console.log('PASS '+name);}catch(e){console.error('FAIL '+name);throw e;}}
const parse=(s,date=ref)=>M.parseEntry(s,date);
const examples=[
 ['50 euro domani tavolo amazon',5000,'2026-10-28','Casa','planned'],
 ['cinquanta euro domani tavolo Amazon',5000,'2026-10-28','Casa','planned'],
 ['ieri 35 euro ho fatto il pieno',3500,'2026-10-26','Trasporti','paid'],
 ['38,50 euro ieri al distributore',3850,'2026-10-26','Trasporti','paid'],
 ['18 euro aperitivo venerdì',1800,'2026-10-30','Mangiare fuori','planned'],
 ['12 euro al bar oggi',1200,ref,'Mangiare fuori','paid'],
 ['22 euro e cinquanta al bar',2250,ref,'Mangiare fuori','paid'],
 ['ventidue euro e cinquanta al bar',2250,ref,'Mangiare fuori','paid'],
 ['un euro al bar',100,ref,'Mangiare fuori','paid'],
 ['150 euro Ryanair dopodomani',15000,'2026-10-29','Viaggi','planned'],
 ['50 euro il 7 novembre 2026 tavolo',5000,'2026-11-07','Casa','planned'],
 ['il 07/11/2026 50 euro tavolo',5000,'2026-11-07','Casa','planned'],
 ['50 euro il 7/11/26 tavolo',5000,'2026-11-07','Casa','planned'],
 ['50 euro 2026-11-07 tavolo',5000,'2026-11-07','Casa','planned'],
 ['ho speso 24 euro sabato scorso Conad',2400,'2026-10-24','Spesa','paid'],
 ['50 euro tra due giorni farmacia',5000,'2026-10-29','Salute','planned'],
 ['50 euro tra 2 giorni farmacia',5000,'2026-10-29','Salute','planned'],
 ['50 euro fra una settimana farmacia',5000,'2026-11-03','Salute','planned'],
 ['50 euro tra un mese farmacia',5000,'2026-11-27','Salute','planned'],
 ['50 euro due giorni fa farmacia',5000,'2026-10-25','Salute','paid'],
 ['50 euro l’altro ieri farmacia',5000,'2026-10-25','Salute','paid'],
 ['50 euro il 5 tavolo',5000,'2026-11-05','Casa','planned'],
 ['50 euro fine mese tavolo',5000,'2026-10-31','Casa','planned'],
 ['1.200,50 euro divano',120050,ref,'Casa','paid'],
 ['1200.50 euro divano',120050,ref,'Casa','paid'],
 ['1 200,50 euro divano',120050,ref,'Casa','paid'],
 ['€50 tavolo',5000,ref,'Casa','paid'],
 ['50 tavolo amazon',5000,ref,'Casa','paid'],
 ['domani 50 tavolo amazon',5000,'2026-10-28','Casa','planned'],
 ['8,90 cornetto e cappuccino',890,ref,'Mangiare fuori','paid'],
 ['38 euro latte e pane al Lidl',3800,ref,'Spesa','paid'],
 ['12 euro Tachipirina',1200,ref,'Salute','paid'],
 ['20 euro supercharger',2000,ref,'Trasporti','paid'],
 ['20 euro ricarica Tesla',2000,ref,'Trasporti','paid'],
 ['10 euro wifi Tesla',1000,ref,'Abbonamenti','paid'],
 ['100 euro fondo pensione privato',10000,ref,'Pensione','paid'],
 ['40 euro palestra',4000,ref,'Sport','paid'],
 ['10 euro ricarica Vodafone',1000,ref,'Utenze','paid'],
 ['18 euro ho preso una pizza',1800,ref,'Mangiare fuori','paid'],
 ['100 euro scarpe Amazon',10000,ref,'Shopping','paid'],
 ['50 euro Amazon',5000,ref,'Shopping','paid'],
 ['22 euro PayPal rata 1/3 biglietto aereo',2200,ref,'Viaggi','paid'],
 ['500 euro devo pagare il divano',50000,ref,'Casa','planned'],
 ['2000 euro stipendio',200000,ref,'Stipendio','paid']
];
for(const [text,amount,date,category,status] of examples)test(text,()=>{const p=parse(text);assert.equal(p.amountCents,amount);assert.equal(p.date,date);assert.equal(p.category,category);assert.equal(p.status,status);});
test('tavolo is not volo',()=>assert.notEqual(M.classify('tavolo').category,'Viaggi'));
test('Barcellona is not bar',()=>assert.notEqual(M.classify('Barcellona').category,'Mangiare fuori'));
test('unknown merchant does not fabricate a category',()=>assert.equal(parse('50 euro a Marta').category,''));
test('invalid February date is unresolved',()=>assert.equal(parse('50 euro 31/02/2027 tavolo').date,null));
test('leap day rejected in non-leap year',()=>assert.equal(parse('50 euro 29/02/2027 tavolo').date,null));
test('leap day accepted in leap year',()=>assert.equal(parse('50 euro 29/02/2028 tavolo').date,'2028-02-29'));
test('conflicting dates are unresolved',()=>assert.equal(parse('oggi 50 euro volo domani').date,null));
test('vague dates require clarification',()=>assert.equal(parse('50 euro settimana prossima tavolo').date,null));
test('year boundary',()=>assert.equal(parse('50 euro domani tavolo','2026-12-31').date,'2027-01-01'));
test('month clamp',()=>assert.equal(parse('50 euro fra un mese tavolo','2027-01-31').date,'2027-02-28'));
test('invalid money is not partially parsed',()=>assert.equal(parse('50,999 euro tavolo').amountCents,null));
test('negative amount requires explicit correction',()=>assert.equal(parse('-50 euro tavolo').amountCents,null));
test('multiple unexplained amounts are not merged',()=>assert.equal(parse('50 euro tavolo 20 euro sedia').amountCents,null));
test('multiple no-currency values require clarification',()=>assert.equal(parse('50 tavolo 20 sedia').amountCents,null));
test('semicolon creates independent drafts',()=>assert.equal(M.interpret('10 euro oggi pranzo; 50 euro domani tavolo',ref).length,2));
test('conjunction separates explicit prices',()=>assert.equal(M.interpret('10 euro pranzo e 20 euro cena',ref).length,2));
test('spoken cents are not split',()=>assert.equal(M.interpret('ventidue euro e cinquanta al bar',ref).length,1));
test('user preferences stay local and win',()=>assert.equal(M.parseEntry('15 euro da Rosi',ref,[{phrase:'da rosi',category:'Mangiare fuori'}]).category,'Mangiare fuori'));
test('cents precision',()=>assert.equal(M.cents('0,29'),29));
test('thousands',()=>assert.equal(M.cents('1.234.567,89'),123456789));
test('English grouped amount with explicit decimals',()=>assert.equal(M.cents('1,234.56'),123456));
test('Ambiguous comma-only amount still requires correction',()=>assert.throws(()=>M.cents('1,234')));
const namedExamples=[
 ['ieri ho fatto 18 euro di benzina','Benzina',1800,'2026-10-26'],
 ['Ho speso diciotto euro di benzina ieri','Benzina',1800,'2026-10-26'],
 ['benzina diciotto euro ieri','Benzina',1800,'2026-10-26'],
 ['Ieri ho fatto il pieno di 38 euro da Q8','Pieno da Q8',3800,'2026-10-26'],
 ['Ho comprato un iPhone 15 a 850 euro con la carta','iPhone 15',85000,ref],
 ['Oggi ho speso 12 euro al bar con carta di credito','Bar',1200,ref],
 ['Ieri sera ho messo 18 euro di benzina pagati con la carta','Benzina',1800,'2026-10-26'],
 ['18 euro il 7 novembre 2026 per il bar','Bar',1800,'2026-11-07'],
 ['35 euro caffè e cornetti via PayPal','Caffè e cornetti',3500,ref],
 ['20 euro da 7-Eleven','7-Eleven',2000,ref],
 ['22 euro PayPal rata 1/3 biglietto aereo','Biglietto aereo',2200,ref],
 ['20 euro Model-3','Model-3',2000,ref],
 ['50 euro The North Face','The North Face',5000,ref],
 ['yesterday I spent 18 euros on petrol','Petrol',1800,'2026-10-26'],
 ['Yesterday evening I spent 18 euros on petrol paid in cash','Petrol',1800,'2026-10-26'],
 ['Yesterday I spent twenty-two euros and fifty cents on coffee','Coffee',2250,'2026-10-26'],
 ['Yesterday I spent twenty two euros on coffee','Coffee',2200,'2026-10-26'],
 ['I bought an iPhone 15 for 850 euros by credit card','iPhone 15',85000,ref],
 ['I spent 18 euros on petrol last Friday','Petrol',1800,'2026-10-23'],
 ['I will pay 18 euros for petrol tomorrow','Petrol',1800,'2026-10-28'],
 ['On November 7, 2026 I will pay 20 euros for parking','Parking',2000,'2026-11-07'],
 ['I bought a table for 1,250.50 euros yesterday','Table',125050,'2026-10-26'],
 ['Coffee 5 euros two days ago','Coffee',500,'2026-10-25']
];
for(const [text,name,amount,date] of namedExamples)test('Concise name: '+text,()=>{const p=parse(text);assert.equal(p.note,name);assert.equal(p.amountCents,amount);assert.equal(p.date,date);});
test('English invalid money stays unresolved',()=>{const p=parse('Yesterday I spent 18.999 euros on petrol');assert.equal(p.amountCents,null);assert.ok(p.warnings.length);});
test('Currency before negative amount stays unresolved',()=>assert.equal(parse('€-18 petrol').amountCents,null));
test('Spoken negative amount stays unresolved',()=>assert.equal(parse('minus eighteen euros on petrol').amountCents,null));
test('English multiple prices are not selected silently',()=>assert.equal(parse('I spent 18 euros on petrol and 20 euros on groceries').amountCents,null));
test('English conflicting dates stay unresolved',()=>assert.equal(parse('Yesterday I paid 18 euros for tomorrow petrol').date,null));
test('English impossible calendar date stays unresolved',()=>assert.equal(parse('50 euros on February 30, 2027 for coffee').date,null));
test('No subject is an editable unresolved name',()=>{const p=parse('ieri ho speso 18 euro');assert.equal(p.note,'');assert.ok(p.warnings.includes('Dai un nome a questo movimento.'));});
test('malformed backup rejected',()=>assert.throws(()=>M.validate({schemaVersion:2})));
// Entirely synthetic fixture: public tests never depend on a personal backup.
const fixture=M.blank();
Object.assign(fixture.settings,{initialized:true,openingDate:ref,openingBalanceCents:250000,salaryCents:180000,budgetCents:120000,savingsGoalCents:20000,payday:27});
fixture.transactions=[
 {id:'demo-income',date:ref,type:'income',amountCents:180000,category:'Stipendio',note:'Demo salary',status:'paid',includedInOpening:true,countBudget:false,recurringId:null,dueDate:null},
 {id:'demo-ticket',date:ref,type:'expense',amountCents:3600,category:'Viaggi',note:'Demo train ticket',status:'paid',includedInOpening:true,countBudget:true,recurringId:null,dueDate:null}
];
const recurring=(id,name,category,amountCents,months,startDate,active=true)=>({id,name,category,amountCents,months,startDate,active,automatic:true});
fixture.recurring=[
 recurring('demo-rent','Demo rent','Casa',48000,1,'2026-11-02'),
 recurring('demo-utilities','Demo utilities','Utenze',7000,2,'2026-11-08'),
 recurring('demo-insurance','Demo insurance','Assicurazioni',27000,6,'2027-04-12'),
 recurring('demo-subscription','Demo subscription','Abbonamenti',1400,1,'2026-11-05'),
 recurring('demo-paused','Demo paused class','Sport',2500,1,'2026-11-10',false)
];
fixture.notes=['Synthetic test fixture, not a real financial archive.'];
const seed=M.validate(fixture);
test('opening balance includes salary and ticket exactly once',()=>assert.equal(M.totals(seed,ref).balance,250000));
test('all fixed commitments count, even when due in six months',()=>assert.equal(M.totals(seed,ref).fixedEquivalent,57400));
test('ticket consumes budget once, not balance twice',()=>assert.equal(M.totals(seed,ref).available,59000));
test('savings unknown is not falsely zero',()=>assert.equal(seed.settings.separateSavingsCents,null));
test('planned expense does not change balance',()=>{const s=M.clone(seed),p=parse('50 euro domani tavolo Amazon');s.transactions.push({...p,recurringId:null,dueDate:null});assert.equal(M.totals(s,ref).balance,250000);assert.equal(M.totals(s,ref).available,54000);});
test('paid expense changes balance exactly once',()=>{const s=M.clone(seed),p=parse('50 euro oggi tavolo Amazon');s.transactions.push(p);assert.equal(M.totals(s,ref).balance,245000);assert.equal(M.totals(s,ref).available,54000);});
test('planned item stays planned on its due date',()=>{const s=M.clone(seed),p=parse('50 euro domani tavolo Amazon');s.transactions.push(p);assert.equal(M.totals(s,'2026-10-28').balance,250000);assert.equal(s.transactions[2].status,'planned');});
test('linked fixed payment is not counted again in the equivalent budget',()=>{const s=M.clone(seed),p={...parse('480 euro affitto','2026-11-02'),recurringId:'demo-rent',dueDate:'2026-11-02'};s.transactions.push(p);assert.equal(M.totals(s,'2026-11-02').balance,202000);assert.equal(M.totals(s,'2026-11-02').available,59000);});
test('utilities due every two months from November',()=>assert.deepEqual(M.occurrences(seed.recurring[1],'2026-10-27','2027-04-01'),['2026-11-08','2027-01-08','2027-03-08']));
test('insurance due every six months',()=>assert.deepEqual(M.occurrences(seed.recurring[2],'2026-10-27','2027-12-31'),['2027-04-12','2027-10-12']));
test('inactive class omitted',()=>assert.deepEqual(M.occurrences(seed.recurring[4],ref,'2027-12-31'),[]));
test('public fixture survives JSON backup round-trip',()=>assert.deepEqual(M.validate(JSON.parse(JSON.stringify(seed))),seed));
test('duplicate IDs rejected',()=>{const s=M.clone(seed);s.transactions.push(M.clone(s.transactions[0]));assert.throws(()=>M.validate(s));});
test('malformed money rejected in import',()=>{const s=M.clone(seed);s.transactions[0].amountCents=NaN;assert.throws(()=>M.validate(s));});
test('cycles start at payday',()=>assert.deepEqual(M.cycle('2026-11-26',27),{start:'2026-10-27',end:'2026-11-27'}));
test('legacy import keeps supplied initial context',()=>{const old={transactions:[{id:'old',date:ref,type:'expense',amount:35,category:'Benzina',note:'Pieno',included:false}],recurring:[]};const s=M.migrate(old,ref,seed.settings);assert.equal(s.transactions[0].category,'Trasporti');assert.equal(M.totals(s,ref).balance,246500);});
test('legacy import without initial context requests setup',()=>assert.equal(M.migrate({transactions:[],recurring:[]},ref).settings.initialized,false));
console.log(`\n${tests} tests passed.`);
