/* ============================================================
   BookMe — Supabase client (loaded before app.js on every page)

   ▼▼▼ ЕДИНСТВЕННОЕ МЕСТО ПРИВЯЗКИ К SUPABASE ▼▼▼
   Чтобы переключить приложение на новый проект — замените
   ТОЛЬКО эти две строки значениями из нового проекта:
     Supabase → Settings → API → Project URL  и  anon public key.
   Больше нигде в коде проект не зашит.
   ============================================================ */
const SUPABASE_URL  = 'https://haacqhhqsasscqkkcofa.supabase.co';
const SUPABASE_ANON = 'sb_publishable_TnJWz_CrwilYHufl_3gRqw_TC7FRKp_';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storageKey: 'bookme_auth',
  },
});
