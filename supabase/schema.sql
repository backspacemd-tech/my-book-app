-- BookMe production baseline for Supabase.
-- Run this in Supabase SQL editor before opening the app to public users.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  role text not null default 'client' check (role in ('admin','master','client')),
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.masters (
  id uuid primary key references public.profiles(id) on delete cascade,
  username text unique,
  specialty text,
  description text,
  city text,
  instagram text,
  telegram text,
  accepts_online boolean not null default true,
  plan text not null default 'free',
  trial_ends timestamptz,
  next_billing timestamptz,
  rating numeric not null default 0,
  reviews_count integer not null default 0,
  expenses numeric not null default 0,
  cover_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  master_id uuid not null references public.masters(id) on delete cascade,
  name text not null,
  description text,
  price numeric not null default 0,
  duration integer not null default 30,
  image_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  master_id uuid not null references public.masters(id) on delete cascade,
  client_id uuid references public.profiles(id) on delete set null,
  service_id uuid references public.services(id) on delete set null,
  service_name text,
  service_price numeric not null default 0,
  service_duration integer not null default 30,
  date_iso date not null,
  time text not null,
  client_name text not null,
  client_phone text not null,
  client_email text,
  status text not null default 'upcoming' check (status in ('upcoming','cancelled','done')),
  created_at timestamptz not null default now(),
  unique(master_id, date_iso, time)
);

create table if not exists public.portfolio (
  id uuid primary key default gen_random_uuid(),
  master_id uuid not null references public.masters(id) on delete cascade,
  url text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  master_id uuid not null references public.masters(id) on delete cascade,
  stars integer not null check (stars between 1 and 5),
  text text,
  who text,
  created_at timestamptz not null default now()
);

create table if not exists public.master_ratings (
  id uuid primary key default gen_random_uuid(),
  master_id uuid not null references public.masters(id) on delete cascade,
  stars integer not null check (stars between 1 and 5),
  created_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  auth text not null,
  p256dh text not null,
  created_at timestamptz not null default now(),
  unique(user_id, endpoint)
);

create table if not exists public.news (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text,
  published boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role text not null default 'master' check (role in ('master','client')),
  token text not null default encode(gen_random_bytes(16), 'hex'),
  created_at timestamptz not null default now()
);

-- Single-row platform settings, editable from the admin panel.
create table if not exists public.app_settings (
  id integer primary key default 1,
  app_name text not null default 'BookMe',
  tagline text not null default 'Онлайн-запись для мастеров и клиентов',
  updated_at timestamptz not null default now(),
  constraint app_settings_singleton check (id = 1)
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

-- is_admin() is defined here (AFTER tables exist — it references public.profiles).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

alter table public.profiles enable row level security;
alter table public.masters enable row level security;
alter table public.services enable row level security;
alter table public.bookings enable row level security;
alter table public.portfolio enable row level security;
alter table public.reviews enable row level security;
alter table public.master_ratings enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.news enable row level security;
alter table public.invitations enable row level security;
alter table public.app_settings enable row level security;

drop policy if exists "profiles self read" on public.profiles;
create policy "profiles self read" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles self insert" on public.profiles;
create policy "profiles self insert" on public.profiles
  for insert with check (id = auth.uid());

drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update" on public.profiles
  for update using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop policy if exists "masters public read" on public.masters;
create policy "masters public read" on public.masters
  for select using (accepts_online = true or id = auth.uid() or public.is_admin());

drop policy if exists "masters owner write" on public.masters;
create policy "masters owner write" on public.masters
  for all using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop policy if exists "services public read" on public.services;
create policy "services public read" on public.services
  for select using (true);

drop policy if exists "services owner write" on public.services;
create policy "services owner write" on public.services
  for all using (master_id = auth.uid() or public.is_admin())
  with check (master_id = auth.uid() or public.is_admin());

drop policy if exists "bookings related read" on public.bookings;
create policy "bookings related read" on public.bookings
  for select using (master_id = auth.uid() or client_id = auth.uid() or public.is_admin());

drop policy if exists "bookings public create" on public.bookings;
create policy "bookings public create" on public.bookings
  for insert with check (true);

drop policy if exists "bookings related update" on public.bookings;
create policy "bookings related update" on public.bookings
  for update using (master_id = auth.uid() or client_id = auth.uid() or public.is_admin())
  with check (master_id = auth.uid() or client_id = auth.uid() or public.is_admin());

drop policy if exists "portfolio public read" on public.portfolio;
create policy "portfolio public read" on public.portfolio
  for select using (true);

drop policy if exists "portfolio owner write" on public.portfolio;
create policy "portfolio owner write" on public.portfolio
  for all using (master_id = auth.uid() or public.is_admin())
  with check (master_id = auth.uid() or public.is_admin());

drop policy if exists "reviews public read" on public.reviews;
create policy "reviews public read" on public.reviews
  for select using (true);

drop policy if exists "ratings public insert" on public.master_ratings;
create policy "ratings public insert" on public.master_ratings
  for insert with check (true);

drop policy if exists "ratings public read" on public.master_ratings;
create policy "ratings public read" on public.master_ratings
  for select using (true);

drop policy if exists "push owner write" on public.push_subscriptions;
create policy "push owner write" on public.push_subscriptions
  for all using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists "news public read published" on public.news;
create policy "news public read published" on public.news
  for select using (published = true or public.is_admin());

drop policy if exists "news admin write" on public.news;
create policy "news admin write" on public.news
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "invitations admin write" on public.invitations;
create policy "invitations admin write" on public.invitations
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "app_settings public read" on public.app_settings;
create policy "app_settings public read" on public.app_settings
  for select using (true);

drop policy if exists "app_settings admin write" on public.app_settings;
create policy "app_settings admin write" on public.app_settings
  for all using (public.is_admin()) with check (public.is_admin());
