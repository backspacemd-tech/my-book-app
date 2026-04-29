/* ============================================================
   BookMe — Supabase client (loaded before app.js on every page)
   ============================================================ */
const SUPABASE_URL  = 'https://bxuiggebgnxewmjwkbqa.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4dWlnZ2ViZ254ZXdtandrYnFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NjYxMTAsImV4cCI6MjA5MzA0MjExMH0.SmAPq3glvy43k7y6OsiD7Os3JOE9nKtoROmOHMytfC0';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storageKey: 'bookme_auth',
  },
});
