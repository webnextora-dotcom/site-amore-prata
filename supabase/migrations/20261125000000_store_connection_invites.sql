create table public.store_connection_invites (
  invite_hash text primary key,
  project_ref text not null,
  project_name text not null,
  confirmed_at timestamptz not null default now()
);

alter table public.store_connection_invites enable row level security;
revoke all on public.store_connection_invites from anon, authenticated;
grant insert on public.store_connection_invites to service_role;
