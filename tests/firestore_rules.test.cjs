/* Run only against the local Firestore emulator; no credentials or cloud writes. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const host = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8088';
assert.match(host, /^(127\.0\.0\.1|localhost):\d+$/, 'Rules tests must stay on localhost.');
const project = 'demo-mymoney';
const base = `http://${host}/v1/projects/${project}/databases/(default)/documents`;
const path = (uid, id) => `projects/${project}/databases/(default)/documents/users/${uid}/records/${id}`;
const uid = 'rules-alice';
let count = 0;

function token(user, provider = 'google.com') {
  const now = Math.floor(Date.now() / 1000);
  const b64 = data => Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${b64({alg:'none',typ:'JWT'})}.${b64({sub:user,user_id:user,aud:project,
    iss:`https://securetoken.google.com/${project}`,iat:now,exp:now+3600,auth_time:now,
    email:`${user}@example.test`,email_verified:true,
    firebase:{sign_in_provider:provider,identities:{[provider]:[user]}}})}.`;
}
const alice = token(uid), bob = token('rules-bob'), anonymousProvider = token(uid, 'anonymous');
function encode(v) {
  if (v === null) return {nullValue:null};
  if (typeof v === 'boolean') return {booleanValue:v};
  if (typeof v === 'string') return {stringValue:v};
  if (typeof v === 'number') return Number.isInteger(v) ? {integerValue:String(v)} : {doubleValue:v};
  if (Array.isArray(v)) return {arrayValue:{values:v.map(encode)}};
  return {mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}};
}
function record(kind, key, value, version = 1, deleted = false) {
  return {schemaVersion:1,kind,key,value,deleted,version,mutationId:'11111111-2222-4333-8444-555555555555'};
}
function write(id, value, user = uid, timestamp = true) {
  const update = {name:path(user,id),fields:encode(value).mapValue.fields};
  if (!timestamp) update.fields.updatedAt = {timestampValue:'2020-01-01T00:00:00Z'};
  return {update,...(timestamp ? {updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]} : {})};
}
async function request(suffix, method = 'GET', body, auth = alice) {
  const res = await fetch(base + suffix, {method,headers:{'Content-Type':'application/json',
    ...(auth ? {Authorization:`Bearer ${auth}`} : {})},...(body ? {body:JSON.stringify(body)} : {})});
  return {status:res.status,body:await res.json()};
}
const commit = (writes, auth = alice) => request(':commit','POST',{writes},auth);
async function allowed(result) { const r = await result; assert.equal(r.status,200,JSON.stringify(r.body)); return r.body; }
async function denied(result) { const r = await result; assert.equal(r.status,403,JSON.stringify(r.body)); }
async function test(name, fn) { await fn(); count++; console.log('PASS',name); }
const tx = {id:'expense',date:'2026-10-27',type:'expense',amountCents:150,category:'Mangiare fuori',
  note:'Caffè',status:'paid',includedInOpening:false,countBudget:true,recurringId:null,dueDate:null};

(async()=>{
  const rules = fs.readFileSync(nodePath.join(__dirname,'../firebase/firestore.rules'),'utf8');
  const compiled = await fetch(`http://${host}/emulator/v1/projects/${project}:securityRules`,{
    method:'PUT',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({rules:{files:[{name:'firestore.rules',content:rules}]}})
  });
  assert.equal(compiled.status,200,await compiled.text());
  await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`,{method:'DELETE'});
  await test('Google owner creates and reads a typed expense with a server timestamp',async()=>{
    await allowed(commit([write('transaction_expense',record('transaction','expense',tx))]));
    const doc = await allowed(request(`/users/${uid}/records/transaction_expense`));
    assert.equal(doc.fields.version.integerValue,'1'); assert.ok(doc.fields.updatedAt.timestampValue);
    await allowed(request(`/users/${uid}/records`));
  });
  await test('Signed-out clients cannot read or write an archive',async()=>{
    await denied(request(`/users/${uid}/records/transaction_expense`,'GET',null,null));
    await denied(commit([write('setting_payday',record('setting','payday',27))],null));
  });
  await test('A second account cannot read, query or write the owner archive',async()=>{
    await denied(request(`/users/${uid}/records/transaction_expense`,'GET',null,bob));
    await denied(request(`/users/${uid}/records`,'GET',null,bob));
    await denied(commit([write('setting_payday',record('setting','payday',27))],bob));
  });
  await test('An anonymous-provider token cannot impersonate an enabled Google owner',async()=>{
    await denied(request(`/users/${uid}/records`,'GET',null,anonymousProvider));
    await denied(commit([write('setting_payday',record('setting','payday',27))],anonymousProvider));
  });
  await test('Only expected private record paths are accessible',async()=>{
    await denied(request('/users')); await denied(request(`/users/${uid}`));
    await denied(commit([{update:{name:`projects/${project}/databases/(default)/documents/public/leak`,fields:{value:encode('no')}}}]));
  });
  await test('Settings, recurring payments, learned categories and notes accept valid payloads',async()=>{
    const recurring = {id:'rent',name:'Affitto',amountCents:50000,months:1,startDate:'2026-11-01',category:'Casa',active:true,automatic:false,estimated:false};
    await allowed(commit([
      write('setting_payday',record('setting','payday',27)),
      write('setting_separateSavingsCents',record('setting','separateSavingsCents',null)),
      write('recurring_rent',record('recurring','rent',recurring)),
      write('rule_caffe',record('rule','caffe',{phrase:'caffè',category:'Mangiare fuori'})),
      write('notes_all',record('notes','all',['Una nota']))
    ]));
  });
  await test('Field allowlists, monetary bounds and business types reject malformed expenses',async()=>{
    for (const patch of [{amountCents:1.5},{amountCents:-1},{amountCents:9000000001},
      {note:'x'.repeat(4001)},{date:'2026-13-90'},{category:'unknown'},{extra:'not allowed'},
      {status:'planned',includedInOpening:true},{recurringId:42},{countBudget:'yes'}]) {
      await denied(commit([write('transaction_invalid',record('transaction','invalid',{...tx,id:'invalid',...patch}))]));
    }
  });
  await test('Other record types reject invalid settings, plan bounds, rule fields and note items',async()=>{
    await denied(commit([write('setting_payday',record('setting','payday',29,2))]));
    await denied(commit([write('setting_secret',record('setting','secret',true))]));
    await denied(commit([write('setting_salaryCents',record('setting','salaryCents','200000'))]));
    await denied(commit([write('recurring_invalid',record('recurring','invalid',{id:'invalid',name:'Rent',amountCents:50000,months:0,startDate:null,category:'Casa',active:true,automatic:false}))]));
    await denied(commit([write('rule_invalid',record('rule','invalid',{phrase:'aa',category:'Casa'}))]));
    await denied(commit([write('notes_all',record('notes','all',['ok',42],2))]));
    await denied(commit([write('notes_all',record('notes','all',['x'.repeat(2001)],2))]));
    await denied(commit([write('notes_all',record('notes','all',Array(21).fill('a'),2))]));
  });
  await test('The maximum notes list validates every entry within the rules evaluation budget',async()=>{
    await allowed(commit([write('notes_all',record('notes','all',Array(20).fill('a'),2))]));
    const invalid = Array(20).fill('a'); invalid[19] = false;
    await denied(commit([write('notes_all',record('notes','all',invalid,3))]));
  });
  await test('A stale client cannot overwrite a newer version and the correct next version succeeds',async()=>{
    await denied(commit([write('transaction_expense',record('transaction','expense',{...tx,amountCents:999}))]));
    await allowed(commit([write('transaction_expense',record('transaction','expense',{...tx,amountCents:250},2))]));
    await denied(commit([write('transaction_expense',record('transaction','expense',{...tx,amountCents:999},2))]));
  });
  await test('A failed atomic group cannot partially save its other records',async()=>{
    await denied(commit([
      write('transaction_expense',record('transaction','expense',tx,2)),
      write('setting_salaryCents',record('setting','salaryCents',200000))
    ]));
    const r = await request(`/users/${uid}/records/setting_salaryCents`); assert.equal(r.status,404);
  });
  await test('Kind and logical key cannot be changed and clients cannot forge update timestamps',async()=>{
    await denied(commit([write('transaction_expense',record('transaction','different',{...tx,id:'different'},3))]));
    await denied(commit([write('transaction_expense',record('setting','expense',3,3))]));
    await denied(commit([write('transaction_expense',record('transaction','expense',tx,3),uid,false)]));
  });
  await test('Tombstones delete data logically, deny hard deletion and block stale resurrection',async()=>{
    await allowed(commit([write('transaction_expense',record('transaction','expense',null,3,true))]));
    await denied(commit([{delete:path(uid,'transaction_expense')}]));
    await denied(commit([write('transaction_expense',record('transaction','expense',tx,3))]));
    await denied(commit([write('transaction_expense',record('transaction','expense',tx,4,true))]));
    await allowed(commit([write('transaction_expense',record('transaction','expense',tx,4))]));
  });
  await test('Envelope fields, versions and mutation identities are mandatory and bounded',async()=>{
    for (const patch of [{schemaVersion:2},{version:0},{version:2},{version:1.5},
      {mutationId:'short'},{mutationId:'x'.repeat(81)},{key:'x'.repeat(201)},
      {deleted:'no'},{extra:'x'}]) {
      await denied(commit([write('setting_budgetCents',{...record('setting','budgetCents',10000),...patch})]));
    }
  });
  console.log(`\n${count} Firestore rules checks passed against the local emulator.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
