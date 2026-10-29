/* Optional self-hosted Web Push sender. Nothing here is deployed by the website build. */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRemoteJWKSet,jwtVerify} from 'jose';
import webpush from 'web-push';
import policy from './policy.cjs';

const project=process.env.FIREBASE_PROJECT_ID,origin=process.env.ALLOWED_ORIGIN;
if(!project||!origin||!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY||!process.env.VAPID_SUBJECT)throw Error('Configure Firebase project, origin and VAPID keys in .env first.');
if(!/^https:\/\/[^/]+$/.test(origin))throw Error('ALLOWED_ORIGIN must be a single HTTPS origin, with no path.');
webpush.setVapidDetails(process.env.VAPID_SUBJECT,process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
const jwks=createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const directory=path.resolve(process.env.DATA_DIR||'./data'),file=path.join(directory,'subscriptions.json');
await fs.mkdir(directory,{recursive:true,mode:0o700});await fs.chmod(directory,0o700);
let records={},saving=Promise.resolve(),sending=false;
try{records=JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
function save(){
  const json=JSON.stringify(records);saving=saving.catch(()=>{}).then(async()=>{await fs.writeFile(file+'.tmp',json,{mode:0o600});await fs.rename(file+'.tmp',file);});return saving;
}
async function owner(req){
  const token=req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];if(!token)throw Object.assign(Error('unauthorized'),{status:401});
  try{const {payload}=await jwtVerify(token,jwks,{issuer:`https://securetoken.google.com/${project}`,audience:project,algorithms:['RS256'],requiredClaims:['exp','iat','sub','aud','iss']});
    if(typeof payload.sub!=='string'||!payload.sub||payload.sub.length>128||payload.firebase?.sign_in_provider!=='google.com')throw Error();return payload.sub;
  }catch(_){throw Object.assign(Error('unauthorized'),{status:401});}
}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>32000)throw Object.assign(Error('request-too-large'),{status:413});}try{return JSON.parse(text);}catch(_){throw Object.assign(Error('invalid-json'),{status:400});}}
function reply(res,status,value){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
const requests=new Map();
function limit(uid){const now=Date.now(),entry=requests.get(uid)||{time:now,count:0};if(now-entry.time>60000){entry.time=now;entry.count=0;}if(++entry.count>30)throw Object.assign(Error('rate-limited'),{status:429});requests.set(uid,entry);if(requests.size>1000)for(const [id,value]of requests)if(now-value.time>60000)requests.delete(id);}
const server=http.createServer(async(req,res)=>{
  if(req.headers.origin!==origin){reply(res,403,{error:'origin-not-allowed'});return;}
  res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','PUT, DELETE, OPTIONS');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  if(req.url!=='/subscriptions'||!['PUT','DELETE'].includes(req.method)){reply(res,404,{error:'not-found'});return;}
  try{
    const uid=await owner(req);limit(uid);const input=await body(req),value=policy.clean({...input,notifications:req.method==='DELETE'?[]:input.notifications}),id=policy.key(value.subscription),current=records[id];
    if(current&&current.uid!==uid)throw Object.assign(Error('subscription-owner-mismatch'),{status:403});
    if(req.method==='DELETE'){delete records[id];await save();reply(res,200,{enabled:false});return;}
    if(!current&&(Object.keys(records).length>=500||Object.values(records).filter(r=>r.uid===uid).length>=5))throw Object.assign(Error('subscription-limit'),{status:429});
    // Preserve sent tags across rescheduling: opening the app cannot replay today's alert.
    const sent=(current?.sent||[]).filter(item=>Date.now()-item.time<16*86400000);
    records[id]={...value,uid,sent,updatedAt:Date.now()};await save();reply(res,200,{enabled:true,scheduled:value.notifications.length});
  }catch(error){reply(res,error.status||500,{error:error.status?error.message:'sender-unavailable'});}
});
async function tick(){
  if(sending)return;sending=true;
  try{
    const now=Date.now();
    for(const [id,record]of Object.entries(records)){
      // A stale device registration is discarded rather than kept indefinitely.
      if(now-record.updatedAt>35*86400000){delete records[id];continue;}
      for(const item of record.notifications){
        // Rescheduling, revoking consent or deleting an account invalidates this snapshot.
        if(records[id]!==record)break;
        const age=now-Date.parse(item.at);if(age<0||record.sent.some(s=>s.tag===item.tag))continue;
        if(age>3600000){record.sent.push({tag:item.tag,time:now});continue;}
        const payload={title:item.title,body:item.body,kind:item.kind,language:record.language,tag:item.tag,icon:'./icon-192-v2.png',badge:'./icon-192-v2.png',data:item.data};
        try{await webpush.sendNotification(record.subscription,JSON.stringify(payload),{TTL:3600,urgency:'normal',timeout:10000});
          // A client may have refreshed its plan during the network request.
          const current=records[id];if(current?.uid===record.uid&&!current.sent.some(s=>s.tag===item.tag))current.sent.push({tag:item.tag,time:now});
        }
        catch(error){if(error.statusCode===404||error.statusCode===410){delete records[id];break;}console.warn('Push delivery deferred',Number(error.statusCode)||'network');}
      }
    }
    await save();
  }catch(_){console.error('Notification sender could not persist its queue.');}finally{sending=false;}
}
const timer=setInterval(tick,60000);timer.unref();
server.listen(Number(process.env.PORT)||8787,process.env.HOST||'127.0.0.1',()=>{console.log('MyMoney sender listening; HTTPS reverse proxy required.');void tick();});
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{clearInterval(timer);server.close(()=>process.exit(0));});
