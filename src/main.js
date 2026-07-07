import * as db from './db.js';

let CATALOG = {};
let currentPortal = 'admin';
let currentSession = null; // { userId, email, role }
let currentStudentRecord = null;
let currentPhotoFile = null;
let loginMode = null; // 'signup' | 'signin'
let pendingLoginEmail = null;

// =====================================================================
// Portal switching (Admin console vs Student portal), gated by real auth
// =====================================================================
async function setRole(portal) {
  currentPortal = portal;
  document.getElementById('btnAdminRole').classList.toggle('active', portal === 'admin');
  document.getElementById('btnStudentRole').classList.toggle('active', portal === 'student');
  document.getElementById('adminView').classList.toggle('hidden', portal !== 'admin');
  document.getElementById('studentView').classList.toggle('hidden', portal !== 'student');

  if (portal === 'admin') {
    if (currentSession && currentSession.role === 'admin') await showAdminDashboard();
    else showAdminLogin();
  } else {
    if (currentStudentRecord) await showStudentDashboardView();
    else showStudentLoginStep1();
  }
}

async function ensureCatalog() {
  if (!CATALOG || Object.keys(CATALOG).length === 0) CATALOG = await db.loadCatalog();
}

function showAdminLogin() {
  document.getElementById('adminDashboard').classList.add('hidden');
  document.getElementById('adminLoginCard').classList.remove('hidden');
}

async function showAdminDashboard() {
  document.getElementById('adminLoginCard').classList.add('hidden');
  document.getElementById('adminDashboard').classList.remove('hidden');
  document.getElementById('adminEmailDisplay').textContent = currentSession.email;
  await ensureCatalog();
  resetRegistrationForm();
  renderStudentsTable();
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

function showTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.getElementById('tab-register').classList.toggle('hidden', name !== 'register');
  document.getElementById('tab-manage').classList.toggle('hidden', name !== 'manage');
  document.getElementById('tab-qb').classList.toggle('hidden', name !== 'qb');
  if (name === 'manage') renderStudentsTable();
  if (name === 'qb') qbInit();
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
      dueDate: row.querySelector('.i-due').value || null,
    });
  });
  const total = programs.reduce((s, p) => s + p.price, 0);
  if (installments.length === 0) {
    installments.push({ amount: total, dueDate: null });
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
  const paid = student.installments.filter((i) => i.paid).reduce((s, i) => s + i.amount, 0);
  return student.total - paid;
}

function statusOf(student) {
  const bal = balanceOf(student);
  if (bal <= 0) return 'paid';
  if (bal < student.total) return 'partial';
  return 'unpaid';
}

async function renderStudentsTable() {
  const students = await db.loadAllStudents();
  const tbody = document.querySelector('#studentsTable tbody');
  tbody.innerHTML = '';
  document.getElementById('studentsEmpty').classList.toggle('hidden', students.length > 0);
  students.forEach((s) => {
    const bal = balanceOf(s);
    const status = statusOf(s);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${s.fullName}</td>
      <td>${s.programs.map((p) => p.test).join(', ')}</td>
      <td>${s.invoiceNumber}</td>
      <td>${s.total.toLocaleString()} CFA</td>
      <td>${bal.toLocaleString()} CFA</td>
      <td><span class="badge ${status}">${status}</span></td>
      <td>
        <button class="btn ghost small" onclick="openInvoiceById('${s.id}')">Invoice</button>
        <button class="btn ghost small" onclick="openPayments('${s.id}')">Payments</button>
        <button class="btn ghost small" onclick="openAttendance('${s.id}')">Attendance</button>
        <button class="btn ghost small" onclick="openProgressReport('${s.id}')">Report</button>
        <button class="btn ghost small" onclick="openCertificateForm('${s.id}')">Certificate</button>
        <button class="btn ghost small" onclick="openSpeakingSubmissions('${s.id}')">Speaking</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function openInvoiceById(id) {
  const students = await db.loadAllStudents();
  const s = students.find((x) => x.id === id);
  if (s) openInvoice(s);
}

function openInvoice(student) {
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
    <div style="display:flex;justify-content:space-between;border-bottom:3px solid #1a2b6b;padding-bottom:16px;margin-bottom:20px;">
      <div style="font-size:22px;font-weight:bold;color:#1a2b6b;">WAAPC Training Centre</div>
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
    <div style="margin-top:20px;font-size:11px;color:#666;text-align:center;border-top:1px solid #e0e4ec;padding-top:10px;">
      Send proof of payment to admissions@waapcamericanschools.com — include student name and invoice number.
    </div>
  `;
  document.getElementById('docContent').innerHTML = html;
  document.getElementById('docOverlay').classList.add('show');
}

async function openPayments(id) {
  const students = await db.loadAllStudents();
  const s = students.find((x) => x.id === id);
  if (!s) return;
  const rows = s.installments
    .map(
      (inst, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${inst.amount.toLocaleString()} CFA</td>
      <td>${inst.dueDate || '—'}</td>
      <td><span class="badge ${inst.paid ? 'paid' : 'unpaid'}">${inst.paid ? 'Paid' : 'Unpaid'}</span></td>
      <td>${inst.paid ? `<button class="btn ghost small" onclick="viewReceipt('${s.id}','${inst.id}')">Receipt</button>` : `<button class="btn small" onclick="markPaid('${s.id}','${inst.id}')">Mark paid</button>`}</td>
    </tr>`
    )
    .join('');
  const html = `
    <h3 style="color:#1a2b6b;">${s.fullName} — Payment schedule</h3>
    <p class="muted">Total ${s.total.toLocaleString()} CFA · Balance ${balanceOf(s).toLocaleString()} CFA</p>
    <table><thead><tr><th>#</th><th>Amount</th><th>Due date</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table>
  `;
  document.getElementById('docContent').innerHTML = html;
  document.getElementById('docOverlay').classList.add('show');
}

async function markPaid(studentId, installmentId) {
  const method = prompt('Payment method (Bank Transfer / Cheque / Wave / Cash):', 'Cash');
  if (method === null) return;
  try {
    await db.markInstallmentPaid(installmentId, method);
  } catch (e) {
    alert('Could not record payment: ' + (e.message || e));
    return;
  }
  await openPayments(studentId);
  renderStudentsTable();
}

async function viewReceipt(studentId, installmentId) {
  const students = await db.loadAllStudents();
  const s = students.find((x) => x.id === studentId);
  const inst = s.installments.find((i) => i.id === installmentId);
  const html = `
    <div style="display:flex;justify-content:space-between;border-bottom:3px solid #1a2b6b;padding-bottom:16px;margin-bottom:20px;">
      <div style="font-size:22px;font-weight:bold;color:#1a2b6b;">WAAPC Training Centre</div>
      <div style="text-align:right;"><div style="font-size:32px;font-weight:bold;color:#1a2b6b;">RECEIPT</div></div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:20px;">
      <div><div style="font-size:11px;font-weight:bold;">RECEIVED FROM</div>
        <div style="font-size:18px;font-weight:bold;color:#1a2b6b;">${s.fullName}</div></div>
      <div style="text-align:right;font-size:13px;">
        <div><b>Receipt No.</b> ${inst.receiptNumber}</div>
        <div><b>Date</b> ${inst.paidDate}</div>
        <div><b>Invoice Ref.</b> ${s.invoiceNumber}</div>
      </div>
    </div>
    <div style="background:#1a2b6b;color:#fff;display:flex;justify-content:space-between;padding:14px 18px;font-weight:bold;font-size:16px;margin-bottom:16px;">
      <span>AMOUNT RECEIVED</span><span style="background:#b81f2c;padding:5px 12px;">${inst.amount.toLocaleString()} CFA</span>
    </div>
    <p><b>Payment method:</b> ${inst.method || '—'}</p>
    <p style="margin-top:24px;font-size:11px;color:#666;text-align:center;border-top:1px solid #e0e4ec;padding-top:10px;">
      Thank you for choosing WAAPC Training Centre.
    </p>
  `;
  document.getElementById('docContent').innerHTML = html;
  document.getElementById('docOverlay').classList.add('show');
}

function closeDoc() {
  document.getElementById('docOverlay').classList.remove('show');
}

// =====================================================================
// Attendance
// =====================================================================
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
  document.getElementById('docContent').innerHTML = html;
  document.getElementById('docOverlay').classList.add('show');
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
  const students = await db.loadAllStudents();
  const s = students.find((x) => x.id === studentId);
  if (!s) return;
  s.attempts = s.attempts || [];
  s.attendance = s.attendance || [];

  const programBlocks = s.programs
    .map((p) => {
      const subjects = (CATALOG[p.test] && CATALOG[p.test].subjects.map((x) => x.name)) || [];
      const att = attendanceStatsFor(s, p.id);
      const subjectRows = subjects
        .map((sub) => {
          const mockAttempts = s.attempts.filter((a) => a.test === p.test && a.subject === sub && a.mode === 'mock');
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
      return `
      <div style="margin-bottom:18px;">
        <div style="font-weight:bold;color:#1a2b6b;font-size:14px;margin-bottom:6px;">${p.test} <span class="muted">(${p.level})</span></div>
        <p class="muted" style="margin:0 0 8px 0;">Attendance: ${att.total > 0 ? att.present + ' / ' + att.total + ' sessions (' + att.pct + '%)' : 'No sessions recorded yet'}</p>
        <table><thead><tr><th>Subject</th><th>Mock attempts</th><th>Best score</th><th>Latest attempt</th></tr></thead><tbody>${subjectRows}</tbody></table>
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
  const html = `
    <div style="border:6px double #1a2b6b;padding:40px;text-align:center;">
      <div style="font-size:14px;letter-spacing:2px;color:#b81f2c;font-weight:bold;">WAAPC TRAINING CENTRE</div>
      <div style="font-size:28px;font-weight:bold;color:#1a2b6b;margin:14px 0;">Certificate of Completion</div>
      <p style="font-size:13px;color:#555;">This certifies that</p>
      <div style="font-size:24px;font-weight:bold;color:#1a2b6b;margin:10px 0;">${student.fullName}</div>
      <p style="font-size:13px;color:#555;">has successfully completed the</p>
      <div style="font-size:18px;font-weight:bold;color:#b81f2c;margin:8px 0;">${program.test} Preparation Program</div>
      <p style="font-size:13px;color:#555;margin-top:16px;">
        ${cert.attendancePct !== null ? 'Attendance: ' + cert.attendancePct + '% &nbsp; | &nbsp; ' : ''}
        ${pct !== null ? 'Final mock assessment: ' + cert.finalScore + '/' + cert.finalTotal + ' (' + pct + '%)' : ''}
      </p>
      <div style="display:flex;justify-content:space-between;margin-top:40px;font-size:12px;color:#666;">
        <div>Certificate No. ${cert.certNumber}</div>
        <div>Issued ${cert.issuedDate}</div>
      </div>
    </div>
  `;
  document.getElementById('docContent').innerHTML = html;
  document.getElementById('docOverlay').classList.add('show');
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
        ${!s.reviewed ? `<button class="btn ghost small" onclick="markSpeakingReviewed('${studentId}','${s.id}')">Mark reviewed</button>` : ''}
      </p>
    </div>`
    )
    .join('');

  const html = `
    <h3 style="color:#1a2b6b;">Speaking submissions</h3>
    ${rows || '<p class="muted">No speaking submissions yet.</p>'}
  `;
  document.getElementById('docContent').innerHTML = html;
  document.getElementById('docOverlay').classList.add('show');
}

async function markSpeakingReviewed(studentId, submissionId) {
  try {
    await db.markSpeakingReviewed(submissionId);
  } catch (e) {
    alert('Could not update: ' + (e.message || e));
    return;
  }
  openSpeakingSubmissions(studentId);
}

// =====================================================================
// Student portal — login (first-login sets password, or normal sign-in)
// =====================================================================
function showStudentLoginStep1() {
  document.getElementById('dashboardCard').classList.add('hidden');
  document.getElementById('loginCard').classList.remove('hidden');
  document.getElementById('loginStep1').classList.remove('hidden');
  document.getElementById('loginStep2').classList.add('hidden');
  document.getElementById('loginError').textContent = '';
}

async function showStudentDashboardView() {
  document.getElementById('loginCard').classList.add('hidden');
  document.getElementById('dashboardCard').classList.remove('hidden');
  await ensureCatalog();
  renderStudentDashboard(currentStudentRecord);
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
  document.getElementById('welcomeMsg').textContent = 'Welcome, ' + s.fullName.split(' ')[0];
  const list = document.getElementById('enrollmentsList');
  list.innerHTML = s.programs
    .map((p) => {
      const subjects = (CATALOG[p.test] && CATALOG[p.test].subjects) || [];
      return `<div style="margin-bottom:16px;">
      <div style="font-weight:bold;color:#1a2b6b;font-size:15px;margin-bottom:8px;">${p.test} <span class="muted">(${p.level})</span></div>
      ${subjects
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
        .join('')}
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

async function startQuizSession(test, subject, mode) {
  const subjectId = findSubjectId(test, subject);
  const bank = subjectId ? await db.listQuestions(subjectId) : [];
  if (bank.length === 0) {
    document.getElementById('subjectArea').innerHTML = '<div class="card empty">Practice content for this subject is coming soon.</div>';
    return;
  }
  sessionState = { kind: 'quiz', test, subject, subjectId, mode, bank, answers: new Array(bank.length).fill(null), submitted: false };
  renderSession();
}

async function startListeningSession(test, subject, mode) {
  const subjectId = findSubjectId(test, subject);
  const passages = subjectId ? await db.listListeningPassages(subjectId) : [];
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
  sessionState = { kind: 'listening', test, subject, subjectId, mode, bank, passageGroups, answers: new Array(bank.length).fill(null), submitted: false };
  renderSession();
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
  const passages = subjectId ? await db.listListeningPassages(subjectId) : [];

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
  const audioFile = document.getElementById('qb_passageAudio').files[0];

  if (!audioFile) {
    alert('Choose an audio file first.');
    return;
  }

  try {
    await db.addListeningPassage(subjectId, { title, audioFile });
  } catch (e) {
    alert('Could not add passage: ' + (e.message || e));
    return;
  }

  document.getElementById('qb_passageTitle').value = '';
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
// Startup — restore session (if any) and show the right screen
// =====================================================================
async function initApp() {
  currentSession = await db.getCurrentSessionInfo();

  if (currentSession && currentSession.role === 'student') {
    const students = await db.loadAllStudents();
    currentStudentRecord = students[0] || null;
  }

  await setRole(currentSession && currentSession.role === 'student' ? 'student' : 'admin');
}

initApp();

// Expose functions referenced by inline HTML event handlers (onclick=, onchange=, etc.)
// to the global scope, since this file is loaded as an ES module and top-level
// declarations are module-scoped rather than attached to `window` automatically.
Object.assign(window, {
  setRole,
  showTab,
  adminLogin,
  adminLogout,
  handlePhoto,
  addProgramRow,
  onProgramChange,
  recalcTotals,
  addInstallmentRow,
  recalcInstallments,
  submitRegistration,
  resetRegistrationForm,
  openInvoiceById,
  closeDoc,
  openPayments,
  markPaid,
  viewReceipt,
  openAttendance,
  recordAttendance,
  openProgressReport,
  openCertificateForm,
  issueCertificate,
  openSpeakingSubmissions,
  markSpeakingReviewed,
  studentCheckEmail,
  studentBackToEmail,
  studentSubmitPassword,
  studentLogout,
  selectAnswer,
  closeSession,
  startSession,
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
  qbAddPassage,
  qbDeletePassage,
  qbAddListeningQuestion,
  qbAddPrompt,
  qbDeletePrompt,
});
