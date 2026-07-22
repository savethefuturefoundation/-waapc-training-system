import { supabase } from './supabaseClient.js';

// ---------------------------------------------------------------------
// Catalog (tests + subjects), loaded once per session and cached in memory.
// Replaces the prototype's hardcoded TEST_CATALOG.
// ---------------------------------------------------------------------
// GED, SAT, and ACT have no Speaking section in the real exam
// (extra_schema_6.sql deletes any stray Speaking subject from them at the
// database level). Filtered here too so the UI is correct even before
// that migration has been run, or if a stray row reappears.
const NO_SPEAKING_TESTS = new Set(['GED', 'SAT', 'ACT']);

export async function loadCatalog() {
  const { data, error } = await supabase
    .from('tests')
    .select('id, name, default_price, default_duration_label, registration_only_price, subjects(id, name, sort_order, kind)')
    .order('name');
  if (error) throw error;

  const catalog = {};
  for (const t of data) {
    let subjects = (t.subjects || []).slice().sort((a, b) => a.sort_order - b.sort_order);
    if (NO_SPEAKING_TESTS.has(t.name)) {
      subjects = subjects.filter((s) => s.kind !== 'speaking' && !/speaking/i.test(s.name));
    }
    catalog[t.name] = {
      id: t.id,
      price: Number(t.default_price),
      duration: t.default_duration_label,
      regOnlyPrice: Number(t.registration_only_price),
      subjects,
    };
  }
  return catalog;
}

// ---------------------------------------------------------------------
// Students — read side. Assembles the same nested shape the UI already
// expects (programs/installments/attempts/attendance/certificates as
// arrays on the student object), built from the normalized tables.
// RLS transparently limits this to "all students" for an admin session
// and to "just their own record" for a student session.
// ---------------------------------------------------------------------
const STUDENT_SELECT = `
  id, full_name, dob, gender, nationality, email, phone,
  guardian_name, guardian_relationship, guardian_phone, guardian_email, address,
  photo_url, notes, created_at,
  enrollments (
    id, test_id, level, sessions_per_week, start_date, end_date, registration_only, price,
    tests ( name ),
    attendance ( id, session_date, present )
  ),
  invoices (
    id, invoice_number, invoice_date, total,
    payment_installments ( id, amount, category, due_date, payments ( id, amount, method, payment_date, receipt_number, notes ) )
  ),
  attempts (
    id, mode, score, total, taken_at,
    subjects ( name, tests ( name ) )
  ),
  certificates (
    id, enrollment_id, certificate_number, issued_date, final_mock_score, final_mock_total, attendance_pct
  )
`;

function mapStudentRow(row) {
  const invoice = (row.invoices && row.invoices[0]) || null;

  const programs = (row.enrollments || []).map((e) => ({
    id: e.id,
    testId: e.test_id,
    test: e.tests?.name,
    level: e.level,
    start: e.start_date,
    end: e.end_date,
    sessionsPerWeek: e.sessions_per_week,
    price: Number(e.price),
    regOnly: e.registration_only,
  }));

  const attendance = (row.enrollments || []).flatMap((e) =>
    (e.attendance || []).map((a) => ({ programId: e.id, date: a.session_date, present: a.present }))
  );

  const installments = ((invoice && invoice.payment_installments) || []).map((i) => {
    const payments = (i.payments || [])
      .map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        method: p.method,
        date: p.payment_date,
        receiptNumber: p.receipt_number,
        notes: p.notes,
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const amount = Number(i.amount);
    const amountPaid = payments.reduce((s, p) => s + p.amount, 0);
    const balance = amount - amountPaid;
    return {
      id: i.id,
      amount,
      category: i.category,
      dueDate: i.due_date,
      payments,
      amountPaid,
      balance,
      status: balance <= 0 ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid',
    };
  });

  const attempts = (row.attempts || []).map((a) => ({
    id: a.id,
    test: a.subjects?.tests?.name,
    subject: a.subjects?.name,
    mode: a.mode,
    score: a.score,
    total: a.total,
    date: (a.taken_at || '').slice(0, 10),
  }));

  const certificates = (row.certificates || []).map((c) => ({
    id: c.id,
    programId: c.enrollment_id,
    certNumber: c.certificate_number,
    issuedDate: c.issued_date,
    finalScore: c.final_mock_score,
    finalTotal: c.final_mock_total,
    attendancePct: c.attendance_pct,
  }));

  return {
    id: row.id,
    fullName: row.full_name,
    dob: row.dob,
    gender: row.gender,
    nationality: row.nationality,
    email: row.email,
    phone: row.phone,
    guardian: {
      name: row.guardian_name,
      relationship: row.guardian_relationship,
      phone: row.guardian_phone,
      email: row.guardian_email,
      address: row.address,
    },
    photoUrl: row.photo_url,
    programs,
    total: programs.reduce((s, p) => s + p.price, 0),
    installments,
    invoiceNumber: invoice?.invoice_number,
    invoiceDate: invoice?.invoice_date,
    notes: row.notes,
    attempts,
    attendance,
    certificates,
    createdAt: new Date(row.created_at).getTime(),
  };
}

export async function loadAllStudents() {
  const { data, error } = await supabase.from('students').select(STUDENT_SELECT).order('created_at');
  if (error) throw error;
  return data.map(mapStudentRow);
}

export async function countTeachers() {
  const { count, error } = await supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'teacher');
  if (error) throw error;
  return count || 0;
}

// ---------------------------------------------------------------------
// Sequence numbers (invoice/receipt/certificate). Admin-only (enforced
// inside the next_seq() Postgres function).
// ---------------------------------------------------------------------
export async function nextSeq(key) {
  const { data, error } = await supabase.rpc('next_seq', { p_key: key });
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------
// Registration — creates the student, enrollments, invoice + line items,
// and payment installments in one flow, and uploads the passport photo.
// ---------------------------------------------------------------------
export async function registerStudent({ student, programs, installments, photoFile }) {
  const { data: studentRow, error: sErr } = await supabase
    .from('students')
    .insert({
      full_name: student.fullName,
      dob: student.dob || null,
      gender: student.gender,
      nationality: student.nationality,
      email: student.email,
      phone: student.phone,
      guardian_name: student.guardian.name,
      guardian_relationship: student.guardian.relationship,
      guardian_phone: student.guardian.phone,
      guardian_email: student.guardian.email,
      address: student.guardian.address,
      notes: student.notes,
    })
    .select()
    .single();
  if (sErr) throw sErr;
  const studentId = studentRow.id;

  if (photoFile) {
    const ext = (photoFile.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${studentId}/photo.${ext}`;
    const { error: upErr } = await supabase.storage.from('student-photos').upload(path, photoFile, { upsert: true });
    if (upErr) throw upErr;
    await supabase.from('students').update({ photo_url: path }).eq('id', studentId);
  }

  const enrollmentRows = programs.map((p) => ({
    student_id: studentId,
    test_id: p.testId,
    level: p.level,
    sessions_per_week: p.sessionsPerWeek,
    start_date: p.start || null,
    end_date: p.end || null,
    registration_only: p.regOnly,
    price: p.price,
  }));
  const { data: enrollments, error: eErr } = await supabase.from('enrollments').insert(enrollmentRows).select();
  if (eErr) throw eErr;

  const total = programs.reduce((s, p) => s + p.price, 0);
  const seq = await nextSeq('invoice_seq');
  const invoiceNumber = 'INV-' + String(seq).padStart(3, '0');
  const { data: invoice, error: iErr } = await supabase
    .from('invoices')
    .insert({ student_id: studentId, invoice_number: invoiceNumber, total })
    .select()
    .single();
  if (iErr) throw iErr;

  const itemRows = enrollments.map((e, idx) => ({
    invoice_id: invoice.id,
    enrollment_id: e.id,
    description: `${programs[idx].test}${programs[idx].regOnly ? ' — Registration Only' : ''}`,
    amount: programs[idx].price,
  }));
  const { error: itemErr } = await supabase.from('invoice_items').insert(itemRows);
  if (itemErr) throw itemErr;

  const instRows = installments.map((i) => ({
    invoice_id: invoice.id,
    amount: i.amount,
    category: i.category || 'training',
    due_date: i.dueDate || null,
  }));
  const { error: instErr } = await supabase.from('payment_installments').insert(instRows);
  if (instErr) throw instErr;

  return { studentId, invoiceNumber };
}

// Removes the student record and everything tied to it (enrollments,
// invoices/payments, grades, attendance, attempts, certificates,
// assignments, placement attempts) via on-delete-cascade foreign keys.
// If the student had already created their own login, that auth account
// isn't removable from the client — the admin needs to delete it
// separately in the Supabase dashboard (Authentication → Users).
export async function deleteStudent(id) {
  const { error } = await supabase.from('students').delete().eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Payments / attendance / certificates
// ---------------------------------------------------------------------
export async function updateInstallment(id, { amount, category }) {
  const { error } = await supabase.from('payment_installments').update({ amount, category }).eq('id', id);
  if (error) throw error;
}

export async function addInstallmentLine(studentId, { amount, category, dueDate }) {
  const { data: invoice, error: e1 } = await supabase.from('invoices').select('id').eq('student_id', studentId).single();
  if (e1) throw e1;
  const { error: e2 } = await supabase
    .from('payment_installments')
    .insert({ invoice_id: invoice.id, amount, category: category || 'other', due_date: dueDate || null });
  if (e2) throw e2;
}

// ---------------------------------------------------------------------
// Payments ledger — every cash/transfer receipt is its own dated,
// receipted transaction against a fee line, so partial payments and
// arrears are tracked accurately instead of a single paid flag.
// ---------------------------------------------------------------------
export async function recordPayment({ studentId, installmentId, amount, method, date, notes }) {
  const seq = await nextSeq('receipt_seq');
  const receiptNumber = 'RCT-' + String(seq).padStart(3, '0');
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from('payments').insert({
    student_id: studentId,
    installment_id: installmentId,
    amount,
    method: method || 'Cash',
    payment_date: date || new Date().toISOString().slice(0, 10),
    receipt_number: receiptNumber,
    notes: notes || null,
    recorded_by: user?.id || null,
  });
  if (error) throw error;
}

export async function deletePayment(id) {
  const { error } = await supabase.from('payments').delete().eq('id', id);
  if (error) throw error;
}

export async function listAllPayments() {
  const { data, error } = await supabase
    .from('payments')
    .select('id, amount, method, payment_date, receipt_number, notes, students(full_name), payment_installments(category)')
    .order('payment_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((p) => ({
    id: p.id,
    amount: Number(p.amount),
    method: p.method,
    date: p.payment_date,
    receiptNumber: p.receipt_number,
    notes: p.notes,
    studentName: p.students?.full_name,
    category: p.payment_installments?.category,
  }));
}

export async function recordAttendance(enrollmentId, date, present) {
  const { error } = await supabase
    .from('attendance')
    .upsert({ enrollment_id: enrollmentId, session_date: date, present }, { onConflict: 'enrollment_id,session_date' });
  if (error) throw error;
}

export async function issueCertificate({ studentId, enrollmentId, score, total, attendancePct }) {
  const seq = await nextSeq('cert_seq');
  const certNumber = 'CERT-' + new Date().getFullYear() + '-' + String(seq).padStart(3, '0');
  const { data, error } = await supabase
    .from('certificates')
    .insert({
      student_id: studentId,
      enrollment_id: enrollmentId,
      certificate_number: certNumber,
      final_mock_score: score,
      final_mock_total: total,
      attendance_pct: attendancePct,
    })
    .select()
    .single();
  if (error) throw error;
  return { certNumber: data.certificate_number, issuedDate: data.issued_date, id: data.id };
}

export async function recordAttempt({ studentId, subjectId, mode, score, total }) {
  const { error } = await supabase.from('attempts').insert({ student_id: studentId, subject_id: subjectId, mode, score, total });
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Question bank — single source of truth (built-ins are seeded once via
// seed_questions.sql; from here on there's no built-in/custom split).
// ---------------------------------------------------------------------
export async function listQuestions(subjectId) {
  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .eq('subject_id', subjectId)
    .eq('active', true)
    .order('created_at');
  if (error) throw error;
  return data.map((q) => ({ id: q.id, q: q.question_text, options: q.options, answer: q.correct_index }));
}

export async function addQuestion(subjectId, { q, options, answer }) {
  const { error } = await supabase
    .from('questions')
    .insert({ subject_id: subjectId, question_text: q, options, correct_index: answer });
  if (error) throw error;
}

export async function deleteQuestion(questionId) {
  const { error } = await supabase.from('questions').delete().eq('id', questionId);
  if (error) throw error;
}

export async function bulkInsertQuestions(rows) {
  const { error } = await supabase
    .from('questions')
    .insert(rows.map((r) => ({ subject_id: r.subjectId, question_text: r.q, options: r.options, correct_index: r.answer })));
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------
export async function studentAccountStatus(email) {
  const { data, error } = await supabase.rpc('student_account_status', { p_email: email });
  if (error) throw error;
  return data; // 'not_registered' | 'needs_signup' | 'has_account'
}

export async function studentSignUp(email, password) {
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  const { error: claimErr } = await supabase.rpc('claim_student_account');
  if (claimErr) throw claimErr;
}

export async function studentSignIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function teacherAccountStatus(email) {
  const { data, error } = await supabase.rpc('teacher_account_status', { p_email: email });
  if (error) throw error;
  return data; // 'not_invited' | 'needs_signup' | 'has_account'
}

export async function teacherSignUp(email, password) {
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  const { error: claimErr } = await supabase.rpc('claim_teacher_account');
  if (claimErr) throw claimErr;
}

export async function addTeacherInvite(email, fullName, subjectsTaught) {
  const { error } = await supabase
    .from('teacher_invites')
    .insert({ email: email.toLowerCase(), full_name: fullName || null, subjects_taught: subjectsTaught || null });
  if (error) throw error;
}

export async function listTeacherInvites() {
  const { data, error } = await supabase.from('teacher_invites').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function listTeachers() {
  const { data, error } = await supabase.rpc('list_teachers');
  if (error) throw error;
  return (data || []).map((t) => ({ id: t.id, email: t.email, fullName: t.full_name, subjectsTaught: t.subjects_taught }));
}

export async function updateTeacherProfile(id, { fullName, subjectsTaught }) {
  const { error } = await supabase.from('profiles').update({ full_name: fullName, subjects_taught: subjectsTaught }).eq('id', id);
  if (error) throw error;
}

// Which program(s) a teacher is scoped to. Empty = unrestricted (sees
// every student), matching pre-existing behavior until admin configures it.
export async function listTeacherAssignments(teacherId) {
  const { data, error } = await supabase.from('teacher_test_assignments').select('test_id').eq('teacher_id', teacherId);
  if (error) throw error;
  return data.map((r) => r.test_id);
}

export async function listMyTeacherAssignments() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  return listTeacherAssignments(user.id);
}

export async function setTeacherAssignments(teacherId, testIds) {
  const { error: delErr } = await supabase.from('teacher_test_assignments').delete().eq('teacher_id', teacherId);
  if (delErr) throw delErr;
  if (testIds.length === 0) return;
  const { error: insErr } = await supabase.from('teacher_test_assignments').insert(testIds.map((testId) => ({ teacher_id: teacherId, test_id: testId })));
  if (insErr) throw insErr;
}

export async function revokeTeacherInvite(id) {
  const { error } = await supabase.from('teacher_invites').delete().eq('id', id);
  if (error) throw error;
}

export async function parentAccountStatus(email) {
  const { data, error } = await supabase.rpc('parent_account_status', { p_email: email });
  if (error) throw error;
  return data; // 'not_registered' | 'needs_signup' | 'has_account'
}

export async function parentSignUp(email, password) {
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  const { error: claimErr } = await supabase.rpc('claim_parent_account');
  if (claimErr) throw claimErr;
}

export async function parentSignIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function adminSignIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function changePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function getCurrentSessionInfo() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  const { data: profile } = await supabase.from('profiles').select('role, full_name').eq('id', session.user.id).single();
  return { userId: session.user.id, email: session.user.email, role: profile?.role || 'student', fullName: profile?.full_name || null };
}

export async function updateMyName(fullName) {
  const { error } = await supabase.rpc('update_my_name', { new_name: fullName });
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Listening — passages (one audio clip shared by a group of questions).
// ---------------------------------------------------------------------
export async function listListeningGroups(subjectId) {
  const { data, error } = await supabase
    .from('listening_passages')
    .select('group_label')
    .eq('subject_id', subjectId)
    .not('group_label', 'is', null);
  if (error) throw error;
  return [...new Set(data.map((p) => p.group_label))].sort();
}

export async function listListeningPassages(subjectId, groupLabel) {
  let query = supabase
    .from('listening_passages')
    .select('id, title, group_label, audio_url, questions(id, question_text, options, correct_index)')
    .eq('subject_id', subjectId)
    .order('created_at');
  if (groupLabel) query = query.eq('group_label', groupLabel);
  const { data, error } = await query;
  if (error) throw error;
  return data.map((p) => ({
    id: p.id,
    title: p.title,
    groupLabel: p.group_label,
    audioUrl: supabase.storage.from('listening-audio').getPublicUrl(p.audio_url).data.publicUrl,
    questions: (p.questions || []).map((q) => ({ id: q.id, q: q.question_text, options: q.options, answer: q.correct_index })),
  }));
}

export async function addListeningPassage(subjectId, { title, audioFile, groupLabel }) {
  const ext = (audioFile.name.split('.').pop() || 'mp3').toLowerCase();
  const path = `${subjectId}/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage.from('listening-audio').upload(path, audioFile);
  if (upErr) throw upErr;

  const { data, error } = await supabase
    .from('listening_passages')
    .insert({ subject_id: subjectId, title, audio_url: path, group_label: groupLabel || null })
    .select()
    .single();
  if (error) throw error;
  return data.id;
}

export async function deleteListeningPassage(passageId) {
  const { error } = await supabase.from('listening_passages').delete().eq('id', passageId);
  if (error) throw error;
}

export async function addListeningQuestion(passageId, subjectId, { q, options, answer }) {
  const { error } = await supabase
    .from('questions')
    .insert({ subject_id: subjectId, passage_id: passageId, question_text: q, options, correct_index: answer });
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Speaking — prompts (cue-card topics) and student recordings. Not
// auto-graded: admin listens back and reviews.
// ---------------------------------------------------------------------
export async function listSpeakingPrompts(subjectId) {
  const { data, error } = await supabase
    .from('speaking_prompts')
    .select('id, prompt_text')
    .eq('subject_id', subjectId)
    .order('created_at');
  if (error) throw error;
  return data.map((p) => ({ id: p.id, text: p.prompt_text }));
}

export async function addSpeakingPrompt(subjectId, promptText) {
  const { error } = await supabase.from('speaking_prompts').insert({ subject_id: subjectId, prompt_text: promptText });
  if (error) throw error;
}

export async function deleteSpeakingPrompt(promptId) {
  const { error } = await supabase.from('speaking_prompts').delete().eq('id', promptId);
  if (error) throw error;
}

export async function submitSpeakingRecording({ studentId, promptId, blob }) {
  const path = `${studentId}/${promptId}/${Date.now()}.webm`;
  const { error: upErr } = await supabase.storage.from('speaking-recordings').upload(path, blob, { contentType: 'audio/webm' });
  if (upErr) throw upErr;

  const { error } = await supabase.from('speaking_submissions').insert({ student_id: studentId, prompt_id: promptId, audio_url: path });
  if (error) throw error;
}

export async function markSpeakingReviewed(submissionId) {
  const { error } = await supabase.from('speaking_submissions').update({ reviewed: true }).eq('id', submissionId);
  if (error) throw error;
}

export async function listSpeakingSubmissions(studentId) {
  const { data, error } = await supabase
    .from('speaking_submissions')
    .select('id, audio_url, submitted_at, reviewed, speaking_prompts(prompt_text)')
    .eq('student_id', studentId)
    .order('submitted_at', { ascending: false });
  if (error) throw error;

  const withUrls = await Promise.all(
    data.map(async (s) => {
      const { data: signed } = await supabase.storage.from('speaking-recordings').createSignedUrl(s.audio_url, 3600);
      return {
        id: s.id,
        promptText: s.speaking_prompts?.prompt_text,
        submittedAt: s.submitted_at,
        reviewed: s.reviewed,
        signedUrl: signed?.signedUrl,
      };
    })
  );
  return withUrls;
}

// ---------------------------------------------------------------------
// Assignments — teacher/admin assign work (optionally linking out to
// another practice site) to specific students; students mark it done,
// optionally with a text response and/or an uploaded file.
// ---------------------------------------------------------------------
export async function createAssignment({ title, description, linkUrl, dueDate, studentIds }) {
  const { data: a, error } = await supabase
    .from('assignments')
    .insert({ title, description: description || null, link_url: linkUrl || null, due_date: dueDate || null })
    .select('id')
    .single();
  if (error) throw error;

  if (studentIds.length > 0) {
    const { error: tErr } = await supabase
      .from('assignment_targets')
      .insert(studentIds.map((student_id) => ({ assignment_id: a.id, student_id })));
    if (tErr) throw tErr;
  }
  return a.id;
}

export async function deleteAssignment(id) {
  const { error } = await supabase.from('assignments').delete().eq('id', id);
  if (error) throw error;
}

export async function listAssignments() {
  const { data, error } = await supabase
    .from('assignments')
    .select(
      'id, title, description, link_url, due_date, created_at, assignment_targets(student_id, students(full_name)), assignment_submissions(student_id, status, submitted_at)'
    )
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((a) => ({
    id: a.id,
    title: a.title,
    description: a.description,
    linkUrl: a.link_url,
    dueDate: a.due_date,
    targets: (a.assignment_targets || []).map((t) => ({
      studentId: t.student_id,
      fullName: t.students?.full_name,
      submission: (a.assignment_submissions || []).find((s) => s.student_id === t.student_id) || null,
    })),
  }));
}

// Used by both the student portal (own assignments, editable) and the
// parent portal (a child's assignments, read-only).
export async function listAssignmentsForStudent(studentId) {
  const { data, error } = await supabase
    .from('assignments')
    .select(
      'id, title, description, link_url, due_date, created_at, assignment_targets!inner(student_id), assignment_submissions(status, response_text, file_url, submitted_at, student_id)'
    )
    .eq('assignment_targets.student_id', studentId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((a) => ({
    id: a.id,
    title: a.title,
    description: a.description,
    linkUrl: a.link_url,
    dueDate: a.due_date,
    submission: (a.assignment_submissions || []).find((s) => s.student_id === studentId) || null,
  }));
}

export async function submitAssignment({ assignmentId, studentId, status, responseText, file }) {
  const payload = {
    assignment_id: assignmentId,
    student_id: studentId,
    status,
    response_text: responseText || null,
    submitted_at: new Date().toISOString(),
  };
  if (file) {
    const path = `${studentId}/${Date.now()}_${file.name}`;
    const { error: upErr } = await supabase.storage.from('assignment-files').upload(path, file, { upsert: true });
    if (upErr) throw upErr;
    payload.file_url = path;
  }
  const { error } = await supabase.from('assignment_submissions').upsert(payload, { onConflict: 'assignment_id,student_id' });
  if (error) throw error;
}

export async function getAssignmentFileUrl(path) {
  const { data } = await supabase.storage.from('assignment-files').createSignedUrl(path, 3600);
  return data?.signedUrl;
}

// ---------------------------------------------------------------------
// Messaging — shared by all four portals. Who can message whom is
// enforced server-side by list_message_contacts() and the messages RLS.
// ---------------------------------------------------------------------
export async function listMessageContacts() {
  const { data, error } = await supabase.rpc('list_message_contacts');
  if (error) throw error;
  return (data || []).map((c) => ({ userId: c.user_id, email: c.email, name: c.display_name, role: c.role }));
}

export async function listUnreadCounts(myUserId) {
  const { data, error } = await supabase.from('messages').select('sender_id').eq('recipient_id', myUserId).eq('read', false);
  if (error) throw error;
  const counts = {};
  data.forEach((m) => {
    counts[m.sender_id] = (counts[m.sender_id] || 0) + 1;
  });
  return counts;
}

export async function listConversation(myUserId, otherUserId) {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .or(`and(sender_id.eq.${myUserId},recipient_id.eq.${otherUserId}),and(sender_id.eq.${otherUserId},recipient_id.eq.${myUserId})`)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export async function sendMessage(recipientId, body) {
  const { error } = await supabase.from('messages').insert({ recipient_id: recipientId, body });
  if (error) throw error;
}

export async function markThreadRead(myUserId, otherUserId) {
  const { error } = await supabase.from('messages').update({ read: true }).eq('recipient_id', myUserId).eq('sender_id', otherUserId).eq('read', false);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Announcements + Calendar — read by everyone, posted by admin/teacher.
// ---------------------------------------------------------------------
export async function listAnnouncements() {
  const { data, error } = await supabase
    .from('announcements')
    .select('*, tests(name)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map((a) => ({ ...a, targetTestName: a.tests?.name || null }));
}

export async function createAnnouncement(title, body, targetTestId) {
  const { error } = await supabase.from('announcements').insert({ title, body: body || null, target_test_id: targetTestId || null });
  if (error) throw error;
}

export async function deleteAnnouncement(id) {
  const { error } = await supabase.from('announcements').delete().eq('id', id);
  if (error) throw error;
}

export async function listCalendarEvents() {
  const { data, error } = await supabase.from('calendar_events').select('*').order('event_date', { ascending: true });
  if (error) throw error;
  return data;
}

export async function createCalendarEvent(title, description, eventDate) {
  const { error } = await supabase.from('calendar_events').insert({ title, description: description || null, event_date: eventDate });
  if (error) throw error;
}

export async function deleteCalendarEvent(id) {
  const { error } = await supabase.from('calendar_events').delete().eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Gradebook — real grades a teacher enters, separate from auto-scored
// practice/mock attempts.
// ---------------------------------------------------------------------
export async function listGradesForStudent(studentId) {
  const { data, error } = await supabase
    .from('grades')
    .select('id, label, score, max_score, notes, entered_at, source, subjects(name, tests(name))')
    .eq('student_id', studentId)
    .order('entered_at', { ascending: false });
  if (error) throw error;
  return data.map((g) => ({
    id: g.id,
    label: g.label,
    score: Number(g.score),
    maxScore: Number(g.max_score),
    notes: g.notes,
    enteredAt: g.entered_at,
    source: g.source || 'manual',
    subject: g.subjects?.name,
    test: g.subjects?.tests?.name,
  }));
}

export async function addGrade({ studentId, subjectId, label, score, maxScore, notes, source }) {
  const { error } = await supabase.from('grades').insert({
    student_id: studentId,
    subject_id: subjectId,
    label,
    score,
    max_score: maxScore,
    notes: notes || null,
    source: source || 'manual',
  });
  if (error) throw error;
}

export async function deleteGrade(id) {
  const { error } = await supabase.from('grades').delete().eq('id', id);
  if (error) throw error;
}

export async function listAllGedScores() {
  const { data, error } = await supabase.from('grades').select('score, subjects(tests(name))');
  if (error) throw error;
  return data.filter((g) => g.subjects?.tests?.name === 'GED').map((g) => Number(g.score));
}

// ---------------------------------------------------------------------
// GED Placement Assessment (GAPA) — computer-graded English/academic
// readiness test for students enrolled in GED.
// ---------------------------------------------------------------------
export async function listPlacementQuestions() {
  const { data, error } = await supabase
    .from('placement_questions')
    .select('id, section, sort_order, question_text, options, correct_index, placement_passages(id, title, body)')
    .order('sort_order');
  if (error) throw error;
  return data.map((q) => ({
    id: q.id,
    section: q.section,
    sortOrder: q.sort_order,
    text: q.question_text,
    options: q.options,
    answer: q.correct_index,
    passage: q.placement_passages ? { id: q.placement_passages.id, title: q.placement_passages.title, body: q.placement_passages.body } : null,
  }));
}

export async function submitPlacementAttempt({ studentId, sectionScores, totalScore, level, recommendation, answers }) {
  const { error } = await supabase.from('placement_attempts').insert({
    student_id: studentId,
    vocabulary_score: sectionScores.vocabulary,
    grammar_score: sectionScores.grammar,
    reading_score: sectionScores.reading,
    critical_thinking_score: sectionScores.critical_thinking,
    total_score: totalScore,
    level,
    recommendation,
    answers,
  });
  if (error) throw error;
}

export async function listPlacementAttempts(studentId) {
  const { data, error } = await supabase
    .from('placement_attempts')
    .select('*')
    .eq('student_id', studentId)
    .order('taken_at', { ascending: false });
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------
// Timetable — read by everyone, edited by admin/teacher.
// ---------------------------------------------------------------------
export async function listTimetable() {
  const { data, error } = await supabase.from('timetable_entries').select('*, tests(name)').order('start_time');
  if (error) throw error;
  return data.map((t) => ({
    id: t.id,
    testId: t.test_id,
    testName: t.tests?.name,
    day: t.day_of_week,
    start: t.start_time,
    end: t.end_time,
    activity: t.activity,
    kind: t.kind,
    teacherName: t.teacher_name,
  }));
}

export async function createTimetableEntry({ testId, day, start, end, activity, kind, teacherName }) {
  const { error } = await supabase
    .from('timetable_entries')
    .insert({ test_id: testId || null, day_of_week: day, start_time: start, end_time: end, activity, kind, teacher_name: teacherName || null });
  if (error) throw error;
}

export async function deleteTimetableEntry(id) {
  const { error } = await supabase.from('timetable_entries').delete().eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------
// Attendance roster — bulk mark-by-class, admin/teacher only.
// ---------------------------------------------------------------------
export async function listEnrollmentsForTest(testId) {
  const { data, error } = await supabase.from('enrollments').select('id, students(id, full_name)').eq('test_id', testId);
  if (error) throw error;
  return data.map((e) => ({ enrollmentId: e.id, studentId: e.students?.id, studentName: e.students?.full_name })).filter((e) => e.studentName);
}

export async function listAttendanceForDate(enrollmentIds, date) {
  if (enrollmentIds.length === 0) return {};
  const { data, error } = await supabase.from('attendance').select('enrollment_id, present').in('enrollment_id', enrollmentIds).eq('session_date', date);
  if (error) throw error;
  const map = {};
  data.forEach((a) => {
    map[a.enrollment_id] = a.present;
  });
  return map;
}

// ---------------------------------------------------------------------
// Finance — expenses (admin only). Income comes from paid installments,
// already available via loadAllStudents().
// ---------------------------------------------------------------------
export async function listExpenses() {
  const { data, error } = await supabase.from('expenses').select('*').order('expense_date', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createExpense({ category, description, amount, date }) {
  const { error } = await supabase.from('expenses').insert({ category, description: description || null, amount, expense_date: date });
  if (error) throw error;
}

export async function deleteExpense(id) {
  const { error } = await supabase.from('expenses').delete().eq('id', id);
  if (error) throw error;
}
