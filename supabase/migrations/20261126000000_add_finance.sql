create table if not exists public.order_danfes (
  order_id uuid primary key references public.orders(id) on delete cascade,
  pdf_base64 text not null check (length(pdf_base64) between 8 and 4000000)
);

alter table public.order_danfes enable row level security;
revoke all on public.order_danfes from public, anon, authenticated;
grant select, insert, update on public.order_danfes to service_role;

create index if not exists orders_finance_paid_date_idx
  on public.orders ((coalesce(paid_at, created_at)), id)
  where payment_status = 'paid';

create or replace function public.store_finance(
  start_date date, end_date date, "grouping" text, page_offset integer
) returns jsonb
language sql stable set search_path = ''
as $$
  with sales as materialized (
    select id, total, shipping, coalesce(paid_at, created_at) as sale_at
    from public.orders
    where payment_status = 'paid'
      and coalesce(paid_at, created_at) >= (start_date::timestamp at time zone 'America/Sao_Paulo')
      and coalesce(paid_at, created_at) < ((end_date + 1)::timestamp at time zone 'America/Sao_Paulo')
  ),
  periods as (
    select date_trunc("grouping", sale_at at time zone 'America/Sao_Paulo')::date as period,
           count(*) as count, sum(total) as total, sum(shipping) as shipping
    from sales
    group by 1
  ),
  page as (
    select s.id, s.total, s.shipping, s.sale_at, o.paid_at is null as legacy_date,
           o.customer->>'name' as customer, d.order_id is not null as has_danfe
    from (select * from sales order by sale_at desc, id desc limit 25 offset page_offset) s
    join public.orders o on o.id = s.id
    left join public.order_danfes d on d.order_id = s.id
  )
  select jsonb_build_object(
    'count', (select count(*) from sales),
    'total', (select coalesce(sum(total), 0) from sales),
    'shipping', (select coalesce(sum(shipping), 0) from sales),
    'periods', (select coalesce(jsonb_agg(periods order by period desc), '[]'::jsonb) from periods),
    'orders', (select coalesce(jsonb_agg(page order by sale_at desc, id desc), '[]'::jsonb) from page)
  );
$$;

revoke all on function public.store_finance(date, date, text, integer) from public, anon, authenticated;
grant execute on function public.store_finance(date, date, text, integer) to service_role;
