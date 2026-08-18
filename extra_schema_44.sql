-- ---------------------------------------------------------------------
-- extra_schema_44.sql
-- Freezes the GED weekday subject rotation. Students and teachers were
-- confused by the timetable relabeling itself every week (the app was
-- computing which subject occupies each class slot from a formula keyed
-- off the calendar week, purely client-side — the stored rows never
-- changed, only what was displayed). Bakes in exactly what the rotation
-- was showing this week as the new fixed, permanent schedule for every
-- week going forward. Paired with removing the client-side rotation
-- logic in main.js, so from here on this table is the single source of
-- truth with nothing recomputing it.
-- ---------------------------------------------------------------------

update timetable_entries set activity = 'Mathematics'
where test_id = (select id from tests where name = 'GED') and day_of_week = 'Mon' and start_time = '09:00';
update timetable_entries set activity = 'Science'
where test_id = (select id from tests where name = 'GED') and day_of_week = 'Mon' and start_time = '10:35';
update timetable_entries set activity = 'Social Studies'
where test_id = (select id from tests where name = 'GED') and day_of_week = 'Mon' and start_time = '12:40';
update timetable_entries set activity = 'Reading & Language Arts'
where test_id = (select id from tests where name = 'GED') and day_of_week = 'Mon' and start_time = '14:05';

update timetable_entries set activity = 'Science'
where test_id = (select id from tests where name = 'GED') and day_of_week = 'Tue' and start_time = '09:00';
update timetable_entries set activity = 'Social Studies'
where test_id = (select id from tests where name = 'GED') and day_of_week = 'Tue' and start_time = '10:35';
update timetable_entries set activity = 'Reading & Language Arts'
where test_id = (select id from tests where name = 'GED') and day_of_week = 'Tue' and start_time = '12:40';
update timetable_entries set activity = 'Mathematics'
where test_id = (select id from tests where name = 'GED') and day_of_week = 'Tue' and start_time = '14:05';

update timetable_entries set activity = 'Social Studies'
where test_id = (select id from tests where name = 'GED') and day_of_week = 'Wed' and start_time = '09:00';
update timetable_entries set activity = 'Reading & Language Arts'
where test_id = (select id from tests where name = 'GED') and day_of_week = 'Wed' and start_time = '10:35';
update timetable_entries set activity = 'Mathematics'
where test_id = (select id from tests where name = 'GED') and day_of_week = 'Wed' and start_time = '12:40';
update timetable_entries set activity = 'Science'
where test_id = (select id from tests where name = 'GED') and day_of_week = 'Wed' and start_time = '14:05';

update timetable_entries set activity = 'Reading & Language Arts'
where test_id = (select id from tests where name = 'GED') and day_of_week = 'Thu' and start_time = '09:00';
update timetable_entries set activity = 'Mathematics'
where test_id = (select id from tests where name = 'GED') and day_of_week = 'Thu' and start_time = '10:35';
update timetable_entries set activity = 'Science'
where test_id = (select id from tests where name = 'GED') and day_of_week = 'Thu' and start_time = '12:40';
update timetable_entries set activity = 'Social Studies'
where test_id = (select id from tests where name = 'GED') and day_of_week = 'Thu' and start_time = '14:05';
