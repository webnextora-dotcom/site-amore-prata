begin;
create table public.store_admins (id uuid primary key references auth.users on delete cascade);
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('Anéis','Brincos','Colares','Pulseiras','Conjuntos')),
  sku text check (sku is null or (char_length(sku) between 1 and 48)),
  stock_quantity integer check (stock_quantity >= 0),
  description text not null default '',
  image_url text not null default '',
  price integer not null check (price between 1 and 99999999),
  active boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  customer jsonb not null,
  items jsonb not null,
  total integer not null check (total > 0),
  shipping integer not null check (shipping >= 0),
  payment_status text not null default 'pending' check (payment_status in ('pending','paid')),
  fulfillment text not null default 'pending' check (fulfillment in ('pending','shipped','delivered')),
  transaction_nsu text unique,
  invoice_slug text,
  paid_at timestamptz,
  checkout_url text,
  created_at timestamptz not null default now()
);
alter table public.store_admins enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
revoke all on public.store_admins, public.products, public.orders from anon, authenticated;
grant select on public.store_admins to service_role;
grant select, insert, update on public.products, public.orders to service_role;
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('product-images','product-images',true,4194304,array['image/jpeg','image/png','image/webp']);
commit;
