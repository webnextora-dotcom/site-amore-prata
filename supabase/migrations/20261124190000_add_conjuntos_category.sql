begin;
alter table public.products
  drop constraint if exists products_category_check,
  add constraint products_category_check
  check (category in ('Anéis','Brincos','Colares','Pulseiras','Conjuntos'));
commit;
