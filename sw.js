/* BookMe — service worker v8 */
const CACHE = 'bookme-v8';

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
<div class="icon">🦋</div>
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
