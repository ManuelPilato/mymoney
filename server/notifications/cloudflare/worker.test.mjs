import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createECDH,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {generateKeyPair,SignJWT,exportJWK,createLocalJWKSet,jwtVerify,importJWK} from 'jose';
import {createHandler,validateToken,putSubscription,deleteSubscription,sendOne,cleanup,buildDelivery} from './worker.mjs';
const require=createRequire(import.meta.url),webpush=require('web-push'),ece=require('http_ece');
const NOW=Date.parse('2026-10-29T10:00:00Z'),ORIGIN='https://manuelpilato.github.io';
function db(){
  const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('schema.sql',import.meta.url),'utf8'));
  function prepare(query){return {bind(...values){const statement=sql.prepare(query);return {
    first:async()=>statement.get(...values)||null,
    all:async()=>({results:statement.all(...values)}),
    run:async()=>({meta:{changes:Number(statement.run(...values).changes)}})
  };}};}
  return {sql,prepare,async batch(commands){sql.exec('BEGIN');try{const values=[];for(const command of commands)values.push(await command.run());sql.exec('COMMIT');return values;}catch(error){sql.exec('ROLLBACK');throw error;}}};
}
function plan(endpoint='https://web.push.apple.com/example',at=NOW-1000){return {
  subscription:{endpoint,keys:{p256dh:'A'.repeat(87),auth:'B'.repeat(22)}},language:'it',
  notifications:[{tag:'mymoney-due-2026-10-29',kind:'due',title:'Domani, senza sorprese.',body:'Hai una scadenza domani.',at:new Date(at).toISOString(),data:{url:'./?notification=plan',kind:'due'}}]
};}
function environment(database=db()){return {DB:database,FIREBASE_PROJECT_ID:'test-project',ALLOWED_ORIGIN:ORIGIN,VAPID_PUBLIC_KEY:'A'.repeat(87),VAPID_PRIVATE_KEY:'B'.repeat(43),VAPID_SUBJECT:'mailto:team@example.com'};}
const fakeBuild=async()=>({method:'POST',headers:{'Content-Encoding':'aes128gcm'},body:'encrypted'});
const request=(method,value,origin=ORIGIN)=>new Request('https://worker.example/subscriptions',{method,headers:{Origin:origin,Authorization:'Bearer synthetic-token','Content-Type':'application/json'},body:JSON.stringify(value)});

test('Worker API requires Firebase auth, exact Origin and completed server configuration',async()=>{
  const env=environment(),handler=createHandler({clock:()=>NOW});
  assert.equal((await handler.fetch(request('PUT',plan(),'https://evil.example'),env)).status,403);
  assert.equal((await handler.fetch(request('PUT',plan()),{...env,VAPID_PRIVATE_KEY:''})).status,503);
  assert.equal((await handler.fetch(request('PUT',plan()),env)).status,401);
  assert.equal(env.DB.sql.prepare('SELECT count(*) AS n FROM subscriptions').get().n,0);
});
test('Real RS256 JWT verifies signature, Firebase project, expiry and Google provider',async()=>{
  const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk=await exportJWK(publicKey);jwk.kid='test-key';
  const keys=createLocalJWKSet({keys:[jwk]});
  const sign=(claims={})=>new SignJWT({firebase:{sign_in_provider:'google.com'},...claims}).setProtectedHeader({alg:'RS256',kid:'test-key'}).setSubject('account-A').setIssuedAt().setIssuer('https://securetoken.google.com/test-project').setAudience('test-project').setExpirationTime('1h').sign(privateKey);
  const valid=await sign();assert.equal(await validateToken(valid,'test-project',keys),'account-A');
  await assert.rejects(validateToken(valid,'other-project',keys),{status:401});
  await assert.rejects(validateToken(await sign({firebase:{sign_in_provider:'anonymous'}}),'test-project',keys),{status:401});
  await assert.rejects(validateToken(valid.slice(0,-20)+'x'.repeat(20),'test-project',keys),{status:401});
});
test('API sanitizes payloads, enforces ownership and revokes all pending deliveries',async()=>{
  const env=environment(),handler=createHandler({verify:async()=> 'A',clock:()=>NOW}),p=plan(undefined,NOW+60000);p.notifications[0].data.url='https://evil.example';p.archive={secret:'never stored'};
  assert.equal((await handler.fetch(request('PUT',p),env)).status,200);
  const stored=env.DB.sql.prepare('SELECT payload FROM notifications').get();assert.doesNotMatch(stored.payload,/evil|secret/);assert.match(stored.payload,/icon-192-v2/);
  const other=createHandler({verify:async()=> 'B',clock:()=>NOW});assert.equal((await other.fetch(request('DELETE',p),env)).status,403);
  assert.equal((await handler.fetch(request('DELETE',p),env)).status,200);assert.equal(env.DB.sql.prepare('SELECT count(*) AS n FROM notifications').get().n,0);
});
test('Shared validation refuses arbitrary push hosts and oversized requests',async()=>{
  const env=environment(),handler=createHandler({verify:async()=> 'A',clock:()=>NOW});
  assert.equal((await handler.fetch(request('PUT',plan('https://127.0.0.1/',NOW+60000)),env)).status,400);
  assert.equal((await handler.fetch(request('PUT',{extra:'x'.repeat(33000)}),env)).status,413);
});
test('D1 limits are atomic and bounded: five devices per account, thirty overall',async()=>{
  const env=environment();for(let i=0;i<5;i++)await putSubscription(env.DB,'A',plan('https://web.push.apple.com/a'+i),NOW);
  await assert.rejects(putSubscription(env.DB,'A',plan('https://web.push.apple.com/a5'),NOW),{status:429});
  for(let i=5;i<30;i++)await putSubscription(env.DB,'user-'+i,plan('https://web.push.apple.com/a'+i),NOW);
  await assert.rejects(putSubscription(env.DB,'last',plan('https://web.push.apple.com/a30'),NOW),{status:429});
  await putSubscription(env.DB,'A',plan('https://web.push.apple.com/a0'),NOW+1);assert.equal(env.DB.sql.prepare('SELECT count(*) AS n FROM subscriptions').get().n,30);
});
test('Cron sends only one due message, preserves deduplication when the client reschedules',async()=>{
  const env=environment(),p=plan();await putSubscription(env.DB,'A',p,NOW);let calls=0;
  const options={now:NOW,build:fakeBuild,fetchPush:async()=>{calls++;return new Response('',{status:201});}};
  assert.equal((await sendOne(env,options)).sent,1);await putSubscription(env.DB,'A',p,NOW+1);
  assert.equal((await sendOne(env,options)).sent,0);assert.equal(calls,1);
});
test('Lease prevents concurrent cron deliveries and revoked consent stops prepared requests',async()=>{
  const env=environment(),p=plan();await putSubscription(env.DB,'A',p,NOW);let release,entered;
  const started=new Promise(resolve=>{entered=resolve;}),wait=new Promise(resolve=>{release=resolve;});let calls=0;
  const pending=sendOne(env,{now:NOW,build:async()=>{entered();await wait;return fakeBuild();},fetchPush:async()=>{calls++;return new Response('',{status:201});}});
  await started;assert.equal((await sendOne(env,{now:NOW,build:fakeBuild})).sent,0);await deleteSubscription(env.DB,'A',p.subscription);release();
  assert.equal((await pending).sent,0);assert.equal(calls,0);
});
test('Transient push failures respect Retry-After; expired endpoints are deleted',async()=>{
  const env=environment();await putSubscription(env.DB,'A',plan(),NOW);
  assert.equal((await sendOne(env,{now:NOW,build:fakeBuild,fetchPush:async()=>new Response('',{status:429,headers:{'Retry-After':'180'}})})).retry,true);
  assert.equal(env.DB.sql.prepare('SELECT retry_at FROM notifications').get().retry_at,NOW+180000);
  assert.equal((await sendOne(env,{now:NOW+179000,build:fakeBuild})).sent,0);
  assert.equal((await sendOne(env,{now:NOW+180000,build:fakeBuild,fetchPush:async()=>new Response('',{status:410})})).expired,true);
  assert.equal(env.DB.sql.prepare('SELECT count(*) AS n FROM subscriptions').get().n,0);
});
test('Old plans expire instead of sending stale financial information',async()=>{
  const env=environment();await putSubscription(env.DB,'A',plan(undefined,NOW-3600001),NOW);
  assert.equal((await sendOne(env,{now:NOW,build:fakeBuild})).sent,0);await cleanup(env.DB,NOW);assert.equal(env.DB.sql.prepare('SELECT count(*) AS n FROM notifications').get().n,0);
});
test('Real WebCrypto payload decrypts with an independent implementation and carries valid Apple-compatible VAPID',async()=>{
  const vapid=webpush.generateVAPIDKeys(),client=createECDH('prime256v1');client.generateKeys();const auth=randomBytes(16);
  const subscription={endpoint:'https://web.push.apple.com/example',keys:{p256dh:client.getPublicKey().toString('base64url'),auth:auth.toString('base64url')}};
  const original=JSON.stringify({title:'MyMoney',body:'Un piccolo check.',icon:'./icon-192-v2.png'});
  const packet=await buildDelivery({subscription:JSON.stringify(subscription),payload:original},{VAPID_PUBLIC_KEY:vapid.publicKey,VAPID_PRIVATE_KEY:vapid.privateKey,VAPID_SUBJECT:'mailto:team@example.com'});
  const headers=new Headers(packet.headers);assert.equal(headers.get('Content-Encoding'),'aes128gcm');assert.equal(packet.body.byteLength,4096);
  const plaintext=ece.decrypt(Buffer.from(packet.body),{version:'aes128gcm',authSecret:auth.toString('base64url'),privateKey:client});assert.equal(plaintext.toString(),original);
  const authorization=headers.get('Authorization');assert.match(authorization,/^vapid t=/);const token=authorization.match(/t=([^, ]+)/)[1],raw=Buffer.from(vapid.publicKey,'base64url');
  const key=await importJWK({kty:'EC',crv:'P-256',x:raw.subarray(1,33).toString('base64url'),y:raw.subarray(33).toString('base64url')},'ES256');
  const result=await jwtVerify(token,key,{audience:'https://web.push.apple.com'});assert.equal(result.payload.sub,'mailto:team@example.com');
});
