create table public.pagbank_store_connections (
  store_id text not null,
  environment text not null check (environment in ('sandbox', 'production')),
  invite_hash text not null,
  invite_expires_at timestamptz not null,
  invite_used_at timestamptz,
  token_ciphertext text,
  token_expires_at timestamptz,
  connected_at timestamptz,
  primary key (store_id, environment)
);

alter table public.pagbank_store_connections enable row level security;
revoke all on public.pagbank_store_connections from public, anon, authenticated;
grant select, insert, update on public.pagbank_store_connections to service_role;
