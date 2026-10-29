'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/i18n.js'),'utf8');
function setup(device='it-IT',saved=null,blocked=false){
  const data=new Map(saved?[['mymoney-language-v1',saved]]:[]),events=[];
  const context={navigator:{language:device},Intl,Date,Map,Object,RangeError,
    localStorage:{getItem:key=>{if(blocked)throw Error('blocked');return data.get(key)||null;},setItem:(key,value)=>{if(blocked)throw Error('blocked');data.set(key,value);}},
    addEventListener(){},dispatchEvent:event=>events.push(event),CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}
  };
  vm.runInNewContext(source,context);
  return {I:context.MyMoneyI18n,data,events};
}
const {I,data,events}=setup('en-US');
assert.equal(I.language,'en');assert.equal(I.locale,'en-GB');
assert.equal(I.t('Nuova spesa'),'New expense');
assert.equal(I.category('Spesa'),'Groceries');
assert.equal(I.decimal(125050),'1250.50');
assert.equal(I.money(125050),'€1,250.50');
assert.equal(I.date('2026-10-28',true),'28 Oct 2026');
assert.equal(I.t('Modifica {name}, {amount}',{name:'Coffee',amount:I.money(350)}),'Edit Coffee, €3.50');
assert.equal(I.text('Dai un nome a questo movimento.'),'Give this transaction a name.');
assert.equal(I.text('Importo non valido: budgetCents.'),'Invalid amount: budget.');
assert.equal(I.t('{count} operazioni pronte da inviare appena torna la connessione.',{count:1}),'1 operation ready to send when you reconnect.');
assert.equal(I.t('chiave futura'),'chiave futura');
const state={settings:{budgetCents:10000},recurring:[{id:'r',name:'Netflix',amountCents:1399,active:true}],transactions:[]};
const proposal={kind:'recurring',action:'toggle',isNew:false,title:'Riattiva Netflix',description:'Il piano si aggiornerà.',recurring:{id:'r',name:'Netflix',amountCents:1399,months:1,active:true}};
const untouched=JSON.stringify({state,proposal});
assert.equal(I.proposal(proposal,state).title,'Reactivate Netflix');
assert.equal(I.proposal({kind:'setting',key:'budgetCents',value:20000},state).description,'From €100.00 to €200.00. The plan will be recalculated. Your account balance stays the same.');
assert.equal(JSON.stringify({state,proposal}),untouched);
assert.equal(I.setLanguage('it'),true);assert.equal(data.get('mymoney-language-v1'),'it');
assert.equal(I.t('Nuova spesa'),'Nuova spesa');assert.equal(I.category('Spesa'),'Spesa');assert.equal(I.decimal(125050),'1250,50');
assert.equal(I.text('Give this transaction a name.'),'Dai un nome a questo movimento.');
assert.equal(I.date('2026-10-28',true),'28 ott 2026');
assert.equal(events.length,1);assert.equal(events[0].type,'mm:languagechange');
assert.equal(setup('en-GB','it').I.language,'it');
assert.equal(setup('fr-FR').I.language,'it');
assert.equal(setup('en-GB','invalid').I.language,'en');
const denied=setup('en-GB',null,true);assert.equal(denied.I.language,'en');assert.equal(denied.I.setLanguage('it'),false);assert.equal(denied.I.language,'it');
assert.throws(()=>I.setLanguage('fr'),RangeError);
console.log('i18n: 29 checks passed');
