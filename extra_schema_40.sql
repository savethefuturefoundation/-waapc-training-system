-- ---------------------------------------------------------------------
-- extra_schema_40.sql
-- Sidebar notification badges — lets any signed-in user record "I've
-- seen announcements up to this point in time", the same restrained
-- pattern extra_schema_19.sql used for self-service display names (an
-- RPC that only ever touches this one column, rather than a broad
-- self-update policy on profiles that could let someone change their
-- own role).
-- ---------------------------------------------------------------------

alter table profiles add column if not exists announcements_last_seen_at timestamptz;

create or replace function mark_announcements_seen() returns void
language plpgsql security definer as $$
begin
  update profiles set announcements_last_seen_at = now() where id = auth.uid();
end;
$$;

revoke all on function mark_announcements_seen() from public;
grant execute on function mark_announcements_seen() to authenticated;
