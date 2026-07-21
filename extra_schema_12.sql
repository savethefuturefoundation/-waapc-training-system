-- =====================================================================
-- WAAPC Training Centre — GED Admission & Placement Assessment (GAPA)
-- Run this AFTER extra_schema_11.sql, in the Supabase SQL Editor.
-- Safe to re-run (seed rows are only inserted if the table is empty).
--
-- A computer-graded English/academic-readiness placement test, taken
-- once by a student enrolled in GED before starting the program, so the
-- school knows their starting English level. Covers the auto-gradable
-- portions of WAAPC's GAPA: Vocabulary, Grammar, Reading Comprehension,
-- Critical Thinking (100 points). The Writing and Reading Fluency
-- sections of the real GAPA require a human examiner, so they are not
-- part of this in-system version.
-- =====================================================================

create table if not exists placement_passages (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  sort_order int not null default 0
);

create table if not exists placement_questions (
  id uuid primary key default gen_random_uuid(),
  section text not null check (section in ('vocabulary', 'grammar', 'reading', 'critical_thinking')),
  passage_id uuid references placement_passages(id) on delete cascade,
  question_text text not null,
  options jsonb not null,
  correct_index int not null,
  sort_order int not null default 0
);

create table if not exists placement_attempts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  vocabulary_score int not null,
  grammar_score int not null,
  reading_score int not null,
  critical_thinking_score int not null,
  total_score int not null,
  level text not null,
  recommendation text not null,
  answers jsonb,
  taken_at timestamptz not null default now()
);

alter table placement_passages enable row level security;
alter table placement_questions enable row level security;
alter table placement_attempts enable row level security;

drop policy if exists "placement passages read" on placement_passages;
create policy "placement passages read" on placement_passages for select using (auth.role() = 'authenticated');
drop policy if exists "placement passages admin write" on placement_passages;
create policy "placement passages admin write" on placement_passages for all using (is_admin()) with check (is_admin());

drop policy if exists "placement questions read" on placement_questions;
create policy "placement questions read" on placement_questions for select using (auth.role() = 'authenticated');
drop policy if exists "placement questions admin write" on placement_questions;
create policy "placement questions admin write" on placement_questions for all using (is_admin()) with check (is_admin());

drop policy if exists "placement attempts staff read" on placement_attempts;
create policy "placement attempts staff read" on placement_attempts for select using (is_admin() or is_teacher());
drop policy if exists "placement attempts self read" on placement_attempts;
create policy "placement attempts self read" on placement_attempts for select using (owns_student(student_id));
drop policy if exists "placement attempts parent read" on placement_attempts;
create policy "placement attempts parent read" on placement_attempts for select using (is_parent() and is_my_child(student_id));

-- A student may only take the placement test if they're enrolled in GED.
drop policy if exists "placement attempts self insert" on placement_attempts;
create policy "placement attempts self insert" on placement_attempts for insert
  with check (
    owns_student(student_id)
    and exists (
      select 1 from enrollments e join tests t on t.id = e.test_id
      where e.student_id = placement_attempts.student_id and t.name = 'GED'
    )
  );

-- ---------------------------------------------------------------------
-- Seed content — WAAPC GAPA Version 1.0 (Sections A-D). Only runs once.
-- ---------------------------------------------------------------------
do $$
declare
  p1 uuid; p2 uuid; p3 uuid; p4 uuid;
begin
  if exists (select 1 from placement_questions limit 1) then
    return;
  end if;

  -- Section A: Academic Vocabulary
  insert into placement_questions (section, question_text, options, correct_index, sort_order) values
  ('vocabulary', 'The word "consistent" most nearly means:', '["Changing frequently","Regular and dependable","Difficult to understand","Temporary"]'::jsonb, 1, 1),
  ('vocabulary', 'A student reads two articles about climate change and decides that one article provides stronger evidence than the other. Which academic skill is the student using?', '["Memorizing","Evaluating","Copying","Predicting"]'::jsonb, 1, 2),
  ('vocabulary', 'The word "infer" means to:', '["Read aloud","Draw a logical conclusion using evidence","Repeat information","Guess without evidence"]'::jsonb, 1, 3),
  ('vocabulary', 'A newspaper article states: "The city''s recycling program reduced landfill waste by 30% over two years." The statistic is an example of:', '["An opinion","Evidence","A prediction","A conclusion"]'::jsonb, 1, 4),
  ('vocabulary', 'Which word is closest in meaning to "reliable"?', '["Honest","Trustworthy","Expensive","Dangerous"]'::jsonb, 1, 5),
  ('vocabulary', 'Which sentence correctly uses the word "justify"?', '["Maria justified her answer by explaining the evidence she used.","Maria justified her homework on the table.","Maria justified the classroom quietly.","Maria justified because she was absent."]'::jsonb, 0, 6),
  ('vocabulary', 'The opposite of "significant" is:', '["Important","Meaningful","Minor","Valuable"]'::jsonb, 2, 7),
  ('vocabulary', 'The word "analyze" means to:', '["Memorize every detail","Examine carefully to understand","Read as quickly as possible","Skip unnecessary information"]'::jsonb, 1, 8),
  ('vocabulary', 'Read the sentence: "Researchers collected information from over 5,000 participants before reaching a conclusion." What does "conclusion" mean in this sentence?', '["A question","A final decision based on evidence","A problem","A prediction"]'::jsonb, 1, 9),
  ('vocabulary', 'Read the sentence: "The new transportation policy had a positive impact on traffic congestion." The word "impact" most nearly means:', '["Beginning","Effect","Cost","Route"]'::jsonb, 1, 10);

  -- Section B: Grammar & Language
  insert into placement_questions (section, question_text, options, correct_index, sort_order) values
  ('grammar', 'Which sentence is grammatically correct?', '["The students in the science class was excited about the experiment.","The students in the science class were excited about the experiment.","The students in the science class is excited about the experiment.","The students in the science class has excited about the experiment."]'::jsonb, 1, 1),
  ('grammar', 'Choose the sentence with the correct verb tense.', '["Yesterday, Maria go to the library.","Yesterday, Maria gone to the library.","Yesterday, Maria went to the library.","Yesterday, Maria going to the library."]'::jsonb, 2, 2),
  ('grammar', 'Which sentence is correct?', '["Every student should bring their notebook to class.","Every student should bring his or her notebook to class.","Every student should bring them notebook to class.","Every student should bring our notebook to class."]'::jsonb, 1, 3),
  ('grammar', 'Which option is a complete sentence?', '["Because the weather was rainy.","While the students were studying.","The teacher reviewed the lesson before the test.","After finishing the assignment."]'::jsonb, 2, 4),
  ('grammar', 'Which sentence is written correctly?', '["The experiment was successful the students celebrated their results.","The experiment was successful, the students celebrated their results.","The experiment was successful; the students celebrated their results.","The experiment was successful because, the students celebrated their results."]'::jsonb, 2, 5),
  ('grammar', 'Choose the sentence with correct punctuation.', '["We bought pencils notebooks, rulers and calculators.","We bought pencils, notebooks, rulers, and calculators.","We bought pencils notebooks rulers and calculators.","We bought pencils; notebooks rulers and calculators."]'::jsonb, 1, 6),
  ('grammar', 'Which sentence is correct?', '["The teachers lounge is on the second floor.","The teacher''s lounge is on the second floor.","The teachers'' lounge is on the second floor.","The teacher lounge''s is on the second floor."]'::jsonb, 2, 7),
  ('grammar', 'Which sentence uses parallel structure correctly?', '["She enjoys reading, writing, and to swim.","She enjoys reading, writing, and swimming.","She enjoys read, writing, and swimming.","She enjoys reading, to write, and swimming."]'::jsonb, 1, 8),
  ('grammar', 'Choose the sentence that is clear and correctly written.', '["Walking to school, the rain soaked James.","Walking to school, James was soaked by the rain.","James was soaked by the rain walking to school because.","Walking, the school soaked James."]'::jsonb, 1, 9),
  ('grammar', 'Read the sentence: "The principal announced the meeting was postponed because of the heavy rain." Which revision is the clearest?', '["The principal announced that the meeting was postponed because of the heavy rain.","The principal announced meeting postponed because heavy rain.","The principal, announced the meeting postponed.","The principal announced because the meeting."]'::jsonb, 0, 10);

  -- Section C: Reading Comprehension — 4 passages, 5 questions each
  insert into placement_passages (title, body, sort_order) values
  ('The Importance of Renewable Energy',
   'For many years, societies around the world have depended heavily on fossil fuels such as coal, oil, and natural gas to produce energy. These resources have powered industries, transportation systems, and homes. However, scientists and policymakers have become increasingly concerned about the environmental effects of relying on fossil fuels. The burning of these resources releases greenhouse gases into the atmosphere, which contribute to rising global temperatures and climate change.

Renewable energy sources provide an alternative approach to meeting energy needs. Unlike fossil fuels, renewable sources can naturally replace themselves over time. Solar energy, for example, uses sunlight to generate electricity through solar panels. Wind energy uses moving air to power turbines that produce electricity. Hydroelectric energy uses flowing water to generate power.

One advantage of renewable energy is that it produces fewer harmful emissions compared with traditional energy sources. Reducing emissions can improve air quality and help decrease the effects of climate change. In addition, renewable energy industries can create new jobs in areas such as engineering, construction, and technology.

Despite these benefits, renewable energy also presents challenges. Solar and wind energy depend on weather conditions, which means energy production can sometimes change. Developing renewable energy systems also requires significant investments in equipment and infrastructure. Researchers are working to improve energy storage systems so that renewable energy can be used more consistently.

The transition to renewable energy will not happen immediately. However, many experts believe that combining different energy sources, improving technology, and making careful decisions about energy use can help societies create a more sustainable future.', 1)
  returning id into p1;

  insert into placement_passages (title, body, sort_order) values
  ('The Role of Civic Participation in a Democracy',
   'A democracy depends not only on elected leaders but also on the active participation of citizens. In democratic societies, citizens have opportunities to influence decisions that affect their communities. This participation can occur through voting, attending public meetings, joining community organizations, contacting government representatives, and discussing important issues with others.

Voting is one of the most recognized forms of civic participation. Through elections, citizens choose individuals who will represent their interests and make decisions on their behalf. However, democracy involves more than simply voting during elections. Citizens who remain informed about public issues are better prepared to evaluate leaders and policies.

Community involvement is another important part of civic life. When people work together to solve local problems, they can create positive changes. For example, residents may organize programs to improve education, protect the environment, or support people in need. These efforts allow citizens to contribute directly to the well-being of their communities.

Some people believe that individual actions have little effect on government decisions. They may feel that their voices are too small to create meaningful change. However, history provides many examples of citizens working together to influence laws and social conditions. Groups of individuals have successfully advocated for improvements in areas such as civil rights, public safety, and education.

A strong democracy requires cooperation between government institutions and citizens. Governments create systems and policies, but citizens provide ideas, feedback, and accountability. When people participate responsibly, they help strengthen the communities and institutions around them.', 2)
  returning id into p2;

  insert into placement_passages (title, body, sort_order) values
  ('Technology and the Changing Workplace',
   'Over the past several decades, technology has transformed the way people work. Computers, digital communication tools, and automated systems have changed how businesses operate and how employees complete their responsibilities. Many tasks that once required physical documents or face-to-face communication can now be completed quickly using digital platforms.

One major change caused by technology is the growth of remote work. Employees in many industries can now communicate with colleagues and complete assignments from locations outside traditional offices. Video conferences, online collaboration tools, and cloud-based systems allow teams to work together even when they are physically separated.

Technology has also increased efficiency in many workplaces. Automated systems can perform repetitive tasks, allowing employees to focus on more complex responsibilities that require creativity and problem-solving. For example, a company may use software to organize financial records while employees analyze information and make decisions based on the results.

However, technological changes also create challenges. Some workers must learn new skills to remain successful in changing industries. Employees who are unfamiliar with digital tools may experience difficulties adapting to new systems. For this reason, many organizations provide training programs to help workers develop the skills they need.

The future workplace will likely continue to change as new technologies are developed. Successful workers will need to be flexible, willing to learn, and capable of adapting to new situations. Although technology may replace some tasks, it also creates new opportunities for people who are prepared to use it effectively.', 3)
  returning id into p3;

  insert into placement_passages (title, body, sort_order) values
  ('Building Healthier Communities Through Prevention',
   'Many communities around the world face challenges related to public health. Problems such as limited access to medical services, unhealthy eating habits, and lack of physical activity can affect people''s quality of life. While doctors and hospitals play an important role in treating illnesses, many health experts argue that preventing health problems before they occur can create stronger and healthier communities.

Preventive health measures include activities such as regular exercise, balanced nutrition, health screenings, and education programs. These actions help individuals understand how their choices can affect their long-term health. For example, a community that provides information about healthy eating may help residents reduce their risk of certain diseases.

Some people argue that individuals alone are responsible for maintaining their health. They believe that personal decisions, such as diet and exercise choices, determine health outcomes. However, other experts argue that communities also influence people''s ability to make healthy choices. Factors such as access to safe parks, affordable nutritious food, and reliable healthcare services can affect whether people are able to maintain healthy lifestyles.

Successful public health programs often involve cooperation between individuals, organizations, and governments. Schools can provide health education, local organizations can create community activities, and governments can support policies that improve access to health resources. When different groups work together, communities are more likely to achieve long-term improvements.

Although preventing every health problem is impossible, prevention strategies can reduce risks and improve overall well-being. Investing in education and community resources can help people make informed decisions and create healthier environments for future generations.', 4)
  returning id into p4;

  insert into placement_questions (section, passage_id, question_text, options, correct_index, sort_order) values
  ('reading', p1, 'What is the main idea of the passage?', '["Fossil fuels are the only reliable source of energy.","Renewable energy offers benefits but also presents challenges that must be addressed.","Solar energy is the most effective energy source.","Scientists disagree about climate change."]'::jsonb, 1, 21),
  ('reading', p1, 'According to the passage, why are scientists concerned about fossil fuels?', '["They are too expensive to produce.","They cannot be used for transportation.","They release greenhouse gases that affect the environment.","They are difficult to find underground."]'::jsonb, 2, 22),
  ('reading', p1, 'The word "sustainable" in the final paragraph most nearly means:', '["Able to continue over a long period of time","Extremely expensive","Difficult to understand","Quickly completed"]'::jsonb, 0, 23),
  ('reading', p1, 'Which statement is supported by evidence from the passage?', '["Renewable energy has no disadvantages.","Renewable energy requires investment and improved technology.","Fossil fuels will disappear immediately.","Wind energy works the same way everywhere."]'::jsonb, 1, 24),
  ('reading', p1, 'Why does the author mention solar, wind, and hydroelectric energy?', '["To show examples of renewable energy sources","To prove fossil fuels are better","To explain why electricity is unnecessary","To compare different countries"]'::jsonb, 0, 25),

  ('reading', p2, 'What is the main purpose of the passage?', '["To explain why governments should control citizens","To describe why citizens should participate in democratic societies","To argue that voting is unnecessary","To compare different types of government systems"]'::jsonb, 1, 26),
  ('reading', p2, 'Which statement best describes the author''s viewpoint?', '["Citizens should avoid discussing political issues.","Only elected leaders can create change.","Citizens play an important role in strengthening democracy.","Community organizations are ineffective."]'::jsonb, 2, 27),
  ('reading', p2, 'The author includes examples of citizens improving civil rights, public safety, and education mainly to:', '["Show that citizen action can influence society","Explain why elections are expensive","Prove that governments are unnecessary","Describe historical events in detail"]'::jsonb, 0, 28),
  ('reading', p2, 'Which statement is a fact presented in the passage?', '["Democracy is the best government system in every situation.","Voting allows citizens to choose representatives.","Individual citizens cannot influence decisions.","Governments always make correct decisions."]'::jsonb, 1, 29),
  ('reading', p2, 'What conclusion can be drawn from the passage?', '["Democracy works best when citizens actively participate.","Citizens should allow leaders to make all decisions.","Community problems cannot be solved.","Public discussions create more problems than solutions."]'::jsonb, 0, 30),

  ('reading', p3, 'What is the main idea of the passage?', '["Technology has eliminated the need for workers.","Technology has changed workplaces by creating both opportunities and challenges.","Employees should avoid using digital tools.","Remote work is the only important workplace change."]'::jsonb, 1, 31),
  ('reading', p3, 'According to the passage, why do organizations provide training programs?', '["To prevent employees from using technology","To help employees develop skills needed for changing workplaces","To replace all employees with machines","To reduce communication between workers"]'::jsonb, 1, 32),
  ('reading', p3, 'The word "adapt" in paragraph four most nearly means:', '["Refuse","Adjust","Ignore","Repeat"]'::jsonb, 1, 33),
  ('reading', p3, 'Which statement best explains the relationship between automation and employees?', '["Automation can handle some tasks while employees focus on more complex work.","Automation prevents employees from making decisions.","Automation removes all workplace responsibilities.","Automation makes training unnecessary."]'::jsonb, 0, 34),
  ('reading', p3, 'Which statement would the author most likely agree with?', '["Workers should stop learning once they have a job.","Technology creates only negative effects.","Workers who continue learning are better prepared for future changes.","Digital skills are no longer important."]'::jsonb, 2, 35),

  ('reading', p4, 'What is the main argument of the passage?', '["Hospitals are unnecessary in modern communities.","Prevention strategies can help improve community health.","Individuals have no responsibility for their health.","Health problems cannot be reduced."]'::jsonb, 1, 36),
  ('reading', p4, 'Which evidence best supports the author''s argument?', '["Preventive programs can include exercise, nutrition education, and health screenings.","Hospitals are expensive to operate.","Some people disagree about health responsibilities.","Many communities have different populations."]'::jsonb, 0, 37),
  ('reading', p4, 'The word "accessible" (as used in the context of healthcare resources) most nearly means:', '["Available and easy to obtain","Hidden from the public","Expensive and rare","Difficult to understand"]'::jsonb, 0, 38),
  ('reading', p4, 'Why does the author mention schools, organizations, and governments?', '["To show that improving health requires cooperation among different groups","To prove that governments should control all health decisions","To explain why schools are responsible for hospitals","To show that individuals cannot make decisions"]'::jsonb, 0, 39),
  ('reading', p4, 'Which statement provides the best summary of the passage?', '["Health problems can only be solved by medical professionals.","Healthy communities develop when people and organizations work together to support prevention.","Personal choices are the only factor affecting health.","Government programs are the only solution to health problems."]'::jsonb, 1, 40);

  -- Section D: Critical Thinking & Evidence
  insert into placement_questions (section, question_text, options, correct_index, sort_order) values
  ('critical_thinking', 'A school conducted a survey asking students how they preferred to study. Independent Reading: 40, Group Study: 65, Online Videos: 55, Tutoring: 30. Which conclusion is best supported by the data?', '["Students prefer studying alone more than with others.","Group study was the most popular method among surveyed students.","Tutoring was the most effective method.","Online videos are unpopular among students."]'::jsonb, 1, 41),
  ('critical_thinking', 'A student writes: "Schools should provide more technology because computers make learning easier." Which evidence would BEST support this claim?', '["Many students enjoy using computers.","Research shows students using educational technology improved their test performance.","Computers are expensive to purchase.","Some teachers prefer traditional textbooks."]'::jsonb, 1, 42),
  ('critical_thinking', 'A city planted more trees in neighborhoods with high levels of air pollution. After five years, pollution levels decreased. Which conclusion is most reasonable?', '["Trees may have contributed to improved air quality.","Trees always eliminate pollution completely.","Pollution has no relationship with the environment.","Planting trees increased pollution."]'::jsonb, 0, 43),
  ('critical_thinking', 'Read the argument: "Our school should cancel science classes because I do not enjoy experiments." What makes this argument weak?', '["It provides too much scientific evidence.","It is based mainly on a personal opinion rather than evidence.","It includes information from researchers.","It compares multiple solutions."]'::jsonb, 1, 44),
  ('critical_thinking', 'A company tracks employee training completion. Finance: 95%, Marketing: 80%, Technology: 90%, Human Resources: 75%. Which department has the highest completion rate?', '["Marketing","Technology","Finance","Human Resources"]'::jsonb, 2, 45),
  ('critical_thinking', 'Claim: "Regular exercise can improve academic performance." Which evidence BEST supports this claim?', '["Exercise equipment can be expensive.","Studies show physical activity improves concentration and memory.","Many students dislike exercise.","Some athletes have poor grades."]'::jsonb, 1, 46),
  ('critical_thinking', 'Student A says online learning gives flexibility to study at different times. Student B says traditional classrooms allow direct communication with teachers. Which conclusion best compares both viewpoints?', '["Both methods have advantages depending on student needs.","Online learning is always better.","Traditional classrooms are unnecessary.","Neither method supports learning."]'::jsonb, 0, 47),
  ('critical_thinking', 'A school notices that students who attend tutoring sessions often receive higher grades. Which statement is the most reasonable conclusion?', '["Tutoring may help students improve academically.","Tutoring guarantees perfect grades.","Students who do not attend tutoring cannot succeed.","Grades are unrelated to studying."]'::jsonb, 0, 48),
  ('critical_thinking', 'A student is researching climate change. Which source is most likely the most reliable?', '["An anonymous social media post","A scientific report from a recognized research organization","A personal opinion written without evidence","An advertisement selling a product"]'::jsonb, 1, 49),
  ('critical_thinking', 'A town introduces a recycling program. After one year, waste sent to landfills decreases, recycling participation increases, and residents receive environmental education. What conclusion is best supported?', '["The recycling program may have improved waste management.","Recycling programs never work.","Residents stopped producing waste completely.","Education has no connection to behavior."]'::jsonb, 0, 50);
end $$;
