'use strict';
const MAX_PLANS=14,MAX_AHEAD=15*86400000;
const kinds=new Set(['due','dueMany','budgetLow','budgetExceeded','weekly','reminder']);
function clean(body,now=Date.now()){
  const invalid=()=>{const e=Error('invalid-request');e.status=400;throw e;};
  if(!body||typeof body!=='object'||Array.isArray(body))invalid();
  const s=body.subscription;let url;
  try{url=new URL(s?.endpoint);}catch(_){invalid();}
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||url.href.length>2048)invalid();
  // The client cannot turn this service into an arbitrary HTTP request proxy.
  if(!(url.hostname==='fcm.googleapis.com'||url.hostname.endsWith('.push.apple.com')||url.hostname==='push.apple.com'||url.hostname==='updates.push.services.mozilla.com'))invalid();
  if(typeof s.keys?.p256dh!=='string'||!/^[A-Za-z0-9_-]{87}={0,2}$/.test(s.keys.p256dh)||typeof s.keys.auth!=='string'||!/^[A-Za-z0-9_-]{22}={0,2}$/.test(s.keys.auth))invalid();
  if(!Array.isArray(body.notifications)||body.notifications.length>MAX_PLANS)invalid();
  const seen=new Set(),notifications=[];
  for(const p of body.notifications){
    const at=Date.parse(p?.at);
    if(!p||!kinds.has(p.kind)||!Number.isFinite(at)||at<=now||at>now+MAX_AHEAD||typeof p.tag!=='string'||!/^mymoney-[A-Za-z]+-\d{4}-\d{2}-\d{2}$/.test(p.tag)||seen.has(p.tag)||typeof p.title!=='string'||!p.title.trim()||p.title.length>100||typeof p.body!=='string'||p.body.length>350)invalid();
    seen.add(p.tag);
    notifications.push({tag:p.tag,kind:p.kind,title:p.title,body:p.body,at:new Date(at).toISOString(),data:{url:p.kind==='due'||p.kind==='dueMany'?'./?notification=plan':'./?notification=history',kind:p.kind}});
  }
  return {subscription:{endpoint:url.href,keys:{p256dh:s.keys.p256dh,auth:s.keys.auth}},language:body.language==='en'?'en':'it',notifications};
}
module.exports={clean};
