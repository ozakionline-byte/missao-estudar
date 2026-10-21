const CACHE='me-v12-cache-corrigido-20261021';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(['/','/index.html','/manifest.webmanifest','/icon-192.png','/icon-512.png'])).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{const req=event.request;if(req.method!=='GET'||new URL(req.url).pathname.startsWith('/api/'))return;if(req.mode==='navigate'){event.respondWith(fetch(req).catch(()=>caches.match(req)));return;}event.respondWith(fetch(req).catch(()=>caches.match(req)));});
