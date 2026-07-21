import { supabase } from './supabaseClient.js';

// ---------------------------------------------------------------------
// Catalog (tests + subjects), loaded once per session and cached in memory.
// Replaces the prototype's hardcoded TEST_CATALOG.
// ---------------------------------------------------------------------
export async function loadCatalog() {
  const { data, error } = await supabase
    .from('tests')
    .select('id, name, default_price, default_duration_label, registration_only_price, subjects(id, name, sort_order, kind)')
    .order('name');
  if (error) throw error;

  const catalog = {};
  for (const t of data) {
    catalog[t.name] = {
      id: t.id,
      price: Number(t.default_price),
      duration: t.default_duration_label,
      regOnlyPrice: Number(t.registration_only_price),
      subjects: (t.subjects || []).slice().sort((a, b) => a.sort_order - b.sort_order),
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
    id, level, sessions_per_week, start_date, end_date, registration_only, price,
    tests ( name ),
    attendance ( id, session_date, present )
  ),
  invoices (
    id, invoice_number, invoice_date, total,
    payment_installments ( id, amount, due_date, paid, paid_date, method, receipt_number )
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

  const installments = ((invoice && invoice.payment_installments) || []).map((i) => ({
    id: i.id,
    amount: Number(i.amount),
    dueDate: i.due_date,
    paid: i.paid,
    paidDate: i.paid_date,
    receiptNumber: i.receipt_number,
    method: i.method,
  }));

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
    due_date: i.dueDate || null,
  }));
  const { error: instErr } = await supabase.from('payment_installments').insert(instRows);
  if (instErr) throw instErr;

  return { studentId, invoiceNumber };
}

// ---------------------------------------------------------------------
// Payments / attendance / certificates
// ---------------------------------------------------------------------
export async function markInstallmentPaid(installmentId, method) {
  const seq = await nextSeq('receipt_seq');
  const receiptNumber = 'RCT-' + String(seq).padStart(3, '0');
  const { error } = await supabase
    .from('payment_installments')
    .update({
      paid: true,
      paid_date: new Date().toISOString().slice(0, 10),
      method,
      receipt_number: receiptNumber,
    })
    .eq('id', installmentId);
  if (error) throw error;
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

export async function addTeacherInvite(email, fullName) {
  const { error } = await supabase.from('teacher_invites').insert({ email: email.toLowerCase(), full_name: fullName || null });
  if (error) throw error;
}

export async function listTeacherInvites() {
  const { data, error } = await supabase.from('teacher_invites').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data;
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

export async function getCurrentSessionInfo() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return null;
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', session.user.id).single();
  return { userId: session.user.id, email: session.user.email, role: profile?.role || 'student' };
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
