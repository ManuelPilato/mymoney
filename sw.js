/* Cache only the public application shell, never backup files. */
'use strict';
const CACHE='mymoney-local-shell-v6.5.2';
const FILES=['./','./index.html','./firebase-sdk.js','./manifest.webmanifest','./icon-180-v2.png','./icon-192-v2.png','./icon-512-v2.png','./preview-wordmark-v2.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)));
  // Wait for existing windows to close before activating a new release.
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    for(const key of await caches.keys())if(key.startsWith('mymoney-local-shell-')&&key!==CACHE)await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
  // Use the installed shell offline; app updates are versioned through this worker.
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    if(event.request.mode==='navigate')return (await cache.match('./index.html'))||fetch(event.request);
    return (await cache.match(event.request))||fetch(event.request);
  })());
});
