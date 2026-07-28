-- ---------------------------------------------------------------------
-- extra_schema_33.sql
-- Corrects the GED timetable so the first real class actually starts at
-- 9:00 AM. extra_schema_31.sql shifted every entry +40 minutes RELATIVE
-- to whatever start_time was already in the database — but if the live
-- schedule had already drifted from the original seed (e.g. an earlier
-- manual edit in the Timetable page) before that ran, the relative shift
-- landed on the wrong absolute time (reported: first class around 9:20
-- instead of 9:00).
--
-- This migration does not guess at the current state or shift anything
-- relatively again — it sets each entry's start_time/end_time to an
-- explicit, absolute, correct value, matched by its position in the
-- day's schedule (1st entry of the day, 2nd, 3rd, ...) rather than by
-- its current time. That position is extremely unlikely to have
-- changed even if individual times drifted. Session lengths and breaks
-- are unchanged from the original design — only the whole day's anchor
-- point moves so the first class lands exactly on 9:00 AM.
--
-- Safe to re-run. If a day doesn't have the expected number of entries
-- (11 for Mon-Thu, 10 for Fri — meaning rows were added/removed/edited
-- outside this migration's assumptions), that day is left untouched
-- rather than risk assigning the wrong time to the wrong row.
-- ---------------------------------------------------------------------

with target as (
  select * from (values
    -- Mon/Tue/Wed/Thu — identical instruction-day schedule.
    (1, '08:40'::time, '09:00'::time),
    (2, '09:00'::time, '10:20'::time),
    (3, '10:20'::time, '10:35'::time),
    (4, '10:35'::time, '11:55'::time),
    (5, '11:55'::time, '12:40'::time),
    (6, '12:40'::time, '13:55'::time),
    (7, '13:55'::time, '15:10'::time),
    (8, '15:10'::time, '15:25'::time),
    (9, '15:25'::time, '16:25'::time),
    (10, '16:25'::time, '17:10'::time),
    (11, '17:10'::time, '17:40'::time)
  ) as t(position, new_start, new_end)
),
ranked as (
  select
    id,
    day_of_week,
    row_number() over (partition by day_of_week order by start_time) as position,
    count(*) over (partition by day_of_week) as day_count
  from timetable_entries
  where test_id = (select id from tests where name = 'GED')
)
update timetable_entries te
set start_time = tg.new_start, end_time = tg.new_end
from ranked r
join target tg on tg.position = r.position
where te.id = r.id
  and r.day_of_week in ('Mon', 'Tue', 'Wed', 'Thu')
  and r.day_count = 11;

with ranked as (
  select
    id,
    day_of_week,
    row_number() over (partition by day_of_week order by start_time) as position,
    count(*) over (partition by day_of_week) as day_count
  from timetable_entries
  where test_id = (select id from tests where name = 'GED')
),
target_fri as (
  select * from (values
    (1, '08:40'::time, '09:00'::time),
    (2, '09:00'::time, '10:40'::time),
    (3, '10:40'::time, '10:55'::time),
    (4, '10:55'::time, '12:25'::time),
    (5, '12:25'::time, '13:10'::time),
    (6, '13:10'::time, '14:10'::time),
    (7, '14:10'::time, '15:10'::time),
    (8, '15:10'::time, '15:25'::time),
    (9, '15:25'::time, '16:40'::time),
    (10, '16:40'::time, '17:40'::time)
  ) as t(position, new_start, new_end)
)
update timetable_entries te
set start_time = tg.new_start, end_time = tg.new_end
from ranked r
join target_fri tg on tg.position = r.position
where te.id = r.id
  and r.day_of_week = 'Fri'
  and r.day_count = 10;
