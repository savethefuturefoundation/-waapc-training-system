-- ---------------------------------------------------------------------
-- extra_schema_27.sql
-- Duration/package pricing tiers per test (e.g. IELTS: 450,000 CFA for 2
-- months, 550,000 for 3, 650,000 for 4, 800,000 for 6, 1,500,000 for a
-- year). Registering a student can pick one of these and the price +
-- program end date fill in automatically, instead of a single flat price.
-- ---------------------------------------------------------------------
create table if not exists test_duration_packages (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references tests(id) on delete cascade,
  months numeric not null,
  price numeric not null,
  sort_order int not null default 0
);

alter table test_duration_packages enable row level security;

drop policy if exists "duration packages read" on test_duration_packages;
create policy "duration packages read" on test_duration_packages for select using (auth.role() = 'authenticated');

drop policy if exists "duration packages admin write" on test_duration_packages;
create policy "duration packages admin write" on test_duration_packages for all
  using (is_admin())
  with check (is_admin());

-- IELTS (Academic) real pricing tiers.
do $$
declare
  ielts_id uuid;
begin
  select id into ielts_id from tests where name = 'IELTS (Academic)';
  if ielts_id is null then
    return;
  end if;

  if not exists (select 1 from test_duration_packages where test_id = ielts_id) then
    insert into test_duration_packages (test_id, months, price, sort_order) values
    (ielts_id, 2, 450000, 1),
    (ielts_id, 3, 550000, 2),
    (ielts_id, 4, 650000, 3),
    (ielts_id, 6, 800000, 4),
    (ielts_id, 12, 1500000, 5);
  end if;

  -- The old single default (450,000 / "1 month") predates these real
  -- tiers — correct it to match the shortest real package.
  update tests
  set default_price = 450000, default_duration_label = '2 months | 2 sessions/week'
  where id = ielts_id;
end $$;
