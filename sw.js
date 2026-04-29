/* BookMe — service worker v7 */
const CACHE = 'bookme-v7';
const ASSETS = [
  './',
  './index.html',
  './master.html',
  './client.html',
  './profile.html',
  './services.html',
  './bookings.html',
  './analytics.html',
  './chat.html',
  './subscription.html',
  './admin.html',
  './p.html',
  './booking.html',
  './public.html',
  './dashboard.html',
  './styles.css',
  './app.js',
  './config.js',
  './manifest.json',
  './offline.html',
];

const OFFLINE_HTML = `<!doctype html><html lang="ru"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<meta name="theme-color" content="#0A0A0A"/>
<title>BookMe — нет связи</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0A0A0B;color:#FAFAFA;font-family:-apple-system,BlinkMacSystemFont,sans-serif;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  min-height:100dvh;padding:24px;text-align:center;gap:16px;}
.icon{width:72px;height:72px;border-radius:22px;background:linear-gradient(135deg,#FF5A6F,#D63384);
  display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:800;color:#fff;margin-bottom:4px;}
h1{font-size:22px;font-weight:700;letter-spacing:-0.02em;}
p{font-size:15px;color:#9CA3AF;line-height:1.5;max-width:300px;}
button{margin-top:8px;background:#FAFAFA;color:#0A0A0A;border:none;border-radius:14px;
  padding:14px 28px;font-size:16px;font-weight:600;cursor:pointer;}
</style></head><body>
<div class="icon">BM</div>
<h1>Нет соединения</h1>
<p>Проверьте интернет и попробуйте снова. Основные страницы доступны офлайн.</p>
<button onclick="location.reload()">Повторить</button>
</body></html>`;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(async c => {
      // Cache assets individually — one fail won't break the whole SW
      await Promise.allSettled(ASSETS.map(url => c.add(url).catch(() => {})));
      // Store inline offline page
      c.put('./offline.html', new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html' } }));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Never intercept Supabase API calls
  if (e.request.url.includes('supabase.co')) return;
  // Never intercept CDN scripts
  if (e.request.url.includes('cdn.jsdelivr.net')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request)
        .then(res => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() =>
          // Return offline page for navigation requests
          e.request.mode === 'navigate'
            ? caches.match('./offline.html')
            : Response.error()
        );
    })
  );
});
