self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(
          '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;background:#09090b;color:#71717a;font:15px -apple-system,system-ui,sans-serif">vide is offline. Check that your Mac is awake.</body>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        )
    )
  )
})
