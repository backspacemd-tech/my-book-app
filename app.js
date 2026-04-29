/* ============================================================
   BookMe — shared utilities (loaded after config.js)
   ============================================================ */

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

async function getMasterRecord(userId) {
  const { data } = await sb.from('masters').select('*').eq('id', userId).single();
  return data;
}

async function isFirstProfile() {
  const { count } = await sb.from('profiles').select('id', { count: 'exact', head: true });
  return !count;
}

async function ensureMasterRecord(user, attrs = {}) {
  const { data: master } = await sb.from('masters').select('*').eq('id', user.id).single();
  if (master) return master;
  const email = attrs.email || user.email || '';
  const username = attrs.username || email.split('@')[0] || user.id.slice(0, 8);
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
  const isFirst = await isFirstProfile();
  const role = isFirst ? 'admin' : (attrs.role || user.user_metadata?.role || user.app_metadata?.role || 'client');
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
  const map = { admin: 'admin.html', master: 'master.html', client: 'client.html' };
  window.location.href = map[role] || 'client.html';
}

// Guard: ensure session, return {session, profile}. Redirects if not authenticated.
async function requireAuth(expectedRole = null) {
  let session;
  try { session = await getSession(); } catch { session = null; }
  if (!session) { window.location.href = 'index.html'; return null; }

  let profile;
  try {
    profile = await ensureProfile(session.user, {
      email: session.user.email,
      name: session.user.user_metadata?.name || session.user.user_metadata?.full_name || undefined,
    });
  } catch (e) {
    console.error('Profile load failed', e);
    window.location.href = 'index.html'; return null;
  }
  if (!profile) { window.location.href = 'index.html'; return null; }

  if (expectedRole && profile.role !== expectedRole && profile.role !== 'admin') {
    redirectByRole(profile.role); return null;
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
  document.body.classList.add('page-exit');
  await new Promise((resolve) => setTimeout(resolve, 180));
  window.location.href = url;
}

async function signOut() {
  await sb.auth.signOut();
  await navigateTo('index.html');
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

// ── Public URL helpers ───────────────────────────────────────
function getPublicUrl(username) {
  const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, '');
  return `${base}p.html?u=${encodeURIComponent(username)}`;
}
function getPrettyUrl(username) { return `bookme.app/${username}`; }

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
  back.textContent = '←';
  back.addEventListener('click', (e) => {
    e.preventDefault();
    if (window.history.length > 1) window.history.back();
    else window.location.href = 'index.html';
  });
  topbar.insertBefore(back, topbar.firstChild);
}

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
};

// ── Tab Bars ─────────────────────────────────────────────────
function renderMasterTabBar(activeKey, badgeMap = {}) {
  _renderTabBar([
    { key: 'home',     label: 'Главная', href: 'master.html',    icon: Icons.home },
    { key: 'bookings', label: 'Записи',  href: 'bookings.html',  icon: Icons.calendar },
    { key: 'services', label: 'Услуги',  href: 'services.html',  icon: Icons.services },
    { key: 'profile',  label: 'Профиль', href: 'profile.html',   icon: Icons.user },
  ], activeKey, badgeMap);
}

function renderClientTabBar(activeKey, badgeMap = {}) {
  _renderTabBar([
    { key: 'home',    label: 'Главная',   href: 'client.html',   icon: Icons.home },
    { key: 'search',  label: 'Мастера',   href: 'client.html#search', icon: Icons.search },
    { key: 'mybookings', label: 'Записи', href: 'client.html#bookings', icon: Icons.calendar },
    { key: 'profile', label: 'Профиль',   href: 'client.html#profile',  icon: Icons.user },
  ], activeKey, badgeMap);
}

function renderAdminTabBar(activeKey, badgeMap = {}) {
  _renderTabBar([
    { key: 'home',  label: 'Обзор',       href: 'admin.html',          icon: Icons.home },
    { key: 'users', label: 'Польз-ли',    href: 'admin.html#users',    icon: Icons.user },
    { key: 'news',  label: 'Новости',     href: 'admin.html#news',     icon: Icons.services },
    { key: 'settings', label: 'Настройки',href: 'admin.html#settings', icon: Icons.admin },
  ], activeKey, badgeMap);
}

// Legacy alias for pages that still call renderTabBar()
function renderTabBar(activeKey, badgeMap = {}) { renderMasterTabBar(activeKey, badgeMap); }

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

// ── Mock AI response ─────────────────────────────────────────
function mockAIResponse(message, profile, bookings, services = []) {
  const msg = message.toLowerCase().trim();
  const stats = calcStats(bookings);
  if (/привет|здравств|hi\b|hello/.test(msg))
    return `Привет, ${profile.name || 'мастер'}! Я ваш ИИ-ассистент. Спросите о записях, выручке или попросите бизнес-совет.`;
  if (/записей|клиент|запись/.test(msg))
    return `Предстоящих записей: ${stats.upcomingCount}, сегодня: ${stats.todayCount}. Выручка за 7 дней: ${fmt$(stats.revenue7)}.`;
  if (/выручк|доход|деньг/.test(msg)) {
    const avg = bookings.length ? Math.round(bookings.reduce((s,b) => s+b.service_price,0)/bookings.length) : 0;
    return `За 7 дней: ${fmt$(stats.revenue7)}. Всего записей: ${bookings.length}. Средний чек: ${fmt$(avg)}.`;
  }
  if (/услуг|прайс|цен/.test(msg)) {
    if (!services.length) return 'У вас пока нет услуг в прайсе. Добавьте в разделе «Услуги».';
    const sorted = [...services].sort((a,b) => b.price-a.price);
    return `Самая дорогая: «${sorted[0].name}» (${fmt$(sorted[0].price)}). Услуг всего: ${services.length}.`;
  }
  if (/совет|рекоменд|как/.test(msg)) {
    const tips = [
      'Добавьте услугу «Экспресс» — привлекает клиентов с ограниченным временем.',
      'Поделитесь ссылкой в Stories — быстрый способ получить новые записи.',
      'Скидка 10% на первый визит увеличивает конверсию на 35%.',
      'Попросите постоянных клиентов оставить отзыв — рейтинг поднимет позиции.',
    ];
    return tips[Math.floor(Math.random()*tips.length)];
  }
  const fb = [
    `У вас ${services.length} услуг и ${stats.upcomingCount} предстоящих записей. Спросите подробнее!`,
    'Спросите о записях, выручке, услугах или попросите бизнес-совет.',
  ];
  return fb[Math.floor(Math.random()*fb.length)];
}

// ── In-memory cache with TTL ──────────────────────────────────
const _cache = new Map();
function getCached(key, fetcher, ttl = 30_000) {
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.ts < ttl) return Promise.resolve(hit.data);
  return fetcher().then(data => { _cache.set(key, { data, ts: Date.now() }); return data; });
}
function invalidateCache(...keys) { keys.forEach(k => _cache.delete(k)); }

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

// ── Supabase Storage upload helper ───────────────────────────
async function uploadFile(bucket, path, file) {
  const { data, error } = await sb.storage.from(bucket).upload(path, file, { upsert: true });
  if (error) { toast('Ошибка загрузки: ' + error.message); return null; }
  const { data: { publicUrl } } = sb.storage.from(bucket).getPublicUrl(path);
  return publicUrl;
}

