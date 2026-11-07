create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid')),
  customer jsonb not null,
  delivery_method text not null
    check (delivery_method in ('courier', 'pudo')),
  delivery_label text not null,
  delivery_details jsonb not null,
  items jsonb not null,
  subtotal_cents integer not null check (subtotal_cents >= 0),
  delivery_cents integer not null check (delivery_cents >= 0),
  total_cents integer not null check (total_cents = subtotal_cents + delivery_cents),
  currency text not null default 'ZAR' check (currency = 'ZAR'),
  receipt_token_hash text not null,
  pf_payment_id text unique,
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_payment_status_idx on public.orders (payment_status);

alter table public.orders enable row level security;
revoke all on public.orders from anon, authenticated;
grant all on public.orders to service_role;
