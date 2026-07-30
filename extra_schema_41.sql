-- ---------------------------------------------------------------------
-- extra_schema_41.sql
-- Fixes swapped activity labels on the GED content days. The times set
-- by extra_schema_37.sql were correct, but on at least Thursday the
-- "Break" and the 4th rotating-subject label ended up on the wrong
-- rows — Break sitting in the 75-minute last-class slot, and a subject
-- name squeezed into the 10-minute break slot. That also broke the
-- subject rotation for that slot, since the rotation only recognizes a
-- row as a class period if it's kind='class' with one of the four
-- subject names — a mislabeled 10-minute "class" was being included in
-- the rotation while the real 75-minute class was excluded.
--
-- This sets each row's activity/kind directly by its exact time (which
-- is already correct), rather than by position, so it's unaffected by
-- whatever caused the mismatch and fixes it uniformly across Mon-Thu
-- regardless of which day(s) were actually affected.
-- ---------------------------------------------------------------------

update timetable_entries set activity = 'Morning Meeting & Daily Goals', kind = 'plan'
where test_id = (select id from tests where name = 'GED') and day_of_week in ('Mon','Tue','Wed','Thu') and start_time = '08:40';

update timetable_entries set activity = 'Reading & Language Arts', kind = 'class'
where test_id = (select id from tests where name = 'GED') and day_of_week in ('Mon','Tue','Wed','Thu') and start_time = '09:00';

update timetable_entries set activity = 'Break', kind = 'rest'
where test_id = (select id from tests where name = 'GED') and day_of_week in ('Mon','Tue','Wed','Thu') and start_time = '10:20';

update timetable_entries set activity = 'Mathematics', kind = 'class'
where test_id = (select id from tests where name = 'GED') and day_of_week in ('Mon','Tue','Wed','Thu') and start_time = '10:35';

update timetable_entries set activity = 'Lunch', kind = 'rest'
where test_id = (select id from tests where name = 'GED') and day_of_week in ('Mon','Tue','Wed','Thu') and start_time = '11:55';

update timetable_entries set activity = 'Science', kind = 'class'
where test_id = (select id from tests where name = 'GED') and day_of_week in ('Mon','Tue','Wed','Thu') and start_time = '12:40';

update timetable_entries set activity = 'Break', kind = 'rest'
where test_id = (select id from tests where name = 'GED') and day_of_week in ('Mon','Tue','Wed','Thu') and start_time = '13:55';

update timetable_entries set activity = 'Social Studies', kind = 'class'
where test_id = (select id from tests where name = 'GED') and day_of_week in ('Mon','Tue','Wed','Thu') and start_time = '14:05';
