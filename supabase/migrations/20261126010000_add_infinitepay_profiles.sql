begin;
create table public.infinitepay_profiles (
  id uuid primary key,
  handle text not null check (char_length(handle) between 1 and 100),
  encrypted_key text not null,
  created_at timestamptz not null default clock_timestamp()
);
create index infinitepay_profiles_latest_idx on public.infinitepay_profiles (created_at desc, id desc);
alter table public.infinitepay_profiles enable row level security;
revoke all on public.infinitepay_profiles from public, anon, authenticated;
grant select, insert on public.infinitepay_profiles to service_role;

alter table public.orders add column infinitepay_profile_id uuid references public.infinitepay_profiles(id);
commit;
