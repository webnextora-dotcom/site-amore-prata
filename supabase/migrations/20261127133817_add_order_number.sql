alter table public.orders
  add column order_number bigint generated always as identity (start with 100001),
  add constraint orders_order_number_unique unique (order_number);

grant usage on sequence public.orders_order_number_seq to service_role;
