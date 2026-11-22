alter table public.orders
  add column if not exists shipping_requested boolean not null default false,
  add column if not exists shipping_method text check (shipping_method in ('PAC','SEDEX')),
  add column if not exists shipping_days integer check (shipping_days between 1 and 90),
  add column if not exists tracking_code text check (tracking_code ~ '^[A-Z]{2}[0-9]{9}[A-Z]{2}$'),
  add column if not exists checkout_expires_at timestamptz,
  add column if not exists checkout_lock_until timestamptz;
