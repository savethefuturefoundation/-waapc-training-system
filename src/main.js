import * as db from './db.js';

let CATALOG = {};
let currentPortal = 'admin';
let currentSession = null; // { userId, email, role }
let currentStudentRecord = null;
let currentPhotoFile = null;
let loginMode = null; // 'signup' | 'signin'
let pendingLoginEmail = null;

// =====================================================================
// Portal switching. Before login: the auth screen shows a role-pill
// switcher (setRole) so the right login form is visible. After login:
// the app shell (sidebar + pages) takes over via showAppShell/showAuthScreen.
// =====================================================================
const ROLE_LABELS = { admin: 'Admin', teacher: 'Teacher', parent: 'Parent', student: 'Student' };

function setRole(portal) {
  currentPortal = portal;
  document.getElementById('btnAdminRole').classList.toggle('active', portal === 'admin');
  document.getElementById('btnTeacherRole').classList.toggle('active', portal === 'teacher');
  document.getElementById('btnParentRole').classList.toggle('active', portal === 'parent');
  document.getElementById('btnStudentRole').classList.toggle('active', portal === 'student');
  document.getElementById('adminLoginCard').classList.toggle('hidden', portal !== 'admin');
  document.getElementById('teacherLoginCard').classList.toggle('hidden', portal !== 'teacher');
  document.getElementById('parentLoginCard').classList.toggle('hidden', portal !== 'parent');
  document.getElementById('loginCard').classList.toggle('hidden', portal !== 'student');
}

function showAuthScreen(portal) {
  document.getElementById('appShell').classList.add('hidden');
  document.getElementById('authScreen').classList.remove('hidden');
  setRole(portal);
}

const SIDEBAR_NAME_FALLBACK = { admin: 'Administrator', teacher: 'Teacher', parent: 'Parent', student: 'Student' };

function showAppShell(role) {
  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
  document.getElementById('sidebarRoleBadge').textContent = ROLE_LABELS[role];
  document.getElementById('sidebarEmail').textContent = currentSession ? currentSession.email : '';
  const displayName = role === 'student' && currentStudentRecord ? currentStudentRecord.fullName : currentSession?.fullName;
  document.getElementById('sidebarName').textContent = displayName || SIDEBAR_NAME_FALLBACK[role] || '';
  document.getElementById('sidebarNavAdmin').classList.toggle('hidden', role !== 'admin');
  document.getElementById('sidebarNavTeacher').classList.toggle('hidden', role !== 'teacher');
  document.getElementById('sidebarNavParent').classList.toggle('hidden', role !== 'parent');
  document.getElementById('sidebarNavStudent').classList.toggle('hidden', role !== 'student');
  const logoutFns = { admin: adminLogout, teacher: teacherLogout, parent: parentLogout, student: studentLogout };
  document.getElementById('sidebarLogoutBtn').onclick = logoutFns[role];
}

function sidebarNavTo(pageId, btn) {
  btn.parentElement.querySelectorAll('.sidebar-nav-item').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('#appShell .page').forEach((p) => p.classList.add('hidden'));
  document.getElementById(pageId).classList.remove('hidden');
}

// Clicking the sidebar logo takes you back to your home/dashboard page,
// like clicking a site logo anywhere else.
function goHome() {
  if (!currentSession) return;
  if (currentSession.role === 'admin') return showTab('dashboard');
  const homeButtonByRole = {
    teacher: '#sidebarNavTeacher .sidebar-nav-item',
    parent: '#sidebarNavParent .sidebar-nav-item',
    student: '#nav-student-dashboard',
  };
  const selector = homeButtonByRole[currentSession.role];
  const btn = selector && document.querySelector(selector);
  if (btn) btn.click();
}

async function ensureCatalog() {
  if (!CATALOG || Object.keys(CATALOG).length === 0) CATALOG = await db.loadCatalog();
}

function showAdminLogin() {
  showAuthScreen('admin');
}

async function showAdminDashboard() {
  showAppShell('admin');
  document.querySelectorAll('#appShell .page').forEach((p) => p.classList.add('hidden'));
  await ensureCatalog();
  resetRegistrationForm();
  showTab('dashboard');
}

async function adminLogin() {
  const email = document.getElementById('adminEmail').value.trim();
  const password = document.getElementById('adminPassword').value;
  const errEl = document.getElementById('adminLoginError');
  errEl.textContent = '';
  try {
    await db.adminSignIn(email, password);
    const session = await db.getCurrentSessionInfo();
    if (!session || session.role !== 'admin') {
      await db.signOut();
      errEl.textContent = 'This account is not set up as an admin.';
      return;
    }
    currentSession = session;
    document.getElementById('adminEmail').value = '';
    document.getElementById('adminPassword').value = '';
    await showAdminDashboard();
  } catch (e) {
    errEl.textContent = e.message || 'Login failed.';
  }
}

async function adminLogout() {
  await db.signOut();
  currentSession = null;
  showAdminLogin();
}

let teacherLoginMode = null; // 'signup' | 'signin'
let pendingTeacherEmail = null;

function showTeacherLoginStep1() {
  showAuthScreen('teacher');
  document.getElementById('teacherLoginStep1').classList.remove('hidden');
  document.getElementById('teacherLoginStep2').classList.add('hidden');
  document.getElementById('teacherLoginError').textContent = '';
}

async function showTeacherDashboard() {
  showAppShell('teacher');
  document.querySelectorAll('#appShell .page').forEach((p) => p.classList.add('hidden'));
  document.getElementById('page-teacher-students').classList.remove('hidden');
  await ensureCatalog();
  renderTeacherStudentsTable();
  renderAssignTargets('tas');
  renderAssignmentsList('tas');
}

async function teacherCheckEmail() {
  const email = document.getElementById('teacherEmail').value.trim().toLowerCase();
  const errEl = document.getElementById('teacherLoginError');
  errEl.textContent = '';
  if (!email) {
    errEl.textContent = 'Enter your email.';
    return;
  }
  let status;
  try {
    status = await db.teacherAccountStatus(email);
  } catch (e) {
    errEl.textContent = 'Something went wrong checking that email. Please try again.';
    return;
  }
  if (status === 'not_invited') {
    errEl.textContent = "This email hasn't been invited as a teacher yet. Please contact the admin.";
    return;
  }
  pendingTeacherEmail = email;
  teacherLoginMode = status === 'needs_signup' ? 'signup' : 'signin';
  document.getElementById('teacherLoginStep1').classList.add('hidden');
  document.getElementById('teacherLoginStep2').classList.remove('hidden');
  document.getElementById('teacherPasswordLabel').textContent =
    teacherLoginMode === 'signup' ? 'Create a password (first login)' : 'Password';
  document.getElementById('teacherSubmitBtn').textContent = teacherLoginMode === 'signup' ? 'Create account & log in' : 'Log in';
  document.getElementById('teacherPassword').value = '';
}

function teacherBackToEmail() {
  showTeacherLoginStep1();
}

async function teacherSubmitPassword() {
  const password = document.getElementById('teacherPassword').value;
  const errEl = document.getElementById('teacherLoginError');
  errEl.textContent = '';
  if (!password || password.length < 6) {
    errEl.textContent = 'Password must be at least 6 characters.';
    return;
  }
  try {
    if (teacherLoginMode === 'signup') await db.teacherSignUp(pendingTeacherEmail, password);
    else await db.adminSignIn(pendingTeacherEmail, password);

    const session = await db.getCurrentSessionInfo();
    if (!session || session.role !== 'teacher') {
      await db.signOut();
      errEl.textContent = 'This account is not set up as a teacher.';
      return;
    }
    currentSession = session;
    document.getElementById('teacherPassword').value = '';
    await showTeacherDashboard();
  } catch (e) {
    errEl.textContent = e.message || 'Login failed. Please check your password and try again.';
  }
}

async function teacherLogout() {
  await db.signOut();
  currentSession = null;
  showTeacherLoginStep1();
}

async function renderTeacherStudentsTable() {
  const allStudents = await db.loadAllStudents();
  let myTestIds = [];
  try {
    myTestIds = await db.listMyTeacherAssignments();
  } catch (e) {
    console.error('listMyTeacherAssignments failed (has extra_schema_19.sql been run?):', e);
  }
  const students = myTestIds.length ? allStudents.filter((s) => s.programs.some((p) => myTestIds.includes(p.testId))) : allStudents;
  const tbody = document.querySelector('#teacherStudentsTable tbody');
  tbody.innerHTML = '';
  document.getElementById('teacherStudentsEmpty').classList.toggle('hidden', students.length > 0);
  document.getElementById('teacherStudentsScopeNote').classList.toggle('hidden', myTestIds.length === 0);
  students.forEach((s) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${s.fullName}</td>
      <td>${s.programs.map((p) => p.test).join(', ')}</td>
      <td>
        <button class="btn ghost small" onclick="openStudentProgress('${s.id}')">Progress</button>
        <button class="btn ghost small" onclick="openAttendance('${s.id}')">Attendance</button>
        <button class="btn ghost small" onclick="openProgressReport('${s.id}')">Report</button>
        <button class="btn ghost small" onclick="openGradebook('${s.id}')">Gradebook</button>
        ${studentHasGed(s) ? `<button class="btn ghost small" onclick="openPlacementResults('${s.id}')">Placement</button>` : ''}
        ${studentHasSpeaking(s) ? `<button class="btn ghost small" onclick="openSpeakingSubmissions('${s.id}')">Speaking</button>` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// =====================================================================
// Parent portal (read-only: attendance, progress reports, assignments)
// =====================================================================
let parentLoginMode = null; // 'signup' | 'signin'
let pendingParentEmail = null;

function showParentLoginStep1() {
  showAuthScreen('parent');
  document.getElementById('parentLoginStep1').classList.remove('hidden');
  document.getElementById('parentLoginStep2').classList.add('hidden');
  document.getElementById('parentLoginError').textContent = '';
}

async function showParentDashboard() {
  showAppShell('parent');
  document.querySelectorAll('#appShell .page').forEach((p) => p.classList.add('hidden'));
  document.getElementById('page-parent-children').classList.remove('hidden');
  await ensureCatalog();
  await renderParentChildren();
}

async function parentCheckEmail() {
  const email = document.getElementById('parentEmail').value.trim().toLowerCase();
  const errEl = document.getElementById('parentLoginError');
  errEl.textContent = '';
  if (!email) {
    errEl.textContent = 'Enter your email.';
    return;
  }
  let status;
  try {
    status = await db.parentAccountStatus(email);
  } catch (e) {
    errEl.textContent = 'Something went wrong checking that email. Please try again.';
    return;
  }
  if (status === 'not_registered') {
    errEl.textContent = "This email isn't on file as a parent/guardian yet. Please contact the school.";
    return;
  }
  pendingParentEmail = email;
  parentLoginMode = status === 'needs_signup' ? 'signup' : 'signin';
  document.getElementById('parentLoginStep1').classList.add('hidden');
  document.getElementById('parentLoginStep2').classList.remove('hidden');
  document.getElementById('parentPasswordLabel').textContent =
    parentLoginMode === 'signup' ? 'Create a password (first login)' : 'Password';
  document.getElementById('parentSubmitBtn').textContent = parentLoginMode === 'signup' ? 'Create account & log in' : 'Log in';
  document.getElementById('parentPassword').value = '';
}

function parentBackToEmail() {
  showParentLoginStep1();
}

async function parentSubmitPassword() {
  const password = document.getElementById('parentPassword').value;
  const errEl = document.getElementById('parentLoginError');
  errEl.textContent = '';
  if (!password || password.length < 6) {
    errEl.textContent = 'Password must be at least 6 characters.';
    return;
  }
  try {
    if (parentLoginMode === 'signup') await db.parentSignUp(pendingParentEmail, password);
    else await db.parentSignIn(pendingParentEmail, password);

    const session = await db.getCurrentSessionInfo();
    if (!session || session.role !== 'parent') {
      await db.signOut();
      errEl.textContent = 'This account is not set up as a parent.';
      return;
    }
    currentSession = session;
    document.getElementById('parentPassword').value = '';
    await showParentDashboard();
  } catch (e) {
    errEl.textContent = e.message || 'Login failed. Please check your password and try again.';
  }
}

async function parentLogout() {
  await db.signOut();
  currentSession = null;
  showParentLoginStep1();
}

async function renderParentChildren() {
  const children = await db.loadAllStudents();
  const container = document.getElementById('parentChildren');
  document.getElementById('parentChildrenEmpty').classList.toggle('hidden', children.length > 0);

  const namedChild = children.find((s) => s.guardian?.name);
  if (namedChild) document.getElementById('sidebarName').textContent = namedChild.guardian.name;

  const cards = await Promise.all(
    children.map(async (s) => {
      const [assignments, grades, progressHtml] = await Promise.all([
        db.listAssignmentsForStudent(s.id),
        db.listGradesForStudent(s.id),
        renderProgressPanel(s),
      ]);
      const assignmentsHtml = assignments.length
        ? assignments.map((a) => renderAssignmentCard(a, { editable: false })).join('')
        : '<p class="muted">No assignments yet.</p>';
      const gradesHtml = grades.length
        ? `<table><thead><tr><th>Subject</th><th>Label</th><th>Score</th></tr></thead><tbody>${grades
            .map((g) => `<tr><td>${g.test || ''} — ${g.subject || ''}</td><td>${g.label}</td><td>${gradeScoreDisplay(g)}</td></tr>`)
            .join('')}</tbody></table>`
        : '<p class="muted">No grades yet.</p>';
      return `<div class="card">
        <h2>${s.fullName}</h2>
        <p class="muted">${s.programs.map((p) => p.test).join(', ') || 'No programs enrolled'}</p>
        <button class="btn ghost small" onclick="openAttendance('${s.id}')">View attendance</button>
        <button class="btn ghost small" onclick="openProgressReport('${s.id}')">View progress report</button>
        <h3 style="margin-top:16px;color:var(--navy);">Progress</h3>
        ${progressHtml}
        <h3 style="margin-top:16px;color:var(--navy);">Grades</h3>
        ${gradesHtml}
        <h3 style="margin-top:16px;color:var(--navy);">Assignments</h3>
        ${assignmentsHtml}
      </div>`;
    })
  );
  container.innerHTML = cards.join('');
}

async function renderTeacherInvites() {
  const invites = await db.listTeacherInvites();
  const tbody = document.querySelector('#teacherInvitesTable tbody');
  tbody.innerHTML = '';
  document.getElementById('teacherInvitesEmpty').classList.toggle('hidden', invites.length > 0);
  invites.forEach((inv) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${inv.full_name || ''}</td>
      <td>${inv.email}</td>
      <td>${new Date(inv.created_at).toLocaleDateString()}</td>
      <td><button class="btn ghost small" onclick="revokeTeacherInvite('${inv.id}')">Revoke</button></td>
    `;
    tbody.appendChild(tr);
  });
}

async function addTeacherInvite() {
  const name = document.getElementById('t_name').value.trim();
  const email = document.getElementById('t_email').value.trim();
  const subjects = document.getElementById('t_subjects').value.trim();
  const errEl = document.getElementById('t_inviteError');
  errEl.textContent = '';
  if (!email) {
    errEl.textContent = 'Enter an email.';
    return;
  }
  try {
    await db.addTeacherInvite(email, name, subjects);
    document.getElementById('t_name').value = '';
    document.getElementById('t_email').value = '';
    document.getElementById('t_subjects').value = '';
    await renderTeacherInvites();
  } catch (e) {
    errEl.textContent = e.message || 'Could not send invite.';
  }
}

async function revokeTeacherInvite(id) {
  await db.revokeTeacherInvite(id);
  await renderTeacherInvites();
}

// =====================================================================
// Teachers directory (Admin/Teacher) — active teachers, mirroring the
// Parents directory, so students know their tutors via the timetable
// and admin can see who teaches what at a glance.
// =====================================================================
let editingTeacherId = null;

async function renderTeachersPage() {
  try {
    await ensureCatalog();
    const teachers = await db.listTeachers();
    const tbody = document.querySelector('#teachersTable tbody');
    document.getElementById('teachersEmpty').textContent = 'No active teachers yet — invited teachers appear here once they log in for the first time.';
    document.getElementById('teachersEmpty').classList.toggle('hidden', teachers.length > 0);
    const isAdmin = currentSession?.role === 'admin';

    const rows = await Promise.all(
      teachers.map(async (t) => {
        let assignedIds = new Set();
        try {
          assignedIds = new Set(await db.listTeacherAssignments(t.id));
        } catch (e) {
          console.error('listTeacherAssignments failed (has extra_schema_19.sql been run?):', e);
        }
        if (editingTeacherId === t.id) {
          const checkboxes = Object.keys(CATALOG)
            .map(
              (name) => `<label style="display:inline-flex;align-items:center;gap:4px;font-weight:normal;font-size:12px;margin-right:10px;white-space:nowrap;">
                <input type="checkbox" class="teach-edit-program" value="${CATALOG[name].id}" style="width:auto;margin:0;" ${assignedIds.has(CATALOG[name].id) ? 'checked' : ''}> ${name}
              </label>`
            )
            .join('');
          return `<tr>
            <td><input id="teach_edit_name" value="${t.fullName || ''}" style="margin-bottom:0;"></td>
            <td>${t.email}</td>
            <td><input id="teach_edit_subjects" value="${t.subjectsTaught || ''}" style="margin-bottom:0;" placeholder="e.g. Mathematics, Science"></td>
            <td style="min-width:220px;">${checkboxes}</td>
            <td>
              <button class="btn small" onclick="saveTeacherEdit('${t.id}')">Save</button>
              <button class="btn ghost small" onclick="cancelTeacherEdit()">Cancel</button>
            </td>
          </tr>`;
        }
        const assignedNames = Object.keys(CATALOG).filter((name) => assignedIds.has(CATALOG[name].id));
        return `<tr>
          <td>${t.fullName || '—'}</td>
          <td>${t.email}</td>
          <td>${t.subjectsTaught || '—'}</td>
          <td>${assignedNames.length ? assignedNames.join(', ') : '<span class="muted">All (unrestricted)</span>'}</td>
          <td>${isAdmin ? `<button class="btn ghost small" onclick="editTeacherClick('${t.id}')">Edit</button>` : ''}</td>
        </tr>`;
      })
    );
    tbody.innerHTML = rows.join('');
  } catch (e) {
    console.error('renderTeachersPage failed:', e);
    document.querySelector('#teachersTable tbody').innerHTML = '';
    const empty = document.getElementById('teachersEmpty');
    const detail = e?.message || String(e || '');
    empty.textContent = detail ? `Something went wrong loading teachers: ${detail}` : 'Something went wrong loading this page. Try refreshing — if it keeps happening, let the admin know.';
    empty.classList.remove('hidden');
  }
}

function editTeacherClick(id) {
  editingTeacherId = id;
  renderTeachersPage();
}

function cancelTeacherEdit() {
  editingTeacherId = null;
  renderTeachersPage();
}

async function saveTeacherEdit(id) {
  const fullName = document.getElementById('teach_edit_name').value.trim();
  const subjectsTaught = document.getElementById('teach_edit_subjects').value.trim();
  const testIds = Array.from(document.querySelectorAll('.teach-edit-program:checked')).map((el) => el.value);
  try {
    await db.updateTeacherProfile(id, { fullName, subjectsTaught });
    await db.setTeacherAssignments(id, testIds);
  } catch (e) {
    alert('Could not save changes: ' + (e.message || e));
    return;
  }
  editingTeacherId = null;
  await renderTeachersPage();
}

// =====================================================================
// Assignments (Admin + Teacher: create/manage; shared by both portals
// via a DOM id prefix — 'as' on the Admin tab, 'tas' on the Teacher tab)
// =====================================================================
async function renderAssignTargets(prefix) {
  const students = await db.loadAllStudents();
  const container = document.getElementById(`${prefix}_targets`);
  container.innerHTML =
    students.map((s) => `<label style="display:block;padding:2px 0;"><input type="checkbox" value="${s.id}"> ${s.fullName}</label>`).join('') ||
    '<p class="muted">No students registered yet.</p>';
}

function toggleAllAssignTargets(containerId, select) {
  document.querySelectorAll(`#${containerId} input[type=checkbox]`).forEach((cb) => (cb.checked = select));
}

async function createAssignment(prefix) {
  const title = document.getElementById(`${prefix}_title`).value.trim();
  const description = document.getElementById(`${prefix}_desc`).value.trim();
  const linkUrl = document.getElementById(`${prefix}_link`).value.trim();
  const dueDate = document.getElementById(`${prefix}_due`).value;
  const studentIds = Array.from(document.querySelectorAll(`#${prefix}_targets input[type=checkbox]:checked`)).map((cb) => cb.value);
  const errEl = document.getElementById(`${prefix}_error`);
  errEl.textContent = '';
  if (!title) {
    errEl.textContent = 'Enter a title.';
    return;
  }
  if (studentIds.length === 0) {
    errEl.textContent = 'Select at least one student.';
    return;
  }
  try {
    await db.createAssignment({ title, description, linkUrl, dueDate, studentIds });
    document.getElementById(`${prefix}_title`).value = '';
    document.getElementById(`${prefix}_desc`).value = '';
    document.getElementById(`${prefix}_link`).value = '';
    document.getElementById(`${prefix}_due`).value = '';
    toggleAllAssignTargets(`${prefix}_targets`, false);
    await renderAssignmentsList(prefix);
  } catch (e) {
    errEl.textContent = e.message || 'Could not create assignment.';
  }
}

async function renderAssignmentsList(prefix) {
  const assignments = await db.listAssignments();
  const listEl = document.getElementById(`${prefix}_list`);
  document.getElementById(`${prefix}_listEmpty`).classList.toggle('hidden', assignments.length > 0);
  listEl.innerHTML = assignments
    .map((a) => {
      const doneCount = a.targets.filter((t) => t.submission?.status === 'done').length;
      const rows = a.targets
        .map(
          (t) => `<tr>
        <td>${t.fullName || 'Unknown'}</td>
        <td>${t.submission?.status === 'done' ? 'Done' : 'Not started'}</td>
        <td>${t.submission?.submitted_at ? new Date(t.submission.submitted_at).toLocaleDateString() : '—'}</td>
      </tr>`
        )
        .join('');
      return `<div class="subject-card" style="display:block;">
        <div style="display:flex;justify-content:space-between;align-items:start;">
          <div>
            <div class="name">${a.title}</div>
            <div class="stats">${a.dueDate ? 'Due ' + a.dueDate + ' &middot; ' : ''}${doneCount}/${a.targets.length} done${
        a.linkUrl ? ' &middot; <a href="' + a.linkUrl + '" target="_blank" rel="noopener">Link</a>' : ''
      }</div>
            ${a.description ? `<p class="muted" style="margin:6px 0 0 0;">${a.description}</p>` : ''}
          </div>
          <button class="btn ghost small" onclick="deleteAssignment('${a.id}','${prefix}')">Delete</button>
        </div>
        <table style="margin-top:8px;"><thead><tr><th>Student</th><th>Status</th><th>Submitted</th></tr></thead><tbody>${rows}</tbody></table>
      </div>`;
    })
    .join('');
}

async function deleteAssignment(id, prefix) {
  try {
    await db.deleteAssignment(id);
  } catch (e) {
    alert('Could not delete assignment: ' + (e.message || e));
    return;
  }
  await renderAssignmentsList(prefix);
}

// Hand-rolled horizontal bar chart: thin bars on a track, rounded ends,
// label to the left, value directly labeled to the right (never color-alone).
function hBarChart(items, opts = {}) {
  const valueFmt = opts.valueFmt || ((v) => v.toLocaleString());
  const barH = 22, rowGap = 18, leftW = 176, plotW = 232, chartW = 520;
  const max = Math.max(1, ...items.map((i) => i.value));
  const rowH = barH + rowGap;
  const height = items.length * rowH + rowGap;
  const rows = items
    .map((item, i) => {
      const y = rowGap + i * rowH;
      const w = item.value > 0 ? Math.max(6, (item.value / max) * plotW) : 0;
      return `
        <text x="${leftW - 10}" y="${y + barH / 2 + 4}" text-anchor="end" font-size="12" font-weight="600" fill="var(--gray-600)">${item.label}</text>
        <rect x="${leftW}" y="${y}" width="${plotW}" height="${barH}" rx="4" fill="var(--gray-100)"></rect>
        <rect x="${leftW}" y="${y}" width="${w}" height="${barH}" rx="4" fill="${item.color}"></rect>
        <text x="${leftW + plotW + 10}" y="${y + barH / 2 + 4}" font-size="12" font-weight="700" fill="var(--navy)">${valueFmt(item.value)}</text>
      `;
    })
    .join('');
  return `<svg viewBox="0 0 ${chartW} ${height}" width="100%" style="max-width:480px;display:block;" role="img" aria-label="${items.map((i) => `${i.label}: ${valueFmt(i.value)}`).join(', ')}">${rows}</svg>`;
}

async function renderAdminDashboardStats() {
  document.getElementById('dash_date').textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  await ensureCatalog();
  const [students, teacherCount, assignments, gedScores, expenses] = await Promise.all([
    db.loadAllStudents(),
    db.countTeachers(),
    db.listAssignments(),
    db.listAllGedScores(),
    db.listExpenses(),
  ]);
  document.getElementById('dash_students').textContent = students.length;
  document.getElementById('dash_teachers').textContent = teacherCount;
  document.getElementById('dash_programs').textContent = Object.keys(CATALOG).length;
  document.getElementById('dash_assignments').textContent = assignments.length;

  const tierCounts = { 'Below Passing': 0, Passing: 0, 'College Ready': 0, 'College Ready + Credit': 0 };
  gedScores.forEach((score) => { tierCounts[gedTier(score)]++; });
  document.getElementById('dash_perfEmpty').classList.toggle('hidden', gedScores.length > 0);
  document.getElementById('dash_perfChart').innerHTML = gedScores.length
    ? hBarChart(
        [
          { label: 'Below Passing', value: tierCounts['Below Passing'], color: 'var(--red)' },
          { label: 'Passing', value: tierCounts['Passing'], color: 'var(--amber)' },
          { label: 'College Ready', value: tierCounts['College Ready'], color: 'var(--blue)' },
          { label: 'College Ready + Credit', value: tierCounts['College Ready + Credit'], color: 'var(--green)' },
        ],
        { valueFmt: (v) => String(v) }
      )
    : '';

  let totalIncome = 0;
  students.forEach((s) => s.installments.forEach((inst) => { totalIncome += inst.amountPaid; }));
  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  document.getElementById('dash_finChart').innerHTML = hBarChart(
    [
      { label: 'Income', value: totalIncome, color: 'var(--navy)' },
      { label: 'Expenses', value: totalExpenses, color: 'var(--gold)' },
    ],
    { valueFmt: (v) => v.toLocaleString() + ' CFA' }
  );
  const net = totalIncome - totalExpenses;
  document.getElementById('dash_finNet').textContent = `Net: ${net.toLocaleString()} CFA`;
  document.getElementById('dash_finNet').style.color = net >= 0 ? 'var(--green)' : 'var(--red)';
}

function showTab(name) {
  document.querySelectorAll('#appShell .page').forEach((p) => p.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  const target = document.getElementById('tab-' + name);
  if (target) target.classList.remove('hidden');
  if (name === 'dashboard') renderAdminDashboardStats();
  if (name === 'manage') renderStudentsTable();
  if (name === 'graduates') renderGraduatesPage();
  if (name === 'qb') qbInit();
  if (name === 'staff') renderTeacherInvites();
  if (name === 'assignments') {
    renderAssignTargets('as');
    renderAssignmentsList('as');
  }
  if (name === 'messages') renderMessagesPage();
  if (name === 'announcements') renderAnnouncementsPage();
  if (name === 'calendar') renderCalendarPage();
  if (name === 'timetable') renderTimetablePage();
  if (name === 'attendance') renderAttendancePage();
  if (name === 'parents') renderParentsPage();
  if (name === 'teachers') renderTeachersPage();
  if (name === 'finance') renderFinancePage();
}

// =====================================================================
// Registration
// =====================================================================
function handlePhoto(e) {
  const file = e.target.files[0];
  if (!file) return;
  currentPhotoFile = file;
  const reader = new FileReader();
  reader.onload = () => {
    const img = document.getElementById('photoPreview');
    img.src = reader.result;
    img.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function addProgramRow() {
  const div = document.createElement('div');
  div.className = 'program-row-wrap';
  const testOptions = Object.keys(CATALOG).map((t) => `<option value="${t}">${t}</option>`).join('');
  div.innerHTML = `
    <div class="program-row">
      <select class="p-test" onchange="onProgramChange(this)">${testOptions}</select>
      <select class="p-level"><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select>
      <input type="date" class="p-start" title="Start date">
      <input type="date" class="p-end" title="End date">
      <input type="number" class="p-sessions" placeholder="Sessions/wk" value="2">
      <input type="number" class="p-price" placeholder="Price CFA">
      <button class="field-remove" onclick="this.closest('.program-row-wrap').remove(); recalcTotals();">×</button>
    </div>
    <div style="margin: -4px 0 8px 2px;">
      <label style="display:inline-flex;align-items:center;gap:6px;font-weight:normal;font-size:12px;color:#444;">
        <input type="checkbox" class="p-regonly" style="width:auto;margin:0;" onchange="onProgramChange(this.closest('.program-row-wrap').querySelector('.p-test'))">
        Registration only — student wants to take just the actual test, no training
      </label>
    </div>
  `;
  document.getElementById('programRows').appendChild(div);
  onProgramChange(div.querySelector('.p-test'));
}

function onProgramChange(selectEl) {
  const test = selectEl.value;
  const row = selectEl.closest('.program-row-wrap');
  const regOnly = row.querySelector('.p-regonly').checked;
  const priceInput = row.querySelector('.p-price');
  const sessionsInput = row.querySelector('.p-sessions');
  const startInput = row.querySelector('.p-start');
  const endInput = row.querySelector('.p-end');
  const levelSelect = row.querySelector('.p-level');
  const cat = CATALOG[test];
  if (regOnly) {
    priceInput.value = cat.regOnlyPrice;
    sessionsInput.value = '';
    sessionsInput.disabled = true;
    startInput.disabled = true;
    endInput.disabled = true;
    levelSelect.disabled = true;
  } else {
    priceInput.value = cat.price;
    sessionsInput.disabled = false;
    startInput.disabled = false;
    endInput.disabled = false;
    levelSelect.disabled = false;
    if (!sessionsInput.value) sessionsInput.value = 2;
  }
  recalcTotals();
}

function recalcTotals() {
  let total = 0;
  document.querySelectorAll('.p-price').forEach((inp) => (total += Number(inp.value || 0)));
  document.getElementById('programTotal').textContent = total.toLocaleString();
  recalcInstallments();
}

function addInstallmentRow() {
  const div = document.createElement('div');
  div.className = 'installment-row';
  div.innerHTML = `
    <input type="number" class="i-amount" placeholder="Amount CFA" oninput="recalcInstallments()">
    <select class="i-category">
      <option value="registration">Registration</option>
      <option value="training" selected>Training</option>
      <option value="test">Test</option>
      <option value="other">Other</option>
    </select>
    <input type="date" class="i-due" title="Due date">
    <span class="muted">CFA</span>
    <button class="field-remove" onclick="this.parentElement.remove(); recalcInstallments();">×</button>
  `;
  document.getElementById('installmentRows').appendChild(div);
}

function recalcInstallments() {
  let total = 0;
  document.querySelectorAll('.i-amount').forEach((inp) => (total += Number(inp.value || 0)));
  document.getElementById('installTotal').textContent = total.toLocaleString();
  const programTotal = Number(document.getElementById('programTotal').textContent.replace(/,/g, '') || 0);
  const warn = document.getElementById('installWarning');
  warn.textContent =
    total !== programTotal && document.querySelectorAll('.i-amount').length > 0
      ? `(does not match total of ${programTotal.toLocaleString()})`
      : '';
}

async function submitRegistration() {
  const name = document.getElementById('s_name').value.trim();
  const email = document.getElementById('s_email').value.trim();
  if (!name || !email) {
    alert('Full name and email are required.');
    return;
  }

  const programs = [];
  document.querySelectorAll('.program-row-wrap').forEach((row) => {
    const regOnly = row.querySelector('.p-regonly').checked;
    const testName = row.querySelector('.p-test').value;
    programs.push({
      testId: CATALOG[testName].id,
      test: testName,
      level: row.querySelector('.p-level').value,
      start: row.querySelector('.p-start').value,
      end: row.querySelector('.p-end').value,
      sessionsPerWeek: Number(row.querySelector('.p-sessions').value || 0) || null,
      price: Number(row.querySelector('.p-price').value || 0),
      regOnly,
    });
  });
  if (programs.length === 0) {
    alert('Add at least one test/program.');
    return;
  }

  const installments = [];
  document.querySelectorAll('.installment-row').forEach((row) => {
    installments.push({
      amount: Number(row.querySelector('.i-amount').value || 0),
      category: row.querySelector('.i-category').value,
      dueDate: row.querySelector('.i-due').value || null,
    });
  });
  const total = programs.reduce((s, p) => s + p.price, 0);
  if (installments.length === 0) {
    installments.push({ amount: total, category: 'training', dueDate: null });
  }

  const student = {
    fullName: name,
    dob: document.getElementById('s_dob').value || null,
    gender: document.getElementById('s_gender').value,
    nationality: document.getElementById('s_nat').value,
    email,
    phone: document.getElementById('s_phone').value,
    guardian: {
      name: document.getElementById('g_name').value,
      relationship: document.getElementById('g_rel').value,
      phone: document.getElementById('g_phone').value,
      email: document.getElementById('g_email').value,
      address: document.getElementById('g_addr').value,
    },
    notes: document.getElementById('s_notes').value,
  };

  let result;
  try {
    result = await db.registerStudent({ student, programs, installments, photoFile: currentPhotoFile });
  } catch (e) {
    alert('Registration failed: ' + (e.message || e));
    return;
  }

  alert('Student registered. Invoice ' + result.invoiceNumber + ' generated.');
  resetRegistrationForm();
  showTab('manage');
  const list = await db.loadAllStudents();
  const s = list.find((x) => x.id === result.studentId);
  if (s) openInvoice(s);
}

function resetRegistrationForm() {
  ['s_name', 's_dob', 's_nat', 's_email', 's_phone', 'g_name', 'g_rel', 'g_phone', 'g_email', 'g_addr', 's_notes'].forEach(
    (id) => (document.getElementById(id).value = '')
  );
  document.getElementById('programRows').innerHTML = '';
  document.getElementById('installmentRows').innerHTML = '';
  document.getElementById('photoPreview').classList.add('hidden');
  currentPhotoFile = null;
  addProgramRow();
  recalcTotals();
}

// =====================================================================
// Students & Payments
// =====================================================================
function balanceOf(student) {
  const paid = student.installments.reduce((s, i) => s + i.amountPaid, 0);
  return student.total - paid;
}

function statusOf(student) {
  const bal = balanceOf(student);
  if (bal <= 0) return 'paid';
  if (bal < student.total) return 'partial';
  return 'unpaid';
}

// GED/SAT/ACT have no Placement assessment or Speaking section in real
// life (extra_schema_6.sql strips any stray Speaking subject from them),
// so those tabs only make sense for a student's actual enrolled program(s).
function studentHasGed(student) {
  return student.programs.some((p) => p.test === 'GED');
}

function studentHasSpeaking(student) {
  return student.programs.some((p) => (CATALOG[p.test]?.subjects || []).some((sub) => /speaking/i.test(sub.name)));
}

// Interactive management screens (attendance, payments, gradebook,
// placement, speaking) render in-place inside the student profile page
// when it's open; everywhere else (teacher/parent views, or before the
// profile page exists) they fall back to the popup overlay. Printable
// documents (invoice, progress report, certificate) always use the
// popup so printing keeps working.
function isStudentProfileActive() {
  const el = document.getElementById('page-student-profile');
  return !!el && !el.classList.contains('hidden');
}

function renderDoc(html) {
  setPrintOrientation(false);
  if (isStudentProfileActive()) {
    document.getElementById('studentProfileContent').innerHTML = html;
  } else {
    document.getElementById('docContent').innerHTML = html;
    document.getElementById('docOverlay').classList.add('show');
  }
}

let currentProfileStudentId = null;

async function openStudentProfile(id) {
  currentProfileStudentId = id;
  document.querySelectorAll('#appShell .page').forEach((p) => p.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.getElementById('page-student-profile').classList.remove('hidden');
  await studentProfileNav('overview');
}

function closeStudentProfile() {
  currentProfileStudentId = null;
  showTab('manage');
}

async function deleteCurrentProfileStudent() {
  if (!currentProfileStudentId) return;
  const students = await db.loadAllStudents();
  const s = students.find((x) => x.id === currentProfileStudentId);
  if (!s) return;
  const typed = prompt(
    `This permanently deletes ${s.fullName} and everything tied to them — enrollments, invoices, payments, grades, attendance, assignments, certificates. This cannot be undone.\n\nType the student's full name to confirm:`
  );
  if (typed === null) return;
  if (typed.trim().toLowerCase() !== s.fullName.trim().toLowerCase()) {
    alert('Name did not match — nothing was deleted.');
    return;
  }
  try {
    await db.deleteStudent(s.id);
  } catch (e) {
    alert('Could not delete student: ' + (e.message || e));
    return;
  }
  alert(`${s.fullName} has been deleted. If they had already created their own login, remove it separately in Supabase (Authentication → Users).`);
  closeStudentProfile();
}

async function studentProfileNav(section) {
  if (!currentProfileStudentId) return;
  document.querySelectorAll('.student-subnav-item').forEach((b) => b.classList.toggle('active', b.dataset.section === section));
  const id = currentProfileStudentId;
  await ensureCatalog();
  const students = await db.loadAllStudents();
  const s = students.find((x) => x.id === id);
  if (!s) return;
  document.getElementById('sp_name').textContent = s.fullName;
  document.getElementById('sp_status').innerHTML = `<span class="badge ${statusOf(s)}">${statusOf(s)}</span>`;
  const placementBtn = document.querySelector('.student-subnav-item[data-section="placement"]');
  const speakingBtn = document.querySelector('.student-subnav-item[data-section="speaking"]');
  if (placementBtn) placementBtn.classList.toggle('hidden', !studentHasGed(s));
  if (speakingBtn) speakingBtn.classList.toggle('hidden', !studentHasSpeaking(s));
  if (section === 'attendance') return openAttendance(id);
  if (section === 'payments') return openPayments(id);
  if (section === 'gradebook') return openGradebook(id);
  if (section === 'placement') return openPlacementResults(id);
  if (section === 'speaking') return openSpeakingSubmissions(id);
  return openStudentDetail(id);
}

function openCurrentProfileInvoice() {
  if (currentProfileStudentId) openInvoiceById(currentProfileStudentId);
}
function openCurrentProfileProgressReport() {
  if (currentProfileStudentId) openProgressReport(currentProfileStudentId);
}
function openCurrentProfileCertificate() {
  if (currentProfileStudentId) openCertificateForm(currentProfileStudentId);
}

async function renderStudentsTable() {
  const students = await db.loadAllStudents();
  const tbody = document.querySelector('#studentsTable tbody');
  tbody.innerHTML = '';
  document.getElementById('studentsEmpty').classList.toggle('hidden', students.length > 0);
  students.forEach((s) => {
    const status = statusOf(s);
    const tr = document.createElement('tr');
    tr.className = 'row-clickable';
    tr.onclick = () => openStudentProfile(s.id);
    tr.innerHTML = `
      <td><b>${s.fullName}</b></td>
      <td>${s.programs.map((p) => p.test).join(', ') || '—'}</td>
      <td><span class="badge ${status}">${status}</span></td>
      <td><button class="btn ghost small" onclick="event.stopPropagation(); openStudentProfile('${s.id}')">View</button></td>
    `;
    tbody.appendChild(tr);
  });
}

async function openStudentDetail(id) {
  const students = await db.loadAllStudents();
  const s = students.find((x) => x.id === id);
  if (!s) return;
  const bal = balanceOf(s);
  const status = statusOf(s);
  const progressHtml = await renderProgressPanel(s);

  const programRows = s.programs
    .map((p) => {
      const graduated = p.status === 'graduated';
      return `<tr>
      <td>${p.test} <span class="muted">(${p.level || '—'})</span></td>
      <td>${p.start || '—'} → ${p.end || '—'}</td>
      <td>${p.price.toLocaleString()} CFA</td>
      <td><span class="badge ${graduated ? 'paid' : 'neutral'}">${graduated ? 'Graduated' : 'Active'}</span>${graduated && p.graduatedDate ? ` <span class="muted">(${p.graduatedDate})</span>` : ''}</td>
      <td class="no-print">
        ${
          graduated
            ? `<button class="btn ghost small" onclick="ungraduateEnrollmentClick('${p.id}','${s.id}')">Undo</button>`
            : `<button class="btn small" onclick="graduateEnrollmentClick('${p.id}','${s.id}')">Graduate</button>`
        }
      </td>
    </tr>`;
    })
    .join('');

  const html = `
    <h3 style="color:var(--navy);margin-bottom:4px;">${s.fullName} <span class="badge ${status}">${status}</span></h3>
    <div class="grid2" style="margin-top:16px;">
      <div>
        <p class="muted" style="margin-bottom:2px;">Date of birth</p><p style="margin-top:0;">${s.dob || '—'}</p>
        <p class="muted" style="margin-bottom:2px;">Gender</p><p style="margin-top:0;">${s.gender || '—'}</p>
        <p class="muted" style="margin-bottom:2px;">Nationality</p><p style="margin-top:0;">${s.nationality || '—'}</p>
      </div>
      <div>
        <p class="muted" style="margin-bottom:2px;">Email</p><p style="margin-top:0;">${s.email}</p>
        <p class="muted" style="margin-bottom:2px;">Phone</p><p style="margin-top:0;">${s.phone || '—'}</p>
      </div>
    </div>

    <h3 style="color:var(--navy);margin-top:20px;">Parent / guardian</h3>
    <div class="grid2">
      <div>
        <p class="muted" style="margin-bottom:2px;">Name</p><p style="margin-top:0;">${s.guardian.name || '—'} ${s.guardian.relationship ? '(' + s.guardian.relationship + ')' : ''}</p>
        <p class="muted" style="margin-bottom:2px;">Phone</p><p style="margin-top:0;">${s.guardian.phone || '—'}</p>
      </div>
      <div>
        <p class="muted" style="margin-bottom:2px;">Email</p><p style="margin-top:0;">${s.guardian.email || '—'}</p>
        <p class="muted" style="margin-bottom:2px;">Address</p><p style="margin-top:0;">${s.guardian.address || '—'}</p>
      </div>
    </div>

    <h3 style="color:var(--navy);margin-top:20px;">Programs</h3>
    <table><thead><tr><th>Program</th><th>Schedule</th><th>Price</th><th>Status</th><th></th></tr></thead><tbody>${programRows}</tbody></table>
    <p class="muted" style="margin-top:10px;">Invoice ${s.invoiceNumber || '—'} — Total ${s.total.toLocaleString()} CFA, Balance ${bal.toLocaleString()} CFA</p>

    <h3 style="color:var(--navy);margin-top:20px;">Progress</h3>
    ${progressHtml}
  `;
  renderDoc(html);
}

// Graduating is tracked per enrollment (a student can be in more than
// one program at once) and never restricts login — the student/parent
// can always view final grades, attendance, and the certificate. Only
// the "take practice test" actions for that specific program retire.
async function graduateEnrollmentClick(enrollmentId, studentId) {
  if (!confirm('Mark this program as graduated? You can undo this afterward if needed.')) return;
  try {
    await db.graduateEnrollment(enrollmentId);
  } catch (e) {
    alert('Could not update: ' + (e.message || e));
    return;
  }
  await openStudentDetail(studentId);
  if (confirm('Marked as graduated. Issue their certificate now?')) {
    await openCertificateForm(studentId);
  }
}

async function ungraduateEnrollmentClick(enrollmentId, studentId) {
  if (!confirm('Undo graduated status for this program?')) return;
  try {
    await db.ungraduateEnrollment(enrollmentId);
  } catch (e) {
    alert('Could not update: ' + (e.message || e));
    return;
  }
  await openStudentDetail(studentId);
}

// =====================================================================
// Graduates dashboard — every completed enrollment, with a visual
// breakdown of GED performance tiers and program mix, plus the full list.
// =====================================================================
async function renderGraduatesPage() {
  const [grads, gedByStudent] = await Promise.all([db.listGraduates(), db.listGedScoresByStudent()]);

  const attendanceVals = grads.map((g) => g.attendancePct).filter((v) => v != null);
  const avgAttendance = attendanceVals.length
    ? Math.round(attendanceVals.reduce((a, b) => a + Number(b), 0) / attendanceVals.length)
    : null;

  const gedGrads = grads.filter((g) => g.test === 'GED');
  const gedPassCount = gedGrads.filter((g) => {
    const best = gedByStudent[g.studentId];
    return best != null && best >= 145;
  }).length;
  const gedPassRate = gedGrads.length ? Math.round((gedPassCount / gedGrads.length) * 100) : null;

  document.getElementById('grad_stats').innerHTML = `
    <div class="stat-grid" style="grid-template-columns:repeat(3,1fr);">
      <div class="stat-card"><div class="stat-label">Total Graduates</div><div class="stat-value">${grads.length}</div></div>
      <div class="stat-card"><div class="stat-label">GED Pass Rate</div><div class="stat-value">${gedPassRate != null ? gedPassRate + '%' : '—'}</div></div>
      <div class="stat-card"><div class="stat-label">Avg. Attendance</div><div class="stat-value">${avgAttendance != null ? avgAttendance + '%' : '—'}</div></div>
    </div>
  `;

  const tierCounts = { 'Below Passing': 0, Passing: 0, 'College Ready': 0, 'College Ready + Credit': 0 };
  gedGrads.forEach((g) => {
    const best = gedByStudent[g.studentId];
    if (best != null) tierCounts[gedTier(best)]++;
  });
  document.getElementById('grad_gedChartEmpty').classList.toggle('hidden', gedGrads.length > 0);
  document.getElementById('grad_gedChart').innerHTML = gedGrads.length
    ? hBarChart(
        Object.entries(GED_TIER_COLOR).map(([label, color]) => ({ label, value: tierCounts[label], color })),
        { valueFmt: (v) => String(v) }
      )
    : '';

  const programCounts = {};
  grads.forEach((g) => { programCounts[g.test] = (programCounts[g.test] || 0) + 1; });
  document.getElementById('grad_programChartEmpty').classList.toggle('hidden', grads.length > 0);
  document.getElementById('grad_programChart').innerHTML = grads.length
    ? hBarChart(
        Object.entries(programCounts).map(([label, value]) => ({ label, value, color: 'var(--navy)' })),
        { valueFmt: (v) => String(v) }
      )
    : '';

  const tbody = document.querySelector('#grad_table tbody');
  document.getElementById('grad_listEmpty').classList.toggle('hidden', grads.length > 0);
  tbody.innerHTML = grads
    .map((g) => {
      const best = gedByStudent[g.studentId];
      const scoreDisplay =
        g.test === 'GED' && best != null
          ? `${best} / 200 — ${gedTier(best)}`
          : g.finalScore != null
          ? `${g.finalScore} / ${g.finalTotal}`
          : '—';
      return `
        <tr>
          <td>${g.studentName || '—'}</td>
          <td>${g.test || '—'}${g.level ? ' · ' + g.level : ''}</td>
          <td>${g.graduatedDate ? new Date(g.graduatedDate).toLocaleDateString() : '—'}</td>
          <td>${scoreDisplay}</td>
          <td>${g.attendancePct != null ? g.attendancePct + '%' : '—'}</td>
          <td>${g.certNumber || '—'}</td>
        </tr>
      `;
    })
    .join('');
}

// =====================================================================
// Gradebook (Admin/Teacher entry; shared with Student/Parent read views)
// =====================================================================
// The real GED exam scores each subject 100-200, not as a percentage.
// Passing is 145+; 165+ is "College Ready"; 175+ adds college credit.
function gedTier(score) {
  if (score < 145) return 'Below Passing';
  if (score < 165) return 'Passing';
  if (score < 175) return 'College Ready';
  return 'College Ready + Credit';
}

function gradeScoreDisplay(g) {
  return g.test === 'GED' ? `${g.score} / 200 — ${gedTier(g.score)}` : `${g.score} / ${g.maxScore}`;
}

// =====================================================================
// Progress panel (student dashboard, parent per-child view, admin
// overview) — GED score trend since Friday tests started, plus quick
// stats. Baseline (GAPA placement, 0-100 English readiness) and GED
// scores (100-200 official scale) are different measurements, so they
// get separate panels rather than one misleading combined chart.
// =====================================================================
const GED_TIER_COLOR = {
  'Below Passing': 'var(--red)',
  Passing: 'var(--amber)',
  'College Ready': 'var(--blue)',
  'College Ready + Credit': 'var(--green)',
};

// The four real GED content areas, in the fixed order/colors GED Ready's
// own score report uses — every student sees the same subject always in
// the same color, so identity never depends on the data.
const GED_READY_SUBJECTS = [
  { name: 'Science', short: 'Science', color: 'var(--red)' },
  { name: 'Social Studies', short: 'Social Studies', color: 'var(--green)' },
  { name: 'Reasoning Through Language Arts', short: 'Language Arts', color: 'var(--purple)' },
  { name: 'Mathematical Reasoning', short: 'Math', color: 'var(--teal)' },
];

// Every GED student takes the real, authorized GED Ready practice test
// before starting classes (their baseline), and may retake it during
// training to check readiness for the actual exam. This shows the most
// recent official GED Ready score per subject, styled like the real
// GED Ready score report.
function gedReadyScoreCards(gedGrades, opts = {}) {
  const latestBySubject = {};
  gedGrades
    .filter((g) => g.source === 'ged_ready')
    .forEach((g) => {
      const prev = latestBySubject[g.subject];
      if (!prev || new Date(g.enteredAt) > new Date(prev.enteredAt)) latestBySubject[g.subject] = g;
    });

  const cards = GED_READY_SUBJECTS.map((cfg) => {
    const g = latestBySubject[cfg.name];
    const passing = g && g.score >= 145;
    const notTaken = !g;
    const statusText = notTaken ? 'Not yet taken' : passing ? "You're ready — schedule now!" : 'Keep Studying!';
    const pillText = notTaken ? 'Not yet taken' : passing ? 'Schedule Test' : 'Keep Studying!';
    const pillStyle = passing
      ? `background:${cfg.color};border-color:${cfg.color};color:#fff;`
      : `background:transparent;border-color:${cfg.color};color:${cfg.color};`;
    return `
      <div class="ged-ready-card">
        <div class="ged-ready-card-header" style="background:${cfg.color};">
          <div class="ged-ready-card-kicker">✎ Practice Test</div>
          <div class="ged-ready-card-subject">${cfg.short}</div>
        </div>
        <div class="ged-ready-card-body">
          <div class="ged-ready-score-circle">${g ? g.score : '—'}</div>
          <div class="ged-ready-status">${statusText}</div>
          ${g ? `<div class="ged-ready-date">Taken ${new Date(g.enteredAt).toLocaleDateString()}</div>` : '<div class="ged-ready-date">&nbsp;</div>'}
          <span class="ged-ready-pill" style="${pillStyle}">${pillText}</span>
          ${passing ? `<span class="ged-ready-report-link" style="color:${cfg.color};">Review score report ›</span>` : ''}
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="card">
      <h2>Most Recent GED Ready Practice Test Scores</h2>
      <p class="muted">After taking your practice test, if you're <i>likely to pass</i> then schedule your test right away. If not, focus your studying on exactly the skills you need to brush up on.</p>
      <div class="ged-ready-grid"${opts.interactive ? ` onclick="sidebarClickById('nav-student-grades')" style="cursor:pointer;"` : ''}>${cards}</div>
    </div>
  `;
}

function gedScoreTrendChart(gedGrades) {
  const points = gedGrades.slice().sort((a, b) => new Date(a.enteredAt) - new Date(b.enteredAt));
  const W = 560, H = 240, ML = 42, MR = 16, MT = 16, MB = 44;
  const plotW = W - ML - MR, plotH = H - MT - MB;
  const yMin = 100, yMax = 200;
  const scaleY = (v) => MT + ((yMax - v) / (yMax - yMin)) * plotH;
  const scaleX = (i) => (points.length > 1 ? ML + (i / (points.length - 1)) * plotW : ML + plotW / 2);

  const bands = [
    { from: 100, to: 145, color: 'var(--red)' },
    { from: 145, to: 165, color: 'var(--amber)' },
    { from: 165, to: 175, color: 'var(--blue)' },
    { from: 175, to: 200, color: 'var(--green)' },
  ];
  const bandRects = bands
    .map((b) => `<rect x="${ML}" y="${scaleY(b.to)}" width="${plotW}" height="${scaleY(b.from) - scaleY(b.to)}" fill="${b.color}" opacity="0.07"></rect>`)
    .join('');

  const linePoints = points.map((g, i) => `${scaleX(i)},${scaleY(g.score)}`).join(' ');
  const dots = points
    .map((g, i) => {
      const x = scaleX(i), y = scaleY(g.score);
      const color = GED_TIER_COLOR[gedTier(g.score)];
      const dateLabel = new Date(g.enteredAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      return `
        <circle cx="${x}" cy="${y}" r="5" fill="${color}" stroke="var(--white)" stroke-width="2"></circle>
        <text x="${x}" y="${y - 12}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--navy)">${g.score}</text>
        <text x="${x}" y="${H - MB + 16}" text-anchor="middle" font-size="10" fill="var(--gray-500)">${dateLabel}</text>
      `;
    })
    .join('');

  const yTicks = [100, 145, 165, 175, 200]
    .map(
      (v) => `<text x="${ML - 8}" y="${scaleY(v) + 4}" text-anchor="end" font-size="10" fill="var(--gray-500)">${v}</text>
      <line x1="${ML}" y1="${scaleY(v)}" x2="${ML + plotW}" y2="${scaleY(v)}" stroke="var(--gray-200)" stroke-width="1"></line>`
    )
    .join('');

  const legend = Object.entries(GED_TIER_COLOR)
    .map(
      ([label, color]) =>
        `<span style="display:inline-flex;align-items:center;gap:5px;margin-right:14px;font-size:11px;color:var(--gray-600);"><span style="width:9px;height:9px;border-radius:50%;background:${color};display:inline-block;"></span>${label}</span>`
    )
    .join('');

  return `
    <svg viewBox="0 0 ${W} ${H}" width="100%" style="max-width:560px;display:block;" role="img" aria-label="GED score trend: ${points
    .map((g) => `${new Date(g.enteredAt).toLocaleDateString()} scored ${g.score}, ${gedTier(g.score)}`)
    .join('; ')}">
      ${bandRects}
      ${yTicks}
      <polyline points="${linePoints}" fill="none" stroke="var(--navy)" stroke-width="2"></polyline>
      ${dots}
    </svg>
    <div style="margin-top:6px;">${legend}</div>
  `;
}

function attendanceRateOf(student) {
  const records = student.attendance || [];
  if (!records.length) return null;
  const present = records.filter((r) => r.present).length;
  return Math.round((present / records.length) * 100);
}

function statTile({ label, value, borderColor, navId }) {
  const styleParts = [];
  if (borderColor) styleParts.push(`border-left-color:${borderColor}`);
  if (navId) styleParts.push('cursor:pointer');
  const attrs = `${styleParts.length ? ` style="${styleParts.join(';')};"` : ''}${navId ? ` onclick="sidebarClickById('${navId}')"` : ''}`;
  return `<div class="stat-card"${attrs}><div class="stat-label">${label}</div><div class="stat-value" style="font-size:19px;">${value}</div></div>`;
}

// Best score-% per subject, from a list of {test, subject, score, total}
// attempts. Used for the non-GED "Mock Exam Performance" chart on the
// profile page and the printed progress report.
function subjectScoreChart(attempts, opts = {}) {
  if (!attempts.length) return '';
  const labelFor = opts.labelFor || ((a) => a.subject);
  const bySubject = {};
  attempts.forEach((a) => {
    if (!a.total) return;
    const pct = Math.round((a.score / a.total) * 100);
    const key = labelFor(a);
    if (!(key in bySubject) || pct > bySubject[key]) bySubject[key] = pct;
  });
  const items = Object.entries(bySubject).map(([label, value]) => ({
    label,
    value,
    color: value >= 70 ? 'var(--green)' : value >= 50 ? 'var(--amber)' : 'var(--red)',
  }));
  return hBarChart(items, { valueFmt: (v) => v + '%' });
}

async function renderProgressPanel(s, opts = {}) {
  const [grades, assignments] = await Promise.all([db.listGradesForStudent(s.id), db.listAssignmentsForStudent(s.id)]);
  const isGed = studentHasGed(s);
  const gedGrades = grades.filter((g) => g.test === 'GED');
  const attendancePct = attendanceRateOf(s);
  const doneCount = assignments.filter((a) => a.submission?.status === 'done').length;
  const sortedGed = gedGrades.slice().sort((a, b) => new Date(b.enteredAt) - new Date(a.enteredAt));
  const latestGed = sortedGed[0] || null;
  const bestGed = gedGrades.length ? gedGrades.reduce((best, g) => (g.score > best.score ? g : best), gedGrades[0]) : null;
  const nav = (id) => (opts.interactive ? id : null);

  // GED score tiles/chart only make sense for students actually enrolled
  // in GED. Everyone else gets a mock-exam performance tile/chart instead
  // of just attendance/assignments — mock attempts are auto-scored, so
  // there's always something to show once the student has taken one.
  const mockAttempts = (s.attempts || []).filter((a) => a.mode === 'mock' && a.test !== 'GED');
  const sortedMock = mockAttempts.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const latestMock = sortedMock[0] || null;
  const bestMockPct = mockAttempts.length ? Math.max(...mockAttempts.map((a) => Math.round((a.score / a.total) * 100))) : null;

  const tiles = [];
  if (isGed) {
    tiles.push(
      statTile({
        label: 'Latest GED Score',
        value: latestGed ? latestGed.score + ' — ' + gedTier(latestGed.score) : '—',
        borderColor: latestGed ? GED_TIER_COLOR[gedTier(latestGed.score)] : 'var(--gold)',
        navId: nav('nav-student-grades'),
      }),
      statTile({
        label: 'Best GED Score',
        value: bestGed ? bestGed.score + ' — ' + gedTier(bestGed.score) : '—',
        borderColor: bestGed ? GED_TIER_COLOR[gedTier(bestGed.score)] : 'var(--gold)',
        navId: nav('nav-student-grades'),
      })
    );
  } else {
    tiles.push(
      statTile({
        label: 'Latest Mock Score',
        value: latestMock ? `${latestMock.score}/${latestMock.total} (${Math.round((latestMock.score / latestMock.total) * 100)}%)` : '—',
        navId: nav('nav-student-courses'),
      }),
      statTile({
        label: 'Best Mock Score',
        value: bestMockPct !== null ? bestMockPct + '%' : '—',
        navId: nav('nav-student-courses'),
      })
    );
  }
  tiles.push(
    statTile({ label: 'Attendance', value: attendancePct !== null ? attendancePct + '%' : '—', navId: nav('nav-student-attendance') }),
    statTile({ label: 'Assignments done', value: doneCount + '/' + assignments.length, navId: nav('nav-student-assignments') })
  );

  const statTiles = `
    <div class="stat-grid" style="grid-template-columns:repeat(${tiles.length},1fr);margin-bottom:16px;">
      ${tiles.join('')}
    </div>
  `;

  const chart = isGed
    ? gedGrades.length
      ? `<div class="card"><h2>GED Score Progress</h2>${gedScoreTrendChart(gedGrades)}</div>`
      : '<p class="muted">No Friday GED test scores entered yet — this chart fills in as scores are recorded in the Gradebook.</p>'
    : mockAttempts.length
    ? `<div class="card"><h2>Mock Exam Performance — Best Score by Subject</h2>${subjectScoreChart(mockAttempts, {
        labelFor: (a) => `${a.test} — ${a.subject}`,
      })}</div>`
    : '<p class="muted">No mock exam attempts yet — this chart fills in once the student takes a practice or mock exam.</p>';

  const readyCards = isGed ? gedReadyScoreCards(gedGrades, opts) : '';

  return readyCards + statTiles + chart;
}

function isGedSubject(subjectId) {
  return !!(CATALOG['GED'] && CATALOG['GED'].subjects.some((sub) => sub.id === subjectId));
}

function updateGradeScoreUI() {
  const subjectSelect = document.getElementById('grade_subject');
  const maxInput = document.getElementById('grade_max');
  if (!subjectSelect || !maxInput) return;
  const ged = isGedSubject(subjectSelect.value);
  maxInput.classList.toggle('hidden', ged);
  document.getElementById('grade_score_label').textContent = ged ? 'GED Scale Score (100–200)' : 'Score / Max';
  if (ged) maxInput.value = 200;
  const readyWrap = document.getElementById('grade_ready_wrap');
  if (readyWrap) readyWrap.classList.toggle('hidden', !ged);
  updateGradeTierPreview();
}

function updateGradeTierPreview() {
  const preview = document.getElementById('grade_tier_preview');
  if (!preview) return;
  const ged = isGedSubject(document.getElementById('grade_subject').value);
  if (!ged) {
    preview.textContent = '';
    return;
  }
  const score = Number(document.getElementById('grade_score').value || 0);
  preview.textContent = score >= 100 && score <= 200 ? gedTier(score) : 'Enter a score between 100 and 200.';
}

async function openGradebook(studentId) {
  const students = await db.loadAllStudents();
  const s = students.find((x) => x.id === studentId);
  if (!s) return;
  await ensureCatalog();
  await renderGradebook(s);
}

async function renderGradebook(s) {
  const grades = await db.listGradesForStudent(s.id);
  const gedGrades = grades.filter((g) => g.test === 'GED');
  const subjectOptions = s.programs
    .flatMap((p) => {
      const subjects = (CATALOG[p.test] && CATALOG[p.test].subjects) || [];
      return subjects.map((sub) => `<option value="${sub.id}">${p.test} — ${sub.name}</option>`);
    })
    .join('');

  const rows = grades
    .map(
      (g) => `<tr>
      <td>${g.test || ''} — ${g.subject || ''}</td>
      <td>${g.label}${g.source === 'ged_ready' ? ' <span class="badge neutral">GED Ready</span>' : ''}</td>
      <td>${gradeScoreDisplay(g)}</td>
      <td>${new Date(g.enteredAt).toLocaleDateString()}</td>
      <td class="no-print"><button class="btn ghost small" onclick="deleteGradeClick('${g.id}','${s.id}')">Delete</button></td>
    </tr>`
    )
    .join('');

  const readyCards = studentHasGed(s) ? gedReadyScoreCards(gedGrades) : '';

  const html = `
    <h3 style="color:var(--navy);">${s.fullName} — Gradebook</h3>
    ${readyCards}
    <table style="margin-top:12px;">
      <thead><tr><th>Subject</th><th>Label</th><th>Score</th><th>Date</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" class="muted">No grades entered yet.</td></tr>'}</tbody>
    </table>

    <div class="no-print" style="margin-top:20px;border-top:1px solid var(--gray-200);padding-top:16px;">
      <h3 style="color:var(--navy);">Add a grade</h3>
      <label>Subject</label>
      <select id="grade_subject" onchange="updateGradeScoreUI()">${subjectOptions || '<option value="">No enrolled programs</option>'}</select>
      <div class="grid2">
        <div><label>Label</label><input id="grade_label" placeholder="e.g. Midterm, Quiz 3"></div>
        <div>
          <label id="grade_score_label">Score / Max</label>
          <div style="display:flex;gap:8px;">
            <input id="grade_score" type="number" style="margin-bottom:0;" oninput="updateGradeTierPreview()">
            <input id="grade_max" type="number" value="100" style="margin-bottom:0;">
          </div>
          <p class="muted" id="grade_tier_preview" style="margin-top:4px;"></p>
        </div>
      </div>
      <label id="grade_ready_wrap" class="hidden">
        <input type="checkbox" id="grade_is_ged_ready" style="width:auto;display:inline-block;margin:0 6px 0 0;vertical-align:middle;">
        <span style="text-transform:none;font-weight:normal;letter-spacing:normal;">This is an official GED Ready practice test score</span>
      </label>
      <label>Notes (optional)</label>
      <textarea id="grade_notes" rows="2"></textarea>
      <button class="btn red" onclick="addGradeClick('${s.id}')">Add grade</button>
      <p id="grade_error" class="muted error-text"></p>
    </div>
  `;
  renderDoc(html);
  updateGradeScoreUI();
}

async function addGradeClick(studentId) {
  const subjectId = document.getElementById('grade_subject').value;
  const label = document.getElementById('grade_label').value.trim();
  const score = parseFloat(document.getElementById('grade_score').value);
  const maxScore = parseFloat(document.getElementById('grade_max').value) || 100;
  const notes = document.getElementById('grade_notes').value.trim();
  const isGedReady = isGedSubject(subjectId) && !!document.getElementById('grade_is_ged_ready')?.checked;
  const errEl = document.getElementById('grade_error');
  errEl.textContent = '';
  if (!subjectId) {
    errEl.textContent = 'Select a subject.';
    return;
  }
  if (!label) {
    errEl.textContent = 'Enter a label.';
    return;
  }
  if (isNaN(score)) {
    errEl.textContent = 'Enter a score.';
    return;
  }
  if (isGedSubject(subjectId) && (score < 100 || score > 200)) {
    errEl.textContent = 'GED scale scores must be between 100 and 200.';
    return;
  }
  try {
    await db.addGrade({ studentId, subjectId, label, score, maxScore, notes, source: isGedReady ? 'ged_ready' : 'manual' });
    const students = await db.loadAllStudents();
    const s = students.find((x) => x.id === studentId);
    await renderGradebook(s);
  } catch (e) {
    errEl.textContent = e.message || 'Could not add grade.';
  }
}

async function deleteGradeClick(gradeId, studentId) {
  await db.deleteGrade(gradeId);
  const students = await db.loadAllStudents();
  const s = students.find((x) => x.id === studentId);
  await renderGradebook(s);
}

async function openInvoiceById(id) {
  const students = await db.loadAllStudents();
  const s = students.find((x) => x.id === id);
  if (s) openInvoice(s);
}

function documentHeaderLogos() {
  return `<div style="display:flex;align-items:center;gap:10px;">
    <img src="/logo-waapc.jpg" alt="WAAPC" style="width:44px;height:44px;object-fit:contain;">
    <div>
      <div style="font-size:20px;font-weight:bold;color:#1a2b6b;line-height:1.1;">WAAPC Training Centre</div>
      <div style="font-size:10px;color:#666;">Authorized GED Testing Service Provider</div>
    </div>
  </div>`;
}

function signatureBlock() {
  return `
    <div style="margin-top:32px;display:flex;justify-content:flex-end;">
      <div style="text-align:center;">
        <img src="/signature-samuel-palmer.png" class="signature-image" alt="Samuel Palmer signature">
        <div style="border-top:1px solid #999;margin-top:2px;padding-top:4px;font-size:11px;color:#666;">Samuel Palmer &middot; Academic Lead</div>
      </div>
    </div>
  `;
}

function openInvoice(student) {
  setPrintOrientation(false);
  const rows = student.programs
    .map((p, i) => {
      const title = p.regOnly ? `${p.test} — Registration Only (Test Sitting)` : `${p.test} Preparation & Registration`;
      const sub = p.regOnly ? `Test sitting only — no training or diagnostic included` : `${p.level} | ${p.start || '—'} to ${p.end || '—'}`;
      const sessionsCell = p.regOnly ? '—' : `${p.sessionsPerWeek || '—'} / wk`;
      return `
    <tr>
      <td>${String(i + 1).padStart(2, '0')}</td>
      <td><div style="font-weight:bold;color:#1a2b6b;">${title}</div>
          <div style="font-size:11px;color:#666;font-style:italic;">${sub}</div></td>
      <td style="text-align:center;">${sessionsCell}</td>
      <td style="text-align:center;">1</td>
      <td>${p.price.toLocaleString()} CFA</td>
      <td style="text-align:right;font-weight:bold;color:#1a2b6b;">${p.price.toLocaleString()} CFA</td>
    </tr>`;
    })
    .join('');

  const html = `
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #1a2b6b;padding-bottom:16px;margin-bottom:20px;">
      ${documentHeaderLogos()}
      <div style="text-align:right;">
        <div style="font-size:32px;font-weight:bold;color:#1a2b6b;">INVOICE</div>
        <div style="font-size:12px;color:#666;">Testing & Examination Services</div>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:16px;">
      <div><div style="font-size:11px;font-weight:bold;">BILLED TO</div>
        <div style="font-size:18px;font-weight:bold;color:#1a2b6b;">${student.fullName}</div>
        <div style="color:#666;font-size:12px;">Student / Client</div></div>
      <div style="text-align:right;font-size:13px;">
        <div><b>Invoice No.</b> ${student.invoiceNumber}</div>
        <div><b>Invoice Date</b> ${student.invoiceDate}</div>
      </div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:14px;">
      <thead><tr style="background:#1a2b6b;color:#fff;font-size:11px;">
        <th style="padding:8px;text-align:left;">#</th><th style="padding:8px;text-align:left;">DESCRIPTION</th>
        <th style="padding:8px;">SESSIONS/WK</th><th style="padding:8px;">QTY</th><th style="padding:8px;text-align:left;">UNIT PRICE</th>
        <th style="padding:8px;text-align:right;background:#b81f2c;">AMOUNT</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="width:280px;margin-left:auto;">
      <div style="display:flex;justify-content:space-between;padding:4px 0;">
        <span>Subtotal</span><span>${student.total.toLocaleString()} CFA</span></div>
      <div style="background:#1a2b6b;color:#fff;display:flex;justify-content:space-between;padding:10px 14px;font-weight:bold;margin-top:6px;">
        <span>TOTAL DUE</span><span style="background:#b81f2c;padding:4px 10px;">${student.total.toLocaleString()} CFA</span></div>
    </div>
    ${signatureBlock()}
    <div style="margin-top:20px;font-size:11px;color:#666;text-align:center;border-top:1px solid #e0e4ec;padding-top:10px;">
      Send proof of payment to admissions@waapcamericanschools.com — include student name and invoice number.
    </div>
  `;
  document.getElementById('docContent').innerHTML = html;
  document.getElementById('docOverlay').classList.add('show');
}

const FEE_CATEGORY_LABELS = { registration: 'Registration', training: 'Training', test: 'Test', other: 'Other' };
let editingInstallmentId = null;
let payingInstallmentId = null;
let expandedInstallmentId = null;

async function openPayments(id) {
  editingInstallmentId = null;
  payingInstallmentId = null;
  expandedInstallmentId = null;
  await renderPaymentsView(id);
}

async function renderPaymentsView(studentId) {
  const students = await db.loadAllStudents();
  const s = students.find((x) => x.id === studentId);
  if (!s) return;

  const paidByCategory = {};
  s.installments.forEach((inst) => {
    if (!inst.amountPaid) return;
    const cat = inst.category || 'other';
    paidByCategory[cat] = (paidByCategory[cat] || 0) + inst.amountPaid;
  });
  const breakdown = Object.keys(FEE_CATEGORY_LABELS)
    .filter((c) => paidByCategory[c])
    .map((c) => `${FEE_CATEGORY_LABELS[c]}: ${paidByCategory[c].toLocaleString()} CFA`)
    .join(' &middot; ');

  const rows = s.installments
    .map((inst, i) => {
      if (editingInstallmentId === inst.id) {
        return `<tr>
      <td>${i + 1}</td>
      <td><input type="number" id="edit_amount" value="${inst.amount}" style="margin-bottom:0;"></td>
      <td><select id="edit_category" style="margin-bottom:0;">${Object.keys(FEE_CATEGORY_LABELS)
        .map((c) => `<option value="${c}" ${inst.category === c ? 'selected' : ''}>${FEE_CATEGORY_LABELS[c]}</option>`)
        .join('')}</select></td>
      <td>${inst.amountPaid.toLocaleString()} CFA</td>
      <td>—</td>
      <td>
        <button class="btn small" onclick="saveInstallmentEdit('${studentId}','${inst.id}')">Save</button>
        <button class="btn ghost small" onclick="cancelInstallmentEdit('${studentId}')">Cancel</button>
      </td>
    </tr>`;
      }
      const mainRow = `<tr>
      <td>${i + 1} &middot; ${FEE_CATEGORY_LABELS[inst.category] || 'Other'}${inst.dueDate ? ` <span class="muted">(due ${inst.dueDate})</span>` : ''}</td>
      <td>${inst.amount.toLocaleString()} CFA</td>
      <td>${inst.amountPaid.toLocaleString()} CFA</td>
      <td>${inst.balance > 0 ? inst.balance.toLocaleString() + ' CFA' : '—'}</td>
      <td><span class="badge ${inst.status}">${inst.status}</span></td>
      <td>
        ${inst.balance > 0 ? `<button class="btn small" onclick="recordPaymentClick('${inst.id}','${studentId}')">Record payment</button>` : ''}
        ${inst.payments.length ? `<button class="btn ghost small" onclick="toggleInstallmentHistory('${inst.id}','${studentId}')">${expandedInstallmentId === inst.id ? 'Hide' : ''} History (${inst.payments.length})</button>` : ''}
        <button class="btn ghost small" onclick="editInstallmentClick('${inst.id}','${studentId}')">Edit</button>
      </td>
    </tr>`;

      let extraRow = '';
      if (payingInstallmentId === inst.id) {
        extraRow = `<tr><td colspan="6" style="background:var(--bg);">
          <div class="grid4" style="align-items:end;">
            <div><label>Amount (CFA)</label><input type="number" id="pay_amount" value="${inst.balance}" style="margin-bottom:0;"></div>
            <div><label>Method</label><select id="pay_method" style="margin-bottom:0;"><option>Cash</option><option>Bank Transfer</option><option>Cheque</option><option>Wave</option><option>Mobile Money</option></select></div>
            <div><label>Date</label><input type="date" id="pay_date" value="${new Date().toISOString().slice(0, 10)}" style="margin-bottom:0;"></div>
            <div><label>Notes (optional)</label><input id="pay_notes" style="margin-bottom:0;"></div>
          </div>
          <div style="margin-top:10px;">
            <button class="btn small" onclick="saveRecordPayment('${studentId}','${inst.id}')">Save payment</button>
            <button class="btn ghost small" onclick="cancelRecordPayment('${studentId}')">Cancel</button>
          </div>
          <p id="pay_error" class="muted error-text"></p>
        </td></tr>`;
      } else if (expandedInstallmentId === inst.id && inst.payments.length) {
        const histRows = inst.payments
          .map(
            (p) => `<tr>
            <td>${p.date}</td><td>${p.amount.toLocaleString()} CFA</td><td>${p.method || '—'}</td><td>${p.receiptNumber || '—'}</td><td>${p.notes || '—'}</td>
            <td>
              <button class="btn ghost small" onclick="viewReceipt('${studentId}','${p.id}')">Receipt</button>
              <button class="btn ghost small" onclick="voidPaymentClick('${p.id}','${studentId}')">Void</button>
            </td>
          </tr>`
          )
          .join('');
        extraRow = `<tr><td colspan="6" style="background:var(--bg);padding:10px 14px;">
          <table><thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Receipt</th><th>Notes</th><th></th></tr></thead><tbody>${histRows}</tbody></table>
        </td></tr>`;
      }
      return mainRow + extraRow;
    })
    .join('');
  const html = `
    <h3 style="color:var(--navy);">${s.fullName} — Payment schedule</h3>
    <p class="muted">Total ${s.total.toLocaleString()} CFA &middot; Balance ${balanceOf(s).toLocaleString()} CFA</p>
    ${breakdown ? `<p class="muted">Paid so far — ${breakdown}</p>` : ''}
    <table><thead><tr><th>Fee</th><th>Owed</th><th>Paid</th><th>Balance</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>
    <button class="btn ghost small" style="margin-top:12px;" onclick="addFeeLineClick('${studentId}')">+ Add fee line</button>
  `;
  renderDoc(html);
}

function editInstallmentClick(instId, studentId) {
  editingInstallmentId = instId;
  renderPaymentsView(studentId);
}

function cancelInstallmentEdit(studentId) {
  editingInstallmentId = null;
  renderPaymentsView(studentId);
}

async function saveInstallmentEdit(studentId, instId) {
  const amount = Number(document.getElementById('edit_amount').value || 0);
  const category = document.getElementById('edit_category').value;
  try {
    await db.updateInstallment(instId, { amount, category });
  } catch (e) {
    alert('Could not save changes: ' + (e.message || e));
    return;
  }
  editingInstallmentId = null;
  await renderPaymentsView(studentId);
  renderStudentsTable();
}

function recordPaymentClick(instId, studentId) {
  payingInstallmentId = instId;
  expandedInstallmentId = null;
  renderPaymentsView(studentId);
}

function cancelRecordPayment(studentId) {
  payingInstallmentId = null;
  renderPaymentsView(studentId);
}

async function saveRecordPayment(studentId, installmentId) {
  const amount = Number(document.getElementById('pay_amount').value || 0);
  const method = document.getElementById('pay_method').value;
  const date = document.getElementById('pay_date').value;
  const notes = document.getElementById('pay_notes').value.trim();
  const errEl = document.getElementById('pay_error');
  errEl.textContent = '';
  if (!amount || amount <= 0) {
    errEl.textContent = 'Enter an amount greater than 0.';
    return;
  }
  try {
    await db.recordPayment({ studentId, installmentId, amount, method, date, notes });
  } catch (e) {
    errEl.textContent = e.message || 'Could not record payment.';
    return;
  }
  payingInstallmentId = null;
  await renderPaymentsView(studentId);
  renderStudentsTable();
}

function toggleInstallmentHistory(instId, studentId) {
  expandedInstallmentId = expandedInstallmentId === instId ? null : instId;
  payingInstallmentId = null;
  renderPaymentsView(studentId);
}

async function voidPaymentClick(paymentId, studentId) {
  if (!confirm('Void this payment? This cannot be undone — use it to correct a mistaken entry.')) return;
  try {
    await db.deletePayment(paymentId);
  } catch (e) {
    alert('Could not void payment: ' + (e.message || e));
    return;
  }
  await renderPaymentsView(studentId);
  renderStudentsTable();
}

async function addFeeLineClick(studentId) {
  const category = prompt('Fee category — registration, training, test, or other:', 'other');
  if (category === null) return;
  const amountStr = prompt('Amount owed for this fee (CFA):');
  if (amountStr === null) return;
  const amount = Number(amountStr);
  if (!amount || amount <= 0) {
    alert('Enter a valid amount.');
    return;
  }
  const cat = Object.keys(FEE_CATEGORY_LABELS).includes(category.trim().toLowerCase()) ? category.trim().toLowerCase() : 'other';
  try {
    await db.addInstallmentLine(studentId, { amount, category: cat });
  } catch (e) {
    alert('Could not add fee line: ' + (e.message || e));
    return;
  }
  await renderPaymentsView(studentId);
  renderStudentsTable();
}

async function viewReceipt(studentId, paymentId) {
  setPrintOrientation(false);
  const students = await db.loadAllStudents();
  const s = students.find((x) => x.id === studentId);
  let payment = null;
  let inst = null;
  for (const i of s.installments) {
    const p = i.payments.find((p) => p.id === paymentId);
    if (p) {
      payment = p;
      inst = i;
      break;
    }
  }
  if (!payment) return;
  const balanceAfter = inst.amount - inst.payments.filter((p) => p.date <= payment.date).reduce((sum, p) => sum + p.amount, 0);
  const html = `
    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #1a2b6b;padding-bottom:16px;margin-bottom:20px;">
      ${documentHeaderLogos()}
      <div style="text-align:right;"><div style="font-size:32px;font-weight:bold;color:#1a2b6b;">RECEIPT</div></div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:20px;">
      <div><div style="font-size:11px;font-weight:bold;">RECEIVED FROM</div>
        <div style="font-size:18px;font-weight:bold;color:#1a2b6b;">${s.fullName}</div></div>
      <div style="text-align:right;font-size:13px;">
        <div><b>Receipt No.</b> ${payment.receiptNumber}</div>
        <div><b>Date</b> ${payment.date}</div>
        <div><b>Invoice Ref.</b> ${s.invoiceNumber}</div>
      </div>
    </div>
    <div style="background:#1a2b6b;color:#fff;display:flex;justify-content:space-between;padding:14px 18px;font-weight:bold;font-size:16px;margin-bottom:16px;">
      <span>AMOUNT RECEIVED</span><span style="background:#b81f2c;padding:5px 12px;">${payment.amount.toLocaleString()} CFA</span>
    </div>
    <p><b>For:</b> ${FEE_CATEGORY_LABELS[inst.category] || 'Other'} (${inst.amount.toLocaleString()} CFA owed)</p>
    <p><b>Payment method:</b> ${payment.method || '—'}</p>
    <p><b>Balance remaining on this fee:</b> ${balanceAfter > 0 ? balanceAfter.toLocaleString() + ' CFA' : 'Paid in full'}</p>
    ${payment.notes ? `<p><b>Notes:</b> ${payment.notes}</p>` : ''}
    ${signatureBlock()}
    <p style="margin-top:24px;font-size:11px;color:#666;text-align:center;border-top:1px solid #e0e4ec;padding-top:10px;">
      Thank you for choosing WAAPC Training Centre.
    </p>
  `;
  document.getElementById('docContent').innerHTML = html;
  document.getElementById('docOverlay').classList.add('show');
}

function closeDoc() {
  document.getElementById('docOverlay').classList.remove('show');
  setPrintOrientation(false);
}

// Chrome does not reliably honor per-element named-page orientation
// switching (@page <name> + page: <name>) within a single print job, so
// certificates get their own landscape page by injecting/removing a plain
// @page rule instead, scoped to whichever document is currently open.
function setPrintOrientation(landscape) {
  let style = document.getElementById('printOrientationStyle');
  if (!landscape) {
    if (style) style.remove();
    return;
  }
  if (!style) {
    style = document.createElement('style');
    style.id = 'printOrientationStyle';
    document.head.appendChild(style);
  }
  style.textContent = '@media print { @page { size: landscape; margin: 0.25in; } }';
}

// =====================================================================
// Change password — available to every role from the sidebar.
// =====================================================================
function openChangePassword() {
  setPrintOrientation(false);
  const showNameField = currentSession && (currentSession.role === 'admin' || currentSession.role === 'teacher');
  const html = `
    <h3 style="color:var(--navy);">Account settings</h3>
    ${
      showNameField
        ? `
    <label>Your name</label>
    <div style="display:flex;gap:8px;">
      <input id="cp_name" value="${currentSession.fullName || ''}" style="margin-bottom:0;">
      <button class="btn small" onclick="updateMyNameClick()">Save</button>
    </div>
    <p id="cp_name_msg" class="muted" style="margin-top:4px;"></p>
    `
        : ''
    }
    <label style="margin-top:${showNameField ? '16px' : '0'};">New password</label>
    <input type="password" id="cp_new" placeholder="At least 6 characters">
    <label>Confirm new password</label>
    <input type="password" id="cp_confirm">
    <button class="btn red" onclick="changePasswordClick()">Update password</button>
    <p id="cp_error" class="muted error-text"></p>
    <p id="cp_success" class="muted" style="color:var(--green);"></p>
  `;
  document.getElementById('docContent').innerHTML = html;
  document.getElementById('docOverlay').classList.add('show');
}

async function updateMyNameClick() {
  const name = document.getElementById('cp_name').value.trim();
  const msgEl = document.getElementById('cp_name_msg');
  if (!name) {
    msgEl.textContent = 'Enter a name.';
    msgEl.style.color = 'var(--red)';
    return;
  }
  try {
    await db.updateMyName(name);
    currentSession.fullName = name;
    document.getElementById('sidebarName').textContent = name;
    msgEl.textContent = 'Saved.';
    msgEl.style.color = 'var(--green)';
  } catch (e) {
    msgEl.textContent = e.message || 'Could not save name.';
    msgEl.style.color = 'var(--red)';
  }
}

async function changePasswordClick() {
  const pw = document.getElementById('cp_new').value;
  const confirmPw = document.getElementById('cp_confirm').value;
  const errEl = document.getElementById('cp_error');
  const okEl = document.getElementById('cp_success');
  errEl.textContent = '';
  okEl.textContent = '';
  if (!pw || pw.length < 6) {
    errEl.textContent = 'Password must be at least 6 characters.';
    return;
  }
  if (pw !== confirmPw) {
    errEl.textContent = 'Passwords do not match.';
    return;
  }
  try {
    await db.changePassword(pw);
    okEl.textContent = 'Password updated.';
    document.getElementById('cp_new').value = '';
    document.getElementById('cp_confirm').value = '';
  } catch (e) {
    errEl.textContent = e.message || 'Could not update password.';
  }
}

// =====================================================================
// Attendance
// =====================================================================
async function openStudentProgress(studentId) {
  const students = await db.loadAllStudents();
  const s = students.find((x) => x.id === studentId);
  if (!s) return;
  const panelHtml = await renderProgressPanel(s);
  renderDoc(`<h3 style="color:#1a2b6b;">${s.fullName} — Progress</h3>${panelHtml}`);
}

async function openAttendance(studentId) {
  const students = await db.loadAllStudents();
  const s = students.find((x) => x.id === studentId);
  if (!s) return;
  s.attendance = s.attendance || [];

  const programOptions = s.programs.map((p) => `<option value="${p.id}">${p.test} (${p.level})</option>`).join('');
  const rows = s.attendance
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((rec) => {
      const prog = s.programs.find((p) => p.id === rec.programId);
      return `<tr>
      <td>${rec.date}</td>
      <td>${prog ? prog.test : 'Unknown'}</td>
      <td><span class="badge ${rec.present ? 'paid' : 'unpaid'}">${rec.present ? 'Present' : 'Absent'}</span></td>
    </tr>`;
    })
    .join('');

  const html = `
    <h3 style="color:#1a2b6b;">${s.fullName} — Attendance</h3>
    <div style="display:flex;gap:8px;align-items:end;margin-bottom:16px;flex-wrap:wrap;">
      <div><label>Program</label><select id="att_program">${programOptions}</select></div>
      <div><label>Date</label><input type="date" id="att_date" value="${new Date().toISOString().slice(0, 10)}"></div>
      <div>
        <button class="btn small" onclick="recordAttendance('${s.id}', true)">Mark present</button>
        <button class="btn ghost small" onclick="recordAttendance('${s.id}', false)">Mark absent</button>
      </div>
    </div>
    <table><thead><tr><th>Date</th><th>Program</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="muted">No attendance recorded yet.</td></tr>'}</tbody></table>
  `;
  renderDoc(html);
}

async function recordAttendance(studentId, present) {
  const programId = document.getElementById('att_program').value;
  const date = document.getElementById('att_date').value;
  if (!date) {
    alert('Pick a date.');
    return;
  }
  try {
    await db.recordAttendance(programId, date, present);
  } catch (e) {
    alert('Could not record attendance: ' + (e.message || e));
    return;
  }
  await openAttendance(studentId);
}

function attendanceStatsFor(student, programId) {
  const records = (student.attendance || []).filter((r) => r.programId === programId);
  const total = records.length;
  const present = records.filter((r) => r.present).length;
  const pct = total > 0 ? Math.round((present / total) * 100) : null;
  return { total, present, pct };
}

// =====================================================================
// Progress report
// =====================================================================
async function openProgressReport(studentId) {
  setPrintOrientation(false);
  const students = await db.loadAllStudents();
  const s = students.find((x) => x.id === studentId);
  if (!s) return;
  s.attempts = s.attempts || [];
  s.attendance = s.attendance || [];

  const programBlocks = s.programs
    .map((p) => {
      const subjects = (CATALOG[p.test] && CATALOG[p.test].subjects.map((x) => x.name)) || [];
      const att = attendanceStatsFor(s, p.id);
      const programMockAttempts = s.attempts.filter((a) => a.test === p.test && a.mode === 'mock');
      const subjectRows = subjects
        .map((sub) => {
          const mockAttempts = programMockAttempts.filter((a) => a.subject === sub);
          const best = mockAttempts.length ? Math.max(...mockAttempts.map((a) => Math.round((a.score / a.total) * 100))) : null;
          const latest = mockAttempts.length ? mockAttempts[mockAttempts.length - 1] : null;
          return `<tr>
        <td>${sub}</td>
        <td>${mockAttempts.length}</td>
        <td>${best !== null ? best + '%' : '—'}</td>
        <td>${latest ? latest.score + '/' + latest.total + ' (' + latest.date + ')' : '—'}</td>
      </tr>`;
        })
        .join('');
      const attendanceBar =
        att.total > 0
          ? hBarChart([{ label: 'Attendance', value: att.pct, color: att.pct >= 80 ? 'var(--green)' : att.pct >= 60 ? 'var(--amber)' : 'var(--red)' }], {
              valueFmt: (v) => v + '%',
            })
          : '';
      const perfChart = programMockAttempts.length ? subjectScoreChart(programMockAttempts) : '';
      return `
      <div style="margin-bottom:18px;">
        <div style="font-weight:bold;color:#1a2b6b;font-size:14px;margin-bottom:6px;">${p.test} <span class="muted">(${p.level})</span></div>
        <p class="muted" style="margin:0 0 8px 0;">Attendance: ${att.total > 0 ? att.present + ' / ' + att.total + ' sessions (' + att.pct + '%)' : 'No sessions recorded yet'}</p>
        ${attendanceBar}
        ${perfChart}
        <table style="margin-top:8px;"><thead><tr><th>Subject</th><th>Mock attempts</th><th>Best score</th><th>Latest attempt</th></tr></thead><tbody>${subjectRows}</tbody></table>
      </div>`;
    })
    .join('');

  const html = `
    <div style="display:flex;justify-content:space-between;border-bottom:3px solid #1a2b6b;padding-bottom:16px;margin-bottom:20px;">
      <div style="font-size:22px;font-weight:bold;color:#1a2b6b;">WAAPC Training Centre</div>
      <div style="text-align:right;"><div style="font-size:26px;font-weight:bold;color:#1a2b6b;">PROGRESS REPORT</div></div>
    </div>
    <div style="margin-bottom:18px;">
      <div style="font-size:11px;font-weight:bold;">STUDENT</div>
      <div style="font-size:18px;font-weight:bold;color:#1a2b6b;">${s.fullName}</div>
      <div class="muted">Report generated ${new Date().toISOString().slice(0, 10)}</div>
    </div>
    ${programBlocks}
    <div style="margin-top:20px;font-size:11px;color:#666;text-align:center;border-top:1px solid #e0e4ec;padding-top:10px;">
      WAAPC Training Centre — Testing & Examination Services
    </div>
  `;
  document.getElementById('docContent').innerHTML = html;
  document.getElementById('docOverlay').classList.add('show');
}

// =====================================================================
// Certificates
// =====================================================================
async function openCertificateForm(studentId) {
  setPrintOrientation(false);
  const students = await db.loadAllStudents();
  const s = students.find((x) => x.id === studentId);
  if (!s) return;
  const programOptions = s.programs.map((p) => `<option value="${p.id}">${p.test} (${p.level})</option>`).join('');
  const html = `
    <h3 style="color:#1a2b6b;">Issue certificate — ${s.fullName}</h3>
    <label>Program completed</label>
    <select id="cert_program">${programOptions}</select>
    <label>Final mock score (numerator)</label>
    <input type="number" id="cert_score" placeholder="e.g. 13">
    <label>Final mock score (out of)</label>
    <input type="number" id="cert_total" placeholder="e.g. 15">
    <button class="btn red" onclick="issueCertificate('${s.id}')">Generate certificate</button>
  `;
  document.getElementById('docContent').innerHTML = html;
  document.getElementById('docOverlay').classList.add('show');
}

async function issueCertificate(studentId) {
  const programId = document.getElementById('cert_program').value;
  const score = Number(document.getElementById('cert_score').value || 0);
  const total = Number(document.getElementById('cert_total').value || 0);
  const students = await db.loadAllStudents();
  const s = students.find((x) => x.id === studentId);
  const program = s.programs.find((p) => p.id === programId);
  const att = attendanceStatsFor(s, programId);

  let cert;
  try {
    cert = await db.issueCertificate({ studentId, enrollmentId: programId, score, total, attendancePct: att.pct });
  } catch (e) {
    alert('Could not issue certificate: ' + (e.message || e));
    return;
  }
  renderCertificate(s, program, {
    certNumber: cert.certNumber,
    issuedDate: cert.issuedDate,
    finalScore: score,
    finalTotal: total,
    attendancePct: att.pct,
  });
}

function renderCertificate(student, program, cert) {
  const pct = cert.finalTotal > 0 ? Math.round((cert.finalScore / cert.finalTotal) * 100) : null;
  const statsParts = [];
  if (cert.attendancePct !== null) statsParts.push(`${cert.attendancePct}% Attendance`);
  if (pct !== null) statsParts.push(`Final Mock Assessment ${cert.finalScore}/${cert.finalTotal} (${pct}%)`);
  statsParts.push(`Certificate No. ${cert.certNumber}`);
  statsParts.push(`Issued ${cert.issuedDate}`);
  const isGed = program.test === 'GED';

  const html = `
    <div class="certificate-frame">
      <div class="certificate-inner">
        <img src="/logo-waapc.jpg" class="certificate-watermark" alt="">
        <div class="certificate-content">
          <img src="/logo-waapc.jpg" class="certificate-crest" alt="WAAPC">
          <div class="certificate-org">WAAPC TRAINING CENTRE</div>
          <div class="certificate-org-sub">${isGed ? 'Authorized GED Testing Service Provider' : 'Testing & Examination Services'}</div>

          <div class="certificate-kicker">Certificate of Completion</div>
          <div class="certificate-presented">This certificate is proudly presented to</div>
          <div class="certificate-name">${student.fullName}</div>
          <div class="certificate-rule"></div>

          <p class="certificate-body">
            For successfully completing the <strong>${program.test} Preparation Program</strong> at WAAPC Training Centre,
            demonstrating commitment, discipline, and mastery of the required competencies.
          </p>
          <p class="certificate-stats">${statsParts.join(' &nbsp;·&nbsp; ')}</p>

          <div class="certificate-sig-row">
            <div class="certificate-sig-col">
              <img src="/signature-samuel-palmer.png" class="signature-image certificate-signature-image" alt="Samuel Palmer signature">
              <div class="certificate-sig-line"></div>
              <div class="certificate-sig-name">Samuel Palmer</div>
              <div class="certificate-sig-title">Academic Lead</div>
            </div>
            ${
              isGed
                ? `<div class="certificate-seal-wrap">
              <img src="/badge-ged-authorized.jpg" class="certificate-seal" alt="Authorized GED Provider Seal">
            </div>`
                : `<div class="certificate-own-seal-wrap">
              <img src="/logo-waapc.jpg" class="certificate-own-seal" alt="WAAPC Seal">
            </div>`
            }
            <div class="certificate-sig-col certificate-sig-col-right">
              <img src="/signature-nathan-adingra.png" class="signature-image certificate-signature-image" alt="Nathan Adingra signature">
              <div class="certificate-sig-line"></div>
              <div class="certificate-sig-name">Nathan Adingra</div>
              <div class="certificate-sig-title">Program Manager</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.getElementById('docContent').innerHTML = html;
  document.getElementById('docOverlay').classList.add('show');
  setPrintOrientation(true);
}

// =====================================================================
// Admin: Speaking submissions review
// =====================================================================
async function openSpeakingSubmissions(studentId) {
  const subs = await db.listSpeakingSubmissions(studentId);
  const rows = subs
    .map(
      (s) => `
    <div class="q-block">
      <div class="qtext">${s.promptText}</div>
      <p class="muted">Submitted ${new Date(s.submittedAt).toLocaleString()}</p>
      ${s.signedUrl ? `<audio controls src="${s.signedUrl}" style="width:100%;"></audio>` : '<p class="muted">Recording unavailable.</p>'}
      <p style="margin-top:8px;">
        <span class="badge ${s.reviewed ? 'paid' : 'unpaid'}">${s.reviewed ? 'Reviewed' : 'Not yet reviewed'}</span>
        ${s.score !== null ? `<span class="badge neutral" style="margin-left:6px;">Score: ${s.score}/100</span>` : ''}
      </p>
      <div style="display:flex;gap:8px;align-items:center;margin-top:6px;">
        <input type="number" min="0" max="100" placeholder="Score /100" value="${s.score !== null ? s.score : ''}" id="speak_score_${s.id}" style="margin-bottom:0;width:110px;">
        <button class="btn ghost small" onclick="gradeSpeakingSubmissionClick('${studentId}','${s.id}')">Save score</button>
      </div>
    </div>`
    )
    .join('');

  const html = `
    <h3 style="color:#1a2b6b;">Speaking submissions</h3>
    ${rows || '<p class="muted">No speaking submissions yet.</p>'}
  `;
  renderDoc(html);
}

async function gradeSpeakingSubmissionClick(studentId, submissionId) {
  const input = document.getElementById('speak_score_' + submissionId);
  const score = parseFloat(input.value);
  if (isNaN(score) || score < 0 || score > 100) {
    alert('Enter a score between 0 and 100.');
    return;
  }
  try {
    await db.gradeSpeakingSubmission(submissionId, score);
  } catch (e) {
    alert('Could not save score: ' + (e.message || e));
    return;
  }
  await openSpeakingSubmissions(studentId);
}

// =====================================================================
// Student portal — login (first-login sets password, or normal sign-in)
// =====================================================================
function showStudentLoginStep1() {
  showAuthScreen('student');
  document.getElementById('loginStep1').classList.remove('hidden');
  document.getElementById('loginStep2').classList.add('hidden');
  document.getElementById('loginError').textContent = '';
}

async function showStudentDashboardView() {
  showAppShell('student');
  document.querySelectorAll('#appShell .page').forEach((p) => p.classList.add('hidden'));
  document.getElementById('page-student-dashboard').classList.remove('hidden');
  await ensureCatalog();
  document.getElementById('welcomeMsg').textContent = 'Welcome, ' + currentStudentRecord.fullName.split(' ')[0];
  renderMyProgress();
}

function sidebarClickById(id) {
  const btn = document.getElementById(id);
  if (btn) btn.click();
}

async function renderMyCoursesPage() {
  if (!currentStudentRecord) return;
  renderStudentDashboard(currentStudentRecord);
  renderPlacementCard();
}

async function renderMyAttendance() {
  if (!currentStudentRecord) return;
  const students = await db.loadAllStudents();
  const s = students.find((x) => x.id === currentStudentRecord.id);
  if (!s) return;
  currentStudentRecord = s;
  const listEl = document.getElementById('myAttendanceList');
  document.getElementById('myAttendanceEmpty').classList.toggle('hidden', (s.attendance || []).length > 0);
  listEl.innerHTML = s.programs
    .map((p) => {
      const stats = attendanceStatsFor(s, p.id);
      const rows = (s.attendance || [])
        .filter((r) => r.programId === p.id)
        .slice()
        .sort((a, b) => (a.date < b.date ? 1 : -1))
        .map((r) => `<tr><td>${r.date}</td><td><span class="badge ${r.present ? 'paid' : 'unpaid'}">${r.present ? 'Present' : 'Absent'}</span></td></tr>`)
        .join('');
      return `<div class="card">
        <h2>${p.test} <span class="muted">(${p.level})</span></h2>
        <p class="muted">${stats.total > 0 ? stats.present + ' / ' + stats.total + ' sessions (' + stats.pct + '%)' : 'No sessions recorded yet'}</p>
        <table><thead><tr><th>Date</th><th>Status</th></tr></thead><tbody>${rows || '<tr><td colspan="2" class="muted">No records yet.</td></tr>'}</tbody></table>
      </div>`;
    })
    .join('');
}

async function renderMyProgress() {
  if (!currentStudentRecord) return;
  const students = await db.loadAllStudents();
  const fresh = students.find((x) => x.id === currentStudentRecord.id) || currentStudentRecord;
  currentStudentRecord = fresh;
  document.getElementById('progressPanel').innerHTML = await renderProgressPanel(fresh, { interactive: true });
}

async function renderMyGrades() {
  if (!currentStudentRecord) return;
  const grades = await db.listGradesForStudent(currentStudentRecord.id);
  const listEl = document.getElementById('myGradesList');
  document.getElementById('myGradesEmpty').classList.toggle('hidden', grades.length > 0);
  listEl.innerHTML = grades
    .map(
      (g) => `<div class="subject-card">
        <div>
          <div class="name">${g.test || ''} — ${g.subject || ''}: ${g.label}</div>
          <div class="stats">${new Date(g.enteredAt).toLocaleDateString()}${g.notes ? ' — ' + g.notes : ''}</div>
        </div>
        <div style="font-weight:bold;color:var(--navy);">${gradeScoreDisplay(g)}</div>
      </div>`
    )
    .join('');
}

// =====================================================================
// GED Placement Assessment (GAPA) — student takes it, admin/teacher and
// parent view results. Only shown for students enrolled in GED.
// =====================================================================
let placementState = null;

async function renderPlacementCard() {
  const cardEl = document.getElementById('placementCard');
  if (!currentStudentRecord) {
    cardEl.classList.add('hidden');
    return;
  }
  const isGed = currentStudentRecord.programs.some((p) => p.test === 'GED');
  cardEl.classList.toggle('hidden', !isGed);
  if (!isGed) return;
  const attempts = await db.listPlacementAttempts(currentStudentRecord.id);
  const latest = attempts[0];
  document.getElementById('placementSummary').innerHTML = latest
    ? `<p>Latest score: <b>${latest.total_score}/100</b> — ${latest.level}. ${latest.recommendation}</p><p class="muted">Taken ${new Date(latest.taken_at).toLocaleDateString()}</p>`
    : '<p class="muted">You haven\'t taken the placement assessment yet.</p>';
}

async function startPlacementTest() {
  if (!currentStudentRecord) return;
  const isGed = currentStudentRecord.programs.some((p) => p.test === 'GED');
  if (!isGed) {
    alert('The placement assessment is only for students enrolled in GED.');
    return;
  }
  const questions = await db.listPlacementQuestions();
  placementState = { questions, answers: new Array(questions.length).fill(null), submitted: false };
  renderPlacementSession();
}

function computePlacementScores() {
  const { questions, answers } = placementState;
  const sections = { vocabulary: 0, grammar: 0, reading: 0, critical_thinking: 0 };
  questions.forEach((q, i) => {
    if (answers[i] === q.answer) sections[q.section] += 2;
  });
  const total = sections.vocabulary + sections.grammar + sections.reading + sections.critical_thinking;
  let level, recommendation;
  if (total >= 90) {
    level = 'Advanced';
    recommendation = 'Direct entry into GED 150+ Accelerator';
  } else if (total >= 75) {
    level = 'Proficient';
    recommendation = 'GED Accelerator with vocabulary/grammar support';
  } else if (total >= 60) {
    level = 'Developing';
    recommendation = 'GED Bridge Program + Accelerator';
  } else if (total >= 40) {
    level = 'Beginning';
    recommendation = 'Academic English support required before intensive GED study';
  } else {
    level = 'Foundation';
    recommendation = 'Not yet ready for GED-level reading; recommend Intensive English Training first';
  }
  return {
    vocabulary: sections.vocabulary,
    grammar: sections.grammar,
    reading: sections.reading,
    criticalThinking: sections.critical_thinking,
    total,
    level,
    recommendation,
  };
}

function renderPlacementSession() {
  const { questions, answers, submitted } = placementState;
  let lastPassageId = null;
  const body = questions
    .map((q, i) => {
      let passageHtml = '';
      if (q.passage && q.passage.id !== lastPassageId) {
        lastPassageId = q.passage.id;
        passageHtml = `<div class="card" style="background:var(--bg);"><h2>${q.passage.title}</h2><p style="white-space:pre-line;">${q.passage.body}</p></div>`;
      }
      const optsHtml = q.options
        .map((opt, oi) => {
          let cls = 'q-opt';
          if (submitted) {
            if (oi === q.answer) cls += ' correct';
            else if (oi === answers[i]) cls += ' wrong';
          } else if (answers[i] === oi) cls += ' selected';
          return `<div class="${cls}" onclick="selectPlacementAnswer(${i}, ${oi})">${String.fromCharCode(65 + oi)}. ${opt}</div>`;
        })
        .join('');
      return `${passageHtml}<div class="q-block"><div class="qtext">${i + 1}. ${q.text}</div>${optsHtml}</div>`;
    })
    .join('');

  let scoreHtml = '';
  if (submitted) {
    const scores = computePlacementScores();
    scoreHtml = `<div class="score-banner">
      <div class="big">${scores.total} / 100</div>
      <div>${scores.level} — ${scores.recommendation}</div>
      <p class="muted" style="color:#fff;">Vocabulary ${scores.vocabulary}/20 &middot; Grammar ${scores.grammar}/20 &middot; Reading ${scores.reading}/40 &middot; Critical Thinking ${scores.criticalThinking}/20</p>
    </div>`;
  }

  document.getElementById('subjectArea').innerHTML = `
    <div class="card">
      <h2>GED Placement Assessment</h2>
      ${scoreHtml}
      ${
        submitted
          ? '<button class="btn ghost small" onclick="closePlacementTest()">Close</button>'
          : '<button class="btn red" onclick="submitPlacementTest()">Submit assessment</button>'
      }
    </div>
    ${body}
    ${!submitted ? '<button class="btn red" onclick="submitPlacementTest()">Submit assessment</button>' : ''}
  `;
}

function selectPlacementAnswer(qIndex, optIndex) {
  if (placementState.submitted) return;
  placementState.answers[qIndex] = optIndex;
  renderPlacementSession();
}

async function submitPlacementTest() {
  const scores = computePlacementScores();
  placementState.submitted = true;
  try {
    await db.submitPlacementAttempt({
      studentId: currentStudentRecord.id,
      sectionScores: { vocabulary: scores.vocabulary, grammar: scores.grammar, reading: scores.reading, critical_thinking: scores.criticalThinking },
      totalScore: scores.total,
      level: scores.level,
      recommendation: scores.recommendation,
      answers: placementState.answers,
    });
    renderPlacementCard();
  } catch (e) {
    alert('Could not save your result: ' + (e.message || e));
  }
  renderPlacementSession();
}

function closePlacementTest() {
  placementState = null;
  document.getElementById('subjectArea').innerHTML = '';
}

async function openPlacementResults(studentId) {
  const students = await db.loadAllStudents();
  const s = students.find((x) => x.id === studentId);
  if (!s) return;
  const attempts = await db.listPlacementAttempts(studentId);
  const rows = attempts
    .map(
      (a) => `<tr>
        <td>${new Date(a.taken_at).toLocaleDateString()}</td>
        <td>${a.vocabulary_score}/20</td>
        <td>${a.grammar_score}/20</td>
        <td>${a.reading_score}/40</td>
        <td>${a.critical_thinking_score}/20</td>
        <td><b>${a.total_score}/100</b></td>
        <td>${a.level}</td>
      </tr>`
    )
    .join('');
  const html = `
    <h3 style="color:var(--navy);">${s.fullName} — GED Placement Assessment</h3>
    <table style="margin-top:12px;">
      <thead><tr><th>Date</th><th>Vocab</th><th>Grammar</th><th>Reading</th><th>Critical Thinking</th><th>Total</th><th>Level</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="muted">No placement attempts yet.</td></tr>'}</tbody>
    </table>
  `;
  renderDoc(html);
}

// =====================================================================
// Assignments (Student: view + submit; Parent: read-only via renderChildAssignments)
// =====================================================================
function renderAssignmentCard(a, { editable }) {
  const done = a.submission?.status === 'done';
  const bodyId = `assign_${a.id}`;
  return `<div class="subject-card" style="display:block;">
    <div style="display:flex;justify-content:space-between;align-items:start;">
      <div>
        <div class="name">${a.title} ${done ? '<span class="badge paid">Done</span>' : '<span class="badge unpaid">Not started</span>'}</div>
        <div class="stats">${a.dueDate ? 'Due ' + a.dueDate : 'No due date'}${
    a.linkUrl ? ' &middot; <a href="' + a.linkUrl + '" target="_blank" rel="noopener">Open link</a>' : ''
  }</div>
        ${a.description ? `<p class="muted" style="margin:6px 0 0 0;">${a.description}</p>` : ''}
      </div>
    </div>
    ${
      editable
        ? `<div id="${bodyId}" style="margin-top:10px;">
      <label>Notes (optional)</label>
      <textarea id="${bodyId}_text" rows="2">${a.submission?.response_text || ''}</textarea>
      <label>Attach a file (optional)</label>
      <input type="file" id="${bodyId}_file">
      <button class="btn small" onclick="submitMyAssignment('${a.id}')">${done ? 'Update' : 'Mark as done'}</button>
      <p id="${bodyId}_error" class="muted" style="color:#b81f2c;"></p>
    </div>`
        : a.submission?.response_text
        ? `<p class="muted" style="margin-top:8px;">Student notes: ${a.submission.response_text}</p>`
        : ''
    }
  </div>`;
}

async function renderMyAssignments() {
  if (!currentStudentRecord) return;
  const assignments = await db.listAssignmentsForStudent(currentStudentRecord.id);
  const listEl = document.getElementById('myAssignmentsList');
  document.getElementById('myAssignmentsEmpty').classList.toggle('hidden', assignments.length > 0);
  listEl.innerHTML = assignments.map((a) => renderAssignmentCard(a, { editable: true })).join('');
}

async function submitMyAssignment(assignmentId) {
  const bodyId = `assign_${assignmentId}`;
  const responseText = document.getElementById(`${bodyId}_text`).value.trim();
  const fileInput = document.getElementById(`${bodyId}_file`);
  const file = fileInput.files[0] || null;
  const errEl = document.getElementById(`${bodyId}_error`);
  errEl.textContent = '';
  try {
    await db.submitAssignment({ assignmentId, studentId: currentStudentRecord.id, status: 'done', responseText, file });
    await renderMyAssignments();
  } catch (e) {
    errEl.textContent = e.message || 'Could not submit. Please try again.';
  }
}

async function studentCheckEmail() {
  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  if (!email) {
    errEl.textContent = 'Enter your email.';
    return;
  }
  let status;
  try {
    status = await db.studentAccountStatus(email);
  } catch (e) {
    errEl.textContent = 'Something went wrong checking that email. Please try again.';
    return;
  }
  if (status === 'not_registered') {
    errEl.textContent = "This email isn't registered with WAAPC Training Centre yet. Please contact the school.";
    return;
  }
  pendingLoginEmail = email;
  loginMode = status === 'needs_signup' ? 'signup' : 'signin';
  document.getElementById('loginStep1').classList.add('hidden');
  document.getElementById('loginStep2').classList.remove('hidden');
  document.getElementById('loginPasswordLabel').textContent =
    loginMode === 'signup' ? 'Create a password (first login)' : 'Password';
  document.getElementById('loginSubmitBtn').textContent = loginMode === 'signup' ? 'Create account & log in' : 'Log in';
  document.getElementById('loginPassword').value = '';
}

function studentBackToEmail() {
  showStudentLoginStep1();
}

async function studentSubmitPassword() {
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  if (!password || password.length < 6) {
    errEl.textContent = 'Password must be at least 6 characters.';
    return;
  }
  try {
    if (loginMode === 'signup') await db.studentSignUp(pendingLoginEmail, password);
    else await db.studentSignIn(pendingLoginEmail, password);

    currentSession = await db.getCurrentSessionInfo();
    const students = await db.loadAllStudents();
    currentStudentRecord = students[0] || null;
    if (!currentStudentRecord) {
      errEl.textContent = 'Logged in, but no student record is linked to this account. Contact the school.';
      return;
    }
    document.getElementById('loginPassword').value = '';
    await showStudentDashboardView();
  } catch (e) {
    errEl.textContent = e.message || 'Login failed. Please check your password and try again.';
  }
}

async function studentLogout() {
  await db.signOut();
  currentSession = null;
  currentStudentRecord = null;
  document.getElementById('loginEmail').value = '';
  document.getElementById('subjectArea').innerHTML = '';
  showStudentLoginStep1();
}

function renderStudentDashboard(s) {
  const list = document.getElementById('enrollmentsList');
  list.innerHTML = s.programs
    .map((p) => {
      const subjects = (CATALOG[p.test] && CATALOG[p.test].subjects) || [];
      const graduated = p.status === 'graduated';
      const body = graduated
        ? `<p class="muted" style="margin:0 0 12px;">You've completed this program${
            p.graduatedDate ? ' on ' + p.graduatedDate : ''
          } — congratulations! Practice and mock exams are no longer needed here; check your Grades and Certificate for your results.</p>`
        : subjects
            .map((subObj) => {
              const sub = subObj.name;
              if (subObj.kind === 'speaking') {
                return `<div class="subject-card">
                <div>
                  <div class="name">${sub}</div>
                  <div class="stats">Recorded speaking practice</div>
                </div>
                <div>
                  <button class="btn ghost small" onclick="startSession('${p.test}','${sub}','practice')">Practice</button>
                  <button class="btn small" onclick="startSession('${p.test}','${sub}','mock')">Record for review</button>
                </div>
              </div>`;
              }
              const attempts = s.attempts.filter((a) => a.test === p.test && a.subject === sub && a.mode === 'mock');
              const best = attempts.length ? Math.max(...attempts.map((a) => Math.round((a.score / a.total) * 100))) : null;
              return `<div class="subject-card">
              <div>
                <div class="name">${sub}</div>
                <div class="stats">${attempts.length ? attempts.length + ' mock attempt(s) · best ' + best + '%' : 'No mock attempts yet'}</div>
              </div>
              <div>
                <button class="btn ghost small" onclick="startSession('${p.test}','${sub}','practice')">Practice</button>
                <button class="btn small" onclick="startSession('${p.test}','${sub}','mock')">Take mock exam</button>
              </div>
            </div>`;
            })
            .join('');
      return `<div style="margin-bottom:16px;">
      <div style="font-weight:bold;color:#1a2b6b;font-size:15px;margin-bottom:8px;">${p.test} <span class="muted">(${p.level})</span> ${
        graduated ? '<span class="badge paid">Graduated</span>' : ''
      }</div>
      ${body}
    </div>`;
    })
    .join('');
}

// =====================================================================
// Practice / Mock exam sessions
// =====================================================================
let sessionState = null;

function findSubjectId(testName, subjectName) {
  const cat = CATALOG[testName];
  if (!cat) return null;
  const sub = cat.subjects.find((s) => s.name === subjectName);
  return sub ? sub.id : null;
}

async function startSession(test, subject, mode) {
  const kind = findSubjectKind(test, subject);
  if (kind === 'listening') return startListeningSession(test, subject, mode);
  if (kind === 'speaking') return startSpeakingSession(test, subject, mode);
  return startQuizSession(test, subject, mode);
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function startQuizSession(test, subject, mode) {
  const subjectId = findSubjectId(test, subject);
  let bank = subjectId ? await db.listQuestions(subjectId) : [];
  if (bank.length === 0) {
    document.getElementById('subjectArea').innerHTML = '<div class="card empty">Practice content for this subject is coming soon.</div>';
    return;
  }
  bank = shuffleArray(bank);
  // Practice runs use a random slice of the bank (not the full set) so
  // repeated practice sessions don't show the identical question set.
  if (mode === 'practice' && bank.length > 10) bank = bank.slice(0, Math.ceil(bank.length * 0.75));
  sessionState = { kind: 'quiz', test, subject, subjectId, mode, bank, answers: new Array(bank.length).fill(null), submitted: false };
  renderSession();
}

async function startListeningSession(test, subject, mode, groupLabel) {
  const subjectId = findSubjectId(test, subject);

  if (groupLabel === undefined) {
    const groups = subjectId ? await db.listListeningGroups(subjectId) : [];
    if (groups.length > 1) {
      renderListeningGroupChooser(test, subject, mode, groups);
      return;
    }
    groupLabel = groups[0];
  }

  const passages = subjectId ? await db.listListeningPassages(subjectId, groupLabel) : [];
  const bank = [];
  const passageGroups = [];
  for (const p of passages) {
    const startIdx = bank.length;
    for (const q of p.questions) bank.push(q);
    passageGroups.push({ title: p.title, audioUrl: p.audioUrl, startIdx, count: p.questions.length });
  }
  if (bank.length === 0) {
    document.getElementById('subjectArea').innerHTML = '<div class="card empty">Practice content for this subject is coming soon.</div>';
    return;
  }
  sessionState = { kind: 'listening', test, subject, subjectId, mode, groupLabel, bank, passageGroups, answers: new Array(bank.length).fill(null), submitted: false };
  renderSession();
}

function renderListeningGroupChooser(test, subject, mode, groups) {
  document.getElementById('subjectArea').innerHTML = `
    <div class="card">
      <h2>${test} — ${subject}</h2>
      <p class="muted">Choose which set to practice:</p>
      ${groups.map((g) => `<button class="btn small" style="margin:4px 8px 4px 0;" onclick="startListeningSession('${test}','${subject}','${mode}','${g}')">${g}</button>`).join('')}
      <div><button class="btn ghost small" style="margin-top:10px;" onclick="closeSession()">Back to dashboard</button></div>
    </div>`;
}

function renderSession() {
  const { subject, mode, submitted, bank } = sessionState;
  const test = sessionState.test;
  let scoreHtml = '';
  if (submitted) {
    const correct = bank.reduce((c, q, i) => c + (sessionState.answers[i] === q.answer ? 1 : 0), 0);
    scoreHtml = `<div class="score-banner"><div>${mode === 'mock' ? 'Mock exam result' : 'Practice result'} — ${subject}</div><div class="big">${correct} / ${bank.length}</div></div>`;
  }

  const renderQuestion = (q, i) => {
    const optsHtml = q.options
      .map((opt, oi) => {
        let cls = 'q-opt';
        if (sessionState.answers[i] === oi) cls += ' selected';
        if (submitted) {
          if (oi === q.answer) cls += ' correct';
          else if (sessionState.answers[i] === oi) cls += ' wrong';
        }
        return `<span class="${cls}" onclick="${submitted ? '' : `selectAnswer(${i},${oi})`}">${opt}</span>`;
      })
      .join('');
    return `<div class="q-block"><div class="qtext">${i + 1}. ${q.q}</div>${optsHtml}</div>`;
  };

  let qHtml;
  if (sessionState.kind === 'listening') {
    qHtml = sessionState.passageGroups
      .map((g) => {
        const groupQs = bank
          .slice(g.startIdx, g.startIdx + g.count)
          .map((q, gi) => renderQuestion(q, g.startIdx + gi))
          .join('');
        return `
        <div style="margin-bottom:20px;">
          ${g.title ? `<div style="font-weight:bold;color:#1a2b6b;margin-bottom:6px;">${g.title}</div>` : ''}
          <audio controls src="${g.audioUrl}" style="width:100%;margin-bottom:10px;"></audio>
          ${groupQs}
        </div>`;
      })
      .join('');
  } else {
    qHtml = bank.map((q, i) => renderQuestion(q, i)).join('');
  }

  document.getElementById('subjectArea').innerHTML = `
    <div class="card">
      <h2>${test} — ${subject} (${mode === 'mock' ? 'Mock exam' : 'Practice'})</h2>
      ${scoreHtml}
      ${qHtml}
      ${
        submitted
          ? `<button class="btn ghost small" onclick="closeSession()">Back to dashboard</button>`
          : `<button class="btn red" onclick="submitSession()">Submit</button>`
      }
    </div>`;
}

function selectAnswer(qIndex, optIndex) {
  sessionState.answers[qIndex] = optIndex;
  renderSession();
}

async function submitSession() {
  const bank = sessionState.bank;
  const correct = bank.reduce((c, q, i) => c + (sessionState.answers[i] === q.answer ? 1 : 0), 0);
  sessionState.submitted = true;
  if (sessionState.mode === 'mock') {
    try {
      await db.recordAttempt({
        studentId: currentStudentRecord.id,
        subjectId: sessionState.subjectId,
        mode: 'mock',
        score: correct,
        total: bank.length,
      });
      const students = await db.loadAllStudents();
      currentStudentRecord = students[0] || currentStudentRecord;
    } catch (e) {
      alert('Could not save your attempt: ' + (e.message || e));
    }
  }
  renderSession();
}

// ----- Speaking sessions (record + optional submit for review) -----
let activeMediaRecorder = null;
let activeMediaChunks = [];

async function startSpeakingSession(test, subject, mode) {
  const subjectId = findSubjectId(test, subject);
  const prompts = subjectId ? await db.listSpeakingPrompts(subjectId) : [];
  if (prompts.length === 0) {
    document.getElementById('subjectArea').innerHTML = '<div class="card empty">Practice content for this subject is coming soon.</div>';
    return;
  }
  sessionState = { kind: 'speaking', test, subject, subjectId, mode, prompts, recordings: {} };
  renderSpeakingSession();
}

function renderSpeakingSession() {
  const { test, subject, mode, prompts, recordings } = sessionState;
  const promptsHtml = prompts
    .map((p) => {
      const rec = recordings[p.id] || {};
      return `
      <div class="q-block">
        <div class="qtext">${p.text}</div>
        <div>
          <button class="btn small ${rec.blob ? 'hidden' : ''}" id="speak_recBtn_${p.id}" onclick="speakStartRecording('${p.id}')">🎙 Record</button>
          <button class="btn ghost small hidden" id="speak_stopBtn_${p.id}" onclick="speakStopRecording('${p.id}')">Stop</button>
          ${rec.blob ? `<button class="btn ghost small" onclick="speakStartRecording('${p.id}')">Record again</button>` : ''}
        </div>
        ${rec.url ? `<audio controls src="${rec.url}" style="width:100%;margin-top:8px;"></audio>` : ''}
        ${mode === 'mock' && rec.blob && !rec.submitted ? `<button class="btn red" style="margin-top:8px;" onclick="speakSubmitRecording('${p.id}')">Submit this response</button>` : ''}
        ${rec.submitted ? `<p class="muted" style="color:#1e7a45;">Submitted for review.</p>` : ''}
      </div>`;
    })
    .join('');

  document.getElementById('subjectArea').innerHTML = `
    <div class="card">
      <h2>${test} — ${subject} (${mode === 'mock' ? 'Recorded for review' : 'Practice'})</h2>
      <p class="muted">${mode === 'mock' ? 'Record your answer, then submit it for the school to review — there is no automatic score.' : 'Record and play back your answer as many times as you like. Nothing is saved in practice mode.'}</p>
      ${promptsHtml}
      <button class="btn ghost small" onclick="closeSession()">Back to dashboard</button>
    </div>`;
}

async function speakStartRecording(promptId) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    activeMediaChunks = [];
    activeMediaRecorder = new MediaRecorder(stream);
    activeMediaRecorder.ondataavailable = (e) => activeMediaChunks.push(e.data);
    activeMediaRecorder.onstop = () => {
      const blob = new Blob(activeMediaChunks, { type: 'audio/webm' });
      const url = URL.createObjectURL(blob);
      sessionState.recordings[promptId] = { blob, url, submitted: false };
      stream.getTracks().forEach((t) => t.stop());
      renderSpeakingSession();
    };
    activeMediaRecorder.start();
    document.getElementById(`speak_recBtn_${promptId}`).classList.add('hidden');
    document.getElementById(`speak_stopBtn_${promptId}`).classList.remove('hidden');
  } catch (e) {
    alert('Could not access the microphone: ' + (e.message || e));
  }
}

function speakStopRecording(promptId) {
  if (activeMediaRecorder && activeMediaRecorder.state !== 'inactive') activeMediaRecorder.stop();
}

async function speakSubmitRecording(promptId) {
  const rec = sessionState.recordings[promptId];
  if (!rec || !rec.blob) return;
  try {
    await db.submitSpeakingRecording({ studentId: currentStudentRecord.id, promptId, blob: rec.blob });
  } catch (e) {
    alert('Could not submit recording: ' + (e.message || e));
    return;
  }
  rec.submitted = true;
  renderSpeakingSession();
}

function closeSession() {
  sessionState = null;
  document.getElementById('subjectArea').innerHTML = '';
  renderStudentDashboard(currentStudentRecord);
}

// =====================================================================
// Admin: Question Bank editor
// =====================================================================
function qbInit() {
  const testSelect = document.getElementById('qb_test');
  testSelect.innerHTML = Object.keys(CATALOG).map((t) => `<option value="${t}">${t}</option>`).join('');
  qbOnTestChange();
}

function qbOnTestChange() {
  const test = document.getElementById('qb_test').value;
  const subjects = CATALOG[test].subjects;
  document.getElementById('qb_subject').innerHTML = subjects.map((s) => `<option value="${s.name}">${s.name}</option>`).join('');
  qbLoadList();
}

function findSubjectKind(testName, subjectName) {
  const cat = CATALOG[testName];
  if (!cat) return 'quiz';
  const sub = cat.subjects.find((s) => s.name === subjectName);
  return sub ? sub.kind : 'quiz';
}

async function qbLoadList() {
  const test = document.getElementById('qb_test').value;
  const subject = document.getElementById('qb_subject').value;
  const kind = findSubjectKind(test, subject);

  document.getElementById('qb_quizPanel').classList.toggle('hidden', kind !== 'quiz');
  document.getElementById('qb_listeningPanel').classList.toggle('hidden', kind !== 'listening');
  document.getElementById('qb_speakingPanel').classList.toggle('hidden', kind !== 'speaking');

  if (kind === 'listening') {
    document.getElementById('qb_count').textContent = 'Listening subject — manage audio passages below.';
    await qbLoadPassages();
  } else if (kind === 'speaking') {
    document.getElementById('qb_count').textContent = 'Speaking subject — manage prompts below.';
    await qbLoadPrompts();
  } else {
    await qbLoadQuizList();
  }
}

async function qbLoadQuizList() {
  const test = document.getElementById('qb_test').value;
  const subject = document.getElementById('qb_subject').value;
  const subjectId = findSubjectId(test, subject);
  const list = subjectId ? await db.listQuestions(subjectId) : [];
  document.getElementById('qb_count').textContent = `${list.length} question(s) in the bank for this subject.`;

  const listDiv = document.getElementById('qb_list');
  document.getElementById('qb_listEmpty').classList.toggle('hidden', list.length > 0);
  listDiv.innerHTML = list
    .map(
      (q, i) => `
    <div class="q-block">
      <div class="qtext">${i + 1}. ${q.q}</div>
      ${q.options.map((opt, oi) => `<div style="padding:4px 0;${oi === q.answer ? 'color:#1e7a45;font-weight:bold;' : ''}">${oi === q.answer ? '✓ ' : '　'} ${opt}</div>`).join('')}
      <button class="btn ghost small" style="margin-top:6px;" onclick="qbDeleteQuestion('${q.id}')">Remove this question</button>
    </div>
  `
    )
    .join('');
}

async function qbAddQuestion() {
  const test = document.getElementById('qb_test').value;
  const subject = document.getElementById('qb_subject').value;
  const qtext = document.getElementById('qb_qtext').value.trim();
  const a = document.getElementById('qb_optA').value.trim();
  const b = document.getElementById('qb_optB').value.trim();
  const c = document.getElementById('qb_optC').value.trim();
  const d = document.getElementById('qb_optD').value.trim();
  const correct = Number(document.getElementById('qb_correct').value);

  if (!qtext || !a || !b || !c || !d) {
    alert('Please fill in the question text and all four options before adding.');
    return;
  }

  const subjectId = findSubjectId(test, subject);
  try {
    await db.addQuestion(subjectId, { q: qtext, options: [a, b, c, d], answer: correct });
  } catch (e) {
    alert('Could not add question: ' + (e.message || e));
    return;
  }

  document.getElementById('qb_qtext').value = '';
  document.getElementById('qb_optA').value = '';
  document.getElementById('qb_optB').value = '';
  document.getElementById('qb_optC').value = '';
  document.getElementById('qb_optD').value = '';
  document.getElementById('qb_correct').value = '0';

  alert('Question added.');
  qbLoadList();
}

async function qbDeleteQuestion(questionId) {
  try {
    await db.deleteQuestion(questionId);
  } catch (e) {
    alert('Could not delete question: ' + (e.message || e));
    return;
  }
  qbLoadList();
}

// ----- Listening passages -----
async function qbLoadPassages() {
  const test = document.getElementById('qb_test').value;
  const subject = document.getElementById('qb_subject').value;
  const subjectId = findSubjectId(test, subject);

  const groups = subjectId ? await db.listListeningGroups(subjectId) : [];
  const groupFilterEl = document.getElementById('qb_passageGroupFilter');
  const previousFilter = groupFilterEl.value;
  groupFilterEl.innerHTML =
    groups.length > 0
      ? `<option value="">All groups</option>` + groups.map((g) => `<option value="${g}">${g}</option>`).join('')
      : `<option value="">(no groups on this subject)</option>`;
  if (groups.includes(previousFilter)) groupFilterEl.value = previousFilter;
  const selectedGroup = groupFilterEl.value;

  const passages = subjectId ? await db.listListeningPassages(subjectId, selectedGroup || undefined) : [];

  document.getElementById('qb_passageListEmpty').classList.toggle('hidden', passages.length > 0);
  document.getElementById('qb_passageList').innerHTML = passages
    .map(
      (p) => `
    <div class="q-block">
      <div class="qtext">${p.title || 'Untitled passage'}</div>
      <audio controls src="${p.audioUrl}" style="width:100%;margin:8px 0;"></audio>
      <p class="muted">${p.questions.length} question(s) attached to this passage.</p>
      ${p.questions
        .map(
          (q, i) => `
        <div style="padding:8px 0;border-top:1px solid #eef1f7;">
          <div style="font-weight:bold;">${i + 1}. ${q.q}</div>
          ${q.options.map((opt, oi) => `<div style="padding:2px 0;${oi === q.answer ? 'color:#1e7a45;font-weight:bold;' : ''}">${oi === q.answer ? '✓ ' : '　'} ${opt}</div>`).join('')}
        </div>`
        )
        .join('')}
      <button class="btn ghost small" style="margin-top:8px;" onclick="qbDeletePassage('${p.id}')">Remove this passage</button>
    </div>
  `
    )
    .join('');

  document.getElementById('qb_passageSelect').innerHTML = passages
    .map((p) => `<option value="${p.id}">${p.title || 'Untitled passage'}</option>`)
    .join('');
}

async function qbAddPassage() {
  const test = document.getElementById('qb_test').value;
  const subject = document.getElementById('qb_subject').value;
  const subjectId = findSubjectId(test, subject);
  const title = document.getElementById('qb_passageTitle').value.trim();
  const groupLabel = document.getElementById('qb_passageGroupLabel').value.trim();
  const audioFile = document.getElementById('qb_passageAudio').files[0];

  if (!audioFile) {
    alert('Choose an audio file first.');
    return;
  }

  try {
    await db.addListeningPassage(subjectId, { title, audioFile, groupLabel });
  } catch (e) {
    alert('Could not add passage: ' + (e.message || e));
    return;
  }

  document.getElementById('qb_passageTitle').value = '';
  document.getElementById('qb_passageGroupLabel').value = '';
  document.getElementById('qb_passageAudio').value = '';
  qbLoadPassages();
}

async function qbDeletePassage(passageId) {
  try {
    await db.deleteListeningPassage(passageId);
  } catch (e) {
    alert('Could not delete passage: ' + (e.message || e));
    return;
  }
  qbLoadPassages();
}

async function qbAddListeningQuestion() {
  const test = document.getElementById('qb_test').value;
  const subject = document.getElementById('qb_subject').value;
  const subjectId = findSubjectId(test, subject);
  const passageId = document.getElementById('qb_passageSelect').value;
  const qtext = document.getElementById('qb_lqtext').value.trim();
  const a = document.getElementById('qb_loptA').value.trim();
  const b = document.getElementById('qb_loptB').value.trim();
  const c = document.getElementById('qb_loptC').value.trim();
  const d = document.getElementById('qb_loptD').value.trim();
  const correct = Number(document.getElementById('qb_lcorrect').value);

  if (!passageId) {
    alert('Add a passage first.');
    return;
  }
  if (!qtext || !a || !b || !c || !d) {
    alert('Please fill in the question text and all four options before adding.');
    return;
  }

  try {
    await db.addListeningQuestion(passageId, subjectId, { q: qtext, options: [a, b, c, d], answer: correct });
  } catch (e) {
    alert('Could not add question: ' + (e.message || e));
    return;
  }

  document.getElementById('qb_lqtext').value = '';
  document.getElementById('qb_loptA').value = '';
  document.getElementById('qb_loptB').value = '';
  document.getElementById('qb_loptC').value = '';
  document.getElementById('qb_loptD').value = '';
  document.getElementById('qb_lcorrect').value = '0';

  alert('Question added to passage.');
  qbLoadPassages();
}

// ----- Speaking prompts -----
async function qbLoadPrompts() {
  const test = document.getElementById('qb_test').value;
  const subject = document.getElementById('qb_subject').value;
  const subjectId = findSubjectId(test, subject);
  const prompts = subjectId ? await db.listSpeakingPrompts(subjectId) : [];

  document.getElementById('qb_promptListEmpty').classList.toggle('hidden', prompts.length > 0);
  document.getElementById('qb_promptList').innerHTML = prompts
    .map(
      (p) => `
    <div class="q-block">
      <div class="qtext">${p.text}</div>
      <button class="btn ghost small" style="margin-top:6px;" onclick="qbDeletePrompt('${p.id}')">Remove this prompt</button>
    </div>
  `
    )
    .join('');
}

async function qbAddPrompt() {
  const test = document.getElementById('qb_test').value;
  const subject = document.getElementById('qb_subject').value;
  const subjectId = findSubjectId(test, subject);
  const text = document.getElementById('qb_promptText').value.trim();

  if (!text) {
    alert('Type a prompt first.');
    return;
  }

  try {
    await db.addSpeakingPrompt(subjectId, text);
  } catch (e) {
    alert('Could not add prompt: ' + (e.message || e));
    return;
  }

  document.getElementById('qb_promptText').value = '';
  qbLoadPrompts();
}

async function qbDeletePrompt(promptId) {
  try {
    await db.deleteSpeakingPrompt(promptId);
  } catch (e) {
    alert('Could not delete prompt: ' + (e.message || e));
    return;
  }
  qbLoadPrompts();
}

// ----- Bulk CSV import -----
function qbLoadCsvFile(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    document.getElementById('qb_csvtext').value = reader.result;
  };
  reader.readAsText(file);
}

function parseCsv(text) {
  const rows = [];
  let row = [],
    field = '',
    inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i],
      next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && next === '\n') i++;
        row.push(field);
        field = '';
        if (row.some((f) => f.trim() !== '')) rows.push(row);
        row = [];
      } else {
        field += c;
      }
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some((f) => f.trim() !== '')) rows.push(row);
  }
  return rows;
}

function findTestKey(name) {
  const target = name.trim().toLowerCase();
  return Object.keys(CATALOG).find((k) => k.toLowerCase() === target) || null;
}

function findSubjectName(testKey, name) {
  const target = name.trim().toLowerCase();
  const found = CATALOG[testKey].subjects.find((s) => s.name.toLowerCase() === target);
  return found ? found.name : null;
}

async function qbBulkImport() {
  const text = document.getElementById('qb_csvtext').value.trim();
  const resultDiv = document.getElementById('qb_importResult');
  if (!text) {
    resultDiv.innerHTML = '<p style="color:#b81f2c;">Paste or upload some CSV content first.</p>';
    return;
  }

  const rows = parseCsv(text);
  if (rows.length < 2) {
    resultDiv.innerHTML = '<p style="color:#b81f2c;">No data rows found below the header.</p>';
    return;
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = {
    test: header.indexOf('test'),
    subject: header.indexOf('subject'),
    question: header.indexOf('question'),
    a: header.indexOf('optiona'),
    b: header.indexOf('optionb'),
    c: header.indexOf('optionc'),
    d: header.indexOf('optiond'),
    correct: header.indexOf('correct'),
  };
  const missingCols = Object.keys(idx).filter((k) => idx[k] === -1);
  if (missingCols.length > 0) {
    resultDiv.innerHTML = `<p style="color:#b81f2c;">Missing required column(s): ${missingCols.join(', ')}. Check the header row matches the format shown above.</p>`;
    return;
  }

  const toInsert = [];
  const errors = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const rawTest = (row[idx.test] || '').trim();
    const rawSubject = (row[idx.subject] || '').trim();
    const qtext = (row[idx.question] || '').trim();
    const opts = [row[idx.a], row[idx.b], row[idx.c], row[idx.d]].map((o) => (o || '').trim());
    const correctRaw = (row[idx.correct] || '').trim().toUpperCase();
    const correctMap = { A: 0, B: 1, C: 2, D: 3, '1': 0, '2': 1, '3': 2, '4': 3 };

    if (!rawTest && !rawSubject && !qtext) continue;

    const testKey = findTestKey(rawTest);
    if (!testKey) {
      errors.push(`Row ${r + 1}: Test "${rawTest}" not recognized.`);
      continue;
    }
    const subjectName = findSubjectName(testKey, rawSubject);
    if (!subjectName) {
      errors.push(`Row ${r + 1}: Subject "${rawSubject}" not found under ${testKey}.`);
      continue;
    }
    if (findSubjectKind(testKey, subjectName) !== 'quiz') {
      errors.push(`Row ${r + 1}: "${subjectName}" is a Listening/Speaking subject — use the Listening/Speaking tools above instead of CSV import.`);
      continue;
    }
    if (!qtext || opts.some((o) => !o)) {
      errors.push(`Row ${r + 1}: Question text or one of the four options is empty.`);
      continue;
    }
    if (!(correctRaw in correctMap)) {
      errors.push(`Row ${r + 1}: Correct answer "${correctRaw}" must be A, B, C, or D.`);
      continue;
    }

    toInsert.push({ subjectId: findSubjectId(testKey, subjectName), q: qtext, options: opts, answer: correctMap[correctRaw] });
  }

  if (toInsert.length > 0) {
    try {
      await db.bulkInsertQuestions(toInsert);
    } catch (e) {
      resultDiv.innerHTML = `<p style="color:#b81f2c;">Import failed: ${e.message || e}</p>`;
      return;
    }
  }

  let html = `<p style="color:#1e7a45;font-weight:bold;">${toInsert.length} question(s) imported successfully.</p>`;
  if (errors.length > 0) {
    html += `<p style="color:#b81f2c;font-weight:bold;">${errors.length} row(s) skipped:</p><ul style="font-size:12px;color:#b81f2c;">${errors.map((e) => `<li>${e}</li>`).join('')}</ul>`;
  }
  resultDiv.innerHTML = html;
  if (toInsert.length > 0) qbLoadList();
}

// =====================================================================
// Announcements (shared page; admin/teacher post, everyone reads)
// =====================================================================
function canPostAsStaff() {
  return !!(currentSession && (currentSession.role === 'admin' || currentSession.role === 'teacher'));
}

// A failed fetch (e.g. a migration not yet run) used to leave these
// shared pages completely blank, which reads as broken. Always land on
// a visible message instead — either the data, an empty state, or this.
function showPageError(containerId, emptyId, error) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = '';
  const empty = emptyId && document.getElementById(emptyId);
  if (empty) {
    const detail = error?.message || String(error || '');
    empty.textContent = detail
      ? `Something went wrong loading this page: ${detail}`
      : 'Something went wrong loading this page. Try refreshing — if it keeps happening, let the admin know.';
    empty.classList.remove('hidden');
  }
}

async function renderAnnouncementsPage() {
  document.getElementById('ann_composer').classList.toggle('hidden', !canPostAsStaff());
  try {
    if (canPostAsStaff()) {
      await ensureCatalog();
      const audienceSelect = document.getElementById('ann_audience');
      if (!audienceSelect.dataset.loaded) {
        audienceSelect.innerHTML =
          '<option value="">Everyone</option>' + Object.keys(CATALOG).map((t) => `<option value="${CATALOG[t].id}">${t} students only</option>`).join('');
        audienceSelect.dataset.loaded = '1';
      }
    }

    let items = await db.listAnnouncements();
    if (currentSession?.role === 'student' && currentStudentRecord) {
      const myPrograms = new Set(currentStudentRecord.programs.map((p) => p.test));
      items = items.filter((a) => !a.targetTestName || myPrograms.has(a.targetTestName));
    }

    const listEl = document.getElementById('ann_list');
    document.getElementById('ann_listEmpty').textContent = 'No announcements yet.';
    document.getElementById('ann_listEmpty').classList.toggle('hidden', items.length > 0);
    listEl.innerHTML = items
    .map(
      (a) => `<div class="card" style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:start;">
          <div>
            <h2 style="margin-bottom:4px;">${a.title} ${a.targetTestName ? `<span class="badge neutral">${a.targetTestName} only</span>` : ''}</h2>
            <p class="muted" style="margin:0 0 8px;">${new Date(a.created_at).toLocaleString()}</p>
            ${a.body ? `<p style="margin:0;">${a.body}</p>` : ''}
          </div>
          ${canPostAsStaff() ? `<button class="btn ghost small no-print" onclick="deleteAnnouncementClick('${a.id}')">Delete</button>` : ''}
        </div>
      </div>`
    )
    .join('');
  } catch (e) {
    console.error('renderAnnouncementsPage failed:', e);
    showPageError('ann_list', 'ann_listEmpty', e);
  }
}

async function createAnnouncementClick() {
  const title = document.getElementById('ann_title').value.trim();
  const body = document.getElementById('ann_body').value.trim();
  const targetTestId = document.getElementById('ann_audience').value || null;
  const errEl = document.getElementById('ann_error');
  errEl.textContent = '';
  if (!title) {
    errEl.textContent = 'Enter a title.';
    return;
  }
  try {
    await db.createAnnouncement(title, body, targetTestId);
    document.getElementById('ann_title').value = '';
    document.getElementById('ann_body').value = '';
    await renderAnnouncementsPage();
  } catch (e) {
    errEl.textContent = e.message || 'Could not post announcement.';
  }
}

async function deleteAnnouncementClick(id) {
  await db.deleteAnnouncement(id);
  await renderAnnouncementsPage();
}

// =====================================================================
// Calendar (shared page; admin/teacher post, everyone reads)
// =====================================================================
async function renderCalendarPage() {
  document.getElementById('cal_composer').classList.toggle('hidden', !canPostAsStaff());
  const events = await db.listCalendarEvents();
  const listEl = document.getElementById('cal_list');
  document.getElementById('cal_listEmpty').classList.toggle('hidden', events.length > 0);
  listEl.innerHTML = events
    .map(
      (e) => `<div class="subject-card">
        <div>
          <div class="name">${e.title}</div>
          <div class="stats">${new Date(e.event_date + 'T00:00:00').toLocaleDateString(undefined, {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}${e.description ? ' — ' + e.description : ''}</div>
        </div>
        ${canPostAsStaff() ? `<button class="btn ghost small no-print" onclick="deleteCalendarEventClick('${e.id}')">Delete</button>` : ''}
      </div>`
    )
    .join('');
}

async function createCalendarEventClick() {
  const title = document.getElementById('cal_title').value.trim();
  const date = document.getElementById('cal_date').value;
  const desc = document.getElementById('cal_desc').value.trim();
  const errEl = document.getElementById('cal_error');
  errEl.textContent = '';
  if (!title || !date) {
    errEl.textContent = 'Enter a title and date.';
    return;
  }
  try {
    await db.createCalendarEvent(title, desc, date);
    document.getElementById('cal_title').value = '';
    document.getElementById('cal_date').value = '';
    document.getElementById('cal_desc').value = '';
    await renderCalendarPage();
  } catch (e) {
    errEl.textContent = e.message || 'Could not add event.';
  }
}

async function deleteCalendarEventClick(id) {
  await db.deleteCalendarEvent(id);
  await renderCalendarPage();
}

// =====================================================================
// Timetable (shared page; admin/teacher post, everyone reads)
// =====================================================================
const TIMETABLE_DAY_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const TIMETABLE_DAY_LABELS = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
const TIMETABLE_KIND_BADGE = { class: 'paid', test: 'partial', plan: 'neutral', rest: 'unpaid' };

// GED weekday core-subject rotation. Times, breaks, lunch, and Friday
// stay exactly as scheduled — only which of the 4 core subjects occupies
// each of the 4 class periods changes, so the same day-of-week doesn't
// always teach the same subject first. The pattern also shifts forward
// one step every week (a Latin square over day x period x week), cycling
// through all 4 orderings before repeating.
const GED_ROTATION_SUBJECTS = ['Reading & Language Arts', 'Mathematics', 'Science', 'Social Studies'];
const GED_ROTATION_DAYS = ['Mon', 'Tue', 'Wed', 'Thu'];
// 2024-01-01 is a Monday — a fixed, arbitrary reference point so the week
// index (and therefore the rotation) is stable and deterministic forever.
const GED_ROTATION_EPOCH = Date.UTC(2024, 0, 1);

function gedRotationWeekIndex(date = new Date()) {
  const dayMs = 24 * 60 * 60 * 1000;
  const todayUTC = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const daysSinceEpoch = Math.floor((todayUTC - GED_ROTATION_EPOCH) / dayMs);
  return Math.floor(daysSinceEpoch / 7) % GED_ROTATION_SUBJECTS.length;
}

// Mutates the given day's GED entries in place, relabeling the 4 rotating
// class slots (matched by their original subject name, in time order)
// with this week's rotated subject. Leaves everything else untouched.
function applyGedRotation(dayEntries, day, weekIndex) {
  const dayIndex = GED_ROTATION_DAYS.indexOf(day);
  if (dayIndex === -1) return;
  const rotatingSlots = dayEntries
    .filter((e) => e.kind === 'class' && GED_ROTATION_SUBJECTS.includes(e.activity))
    .sort((a, b) => a.start.localeCompare(b.start));
  if (rotatingSlots.length !== GED_ROTATION_SUBJECTS.length) return;
  rotatingSlots.forEach((entry, periodIndex) => {
    const subjectIndex = (periodIndex + dayIndex + weekIndex) % GED_ROTATION_SUBJECTS.length;
    entry.activity = GED_ROTATION_SUBJECTS[subjectIndex];
  });
}

async function renderTimetablePage() {
  document.getElementById('tt_composer').classList.toggle('hidden', !canPostAsStaff());
  try {
    if (canPostAsStaff()) {
      await ensureCatalog();
      const select = document.getElementById('tt_test');
      if (!select.dataset.loaded) {
        select.innerHTML = '<option value="">General (no specific program)</option>' + Object.keys(CATALOG).map((t) => `<option value="${CATALOG[t].id}">${t}</option>`).join('');
        select.dataset.loaded = '1';
      }
    }

    let entries = await db.listTimetable();
    const listEl = document.getElementById('tt_list');

    // Students see their own personal timetable: entries for their enrolled
    // program(s) plus general (no-program) entries, with their tutor's name.
    if (currentSession?.role === 'student' && currentStudentRecord) {
      const myPrograms = new Set(currentStudentRecord.programs.map((p) => p.test));
      entries = entries.filter((e) => !e.testName || myPrograms.has(e.testName));
    }

    document.getElementById('tt_listEmpty').textContent = 'No timetable entries yet.';
    document.getElementById('tt_listEmpty').classList.toggle('hidden', entries.length > 0);

    const byDay = {};
    entries.forEach((e) => {
      byDay[e.day] = byDay[e.day] || [];
      byDay[e.day].push(e);
    });

    const gedWeekIndex = gedRotationWeekIndex();
    GED_ROTATION_DAYS.forEach((d) => {
      if (byDay[d]) applyGedRotation(byDay[d].filter((e) => e.testName === 'GED'), d, gedWeekIndex);
    });

    listEl.innerHTML = TIMETABLE_DAY_ORDER.filter((d) => byDay[d])
      .map((d) => {
        const rows = byDay[d]
          .map(
            (e) => `<tr>
          <td>${e.start.slice(0, 5)}–${e.end.slice(0, 5)}</td>
          <td>${e.activity}${e.testName ? ' <span class="muted">(' + e.testName + ')</span>' : ''}</td>
          <td>${e.teacherName || '—'}</td>
          <td><span class="badge ${TIMETABLE_KIND_BADGE[e.kind] || 'neutral'}">${e.kind}</span></td>
          ${canPostAsStaff() ? `<td class="no-print"><button class="btn ghost small" onclick="deleteTimetableEntryClick('${e.id}')">Delete</button></td>` : ''}
        </tr>`
          )
          .join('');
        return `<div class="card">
          <h2>${TIMETABLE_DAY_LABELS[d]}</h2>
          <table><thead><tr><th>Time</th><th>Activity</th><th>Tutor</th><th>Type</th>${canPostAsStaff() ? '<th></th>' : ''}</tr></thead><tbody>${rows}</tbody></table>
        </div>`;
      })
      .join('');
  } catch (e) {
    console.error('renderTimetablePage failed:', e);
    showPageError('tt_list', 'tt_listEmpty', e);
  }
}

async function createTimetableEntryClick() {
  const testId = document.getElementById('tt_test').value || null;
  const day = document.getElementById('tt_day').value;
  const start = document.getElementById('tt_start').value;
  const end = document.getElementById('tt_end').value;
  const activity = document.getElementById('tt_activity').value.trim();
  const kind = document.getElementById('tt_kind').value;
  const teacherName = document.getElementById('tt_teacher').value.trim();
  const errEl = document.getElementById('tt_error');
  errEl.textContent = '';
  if (!start || !end || !activity) {
    errEl.textContent = 'Fill in start time, end time, and activity.';
    return;
  }
  try {
    await db.createTimetableEntry({ testId, day, start, end, activity, kind, teacherName });
    document.getElementById('tt_activity').value = '';
    document.getElementById('tt_teacher').value = '';
    await renderTimetablePage();
  } catch (e) {
    errEl.textContent = e.message || 'Could not add timetable entry.';
  }
}

async function deleteTimetableEntryClick(id) {
  await db.deleteTimetableEntry(id);
  await renderTimetablePage();
}

// =====================================================================
// Finance (Admin only) — income (from paid installments) vs. expenses
// =====================================================================
let financeStudents = [];

async function renderFinancePage() {
  const [students, expenses, payments] = await Promise.all([db.loadAllStudents(), db.listExpenses(), db.listAllPayments()]);
  financeStudents = students;

  const incomeByCategory = {};
  let totalIncome = 0;
  students.forEach((s) => {
    s.installments.forEach((inst) => {
      if (!inst.amountPaid) return;
      const cat = inst.category || 'other';
      incomeByCategory[cat] = (incomeByCategory[cat] || 0) + inst.amountPaid;
      totalIncome += inst.amountPaid;
    });
  });
  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const net = totalIncome - totalExpenses;

  document.getElementById('fin_income').textContent = totalIncome.toLocaleString();
  document.getElementById('fin_expenses').textContent = totalExpenses.toLocaleString();
  document.getElementById('fin_net').textContent = net.toLocaleString();

  document.getElementById('fin_breakdown').innerHTML =
    Object.keys(FEE_CATEGORY_LABELS)
      .filter((c) => incomeByCategory[c])
      .map(
        (c) => `<div class="subject-card"><div class="name">${FEE_CATEGORY_LABELS[c]}</div><div style="font-weight:bold;color:var(--navy);">${incomeByCategory[c].toLocaleString()} CFA</div></div>`
      )
      .join('') || '<p class="muted">No income recorded yet.</p>';

  const arrears = students
    .map((s) => ({ s, balance: balanceOf(s) }))
    .filter((x) => x.balance > 0)
    .sort((a, b) => b.balance - a.balance);
  document.getElementById('fin_arrearsEmpty').classList.toggle('hidden', arrears.length > 0);
  document.querySelector('#fin_arrearsTable tbody').innerHTML = arrears
    .map(({ s, balance }) => {
      const paid = s.total - balance;
      return `<tr>
        <td>${s.fullName}</td>
        <td>${s.programs.map((p) => p.test).join(', ') || '—'}</td>
        <td>${s.total.toLocaleString()} CFA</td>
        <td>${paid.toLocaleString()} CFA</td>
        <td style="font-weight:bold;color:var(--red);">${balance.toLocaleString()} CFA</td>
        <td><button class="btn small" onclick="financeSelectStudent('${s.id}')">Record payment</button></td>
      </tr>`;
    })
    .join('');

  document.getElementById('fin_ledgerEmpty').classList.toggle('hidden', payments.length > 0);
  document.querySelector('#fin_ledgerTable tbody').innerHTML = payments
    .map(
      (p) => `<tr>
      <td>${p.date}</td>
      <td>${p.studentName || '—'}</td>
      <td>${FEE_CATEGORY_LABELS[p.category] || 'Other'}</td>
      <td>${p.amount.toLocaleString()} CFA</td>
      <td>${p.method || '—'}</td>
      <td>${p.receiptNumber || '—'}</td>
      <td><button class="btn ghost small" onclick="financeVoidPaymentClick('${p.id}')">Void</button></td>
    </tr>`
    )
    .join('');

  const studentSelect = document.getElementById('pay_student');
  const prevValue = studentSelect.value;
  studentSelect.innerHTML =
    '<option value="">Select a student…</option>' +
    students.map((s) => `<option value="${s.id}">${s.fullName}${balanceOf(s) > 0 ? ' — owes ' + balanceOf(s).toLocaleString() + ' CFA' : ''}</option>`).join('');
  studentSelect.value = prevValue;
  populateFinanceInstallmentOptions();
  if (!document.getElementById('fpay_date').value) document.getElementById('fpay_date').value = new Date().toISOString().slice(0, 10);

  const listEl = document.querySelector('#fin_expenseTable tbody');
  document.getElementById('fin_expenseListEmpty').classList.toggle('hidden', expenses.length > 0);
  listEl.innerHTML = expenses
    .map(
      (e) => `<tr>
        <td>${new Date(e.expense_date).toLocaleDateString()}</td>
        <td>${e.category}</td>
        <td>${e.description || '—'}</td>
        <td>${Number(e.amount).toLocaleString()} CFA</td>
        <td><button class="btn ghost small" onclick="deleteExpenseClick('${e.id}')">Delete</button></td>
      </tr>`
    )
    .join('');
}

function populateFinanceInstallmentOptions() {
  const studentId = document.getElementById('pay_student').value;
  const instSelect = document.getElementById('pay_installment');
  const s = financeStudents.find((x) => x.id === studentId);
  if (!s) {
    instSelect.innerHTML = '<option value="">—</option>';
    document.getElementById('fpay_amount').value = '';
    return;
  }
  const outstanding = s.installments.filter((i) => i.balance > 0);
  instSelect.innerHTML = outstanding.length
    ? outstanding.map((i) => `<option value="${i.id}">${FEE_CATEGORY_LABELS[i.category] || 'Other'} — balance ${i.balance.toLocaleString()} CFA</option>`).join('')
    : '<option value="">No outstanding fee lines — add one</option>';
  onFinanceInstallmentChange();
}

function onFinancePayStudentChange() {
  populateFinanceInstallmentOptions();
}

function onFinanceInstallmentChange() {
  const studentId = document.getElementById('pay_student').value;
  const instId = document.getElementById('pay_installment').value;
  const s = financeStudents.find((x) => x.id === studentId);
  const inst = s && s.installments.find((i) => i.id === instId);
  document.getElementById('fpay_amount').value = inst ? inst.balance : '';
}

function financeSelectStudent(studentId) {
  const select = document.getElementById('pay_student');
  select.value = studentId;
  populateFinanceInstallmentOptions();
  select.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function financeRecordPaymentClick() {
  const studentId = document.getElementById('pay_student').value;
  const installmentId = document.getElementById('pay_installment').value;
  const amount = Number(document.getElementById('fpay_amount').value || 0);
  const method = document.getElementById('fpay_method').value;
  const date = document.getElementById('fpay_date').value;
  const notes = document.getElementById('fpay_notes').value.trim();
  const errEl = document.getElementById('fpay_error');
  errEl.textContent = '';
  if (!studentId) {
    errEl.textContent = 'Select a student.';
    return;
  }
  if (!installmentId) {
    errEl.textContent = 'Select a fee line (or add one).';
    return;
  }
  if (!amount || amount <= 0) {
    errEl.textContent = 'Enter an amount greater than 0.';
    return;
  }
  try {
    await db.recordPayment({ studentId, installmentId, amount, method, date, notes });
  } catch (e) {
    errEl.textContent = e.message || 'Could not record payment.';
    return;
  }
  document.getElementById('fpay_amount').value = '';
  document.getElementById('fpay_notes').value = '';
  await renderFinancePage();
  document.getElementById('pay_student').value = studentId;
  populateFinanceInstallmentOptions();
}

async function financeAddFeeLineClick() {
  const studentId = document.getElementById('pay_student').value;
  if (!studentId) {
    alert('Select a student first.');
    return;
  }
  const category = prompt('Fee category — registration, training, test, or other:', 'other');
  if (category === null) return;
  const amountStr = prompt('Amount owed for this fee (CFA):');
  if (amountStr === null) return;
  const amount = Number(amountStr);
  if (!amount || amount <= 0) {
    alert('Enter a valid amount.');
    return;
  }
  const cat = Object.keys(FEE_CATEGORY_LABELS).includes(category.trim().toLowerCase()) ? category.trim().toLowerCase() : 'other';
  try {
    await db.addInstallmentLine(studentId, { amount, category: cat });
  } catch (e) {
    alert('Could not add fee line: ' + (e.message || e));
    return;
  }
  await renderFinancePage();
  document.getElementById('pay_student').value = studentId;
  populateFinanceInstallmentOptions();
}

async function financeVoidPaymentClick(paymentId) {
  if (!confirm('Void this payment? This cannot be undone — use it to correct a mistaken entry.')) return;
  try {
    await db.deletePayment(paymentId);
  } catch (e) {
    alert('Could not void payment: ' + (e.message || e));
    return;
  }
  await renderFinancePage();
}

async function createExpenseClick() {
  const category = document.getElementById('exp_category').value;
  const description = document.getElementById('exp_description').value.trim();
  const amount = Number(document.getElementById('exp_amount').value || 0);
  const date = document.getElementById('exp_date').value || new Date().toISOString().slice(0, 10);
  const errEl = document.getElementById('exp_error');
  errEl.textContent = '';
  if (!amount) {
    errEl.textContent = 'Enter an amount.';
    return;
  }
  try {
    await db.createExpense({ category, description, amount, date });
    document.getElementById('exp_description').value = '';
    document.getElementById('exp_amount').value = '';
    await renderFinancePage();
  } catch (e) {
    errEl.textContent = e.message || 'Could not add expense.';
  }
}

async function deleteExpenseClick(id) {
  await db.deleteExpense(id);
  await renderFinancePage();
}

// =====================================================================
// Attendance (dedicated bulk-by-class page; admin/teacher only)
// =====================================================================
async function renderAttendancePage() {
  await ensureCatalog();
  const select = document.getElementById('att_test');
  if (!select.dataset.loaded) {
    select.innerHTML = Object.keys(CATALOG)
      .map((t) => `<option value="${CATALOG[t].id}">${t}</option>`)
      .join('');
    select.dataset.loaded = '1';
  }
  if (!document.getElementById('att_date').value) {
    document.getElementById('att_date').value = new Date().toISOString().slice(0, 10);
  }
  await loadAttendanceRoster();
}

async function loadAttendanceRoster() {
  const testId = document.getElementById('att_test').value;
  const date = document.getElementById('att_date').value;
  const listEl = document.getElementById('att_roster');
  if (!testId || !date) return;
  const roster = await db.listEnrollmentsForTest(testId);
  const existing = await db.listAttendanceForDate(
    roster.map((r) => r.enrollmentId),
    date
  );
  document.getElementById('att_rosterEmpty').classList.toggle('hidden', roster.length > 0);
  listEl.innerHTML = roster
    .map((r) => {
      const present = existing[r.enrollmentId];
      return `<div class="subject-card">
        <div class="name">${r.studentName}</div>
        <div>
          <button class="btn ${present === true ? '' : 'ghost'} small" onclick="markRosterAttendance('${r.enrollmentId}', true)">Present</button>
          <button class="btn ${present === false ? 'red' : 'ghost'} small" onclick="markRosterAttendance('${r.enrollmentId}', false)">Absent</button>
        </div>
      </div>`;
    })
    .join('');
}

async function markRosterAttendance(enrollmentId, present) {
  const date = document.getElementById('att_date').value;
  try {
    await db.recordAttendance(enrollmentId, date, present);
  } catch (e) {
    alert('Could not record attendance: ' + (e.message || e));
    return;
  }
  await loadAttendanceRoster();
}

// =====================================================================
// Parents directory (Admin/Teacher only) — derived from guardian info
// already captured at student registration; no separate table needed.
// =====================================================================
async function renderParentsPage() {
  const students = await db.loadAllStudents();
  const map = new Map();
  students.forEach((s) => {
    if (!s.guardian.email) return;
    const key = s.guardian.email.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { name: s.guardian.name, relationship: s.guardian.relationship, phone: s.guardian.phone, email: s.guardian.email, children: [] });
    }
    map.get(key).children.push(s.fullName);
  });
  const guardians = Array.from(map.values());
  const tbody = document.querySelector('#parentsTable tbody');
  document.getElementById('parentsEmpty').classList.toggle('hidden', guardians.length > 0);
  tbody.innerHTML = guardians
    .map(
      (g) => `<tr>
        <td>${g.name || '—'}</td>
        <td>${g.relationship || '—'}</td>
        <td>${g.phone || '—'}</td>
        <td><a href="mailto:${g.email}">${g.email}</a></td>
        <td>${g.children.join(', ')}</td>
      </tr>`
    )
    .join('');
}

// =====================================================================
// Messaging (shared page + logic across all four portals)
// =====================================================================
let messageContacts = [];
let activeContactId = null;

async function renderMessagesPage() {
  const listEl = document.getElementById('msg_contacts');
  try {
    const [contacts, unread] = await Promise.all([db.listMessageContacts(), db.listUnreadCounts(currentSession.userId)]);
    messageContacts = contacts;
    document.getElementById('msg_contactsEmpty').textContent = 'No one to message yet — contacts appear here once a teacher, parent, or student has logged in at least once.';
    document.getElementById('msg_contactsEmpty').classList.toggle('hidden', contacts.length > 0);
    listEl.innerHTML = contacts
      .map(
        (c) => `<div class="subject-card row-clickable ${c.userId === activeContactId ? 'contact-active' : ''}" onclick="openConversation('${c.userId}')">
          <div>
            <div class="name">${c.name} <span class="badge neutral">${c.role}</span></div>
            <div class="stats">${c.email}</div>
          </div>
          ${unread[c.userId] ? `<span class="badge unpaid">${unread[c.userId]} new</span>` : ''}
        </div>`
      )
      .join('');
  } catch (e) {
    console.error('renderMessagesPage failed:', e);
    showPageError('msg_contacts', 'msg_contactsEmpty', e);
  }
}

async function openConversation(otherUserId) {
  activeContactId = otherUserId;
  const errEl = document.getElementById('msg_error');
  if (errEl) errEl.textContent = '';
  try {
    await db.markThreadRead(currentSession.userId, otherUserId);
    await renderConversation();
    await renderMessagesPage();
  } catch (e) {
    console.error('openConversation failed:', e);
    if (errEl) errEl.textContent = 'Could not open this conversation: ' + (e.message || e);
  }
}

async function renderConversation() {
  const contact = messageContacts.find((c) => c.userId === activeContactId);
  document.getElementById('msg_activeContactName').textContent = contact ? contact.name : 'Select a contact to start messaging';
  document.getElementById('msg_composeBar').style.display = activeContactId ? 'flex' : 'none';
  if (!activeContactId) {
    document.getElementById('msg_thread').innerHTML = '';
    return;
  }
  const msgs = await db.listConversation(currentSession.userId, activeContactId);
  const body = msgs
    .map((m) => {
      const mine = m.sender_id === currentSession.userId;
      return `<div style="margin-bottom:10px;text-align:${mine ? 'right' : 'left'};">
        <div style="display:inline-block;max-width:70%;padding:8px 12px;border-radius:10px;background:${
          mine ? 'var(--navy)' : 'var(--bg)'
        };color:${mine ? '#fff' : 'inherit'};text-align:left;">${m.body}</div>
        <div class="muted" style="font-size:11px;margin-top:2px;">${new Date(m.created_at).toLocaleString()}</div>
      </div>`;
    })
    .join('');
  document.getElementById('msg_thread').innerHTML = body || '<p class="muted">No messages yet. Say hello.</p>';
  const thread = document.getElementById('msg_thread');
  thread.scrollTop = thread.scrollHeight;
}

async function sendMessageClick() {
  const textEl = document.getElementById('msg_composeText');
  const text = textEl.value.trim();
  const errEl = document.getElementById('msg_error');
  if (errEl) errEl.textContent = '';
  if (!text || !activeContactId) return;
  try {
    await db.sendMessage(activeContactId, text);
    textEl.value = '';
    await renderConversation();
  } catch (e) {
    console.error('sendMessageClick failed:', e);
    if (errEl) errEl.textContent = 'Could not send: ' + (e.message || e);
  }
}

// =====================================================================
// Startup — restore session (if any) and show the right screen
// =====================================================================
async function initApp() {
  currentSession = await db.getCurrentSessionInfo();

  if (currentSession && currentSession.role === 'student') {
    const students = await db.loadAllStudents();
    currentStudentRecord = students[0] || null;
  }

  if (currentSession && currentSession.role === 'admin') await showAdminDashboard();
  else if (currentSession && currentSession.role === 'teacher') await showTeacherDashboard();
  else if (currentSession && currentSession.role === 'parent') await showParentDashboard();
  else if (currentSession && currentSession.role === 'student' && currentStudentRecord) await showStudentDashboardView();
  else showAuthScreen('admin');
}

initApp();

// Expose functions referenced by inline HTML event handlers (onclick=, onchange=, etc.)
// to the global scope, since this file is loaded as an ES module and top-level
// declarations are module-scoped rather than attached to `window` automatically.
Object.assign(window, {
  setRole,
  showTab,
  sidebarNavTo,
  goHome,
  openChangePassword,
  changePasswordClick,
  updateMyNameClick,
  adminLogin,
  adminLogout,
  teacherCheckEmail,
  teacherBackToEmail,
  teacherSubmitPassword,
  teacherLogout,
  parentCheckEmail,
  parentBackToEmail,
  parentSubmitPassword,
  parentLogout,
  addTeacherInvite,
  revokeTeacherInvite,
  toggleAllAssignTargets,
  createAssignment,
  deleteAssignment,
  createAnnouncementClick,
  deleteAnnouncementClick,
  createCalendarEventClick,
  deleteCalendarEventClick,
  createTimetableEntryClick,
  deleteTimetableEntryClick,
  loadAttendanceRoster,
  markRosterAttendance,
  renderParentsPage,
  renderTeachersPage,
  sidebarClickById,
  renderMyCoursesPage,
  renderMyAttendance,
  renderMyGrades,
  renderMyAssignments,
  renderMyProgress,
  editTeacherClick,
  cancelTeacherEdit,
  saveTeacherEdit,
  renderMessagesPage,
  renderAnnouncementsPage,
  renderCalendarPage,
  renderTimetablePage,
  renderAttendancePage,
  openConversation,
  sendMessageClick,
  handlePhoto,
  addProgramRow,
  onProgramChange,
  recalcTotals,
  addInstallmentRow,
  recalcInstallments,
  submitRegistration,
  resetRegistrationForm,
  openInvoiceById,
  openStudentDetail,
  graduateEnrollmentClick,
  ungraduateEnrollmentClick,
  openStudentProfile,
  closeStudentProfile,
  deleteCurrentProfileStudent,
  studentProfileNav,
  openCurrentProfileInvoice,
  openCurrentProfileProgressReport,
  openCurrentProfileCertificate,
  openGradebook,
  addGradeClick,
  updateGradeScoreUI,
  updateGradeTierPreview,
  deleteGradeClick,
  startPlacementTest,
  selectPlacementAnswer,
  submitPlacementTest,
  closePlacementTest,
  openPlacementResults,
  closeDoc,
  openPayments,
  editInstallmentClick,
  cancelInstallmentEdit,
  saveInstallmentEdit,
  recordPaymentClick,
  cancelRecordPayment,
  saveRecordPayment,
  toggleInstallmentHistory,
  voidPaymentClick,
  addFeeLineClick,
  createExpenseClick,
  deleteExpenseClick,
  onFinancePayStudentChange,
  onFinanceInstallmentChange,
  financeSelectStudent,
  financeRecordPaymentClick,
  financeAddFeeLineClick,
  financeVoidPaymentClick,
  viewReceipt,
  openStudentProgress,
  openAttendance,
  recordAttendance,
  openProgressReport,
  openCertificateForm,
  issueCertificate,
  openSpeakingSubmissions,
  gradeSpeakingSubmissionClick,
  studentCheckEmail,
  studentBackToEmail,
  studentSubmitPassword,
  studentLogout,
  submitMyAssignment,
  selectAnswer,
  closeSession,
  startSession,
  startListeningSession,
  submitSession,
  speakStartRecording,
  speakStopRecording,
  speakSubmitRecording,
  qbOnTestChange,
  qbLoadList,
  qbLoadCsvFile,
  qbAddQuestion,
  qbDeleteQuestion,
  qbBulkImport,
  qbLoadPassages,
  qbAddPassage,
  qbDeletePassage,
  qbAddListeningQuestion,
  qbAddPrompt,
  qbDeletePrompt,
});
