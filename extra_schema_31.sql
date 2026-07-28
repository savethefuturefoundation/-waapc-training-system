-- ---------------------------------------------------------------------
-- extra_schema_31.sql
-- GED timetable: the first real class now starts at 9:00 AM instead of
-- 8:20 AM (the whole day shifts forward by 40 minutes, every day
-- Mon-Fri). Session lengths and breaks are unchanged — this only moves
-- start_time/end_time uniformly. The subject-rotation feature is
-- time-independent (it only cares about day/period order), so it keeps
-- working correctly with the new times, no code change needed.
-- ---------------------------------------------------------------------
update timetable_entries
set start_time = start_time + interval '40 minutes',
    end_time = end_time + interval '40 minutes'
where test_id = (select id from tests where name = 'GED');
