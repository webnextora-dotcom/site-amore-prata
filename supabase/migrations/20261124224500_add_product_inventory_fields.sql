begin;
alter table public.products
  add column if not exists sku text check (sku is null or (char_length(sku) between 1 and 48)),
  add column if not exists stock_quantity integer check (stock_quantity >= 0);
create unique index if not exists products_live_sku_key
  on public.products (sku)
  where sku is not null and deleted_at is null;
notify pgrst, 'reload schema';
commit;
