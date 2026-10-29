// Cloudflare Workers Free + D1. No process, filesystem, Node compatibility or paid bindings.
import {createRemoteJWKSet,jwtVerify} from 'jose';
import {buildPushPayload} from '@block65/webcrypto-web-push';
import validation from '../validation.cjs';

const DAY=86400000,HOUR=3600000,MAX_SUBSCRIPTIONS=30,MAX_PER_USER=5;
const googleKeys=createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const problem=(code,status)=>Object.assign(Error(code),{status});
const statement=(db,sql,...values)=>db.prepare(sql).bind(...values);
export async function subscriptionId(subscription){
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(subscription.endpoint));
  return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function validateToken(token,project,keys=googleKeys){
  if(!token||!project)throw problem('unauthorized',401);
  try{
    const {payload}=await jwtVerify(token,keys,{issuer:`https://securetoken.google.com/${project}`,audience:project,algorithms:['RS256'],requiredClaims:['exp','iat','sub','aud','iss']});
    if(typeof payload.sub!=='string'||!payload.sub||payload.sub.length>128||payload.firebase?.sign_in_provider!=='google.com'||payload.iat>Date.now()/1000+60)throw Error();
    return payload.sub;
  }catch(_){throw problem('unauthorized',401);}
}
const authenticate=(request,env)=>validateToken(request.headers.get('Authorization')?.match(/^Bearer (\S+)$/)?.[1],env.FIREBASE_PROJECT_ID);
function configured(env){
  return env.DB&&env.FIREBASE_PROJECT_ID&&/^https:\/\/[^/]+$/.test(env.ALLOWED_ORIGIN||'')&&
    /^[A-Za-z0-9_-]{87}$/.test(env.VAPID_PUBLIC_KEY||'')&&/^[A-Za-z0-9_-]{43}$/.test(env.VAPID_PRIVATE_KEY||'')&&
    /^(mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/[^\s]+)$/.test(env.VAPID_SUBJECT||'')&&!env.VAPID_SUBJECT.includes('REPLACE_');
}
async function readBody(request){
  if(Number(request.headers.get('Content-Length'))>32000)throw problem('request-too-large',413);
  const reader=request.body?.getReader();if(!reader)throw problem('invalid-json',400);
  let size=0,text='';const decoder=new TextDecoder();
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>32000){await reader.cancel();throw problem('request-too-large',413);}text+=decoder.decode(value,{stream:true});}
  try{return JSON.parse(text+decoder.decode());}catch(_){throw problem('invalid-json',400);}
}
async function rateLimit(db,uid,now){
  const window=Math.floor(now/60000);
  const row=await statement(db,`INSERT INTO rate_limits(uid,window,count) VALUES(?,?,1)
    ON CONFLICT(uid) DO UPDATE SET window=excluded.window,
    count=CASE WHEN rate_limits.window=excluded.window THEN rate_limits.count+1 ELSE 1 END RETURNING count`,uid,window).first();
  if(row.count>30)throw problem('rate-limited',429);
}
export async function putSubscription(db,uid,value,now){
  const id=await subscriptionId(value.subscription),current=await statement(db,'SELECT uid FROM subscriptions WHERE id=?',id).first();
  if(current&&current.uid!==uid)throw problem('subscription-owner-mismatch',403);
  const revision=crypto.randomUUID(),tags=value.notifications.map(item=>item.tag);
  const commands=[statement(db,`INSERT INTO subscriptions(id,uid,subscription,language,updated_at)
    SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM subscriptions WHERE id=? AND uid=?)
      OR ((SELECT count(*) FROM subscriptions)<? AND (SELECT count(*) FROM subscriptions WHERE uid=?)<?)
    ON CONFLICT(id) DO UPDATE SET subscription=excluded.subscription,language=excluded.language,updated_at=excluded.updated_at
    WHERE subscriptions.uid=excluded.uid`,id,uid,JSON.stringify(value.subscription),value.language,now,id,uid,MAX_SUBSCRIPTIONS,uid,MAX_PER_USER),
    statement(db,`DELETE FROM notifications WHERE subscription_id=? AND EXISTS(SELECT 1 FROM subscriptions WHERE id=? AND uid=?)
      ${tags.length?'AND tag NOT IN ('+tags.map(()=>'?').join(',')+')':''}`,id,id,uid,...tags)];
  for(const item of value.notifications){
    const payload={title:item.title,body:item.body,kind:item.kind,language:value.language,tag:item.tag,icon:'./icon-192-v2.png',badge:'./icon-192-v2.png',data:item.data};
    commands.push(statement(db,`INSERT INTO notifications(subscription_id,tag,at,payload,revision)
      SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM subscriptions WHERE id=? AND uid=?)
      ON CONFLICT(subscription_id,tag) DO UPDATE SET at=excluded.at,payload=excluded.payload,revision=excluded.revision,
        retry_at=0,attempts=0,claim=NULL,lease_until=0`,id,item.tag,Date.parse(item.at),JSON.stringify(payload),revision,id,uid));
  }
  const results=await db.batch(commands);
  if(!results[0].meta.changes)throw problem('subscription-limit',429);
  return {enabled:true,scheduled:value.notifications.length};
}
export async function deleteSubscription(db,uid,subscription){
  const id=await subscriptionId(subscription),current=await statement(db,'SELECT uid FROM subscriptions WHERE id=?',id).first();
  if(current&&current.uid!==uid)throw problem('subscription-owner-mismatch',403);
  await statement(db,'DELETE FROM subscriptions WHERE id=? AND uid=?',id,uid).run();return {enabled:false};
}
export async function buildDelivery(item,env){
  return buildPushPayload({data:item.payload,options:{ttl:3600,urgency:'normal'}},JSON.parse(item.subscription),{
    publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY,subject:env.VAPID_SUBJECT
  });
}
export async function sendOne(env,{now=Date.now(),build=buildDelivery,fetchPush=fetch}={}){
  const db=env.DB;
  // One encrypted delivery per minute keeps the Free CPU budget bounded for a personal beta.
  const item=await statement(db,`SELECT n.*,s.subscription,s.uid FROM notifications n JOIN subscriptions s ON s.id=n.subscription_id
    WHERE n.at<=? AND n.at>? AND n.retry_at<=? AND n.lease_until<=? AND s.updated_at>?
      AND NOT EXISTS(SELECT 1 FROM sent WHERE subscription_id=n.subscription_id AND tag=n.tag)
    ORDER BY n.at,n.subscription_id LIMIT 1`,now,now-HOUR,now,now,now-35*DAY).first();
  if(!item)return {sent:0};
  const claim=crypto.randomUUID();
  const owned=await statement(db,`UPDATE notifications SET claim=?,lease_until=?
    WHERE subscription_id=? AND tag=? AND revision=? AND lease_until<=? RETURNING tag`,claim,now+2*60000,item.subscription_id,item.tag,item.revision,now).first();
  if(!owned)return {sent:0};
  try{
    const request=await build(item,env);
    // Consent or the plan can change while WebCrypto prepares the encrypted request.
    const live=await statement(db,`SELECT 1 AS active FROM notifications WHERE subscription_id=? AND tag=? AND claim=? AND revision=?
      AND NOT EXISTS(SELECT 1 FROM sent WHERE subscription_id=? AND tag=?)`,item.subscription_id,item.tag,claim,item.revision,item.subscription_id,item.tag).first();
    if(!live)return {sent:0};
    const response=await fetchPush(JSON.parse(item.subscription).endpoint,{...request,redirect:'error',signal:AbortSignal.timeout(10000)});
    if(response.ok){
      await db.batch([
        statement(db,`INSERT OR IGNORE INTO sent(subscription_id,tag,sent_at) SELECT ?,?,?
          WHERE EXISTS(SELECT 1 FROM subscriptions WHERE id=? AND uid=?)`,item.subscription_id,item.tag,now,item.subscription_id,item.uid),
        statement(db,'UPDATE notifications SET claim=NULL,lease_until=0 WHERE subscription_id=? AND tag=? AND claim=?',item.subscription_id,item.tag,claim)
      ]);return {sent:1};
    }
    if(response.status===404||response.status===410){await statement(db,'DELETE FROM subscriptions WHERE id=? AND uid=?',item.subscription_id,item.uid).run();return {sent:0,expired:true};}
    const retry=response.headers.get('Retry-After');
    const delay=retry&&/^\d+$/.test(retry)?Number(retry)*1000:retry?Date.parse(retry)-now:0;
    // 400/401/403 indicate invalid/configuration errors; don't repeatedly hit the push service.
    if(response.status!==429&&response.status<500)throw problem('push-rejected',response.status);
    await retryLater(db,item,claim,now,delay);return {sent:0,retry:true};
  }catch(error){
    if(error.status&&error.status<500){await statement(db,'DELETE FROM notifications WHERE subscription_id=? AND tag=? AND claim=?',item.subscription_id,item.tag,claim).run();return {sent:0,rejected:true};}
    await retryLater(db,item,claim,now);return {sent:0,retry:true};
  }
}
async function retryLater(db,item,claim,now,retryAfter=0){
  const delay=Math.max(60000*Math.pow(2,Math.min(item.attempts,4)),Math.min(Math.max(0,retryAfter||0),HOUR));
  await statement(db,`UPDATE notifications SET claim=NULL,lease_until=0,retry_at=?,attempts=attempts+1
    WHERE subscription_id=? AND tag=? AND claim=?`,now+delay,item.subscription_id,item.tag,claim).run();
}
export async function cleanup(db,now){
  await db.batch([
    statement(db,'DELETE FROM subscriptions WHERE updated_at<?',now-35*DAY),
    statement(db,'DELETE FROM notifications WHERE at<?',now-HOUR),
    statement(db,'DELETE FROM sent WHERE sent_at<?',now-16*DAY),
    statement(db,'DELETE FROM rate_limits WHERE window<?',Math.floor(now/60000)-60)
  ]);
}
export function createHandler({verify=authenticate,clock=Date.now}={}){
  return {
    async fetch(request,env){
      const origin=request.headers.get('Origin'),headers={'Content-Type':'application/json','Cache-Control':'no-store'};
      const reply=(status,value)=>new Response(JSON.stringify(value),{status,headers});
      if(!env.ALLOWED_ORIGIN||origin!==env.ALLOWED_ORIGIN)return reply(403,{error:'origin-not-allowed'});
      Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'Content-Type, Authorization','Access-Control-Allow-Methods':'PUT, DELETE, OPTIONS'});
      const url=new URL(request.url);
      if(url.pathname!=='/subscriptions'||url.search)return reply(404,{error:'not-found'});
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
      if(!['PUT','DELETE'].includes(request.method))return reply(405,{error:'method-not-allowed'});
      if(!configured(env))return reply(503,{error:'sender-not-configured'});
      try{
        const uid=await verify(request,env),now=clock();await rateLimit(env.DB,uid,now);
        const input=await readBody(request),value=validation.clean({...input,notifications:request.method==='DELETE'?[]:input.notifications},now);
        return reply(200,request.method==='PUT'?await putSubscription(env.DB,uid,value,now):await deleteSubscription(env.DB,uid,value.subscription));
      }catch(error){return reply(error.status||503,{error:error.status?error.message:'sender-unavailable'});}
    },
    async scheduled(controller,env){
      if(!configured(env))throw Error('sender-not-configured');
      const now=controller.scheduledTime||Date.now();
      await sendOne(env,{now});
      // Housekeeping hourly, not 1,440 full-table scans per day.
      if(new Date(now).getUTCMinutes()===0)await cleanup(env.DB,now);
    }
  };
}
export default createHandler();
