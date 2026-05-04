/* BookMe — service worker v10 */
const CACHE = 'bookme-v10';

// Only static assets get cached — never HTML pages
const STATIC = [
  './styles.css',
  './app.js',
  './config.js',
  './logo.svg',
  './manifest.json',
  './apple-touch-icon.png',
  './apple-touch-icon-512.png',
];

const OFFLINE_HTML = `<!doctype html><html lang="ru"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<meta name="theme-color" content="#0A0A0A"/>
<title>BookMe — нет связи</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0A0A0B;color:#FAFAFA;font-family:-apple-system,sans-serif;
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  min-height:100dvh;padding:24px;text-align:center;gap:16px;}
.icon{width:72px;height:72px;border-radius:22px;background:linear-gradient(135deg,#4F378A,#150E24);
  display:flex;align-items:center;justify-content:center;font-size:32px;margin-bottom:4px;}
h1{font-size:22px;font-weight:700;letter-spacing:-0.02em;}
p{font-size:15px;color:#9CA3AF;line-height:1.5;max-width:300px;}
button{margin-top:8px;background:#FAFAFA;color:#0A0A0A;border:none;border-radius:14px;
  padding:14px 28px;font-size:16px;font-weight:600;cursor:pointer;}
</style></head><body>
<div class="icon"><svg width="36" height="36" viewBox="0 0 600 600" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M490 99C510 99 526 110 526 146s-5 105-10 165c-18 68-60 103-113 120 46 12 78 32 87 52 13 27 5 59-27 93-34 36-61 45-81 43-21-2-38-11-52-25-14-14-24-31-32-46-7-14-13-27-16-36a600 600 0 0 1-3-10 600 600 0 0 1-3 10c-3 9-8 22-16 36-7 15-18 32-32 46-14 14-31 23-52 25-20 2-47-7-81-43-32-34-40-66-27-93 10-20 41-40 87-52C110 245 68 210 50 143 44 118 38 84 33 52 29 20 75 99 110 99c24 0 55 16 77 32 31 23 64 58 88 91 24-33 57-68 88-91 22-16 53-32 77-32z" fill="url(#g)"/><defs><linearGradient id="g" x1="300" y1="100" x2="300" y2="497" gradientUnits="userSpaceOnUse"><stop stop-color="#9B5DFF"/><stop offset="1" stop-color="#C9B2F0"/></linearGradient></defs></svg></div>
<h1>Нет соединения</h1>
<p>Проверьте интернет и попробуйте снова.</p>
<button onclick="location.reload()">Повторить</button>
</body></html>`;

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => {
      // Store offline page
      c.put('./offline.html', new Response(OFFLINE_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }));
      // Cache static assets individually (one failure won't break install)
      return Promise.allSettled(STATIC.map(url => c.add(url).catch(() => {})));
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

// ── Push notifications ────────────────────────────────────────
self.addEventListener('push', e => {
  let data = { title: 'BookMe', body: '', url: '/' };
  try { data = { ...data, ...e.data.json() }; } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon:  './apple-touch-icon.png',
      badge: './apple-touch-icon.png',
      data:  { url: data.url },
      vibrate: [100, 50, 100],
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      const c = cs.find(w => w.url.includes(self.location.origin));
      if (c) { c.focus(); c.navigate(url); }
      else    clients.openWindow(url);
    })
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // ── Never intercept these ──────────────────────────────────
  // Supabase API
  if (url.hostname.includes('supabase.co')) return;
  // CDN (Supabase JS, etc.)
  if (url.hostname.includes('jsdelivr.net')) return;
  // Google OAuth & external auth domains
  if (url.hostname.includes('google') || url.hostname.includes('accounts.')) return;
  // Any URL with query params (OAuth callbacks: ?code=, ?error=, ?token= etc.)
  if (url.search) return;
  // Auth hash fragments (access_token, refresh_token)
  if (url.hash.includes('access_token') || url.hash.includes('refresh_token')) return;

  // ── HTML navigation → Network first, cache ONLY as fallback ──
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          // CRITICAL: never cache or return redirect responses — Safari bug
          if (res.status >= 300 && res.status < 400) return res;
          // Cache fresh HTML for offline fallback
          if (res.ok) {
            caches.open(CACHE).then(c => c.put(e.request, res.clone()));
          }
          return res;
        })
        .catch(() =>
          // Offline: try cached page, then generic offline page
          caches.match(e.request).then(cached => cached || caches.match('./offline.html'))
        )
    );
    return;
  }

  // ── Static assets (CSS, JS, images) → Cache first ─────────
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok) {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      }).catch(() => Response.error());
    })
  );
});
