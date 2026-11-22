alter table public.orders add column if not exists deleted_at timestamptz;
