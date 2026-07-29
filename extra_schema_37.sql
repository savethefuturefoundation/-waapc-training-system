-- ---------------------------------------------------------------------
-- extra_schema_37.sql
-- Fixes the GED content days (Mon/Tue/Wed/Thu) for real this time.
--
-- extra_schema_33.sql refused to touch these days because they only had
-- 7 rows each instead of the original 11 — a safety check working as
-- designed, since 4 rows (a second break, Writing Workshop, Guided
-- Homework Session, Reflection) had been deleted at some point via the
-- Timetable page's Delete button. Confirmed by comparing against
-- Friday, which still had all its rows and was already correct.
--
-- Per instruction: Friday is a testing day with its own structure and
-- is intentionally left untouched. For Mon/Tue/Wed/Thu, the 3 removed
-- afternoon blocks (Writing Workshop, Guided Homework, Reflection) are
-- NOT restored — only a new 10-minute break is added between the last
-- two classes, then every period is set to its correct absolute time
-- so the first class starts at 9:00 AM. Session lengths for the
-- existing periods are unchanged; only the day's anchor point moves and
-- the new break is inserted.
--
-- Safe to re-run: the break is only inserted if a day still has exactly
-- 7 rows (i.e., hasn't been inserted already), and the time-fix only
-- touches a day with exactly 8 rows (i.e., after the break exists).
-- ---------------------------------------------------------------------

-- 1. Insert the new 10-minute break between the 6th and 7th chronological
-- entries (Science-slot and Social-Studies-slot), only if the day still
-- has exactly 7 rows.
insert into timetable_entries (test_id, day_of_week, start_time, end_time, activity, kind, sort_order)
select ranked.test_id, ranked.day_of_week, ranked.end_time, ranked.end_time + interval '1 minute', 'Break', 'rest', 100
from (
  select
    te.test_id, te.day_of_week, te.end_time,
    row_number() over (partition by te.day_of_week order by te.start_time) as position,
    count(*) over (partition by te.day_of_week) as day_count
  from timetable_entries te
  where te.test_id = (select id from tests where name = 'GED')
    and te.day_of_week in ('Mon', 'Tue', 'Wed', 'Thu')
) ranked
where ranked.position = 6
  and ranked.day_count = 7;

-- 2. Set every period (now 8 per day) to its correct absolute time.
with target as (
  select * from (values
    (1, '08:40'::time, '09:00'::time),  -- Morning Meeting & Daily Goals
    (2, '09:00'::time, '10:20'::time),  -- 1st rotating class (80 min)
    (3, '10:20'::time, '10:35'::time),  -- Break
    (4, '10:35'::time, '11:55'::time),  -- 2nd rotating class (80 min)
    (5, '11:55'::time, '12:40'::time),  -- Lunch
    (6, '12:40'::time, '13:55'::time),  -- 3rd rotating class (75 min)
    (7, '13:55'::time, '14:05'::time),  -- new 10-min Break
    (8, '14:05'::time, '15:20'::time)   -- 4th rotating class (75 min)
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
    and day_of_week in ('Mon', 'Tue', 'Wed', 'Thu')
)
update timetable_entries te
set start_time = tg.new_start, end_time = tg.new_end
from ranked r
join target tg on tg.position = r.position
where te.id = r.id
  and r.day_count = 8;
