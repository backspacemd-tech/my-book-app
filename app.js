/* ============================================================
   BookMe — shared utilities (loaded after config.js)
   ============================================================ */

// ── Normalize old .html URLs to clean paths ────────────────────
(function normalizeHtmlUrl() {
  const path = window.location.pathname;
  if (!path.endsWith('.html')) return;
  const clean = path === '/index.html' ? '/login' : path.replace(/\.html$/, '');
  const destination = clean + window.location.search + window.location.hash;
  if (destination !== window.location.href) {
    window.location.replace(destination);
  }
})();

// ── Global error boundary ─────────────────────────────────────
window.addEventListener('unhandledrejection', e => {
  const msg = e.reason?.message || String(e.reason);
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
    toast('Нет соединения. Проверьте интернет.'); return;
  }
  console.error('[BookMe]', e.reason);
});
window.onerror = (msg, _src, _l, _c, err) => { console.error('[BookMe]', err || msg); };

// ── Format helpers ───────────────────────────────────────────
function fmt$(n) { return '$' + (n || 0).toLocaleString('en-US'); }

function fmtDate(d) {
  const months = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

function todayISO(offset = 0) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

function isFuture(iso) { return iso >= todayISO(0); }
function isToday(iso)  { return iso === todayISO(0); }

function bookingsByDate(bookings, when) {
  switch (when) {
    case 'today':    return bookings.filter(b => isToday(b.date_iso));
    case 'upcoming': return bookings.filter(b => isFuture(b.date_iso));
    case 'past':     return bookings.filter(b => !isFuture(b.date_iso));
    default:         return bookings.slice();
  }
}

// ── Auth helpers ─────────────────────────────────────────────
async function getSession() {
  const { data: { session } } = await sb.auth.getSession();
  return session;
}

async function getProfile(userId) {
  const { data } = await sb.from('profiles').select('*').eq('id', userId).single();
  return data;
}

async function ensureMasterRecord(user, attrs = {}) {
  const { data: master } = await sb.from('masters').select('*').eq('id', user.id).single();
  if (master) return master;
  const email = attrs.email || user.email || '';
  const username = attrs.username || email.split('@')[0] || user.id.slice(0, 8);
  // New masters get 30-day trial (DB default is now 30 days)
  await sb.from('masters').insert({
    id: user.id,
    username,
    accepts_online: true,
    plan: 'trial',
    specialty: attrs.specialty || null,
    ...attrs,
  });
  const { data } = await sb.from('masters').select('*').eq('id', user.id).single();
  return data;
}

async function ensureProfile(user, attrs = {}) {
  const profile = await getProfile(user.id);
  if (profile) return profile;

  const specialty = attrs.specialty || user.user_metadata?.specialty || user.app_metadata?.specialty || null;
  const requestedRole = attrs.role || user.user_metadata?.role || user.app_metadata?.role || 'client';
  const role = requestedRole === 'admin' ? 'client' : requestedRole;
  const email = attrs.email || user.email || '';
  const name = attrs.name || user.user_metadata?.name || user.user_metadata?.full_name || email.split('@')[0] || '';

  await sb.from('profiles').insert({
    id: user.id,
    email,
    name,
    role,
  });

  const created = await getProfile(user.id);
  if (created?.role === 'master') {
    await ensureMasterRecord(user, { email, username: attrs.username, specialty });
  }
  return created;
}

// Redirects to right dashboard by role
function redirectByRole(role) {
  const map = { admin: '/admin', master: '/master', client: '/client' };
  window.location.href = map[role] || '/client';
}

// Guard: ensure session, return {session, profile}. Redirects if not authenticated.
async function requireAuth(expectedRole = null) {
  let session;
  try { session = await getSession(); } catch { session = null; }
  if (!session) { window.location.href = '/login'; return null; }

  let profile;
  try {
    profile = await ensureProfile(session.user, {
      email: session.user.email,
      name: session.user.user_metadata?.name || session.user.user_metadata?.full_name || undefined,
    });
  } catch (e) {
    console.error('Profile load failed', e);
    window.location.href = '/login'; return null;
  }
  if (!profile) { window.location.href = '/login'; return null; }

  if (expectedRole && profile.role !== expectedRole && profile.role !== 'admin') {
    // Allow masters to enter client mode (to book services themselves)
    if (!(expectedRole === 'client' && profile.role === 'master')) {
      redirectByRole(profile.role); return null;
    }
  }
  return { session, profile };
}

// ── Cancel booking helper ─────────────────────────────────────
async function cancelBooking(id, { onDone } = {}) {
  const { error } = await sb.from('bookings').update({ status: 'cancelled' }).eq('id', id);
  if (error) { toast('Ошибка отмены: ' + error.message); return false; }
  toast('Запись отменена', { icon: '✓' });
  if (onDone) onDone();
  return true;
}

async function navigateTo(url) {
  if (!url) return;
  // Haptic feedback on supported devices
  if (navigator.vibrate) navigator.vibrate(8);
  document.body.classList.add('page-exit');
  // If browser supports View Transitions, it handles the animation automatically
  // The page-exit class is the fallback for older browsers
  await new Promise(r => setTimeout(r, 160));
  window.location.href = url;
}

async function signOut() {
  await sb.auth.signOut();
  await navigateTo('/login');
}

// ── Toast notifications ──────────────────────────────────────
function toast(msg, opts = {}) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
  el.innerHTML = (opts.icon ? `<span>${opts.icon}</span> ` : '') + msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2400);
}

// ── Bottom sheet ─────────────────────────────────────────────
function openSheet(html) {
  let backdrop = document.querySelector('.sheet-backdrop');
  let sheet    = document.querySelector('.sheet');
  if (!backdrop) { backdrop = document.createElement('div'); backdrop.className = 'sheet-backdrop'; document.body.appendChild(backdrop); }
  if (!sheet)    { sheet    = document.createElement('div'); sheet.className = 'sheet';             document.body.appendChild(sheet); }
  sheet.innerHTML = `<div class="grabber"></div><div class="sheet-content">${html}</div>`;
  requestAnimationFrame(() => {
    backdrop.classList.add('open');
    sheet.classList.add('open');
    document.body.style.overflow = 'hidden';
  });
  backdrop.onclick = closeSheet;
  let startY = null;
  sheet.ontouchstart = e => { startY = e.touches[0].clientY; };
  sheet.ontouchmove  = e => { if (startY !== null && e.touches[0].clientY - startY > 80) { closeSheet(); startY = null; } };
  return { close: closeSheet };
}
function closeSheet() {
  document.querySelector('.sheet-backdrop')?.classList.remove('open');
  document.querySelector('.sheet')?.classList.remove('open');
  document.body.style.overflow = '';
}

// ── Clipboard / Share ────────────────────────────────────────
async function copyToClipboard(text) {
  try { await navigator.clipboard.writeText(text); }
  catch { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
  toast('Ссылка скопирована', { icon: '✓' });
}
async function shareLink(url, title) {
  if (navigator.share) { try { await navigator.share({ title, url }); return true; } catch {} }
  return false;
}
// Share arbitrary text, falling back to clipboard (with toast) when share is unavailable.
async function shareText(text) {
  if (navigator.share) { try { await navigator.share({ text }); return; } catch {} }
  await copyToClipboard(text);
}

// ── Public URL helpers ───────────────────────────────────────
function getPublicUrl(username) {
  const origin = location.hostname === 'localhost'
    ? 'https://bookme-app.online'
    : location.origin;
  return `${origin}/p?u=${encodeURIComponent(username)}`;
}
function getPrettyUrl(username) {
  return `bookme-app.online/${username}`;
}

function setupAppNavigation() {
  document.body.addEventListener('click', (event) => {
    const anchor = event.target.closest('a');
    if (!anchor || anchor.target && anchor.target !== '_self') return;

    const href = anchor.getAttribute('href');
    if (!href || href === '#' || href === '#!' || href.startsWith('javascript:')) {
      event.preventDefault();
      return;
    }
    if (href.startsWith('mailto:') || href.startsWith('tel:')) return;

    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return;
    if (url.pathname === window.location.pathname && url.hash) return;

    event.preventDefault();
    navigateTo(url.href);
  });

  requestAnimationFrame(() => document.body.classList.remove('page-exit'));
}
setupAppNavigation();

function isStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function addAppBackButton() {
  const topbar = document.querySelector('.topbar');
  if (!topbar || topbar.querySelector('.icon-btn-circle')) return;
  const back = document.createElement('a');
  back.className = 'icon-btn-circle';
  back.href = 'javascript:void(0)';
  back.setAttribute('aria-label', 'Назад');
  back.innerHTML = Icons.back;
  back.addEventListener('click', (e) => {
    e.preventDefault();
    if (window.history.length > 1) window.history.back();
    else window.location.href = '/login';
  });
  topbar.insertBefore(back, topbar.firstChild);
}

const VAPID_PUBLIC = 'BBMwcY30tnia_RZjEOEwwVEA6eC82Fy9P3gOksQ_jA0_00wA8Pp3T8N3YUGovZbwZLzmwy4ca8lZmc1JVR94bX0';

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      console.log('ServiceWorker registered:', reg.scope);
    } catch (err) {
      console.warn('ServiceWorker failed:', err);
    }
  });
}

// Convert VAPID public key to Uint8Array for pushManager.subscribe
function _vapidKey() {
  const b = VAPID_PUBLIC.replace(/-/g,'+').replace(/_/g,'/');
  const raw = atob(b.padEnd(b.length + (4 - b.length % 4) % 4, '='));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function setupPush(userId) {
  if (!('PushManager' in window) || !('Notification' in window)) {
    console.log('[Push] not supported'); return;
  }
  try {
    const reg  = await navigator.serviceWorker.ready;
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { console.log('[Push] denied'); return; }

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _vapidKey(),
      });
    }
    const json = sub.toJSON();
    const { error } = await sb.from('push_subscriptions').upsert({
      user_id:  userId,
      endpoint: json.endpoint,
      auth:     json.keys.auth,
      p256dh:   json.keys.p256dh,
    }, { onConflict: 'user_id,endpoint' });
    if (error) console.error('[Push] DB error:', error.message);
    else console.log('[Push] subscribed OK for', userId);
  } catch (e) {
    console.error('[Push] failed:', e.message);
  }
}

async function sendPush(userId, { title, body, url = '/' } = {}) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, title, body, url }),
    });
  } catch(e) { console.warn('[Push] send failed', e); }
}

let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  // Optionally show a custom install prompt in the app UI
  console.log('PWA install prompt ready');
});

window.addEventListener('appinstalled', () => {
  toast('BookMe установлен', { icon: '✓' });
});

function setupProgressiveApp() {
  document.documentElement.classList.toggle('standalone', isStandaloneMode());
  window.addEventListener('pageshow', () => document.body.classList.remove('page-exit'));
  window.addEventListener('popstate', () => document.body.classList.remove('page-exit'));
  addAppBackButton();
  registerServiceWorker();
}
setupProgressiveApp();

// ── SVG Icons ────────────────────────────────────────────────
const Icons = {
  home:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/></svg>`,
  calendar: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`,
  services: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h10"/></svg>`,
  user:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6"/></svg>`,
  search:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>`,
  admin:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/></svg>`,
  plus:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>`,
  chart:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 16 4-4 4 4 4-6"/></svg>`,
  sparkle:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>`,
  copy:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
  share:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>`,
  external: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
  camera:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
  star:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  coffee:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>`,
  warning:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  back:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`,
  logout:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
  image:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
  edit:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  phone:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.07 14.89a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 2.97 4h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 11.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 19z"/></svg>`,
  msg:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
};

// ── Tab Bars ─────────────────────────────────────────────────
function renderMasterTabBar(activeKey, badgeMap = {}) {
  _renderTabBar([
    { key: 'home',     label: 'Главная',  href: '/master',   icon: Icons.home },
    { key: 'bookings', label: 'Записи',   href: '/bookings', icon: Icons.calendar },
    { key: 'clients',  label: 'Клиенты',  href: '/clients',  icon: Icons.user },
    { key: 'profile',  label: 'Профиль',  href: '/profile',  icon: Icons.edit },
  ], activeKey, badgeMap);
}

function renderClientTabBar(activeKey, badgeMap = {}) {
  _renderTabBar([
    { key: 'home',    label: 'Главная',   href: '/client',   icon: Icons.home },
    { key: 'search',  label: 'Мастера',   href: '/client#search', icon: Icons.search },
    { key: 'mybookings', label: 'Записи', href: '/client#bookings', icon: Icons.calendar },
    { key: 'profile', label: 'Профиль',   href: '/client#profile',  icon: Icons.user },
  ], activeKey, badgeMap);
}

function renderAdminTabBar(activeKey, badgeMap = {}) {
  _renderTabBar([
    { key: 'home',  label: 'Обзор',       href: '/admin',          icon: Icons.home },
    { key: 'users', label: 'Польз-ли',    href: '/admin#users',    icon: Icons.user },
    { key: 'news',  label: 'Новости',     href: '/admin#news',     icon: Icons.services },
    { key: 'settings', label: 'Настройки',href: '/admin#settings', icon: Icons.admin },
  ], activeKey, badgeMap);
}

function _renderTabBar(tabs, activeKey, badgeMap) {
  const html = `<div class="tabbar-inner">${tabs.map(t => `
    <a href="${t.href}" class="${activeKey === t.key ? 'active' : ''}">
      ${t.icon}<span>${t.label}</span>
      ${badgeMap[t.key] ? `<span class="badge">${badgeMap[t.key]}</span>` : ''}
    </a>`).join('')}</div>`;
  let nav = document.querySelector('.tabbar');
  if (!nav) { nav = document.createElement('nav'); nav.className = 'tabbar'; document.body.appendChild(nav); }
  nav.innerHTML = html;
}

// ── Auto-render nav immediately on DOM ready based on URL ────────
// This guarantees the nav is ALWAYS visible before any async auth/data.
document.addEventListener('DOMContentLoaded', () => {
  const p = location.pathname;
  const masterPages = {
    '/master':       'home',
    '/bookings':     'bookings',
    '/clients':      'clients',
    '/profile':      'profile',
    '/profile-edit': 'profile',
    '/services':     'home',
    '/analytics':    'home',
    '/chat':         'home',
    '/subscription': 'profile',
    '/settings':     'profile',
  };
  const clientPages = { '/client': 'home' };
  const adminPages  = { '/admin': 'home' };
  if (masterPages[p] !== undefined) renderMasterTabBar(masterPages[p]);
  else if (clientPages[p] !== undefined) renderClientTabBar(clientPages[p]);
  else if (adminPages[p]  !== undefined) renderAdminTabBar(adminPages[p]);
});

// ── Stats calculation (from Supabase bookings array) ─────────
function calcStats(bookings) {
  const today    = bookings.filter(b => isToday(b.date_iso));
  const upcoming = bookings.filter(b => isFuture(b.date_iso));
  const last7    = Array.from({ length: 7 }, (_, i) => todayISO(-i));
  const revenue7 = bookings.filter(b => last7.includes(b.date_iso)).reduce((s, b) => s + (b.service_price || 0), 0);
  return {
    todayCount:    today.length,
    upcomingCount: upcoming.length,
    revenue7,
    weekData: last7.reverse().map(iso => ({
      iso,
      total: bookings.filter(b => b.date_iso === iso).reduce((s, b) => s + (b.service_price || 0), 0),
      count: bookings.filter(b => b.date_iso === iso).length,
    })),
  };
}

function calcAnalytics(bookings, period) {
  const labels = [], revenue = [], counts = [];
  const today = new Date();
  if (period === 'week') {
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0,10);
      const bb = bookings.filter(b => b.date_iso === iso);
      labels.push(['Вс','Пн','Вт','Ср','Чт','Пт','Сб'][d.getDay()]);
      revenue.push(bb.reduce((s,b) => s + (b.service_price||0), 0));
      counts.push(bb.length);
    }
  } else if (period === 'month') {
    for (let i = 3; i >= 0; i--) {
      const s = new Date(today); s.setDate(s.getDate() - i*7 - 6);
      const e = new Date(today); e.setDate(e.getDate() - i*7);
      const bb = bookings.filter(b => b.date_iso >= s.toISOString().slice(0,10) && b.date_iso <= e.toISOString().slice(0,10));
      labels.push(`Нед ${4-i}`);
      revenue.push(bb.reduce((s,b) => s + (b.service_price||0), 0));
      counts.push(bb.length);
    }
  } else {
    const mn = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(today); d.setMonth(d.getMonth() - i);
      const prefix = d.toISOString().slice(0,7);
      const bb = bookings.filter(b => b.date_iso?.startsWith(prefix));
      labels.push(mn[d.getMonth()]);
      revenue.push(bb.reduce((s,b) => s + (b.service_price||0), 0));
      counts.push(bb.length);
    }
  }
  const totalRevenue = revenue.reduce((s,x) => s+x, 0);
  const totalCount   = counts.reduce((s,x) => s+x, 0);
  return { labels, revenue, counts, totalRevenue, totalCount, avgCheck: totalCount ? Math.round(totalRevenue/totalCount) : 0 };
}

// ── Face ID / Passkeys (WebAuthn) ────────────────────────────
const PASSKEY_KEY = 'bm_passkey_id';

async function registerPasskey(profile) {
  if (!window.PublicKeyCredential) return;
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const idBytes   = new TextEncoder().encode(profile.id);
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'BookMe', id: location.hostname },
        user: { id: idBytes, name: profile.email, displayName: profile.name || profile.email },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'preferred' },
        timeout: 60000,
      },
    });
    if (cred) {
      localStorage.setItem(PASSKEY_KEY, JSON.stringify({ id: cred.id, userId: profile.id }));
      toast('Face ID / Touch ID сохранён', { icon: '✓' });
    }
  } catch (e) { console.log('[Passkey] register skipped:', e.message); }
}

async function tryPasskeyLogin() {
  const saved = JSON.parse(localStorage.getItem(PASSKEY_KEY) || 'null');
  if (!saved || !window.PublicKeyCredential) return false;
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const cred = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: location.hostname,
        allowCredentials: [{ type: 'public-key', id: _b64ToBytes(saved.id) }],
        userVerification: 'preferred',
        timeout: 60000,
      },
    });
    if (cred) {
      // Passkey verified — use cached Supabase session
      const session = await getSession();
      if (session) return session;
    }
  } catch (e) { console.log('[Passkey] login skipped:', e.message); }
  return false;
}

function hasPasskey() { return !!localStorage.getItem(PASSKEY_KEY); }

function _b64ToBytes(s) {
  const raw = atob(s.replace(/-/g,'+').replace(/_/g,'/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

// ── Animation utilities ───────────────────────────────────────

// Stagger-animate a list container (retriggers on re-render)
function staggerList(container) {
  if (!container) return;
  container.classList.remove('stagger');
  void container.offsetWidth; // force reflow to restart animation
  container.classList.add('stagger');
}

// Animate a numeric value counting up
function animateNumber(el, target, { duration = 550, prefix = '', suffix = '', decimals = 0 } = {}) {
  if (!el) return;
  const start = performance.now();
  const step = (now) => {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
    const val = decimals
      ? (eased * target).toFixed(decimals)
      : Math.round(eased * target).toLocaleString('ru');
    el.textContent = prefix + val + suffix;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Add pop class to stat elements with stagger
function animateStats(selectors) {
  selectors.forEach((sel, i) => {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    if (!el) return;
    el.classList.remove('anim-stat-pop');
    setTimeout(() => { void el.offsetWidth; el.classList.add('anim-stat-pop'); }, i * 60);
  });
}

// Fade + slide a section in
function fadeSection(el, delay = 0) {
  if (!el) return;
  el.style.opacity = '0';
  el.style.transform = 'translateY(12px)';
  el.style.transition = 'none';
  void el.offsetWidth;
  el.style.transition = `opacity .3s .${delay}s cubic-bezier(.25,.46,.45,.94), transform .3s .${delay}s cubic-bezier(.25,.46,.45,.94)`;
  el.style.opacity = '1';
  el.style.transform = 'translateY(0)';
}

// ── Debounce ─────────────────────────────────────────────────
function debounce(fn, ms = 300) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// ── HTML escaping (prevent injection when rendering DB content) ─
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
  ));
}

// ── News feed (admin-published announcements) ─────────────────
async function loadPublishedNews(limit = 10) {
  const { data, error } = await sb.from('news')
    .select('id, title, body, created_at')
    .eq('published', true)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) { console.warn('[News] load failed:', error.message); return []; }
  return data || [];
}

// Mount published news into a container. The closest [data-news-section]
// (or the container itself) is hidden when there is nothing to show.
async function mountNews(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const section = el.closest('[data-news-section]') || el;
  const items = await loadPublishedNews(10);
  if (!items.length) { section.hidden = true; return; }
  section.hidden = false;
  el.innerHTML = items.map(n => `
    <div class="news-card anim-fade-up">
      <div class="news-card-meta">${fmtDate(new Date(n.created_at))}</div>
      <div class="news-card-title">${escapeHtml(n.title)}</div>
      ${n.body ? `<div class="news-card-body">${escapeHtml(n.body)}</div>` : ''}
    </div>`).join('');
}

// ── App settings (admin-editable platform name / tagline) ─────
async function loadAppSettings() {
  try {
    const { data } = await sb.from('app_settings').select('app_name, tagline').eq('id', 1).maybeSingle();
    return data || null;
  } catch { return null; }
}

// ── Skeleton helpers ──────────────────────────────────────────
function skCard(lines = 2) {
  const lineHtml = Array.from({ length: lines }, (_, i) =>
    `<span class="sk sk-text" style="width:${i === 0 ? '65%' : '45%'};margin-top:${i ? '8px' : '0'};display:block;"></span>`
  ).join('');
  return `<div class="sk-card">
    <span class="sk sk-avatar" style="width:48px;height:48px;flex-shrink:0;"></span>
    <div style="flex:1;">${lineHtml}</div>
  </div>`;
}
function skCards(n = 3) { return Array.from({ length: n }, () => skCard()).join(''); }

// ── Image Cropper (pure JS canvas) ───────────────────────────
class ImageCropper {
  constructor({ aspectRatio = 1, cropSize = 280, onDone, onCancel } = {}) {
    this.ar = aspectRatio; this.cropSize = cropSize;
    this.onDone = onDone; this.onCancel = onCancel;
    this._build();
  }

  _build() {
    this.el = document.createElement('div');
    this.el.className = 'crop-overlay';
    this.el.innerHTML = `
      <div class="crop-header">
        <button class="crop-btn-cancel" id="_cc">Отмена</button>
        <h3>Кадрирование</h3>
        <button class="crop-btn-apply" id="_ca" style="flex:none;padding:8px 18px;font-size:14px;">Готово</button>
      </div>
      <div class="crop-canvas-wrap">
        <canvas id="_cv"></canvas>
        <div class="crop-frame" id="_cf">
          <div class="crop-corner-bl"></div><div class="crop-corner-br"></div>
        </div>
      </div>
      <p class="crop-hint">Перемещайте и масштабируйте фото</p>
      <div class="crop-actions" style="padding-bottom:calc(20px + var(--safe-bottom));">
        <button class="crop-btn-cancel" id="_cc2">Отмена</button>
        <button class="crop-btn-apply" id="_ca2">Применить</button>
      </div>`;
    document.body.appendChild(this.el);
    this.canvas = this.el.querySelector('#_cv');
    this.ctx    = this.canvas.getContext('2d');
    this.frame  = this.el.querySelector('#_cf');
    this.el.querySelectorAll('#_cc,#_cc2').forEach(b => b.onclick = () => this._cancel());
    this.el.querySelectorAll('#_ca,#_ca2').forEach(b => b.onclick = () => this._apply());
  }

  open(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { this._img = img; URL.revokeObjectURL(url); this._init(); };
    img.src = url;
  }

  _init() {
    const wrap  = this.el.querySelector('.crop-canvas-wrap');
    const W = wrap.clientWidth, H = wrap.clientHeight;
    this.canvas.width  = W; this.canvas.height = H;
    const cs = Math.min(this.cropSize, W * .85, H * .85);
    this.cropW = cs; this.cropH = cs / this.ar;
    this.cropX = (W - this.cropW) / 2; this.cropY = (H - this.cropH) / 2;

    const scale = Math.max(this.cropW / this._img.width, this.cropH / this._img.height) * 1.05;
    this.sc = scale;
    this.ox = W / 2; this.oy = H / 2;

    this.frame.style.cssText = `width:${this.cropW}px;height:${this.cropH}px;left:${this.cropX}px;top:${this.cropY}px;`;
    this._bindEvents(); this._draw();
  }

  _draw() {
    const c = this.canvas, img = this._img;
    c.width = c.width; // clear
    this.ctx.drawImage(img, this.ox - img.width * this.sc / 2, this.oy - img.height * this.sc / 2,
      img.width * this.sc, img.height * this.sc);
  }

  _bindEvents() {
    const c = this.canvas;
    // Mouse
    let down = false, lx, ly;
    c.addEventListener('mousedown', e => { down = true; lx = e.clientX; ly = e.clientY; });
    window.addEventListener('mousemove', e => {
      if (!down) return;
      this.ox += e.clientX - lx; this.oy += e.clientY - ly;
      lx = e.clientX; ly = e.clientY; this._draw();
    });
    window.addEventListener('mouseup', () => down = false);
    c.addEventListener('wheel', e => { e.preventDefault(); this.sc *= e.deltaY < 0 ? 1.07 : 0.93; this._draw(); }, { passive: false });

    // Touch
    let touches = [], pinchDist0 = 0, sc0 = 0;
    c.addEventListener('touchstart', e => {
      e.preventDefault(); touches = [...e.touches];
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchDist0 = Math.hypot(dx, dy); sc0 = this.sc;
      }
    }, { passive: false });
    c.addEventListener('touchmove', e => {
      e.preventDefault();
      if (e.touches.length === 1 && touches.length === 1) {
        this.ox += e.touches[0].clientX - touches[0].clientX;
        this.oy += e.touches[0].clientY - touches[0].clientY;
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        this.sc = sc0 * Math.hypot(dx, dy) / pinchDist0;
      }
      touches = [...e.touches]; this._draw();
    }, { passive: false });
  }

  _apply() {
    const out = document.createElement('canvas');
    out.width = this.cropW; out.height = this.cropH;
    const ctx = out.getContext('2d');
    const img = this._img;
    const sx = (this.cropX - this.ox + img.width * this.sc / 2) / this.sc;
    const sy = (this.cropY - this.oy + img.height * this.sc / 2) / this.sc;
    const sw = this.cropW / this.sc, sh = this.cropH / this.sc;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, this.cropW, this.cropH);
    out.toBlob(blob => { this._destroy(); this.onDone && this.onDone(blob); }, 'image/jpeg', .92);
  }

  _cancel() { this._destroy(); this.onCancel && this.onCancel(); }
  _destroy() { this.el.remove(); }
}

// Open file picker → crop → callback(blob)
function pickAndCrop({ aspectRatio = 1, cropSize = 280, accept = 'image/*' } = {}) {
  return new Promise((resolve, reject) => {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept, style: 'display:none' });
    document.body.appendChild(inp);
    inp.onchange = () => {
      const file = inp.files[0]; inp.remove();
      if (!file) return reject(new Error('cancelled'));
      new ImageCropper({ aspectRatio, cropSize, onDone: resolve, onCancel: () => reject(new Error('cancelled')) }).open(file);
    };
    inp.oncancel = () => { inp.remove(); reject(new Error('cancelled')); };
    inp.click();
  });
}

// ── Supabase Storage upload helper ───────────────────────────
async function uploadFile(bucket, path, file) {
  const { data, error } = await sb.storage.from(bucket).upload(path, file, { upsert: true });
  if (error) { toast('Ошибка загрузки: ' + error.message); return null; }
  const { data: { publicUrl } } = sb.storage.from(bucket).getPublicUrl(path);
  return publicUrl;
}
