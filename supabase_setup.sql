-- ============================================================
-- ShelfSense - Run this ENTIRE file in Supabase SQL Editor
-- Go to: https://supabase.com/dashboard/project/rlcvrkeozciihjhstbop/sql
-- ============================================================

-- 1. TABLES

create table if not exists public.scales (
  id                      text primary key,
  item_name               text not null default 'Unknown Item',
  unit_weight_g           numeric not null default 100,    -- only used for grams-mode calibration
  shelf_location          text default '',
  baseline_units          integer not null default 0,
  baseline_checkout_count integer not null default 0,
  raw_value               float8,
  tare_offset             float8  not null default 0,      -- raw value at zero
  K_calibration           float8                            -- raw counts per unit (null = uncalibrated)
);

alter table public.scales
  add column if not exists raw_value float8;

create table if not exists public.readings (
  id         bigserial primary key,
  scale_id   text references public.scales(id) on delete cascade,
  raw_value  float8 not null,                              -- raw load-cell ADC count from HX711
  created_at timestamptz default now()
);

create table if not exists public.invoices (
  id         bigserial primary key,
  scale_id   text references public.scales(id) on delete cascade,
  quantity   integer not null,
  note       text default '',
  created_at timestamptz default now()
);

create table if not exists public.checkouts (
  id         bigserial primary key,
  scale_id   text references public.scales(id) on delete cascade,
  quantity   integer not null,
  created_at timestamptz default now()
);

-- 2. SEED DEFAULT SCALE CONFIGS
insert into public.scales (id, item_name, unit_weight_g, shelf_location) values
  ('scale_1', 'Apples',  150, 'Produce Shelf A'),
  ('scale_2', 'Oranges', 200, 'Produce Shelf B')
on conflict (id) do nothing;

-- 3. ROW LEVEL SECURITY (open for demo — restrict before production)
alter table public.scales    enable row level security;
alter table public.readings  enable row level security;
alter table public.invoices  enable row level security;
alter table public.checkouts enable row level security;

drop policy if exists "anon_all_scales"    on public.scales;
drop policy if exists "anon_all_readings"  on public.readings;
drop policy if exists "anon_all_invoices"  on public.invoices;
drop policy if exists "anon_all_checkouts" on public.checkouts;

create policy "anon_all_scales"    on public.scales    for all using (true) with check (true);
create policy "anon_all_readings"  on public.readings  for all using (true) with check (true);
create policy "anon_all_invoices"  on public.invoices  for all using (true) with check (true);
create policy "anon_all_checkouts" on public.checkouts for all using (true) with check (true);

-- 4. ENABLE REALTIME (required for live updates)
-- If you get "already exists" errors on these, that's fine — they're already on.
do $$
begin
  begin
    alter publication supabase_realtime add table public.readings;
  exception when others then null;
  end;
  begin
    alter publication supabase_realtime add table public.invoices;
  exception when others then null;
  end;
  begin
    alter publication supabase_realtime add table public.checkouts;
  exception when others then null;
  end;
  begin
    alter publication supabase_realtime add table public.scales;
  exception when others then null;
  end;
end $$;

-- 5. INDEX for fast latest-reading queries
create index if not exists readings_scale_id_time_idx
  on public.readings (scale_id, created_at desc);
