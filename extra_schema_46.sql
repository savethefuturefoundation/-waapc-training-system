-- ---------------------------------------------------------------------
-- extra_schema_46.sql
-- Campus canteen ordering. Students and teachers place an order from an
-- admin-managed menu; everything is delivered to them on campus (no
-- off-site pickup), so there's no delivery-address field — just who's
-- ordering, what, and an optional payment-receipt upload admin can use
-- to reconcile payment. Admin tracks every order's status.
-- ---------------------------------------------------------------------

create table if not exists canteen_items (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'Plats',
  name text not null,
  note text,
  price numeric not null check (price >= 0),
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table canteen_items enable row level security;

drop policy if exists "canteen items read" on canteen_items;
create policy "canteen items read" on canteen_items for select using (auth.role() = 'authenticated');

drop policy if exists "canteen items admin write" on canteen_items;
create policy "canteen items admin write" on canteen_items for all using (is_admin()) with check (is_admin());

create table if not exists canteen_orders (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users(id) on delete cascade,
  orderer_name text not null,
  orderer_class text not null,
  notes text,
  total numeric not null default 0,
  status text not null default 'pending' check (status in ('pending', 'preparing', 'ready', 'delivered', 'cancelled')),
  receipt_url text,
  created_at timestamptz not null default now()
);

alter table canteen_orders enable row level security;

-- Only student/teacher accounts can place an order (parents/admin don't
-- order for themselves here).
drop policy if exists "canteen orders self insert" on canteen_orders;
create policy "canteen orders self insert" on canteen_orders for insert with check (
  created_by = auth.uid()
  and exists (select 1 from profiles where id = auth.uid() and role in ('student', 'teacher'))
);

drop policy if exists "canteen orders self read" on canteen_orders;
create policy "canteen orders self read" on canteen_orders for select using (created_by = auth.uid());

drop policy if exists "canteen orders admin all" on canteen_orders;
create policy "canteen orders admin all" on canteen_orders for all using (is_admin()) with check (is_admin());

create table if not exists canteen_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references canteen_orders(id) on delete cascade,
  item_id uuid references canteen_items(id) on delete set null,
  item_name text not null,
  unit_price numeric not null,
  quantity int not null check (quantity > 0)
);

alter table canteen_order_items enable row level security;

drop policy if exists "canteen order items self insert" on canteen_order_items;
create policy "canteen order items self insert" on canteen_order_items for insert with check (
  exists (select 1 from canteen_orders o where o.id = order_id and o.created_by = auth.uid())
);

drop policy if exists "canteen order items self read" on canteen_order_items;
create policy "canteen order items self read" on canteen_order_items for select using (
  exists (select 1 from canteen_orders o where o.id = order_id and o.created_by = auth.uid())
);

drop policy if exists "canteen order items admin all" on canteen_order_items;
create policy "canteen order items admin all" on canteen_order_items for all using (is_admin()) with check (is_admin());

-- attach_canteen_receipt(): lets whoever placed an order attach a payment
-- receipt afterward, without opening up general UPDATE on canteen_orders
-- (which would also let them rewrite their own status). Same restrained
-- security-definer pattern as update_my_name()/mark_announcements_seen().
create or replace function attach_canteen_receipt(p_order_id uuid, p_receipt_path text) returns void
language plpgsql security definer as $$
begin
  update canteen_orders set receipt_url = p_receipt_path
  where id = p_order_id and created_by = auth.uid();
  if not found then
    raise exception 'Order not found or not yours';
  end if;
end;
$$;

revoke all on function attach_canteen_receipt(uuid, text) from public;
grant execute on function attach_canteen_receipt(uuid, text) to authenticated;

-- Receipts can contain personal payment info, so the bucket is private —
-- the uploader (folder = their own auth uid) and admin can read.
insert into storage.buckets (id, name, public)
values ('canteen-receipts', 'canteen-receipts', false)
on conflict (id) do nothing;

drop policy if exists "canteen receipts self all" on storage.objects;
create policy "canteen receipts self all" on storage.objects for all
  using (bucket_id = 'canteen-receipts' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'canteen-receipts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "canteen receipts admin read" on storage.objects;
create policy "canteen receipts admin read" on storage.objects for select
  using (bucket_id = 'canteen-receipts' and is_admin());

-- Seed the menu from the school's current canteen partner (Afrikme).
-- Safe to re-run — only seeds if the menu is still empty, so admin's
-- later edits from the app are never overwritten.
do $$
begin
  if exists (select 1 from canteen_items limit 1) then
    return;
  end if;

  insert into canteen_items (category, name, note, price, sort_order) values
  ('Plats', 'Jollof rice with chicken', 'Riz jollof, poulet', 2500, 1),
  ('Plats', 'Fried rice with meat', 'Riz sauté, viande', 2500, 2),
  ('Plats', 'Braised rice with sausage & fried eggs', 'Wet salad', 2500, 3),
  ('Plats', 'Noodles with chicken', 'Nouilles, poulet', 2000, 4),
  ('Plats', 'Attiéké poisson', 'Attiéké, poisson', 2000, 5),
  ('Plats', 'Fried potatoes with chicken', 'Pommes de terre, poulet', 2000, 6),
  ('Plats', 'Céleste (taille moyenne)', 'Pâtisserie', 500, 7),
  ('Boissons', 'Coca-Cola', null, 500, 1),
  ('Boissons', 'Fanta', null, 500, 2),
  ('Boissons', 'Bissap', null, 500, 3),
  ('Boissons', 'Tampico', null, 500, 4),
  ('Boissons', 'Big bottle water', null, 500, 5),
  ('Boissons', 'Small bottle water', null, 300, 6);
end $$;
