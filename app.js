'use strict';
/* School & Training Progress Tracker — frontend (plain JavaScript, no build step) */

const CFG = window.APP_CONFIG || {};
const S = {
  token: null, user: null, loaded: false,
  schools: [], params: [], students: [], users: [], courses: [], leaves: [], absences: [],
  photos: {}, thumbs: {}, charts: [], view: null,
  filter: { q: '', course: '', gender: '', status: 'active' },
  tiles: { q: '', course: '', gender: '' },
  batch: { course: '', gender: '', sel: '', date: '' },
  att: { course: '', gender: '', date: '' },
  period: '12w',
  growth: { group: 'month', cat: 'Overall', course: '', gender: '', pid: '' }
};
const app = document.getElementById('app');
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
};
const LOADING = '<div class="loading">Loading…</div>';

/* ---------------- API ---------------- */
const apiUrl = () => CFG.API_URL || '';
store.set('st_api', null); // old versions let users type a server address; it now always comes from config.js

async function api(action, data = {}) {
  const url = apiUrl();
  if (!url) throw new Error('Server URL is not set in config.js.');
  let res, j;
  net(1);
  try {
    try {
      // text/plain body = no CORS preflight, which Apps Script cannot answer
      res = await fetch(url, { method: 'POST', body: JSON.stringify({ action, data, token: S.token }) });
    } catch (e) { throw new Error('Cannot reach server. Check your internet connection.'); }
    try { j = await res.json(); } catch (e) { throw new Error('Unexpected server response. Check the Server URL.'); }
  } finally { net(-1); }
  if (!j.ok) {
    if (/session expired/i.test(j.error)) logout(true);
    throw new Error(j.error);
  }
  return j.data;
}

let inflight = 0;
function net(d) { inflight = Math.max(0, inflight + d); const b = $('#netbar'); if (b) b.hidden = inflight === 0; }

/* ---------------- local cache: screens show saved data at once, then update ---------------- */
const CACHE_PREFIX = 'st_c_';
const mem = {};
const cKey = k => CACHE_PREFIX + (S.user ? S.user.id : '') + '_' + k;
function cacheGet(k) {
  if (k in mem) return mem[k];
  try { const v = localStorage.getItem(cKey(k)); if (v) return (mem[k] = JSON.parse(v)); } catch (e) { /* ignore */ }
  return undefined;
}
function cacheSet(k, v) {
  mem[k] = v;
  const s = JSON.stringify(v);
  try { localStorage.setItem(cKey(k), s); }
  catch (e) { clearCache('rec_'); try { localStorage.setItem(cKey(k), s); } catch (e2) { /* storage full: memory only */ } }
}
function cacheDrop(k) { delete mem[k]; try { localStorage.removeItem(cKey(k)); } catch (e) { /* ignore */ } }
function clearCache(prefix = '') {
  Object.keys(mem).forEach(k => { if (k.startsWith(prefix)) delete mem[k]; });
  try {
    Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX) && (!prefix || k.includes('_' + prefix)))
      .forEach(k => localStorage.removeItem(k));
  } catch (e) { /* ignore */ }
}
/** Render cached data immediately (if any), fetch fresh in the background, re-render only if it changed. */
async function swr(key, action, data, render) {
  const cached = cacheGet(key);
  if (cached !== undefined) render(cached, true);
  let fresh;
  try { fresh = await api(action, data); }
  catch (e) {
    if (cached !== undefined) { if (S.token) toast('Could not refresh (showing saved data): ' + e.message, true); return; }
    throw e;
  }
  cacheSet(key, fresh);
  if (cached === undefined || JSON.stringify(cached) !== JSON.stringify(fresh)) render(fresh, false);
}
/** After a save, update the cached records of a student right away (server copy follows). */
function applyLocalRecords(items) {
  const now = new Date().toISOString();
  items.forEach(it => {
    const key = 'rec_' + it.student_id, recs = cacheGet(key);
    if (!recs) return;
    const i = recs.findIndex(r => r.parameter_id === it.parameter_id && r.date === it.date);
    const value = (it.value || '').trim(), remarks = (it.remarks || '').trim();
    if (!value && !remarks) { if (i >= 0) recs.splice(i, 1); }
    else if (i >= 0) Object.assign(recs[i], { value, remarks, entered_by: S.user.id, updated_at: now });
    else recs.push({ id: 'new_' + Math.random().toString(36).slice(2), student_id: it.student_id, parameter_id: it.parameter_id,
      date: it.date, value, remarks, entered_by: S.user.id, created_at: now, updated_at: now });
    cacheSet(key, recs);
  });
  cacheDrop('dash');
}
function saveBoot() {
  if (S.loaded) cacheSet('boot', { me: S.user, schools: S.schools, parameters: S.params, students: S.students, users: S.users,
    courses: S.courses, leaves: S.leaves, absences: S.absences });
}

/* ---------------- helpers ---------------- */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function today() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
function addDays(s, n) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
function fmtDate(s) { if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || ''; const [y, m, d] = s.split('-'); return `${+d} ${MONTHS[+m - 1]} ${y}`; }
function shortDate(s) { const [, m, d] = s.split('-'); return `${+d} ${MONTHS[+m - 1]}`; }
function fmtNum(n) { return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100); }
function initials(name) { return esc(String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')); }

const studentOf = id => S.students.find(s => s.id === id);
const paramOf = id => S.params.find(p => p.id === id);
const userName = id => (S.users.find(u => u.id === id) || {}).name || '—';
const byOrder = (a, b) => (+a.sort_order || 0) - (+b.sort_order || 0) || a.name.localeCompare(b.name);
const byName = (a, b) => a.name.localeCompare(b.name);
const activeParams = cat => S.params.filter(p => p.active === '1' && (!cat || p.category === cat)).sort(byOrder);
const gradeOpts = p => String(p.options || '').split(',').map(x => x.trim()).filter(Boolean);
const schoolName = () => (S.schools.find(s => s.active === '1') || S.schools[0] || {}).name || CFG.APP_NAME || '';

/* Roles: admin = Super Admin, manager = admissions/courses/leave, teacher = progress for mapped subjects */
const ROLE_LABEL = { admin: 'Super Admin', manager: 'Manager', teacher: 'Teacher' };
const role = () => (S.user ? S.user.role : '');
const isAdmin = () => role() === 'admin';
const canAdmit = () => role() === 'admin' || role() === 'manager';
const canEnter = () => role() === 'admin' || role() === 'teacher';
const subjectIds = u => String((u && u.subjects) || '').split(',').filter(Boolean);
/** Parameters the logged-in user may enter values for. */
const myParams = cat => isAdmin() ? activeParams(cat)
  : role() === 'teacher' ? activeParams(cat).filter(p => subjectIds(S.user).includes(p.id)) : [];
const canEditParam = pid => isAdmin() || (role() === 'teacher' && subjectIds(S.user).includes(pid));
const teachersOf = pid => S.users.filter(u => u.role === 'teacher' && u.active === '1' && subjectIds(u).includes(pid));

const CATS = ['Subject', 'Physical'];
const CAT_LABEL = { Subject: '📘 Academics', Physical: '🏃 Physical training' };
const CAT_NAME = { Subject: 'Academics', Physical: 'Physical' };
const courseOf = id => S.courses.find(c => c.id === id);
const courseName = id => (courseOf(id) || {}).name || '';
const activeCourses = () => S.courses.filter(c => c.active === '1').sort(byName);
const leaveOn = (sid, date) => S.leaves.find(l => l.student_id === sid && l.from_date <= date && l.to_date >= date);
const leaveTag = (s, date = today()) => leaveOn(s.id, date) ? '<span class="tag leave">On leave</span>'
  : absentOn(s.id, date) ? '<span class="tag absent">Absent</span>' : '';
const absentOn = (sid, date) => S.absences.find(a => a.student_id === sid && a.date === date);
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayName = d => DAYS[new Date(d + 'T00:00:00Z').getUTCDay()];
const courseIds = s => String((s && s.course_id) || '').split(',').filter(id => courseOf(id));
const inCourse = (s, cid) => String((s && s.course_id) || '').split(',').includes(cid);
const coursesText = s => courseIds(s).map(courseName).join(', ');
const studentLine = s => [coursesText(s), s.batch].filter(Boolean).join(' · ');

function avatarHtml(s, big) {
  const ph = S.photos[s.id] || S.thumbs[s.id];
  return `<div class="avatar${big ? ' big' : ''}">${ph ? `<img src="${ph}" alt="">` : initials(s.name)}</div>`;
}

/** All small photos in one request (cached on the phone), then redraw. */
function loadThumbs(redraw) {
  return swr('thumbs', 'getThumbs', {}, t => { S.thumbs = t || {}; redraw(); }).catch(() => {});
}

/* Male / Female filter, used on every list */
const GENDERS = [['', 'All'], ['Male', 'Male'], ['Female', 'Female']];
function genderTabs(cur) {
  return `<div class="tabs gtabs" role="group" aria-label="Gender">${GENDERS.map(([v, l]) =>
    `<button type="button" data-gv="${v}" class="${(cur || '') === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
function bindGenderTabs(box, onPick) {
  $$('[data-gv]', box).forEach(b => {
    b.onclick = () => { $$('[data-gv]', box).forEach(x => x.classList.toggle('on', x === b)); onPick(b.dataset.gv); };
  });
}
const genderOk = (s, g) => !g || s.gender === g;

async function getPhoto(id) {
  if (!(id in S.photos)) {
    const c = cacheGet('ph_' + id);
    if (c !== undefined) S.photos[id] = c;
    else { S.photos[id] = (await api('getPhoto', { student_id: id })).data || ''; cacheSet('ph_' + id, S.photos[id]); }
  }
  return S.photos[id];
}

function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, err ? 5000 : 2500);
}

function title(t, back) {
  $('#pageTitle').textContent = t;
  $('#backBtn').hidden = !back;
  $('#brandMark').hidden = !!back;
  $('#tbSub').textContent = CFG.APP_NAME || '';
  document.title = t + ' · ' + (CFG.APP_NAME || 'Tracker');
}

function go(hash) { if (location.hash === hash) router(); else location.hash = hash; }

async function busy(btn, fn) {
  const txt = btn.textContent; btn.disabled = true; btn.textContent = 'Please wait…';
  try { return await fn(); } catch (e) { toast(e.message, true); } finally { btn.disabled = false; btn.textContent = txt; }
}

/* ---------------- forms & modal ---------------- */
function fieldHtml(f, v) {
  v = v ?? f.default ?? '';
  const id = 'f_' + f.name;
  if (f.type === 'heading') return `<div class="full form-h">${esc(f.label)}</div>`;
  const wrap = `class="${f.full ? 'full' : ''}" data-f="${f.name}"`;
  if (f.type === 'checkbox') {
    return `<div ${wrap}><label class="check" style="margin-top:14px"><input type="checkbox" name="${f.name}" ${v === '1' ? 'checked' : ''}> ${esc(f.label)}</label></div>`;
  }
  if (f.type === 'segment') {
    const cur = f.options.some(([ov]) => String(ov) === String(v)) ? String(v) : String(f.options[0][0]);
    return `<div ${wrap}><label>${esc(f.label)}</label><div class="seg" role="radiogroup" aria-label="${esc(f.label)}">${f.options.map(([ov, ol]) =>
      `<label><input type="radio" name="${f.name}" value="${esc(ov)}" ${String(ov) === cur ? 'checked' : ''}><span>${esc(ol)}</span></label>`).join('')}</div></div>`;
  }
  if (f.type === 'multi') { // tick boxes; options: [value, label, group]
    const sel = String(v).split(',').filter(Boolean);
    let grp = null;
    return `<div class="full" data-f="${f.name}"><label>${esc(f.label)}</label>
      ${f.options.length ? `<div class="checks">${f.options.map(([ov, ol, g]) => {
        const head = g && g !== grp ? `<div class="checks-h">${esc((grp = g))}</div>` : '';
        return head + `<label class="check"><input type="checkbox" name="${f.name}" value="${esc(ov)}" ${sel.includes(ov) ? 'checked' : ''}> ${esc(ol)}</label>`;
      }).join('')}</div>` : `<div class="muted small">${esc(f.empty || 'Nothing to choose yet.')}</div>`}
      ${f.help ? `<div class="muted small">${esc(f.help)}</div>` : ''}</div>`;
  }
  let input;
  if (f.type === 'select') {
    input = `<select id="${id}" name="${f.name}" ${f.required ? 'required' : ''}>${f.options.map(([ov, ol]) =>
      `<option value="${esc(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select>`;
  } else if (f.type === 'textarea') {
    input = `<textarea id="${id}" name="${f.name}" rows="3">${esc(v)}</textarea>`;
  } else {
    input = `<input id="${id}" type="${f.type || 'text'}" name="${f.name}" value="${esc(v)}" ${f.required ? 'required' : ''}
      placeholder="${esc(f.placeholder || '')}" ${f.attrs || ''}>`;
  }
  return `<div ${wrap}><label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>${input}
    ${f.help ? `<div class="muted small">${esc(f.help)}</div>` : ''}</div>`;
}

function formValues(form, fields) {
  const out = {};
  fields.forEach(f => {
    if (f.type === 'heading') return;
    if (f.type === 'multi') { out[f.name] = $$(`input[name="${f.name}"]:checked`, form).map(x => x.value).join(','); return; }
    const el = form.elements[f.name];
    if (!el) return;
    out[f.name] = f.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value.trim();
  });
  return out;
}

function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }

function formModal({ title: t, fields, values = {}, submitText = 'Save', onSubmit, onOpen }) {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet">
    <div class="row"><h2 style="margin:0">${esc(t)}</h2><span class="spacer"></span>
      <button class="icon-btn" type="button" data-close style="color:var(--muted)" aria-label="Close">&times;</button></div>
    <form novalidate>${fields.map(f => fieldHtml(f, values[f.name])).join('')}
      <div style="margin-top:16px"><button class="btn block" type="submit">${esc(submitText)}</button></div></form></div>`;
  m.hidden = false;
  m.onclick = e => { if (e.target === m || e.target.closest('[data-close]')) closeModal(); };
  const form = $('form', m);
  form.onsubmit = async e => {
    e.preventDefault();
    const vals = formValues(form, fields);
    const missing = fields.find(f => f.required && !vals[f.name]);
    if (missing) return toast(missing.label + ' is required', true);
    await busy($('button[type=submit]', form), async () => { await onSubmit(vals); closeModal(); });
  };
  if (onOpen) onOpen(form);
}

/* ---------------- auth ---------------- */
function showChrome(on) { $('#topbar').hidden = !on; $('#bottomnav').hidden = !on; }

function renderLogin() {
  showChrome(false);
  document.title = CFG.APP_NAME || 'Progress Tracker';
  app.innerHTML = `<div class="login">
    <div class="logo"><img src="logo-wide.png" alt="${esc(CFG.APP_NAME || 'Logo')}">
      <div class="muted">Student Progress Tracker</div></div>
    <form class="card" id="loginForm">
      <label for="lu">Username</label><input id="lu" name="username" autocomplete="username" autocapitalize="none" required>
      <label for="lp">Password</label><input id="lp" name="password" type="password" autocomplete="current-password" required>
      <div style="margin-top:16px"><button class="btn block" type="submit">Log in</button></div>
    </form></div>`;
  $('#loginForm').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    await busy($('button', f), async () => {
      const r = await api('login', { username: f.username.value.trim(), password: f.password.value });
      setSession(r);
      S.loaded = false;
      go('#/home');
    });
  };
}

function setSession(r) {
  S.token = r.token; S.user = r.user;
  store.set('st_token', r.token); store.set('st_user', JSON.stringify(r.user));
}

function logout(expired) {
  clearCache();
  S.token = null; S.user = null; S.loaded = false; S.photos = {};
  store.set('st_token', null); store.set('st_user', null);
  closeModal();
  renderLogin();
  if (expired) toast('Session expired. Please log in again.', true);
}

async function loadAll(withDashboard) {
  const d = await api('bootstrap', { with_dashboard: !!withDashboard });
  if (d.dashboard) cacheSet('dash', d.dashboard);
  delete d.dashboard;
  applyBoot(d);
  saveBoot();
}

function applyBoot(d) {
  S.user = d.me; store.set('st_user', JSON.stringify(d.me));
  S.schools = d.schools; S.students = d.students; S.users = d.users;
  S.params = d.parameters.map(p => (p.category === 'Study' ? Object.assign({}, p, { category: 'Subject' }) : p));
  S.courses = d.courses || []; S.leaves = d.leaves || []; S.absences = d.absences || [];
  S.loaded = true;
  $('#whoAmI').innerHTML = `<span class="uc-text"><b>${esc(S.user.name)}</b><small>${ROLE_LABEL[S.user.role] || ''}</small></span>
    <span class="uc-av">${initials(S.user.name)}</span>`;
  // third tab: Entry for super admin / teachers, Leave for the manager
  $('#navStudents').innerHTML = role() === 'manager' ? '<span>&#9786;</span>Students' : '<span>&#128200;</span>Insights';
  const tab = $('#navThird');
  if (canEnter()) { tab.href = '#/batch'; tab.dataset.nav = 'batch'; tab.innerHTML = '<span>&#9998;</span>Entry'; }
  else { tab.href = '#/attendance'; tab.dataset.nav = 'attendance'; tab.innerHTML = '<span>&#9745;</span>Attendance'; }
}

/* ---------------- router ---------------- */
let routeSeq = 0;
const VIEW_ROLES = {
  params: ['admin'], users: ['admin'], teachers: ['admin'],
  'student-edit': ['admin', 'manager'], courses: ['admin', 'manager'], leaves: ['admin', 'manager'], attendance: ['admin', 'manager'],
  entry: ['admin', 'teacher'], batch: ['admin', 'teacher']
};

async function router() {
  const seq = ++routeSeq;
  S.charts.forEach(c => { try { c.destroy(); } catch (e) { /* already gone */ } }); S.charts = []; S.view = null;
  closeModal();
  if (!S.token) return renderLogin();
  const parts = (location.hash || '#/home').replace(/^#\/?/, '').split('/');
  const name = parts[0] || 'home';
  showChrome(true);
  try {
    if (!S.loaded) {
      const boot = cacheGet('boot');
      if (boot) {
        applyBoot(boot);
        loadAll(false).then(() => { // quietly refresh lists in the background
          if (seq === routeSeq && name === 'students' && $('#modal').hidden) router();
        }).catch(() => {});
      } else { app.innerHTML = LOADING; await loadAll(true); if (seq !== routeSeq) return; }
    } else saveBoot();
    if (VIEW_ROLES[name] && !VIEW_ROLES[name].includes(role())) return go('#/home');
    const nav = { home: 'home', students: 'students', student: 'students', 'student-edit': 'students', entry: 'batch', batch: 'batch', attendance: 'attendance' }[name] || 'more';
    $$('#bottomnav a').forEach(a => a.classList.toggle('active', a.dataset.nav === nav));
    window.scrollTo(0, 0);
    await (ROUTES[name] || viewHome)(seq, ...parts.slice(1).map(decodeURIComponent));
  } catch (e) {
    if (!S.token || seq !== routeSeq) return;
    app.innerHTML = `<div class="card empty">${esc(e.message)}<br><br><button class="btn" id="retry">Try again</button></div>`;
    $('#retry').onclick = () => { S.loaded = false; router(); };
  }
}

/* ---------------- HOME ---------------- */
const activeStudents = () => S.students.filter(s => s.status !== 'inactive');

function courseCard() {
  const act = activeStudents();
  const rows = activeCourses().map(c => [c.id, c.name, act.filter(s => inCourse(s, c.id)).length]);
  const none = act.filter(s => !courseIds(s).length).length;
  if (none) rows.push(['', 'No course', none]);
  if (!rows.length) return '';
  return `<div class="card"><h3>Students by course</h3><ul class="list">${rows.map(([id, n, c]) =>
    `<li data-course="${id}"><div class="grow">${esc(n)}</div><b>${c}</b></li>`).join('')}</ul></div>`;
}

function bindHomeLinks() {
  $$('#app [data-go]').forEach(li => { li.onclick = () => go(li.dataset.go); });
  $$('#app [data-course]').forEach(li => { li.onclick = () => { S.filter.course = li.dataset.course || '-'; go('#/students'); }; });
}

async function viewHome(seq) {
  title('Home');
  const hello = `<div class="home-logo"><img src="logo-wide.png" alt="${esc(CFG.APP_NAME || 'Logo')}"></div>
    <h2 style="margin-top:4px">Hello, ${esc(S.user.name.split(' ')[0])} <span class="tag">${esc(ROLE_LABEL[role()] || '')}</span></h2>`;

  if (role() === 'manager') { // admissions & leave only: everything comes from the already-loaded lists
    const act = activeStudents(), t = today(), month = t.slice(0, 7);
    const recent = S.students.filter(s => s.join_date).sort((a, b) => b.join_date.localeCompare(a.join_date) || byName(a, b)).slice(0, 8);
    app.innerHTML = `${hello}
      <div class="grid stats">
        <div class="stat"><div class="n">${act.length}</div><div class="l">Active students</div></div>
        <div class="stat"><div class="n">${S.students.filter(s => (s.join_date || '').startsWith(month)).length}</div><div class="l">Admissions this month</div></div>
        <div class="stat" data-go="#/attendance"><div class="n">${act.filter(s => absentOn(s.id, t)).length}</div><div class="l">Absent today</div></div>
        <div class="stat" data-go="#/attendance"><div class="n">${act.filter(s => leaveOn(s.id, t)).length}</div><div class="l">On leave today</div></div>
      </div>
      ${courseCard()}
      <div class="card"><h3>Recent admissions</h3>${recent.length ? `<ul class="list">${recent.map(s => `<li data-go="#/student/${s.id}">${avatarHtml(s)}
        <div class="grow"><div class="title">${esc(s.name)}</div><div class="muted">${esc(studentLine(s))}</div></div>
        <span class="muted small">${fmtDate(s.join_date)}</span></li>`).join('')}</ul>` : '<div class="empty">No admissions yet.</div>'}</div>`;
    bindHomeLinks();
    return;
  }

  if (role() === 'teacher') return teacherHome(seq, hello);
  const mine = myParams();
  const subjectsCard = role() === 'teacher' ? `<div class="card"><h3>My subjects</h3>${mine.length
    ? `<div class="muted small">Tap a subject to update it for every student at once.</div>
       <div class="chips">${mine.map(p => `<a class="chip" href="#/batch/${p.id}">${p.category === 'Physical' ? '🏃' : '📘'} ${esc(p.name)}</a>`).join('')}</div>`
    : '<div class="empty">No subjects are mapped to you yet. Ask the Super Admin.</div>'}</div>` : '';
  app.innerHTML = `${hello}
    ${subjectsCard}
    ${isAdmin() ? growthShell() : ''}
    <div id="hLists"></div>`;
  if (isAdmin()) bindGrowth();
  await swr('dash', 'dashboard', {}, d => { if (seq === routeSeq) renderDash(d); });
}

/* ---------------- TEACHER HOME: tap a student's photo to update their scores ---------------- */
function teacherHome(seq, hello) {
  const T = S.tiles, mine = myParams(), t = today();
  if (!mine.length) {
    app.innerHTML = hello + '<div class="card empty">No subjects are mapped to you yet. Ask the Super Admin.</div>';
    return;
  }
  app.innerHTML = `${hello}
    <div class="card"><h3>Update one subject for everyone</h3>
      <div class="chips">${mine.map(p => `<a class="chip" href="#/batch/${p.id}">${p.category === 'Physical' ? '🏃' : '📘'} ${esc(p.name)}</a>`).join('')}</div></div>
    <div class="card">
      <h3>Or tap a student to update their scores</h3>
      <input id="tq" type="search" placeholder="Search student…" value="${esc(T.q)}" aria-label="Search student">
      <div id="tg" style="margin-top:8px">${genderTabs(T.gender)}</div>
      ${activeCourses().length ? `<select id="tc" style="margin-top:8px" aria-label="Course"><option value="">All courses</option>
        ${activeCourses().map(c => `<option value="${c.id}" ${T.course === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>` : ''}
      <div class="muted small" id="tcount" style="margin:10px 0 4px"></div>
      <div class="tiles" id="tiles"></div>
    </div>`;
  let pending = null;
  const draw = () => {
    if (seq !== routeSeq || !$('#tiles')) return;
    const q = T.q.trim().toLowerCase();
    const list = activeStudents().filter(s => genderOk(s, T.gender) && (!T.course || inCourse(s, T.course)) &&
      (!q || s.name.toLowerCase().includes(q))).sort(byName);
    const done = pending ? list.filter(s => !pending.has(s.id)).length : null;
    $('#tcount').textContent = `${list.length} student${list.length === 1 ? '' : 's'}` +
      (done === null ? '' : ` · ${done} updated in the last 7 days (✓)`);
    $('#tiles').innerHTML = list.length ? list.map(s => {
      const ph = S.photos[s.id] || S.thumbs[s.id];
      const away = leaveOn(s.id, t) ? 'Leave' : absentOn(s.id, t) ? 'Absent' : '';
      const ok = pending && !pending.has(s.id);
      return `<button type="button" class="tile" data-sid="${s.id}" aria-label="Update scores for ${esc(s.name)}">
        <span class="tile-ph">${ph ? `<img src="${ph}" alt="" loading="lazy">` : `<span class="tile-in">${initials(s.name)}</span>`}
          ${ok ? '<span class="tile-ok" title="Updated this week">✓</span>' : ''}${away ? `<span class="tile-away">${away}</span>` : ''}</span>
        <span class="tile-name">${esc(s.name)}</span></button>`;
    }).join('') : '<div class="empty" style="grid-column:1/-1">No students found.</div>';
    $$('#tiles [data-sid]').forEach(b => { b.onclick = () => go('#/entry/' + b.dataset.sid); });
  };
  $('#tq').oninput = e => { T.q = e.target.value; draw(); };
  bindGenderTabs($('#tg'), g => { T.gender = g; draw(); });
  if ($('#tc')) $('#tc').onchange = e => { T.course = e.target.value; draw(); };
  draw();
  loadThumbs(draw);
  swr('dash', 'dashboard', {}, d => { pending = new Set(d.pending_student_ids); draw(); }).catch(() => {});
}

function renderDash(d) {
  if (!$('#hLists')) return;
  const t = today();
  const pending = d.pending_student_ids.map(studentOf).filter(s => s && !leaveOn(s.id, t));
  const teacher = role() === 'teacher';
  $('#hLists').innerHTML = `
    ${isAdmin() ? courseCard() : ''}
    <div class="card"><h3>Pending this week (${pending.length})${teacher ? ' <span class="muted small">for my subjects</span>' : ''}</h3>
      ${pending.length ? `<ul class="list">${pending.slice(0, 12).map(s => `<li data-go="#/entry/${s.id}">
        ${avatarHtml(s)}<div class="grow"><div class="title">${esc(s.name)}</div>
        <div class="muted">${esc(studentLine(s))}</div></div><span class="tag">Add</span></li>`).join('')}</ul>
        ${pending.length > 12 ? `<div class="muted small" style="margin-top:6px">+ ${pending.length - 12} more. Use Bulk entry to fill all at once.</div>` : ''}`
      : '<div class="empty">All students updated in the last 7 days 🎉</div>'}</div>
    <div class="card"><h3>Recent entries</h3>
      ${d.recent.length ? `<ul class="list">${d.recent.map(r => {
        const s = studentOf(r.student_id), p = paramOf(r.parameter_id);
        if (!s || !p) return '';
        return `<li data-go="#/student/${s.id}"><div class="grow"><div class="title">${esc(s.name)}</div>
          <div class="muted">${esc(p.name)}: <b>${esc(r.value)}</b> ${esc(p.unit)} · ${fmtDate(r.date)} · by ${esc(userName(r.entered_by))}</div></div></li>`;
      }).join('')}</ul>` : '<div class="empty">No entries yet.</div>'}</div>`;
  bindHomeLinks();
}

/* ---------------- GROWTH MONITOR (admin home) ---------------- */
const GROUPS = { week: 'Week', month: 'Month', year: 'Year' };
const RANGE_TEXT = { week: 'last 12 weeks', month: 'last 12 months', year: 'all years' };
const CAT_COLOR = { Subject: '#8e1b2e', Physical: '#f2a33a' };
let growthCharts = [];

function weekKey(s) {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return dt.toISOString().slice(0, 10);
}
function growthFrom(group) {
  const t = today();
  if (group === 'week') return addDays(weekKey(t), -77);
  if (group === 'month') { const [y, m] = t.split('-').map(Number); return new Date(Date.UTC(y, m - 12, 1)).toISOString().slice(0, 10); }
  return '';
}
function periodList(group, from, keys) {
  const t = today(), out = [];
  if (group === 'week') { for (let k = weekKey(from); k <= t; k = addDays(k, 7)) out.push(k); }
  else if (group === 'month') {
    let [y, m] = from.split('-').map(Number); const [ty, tm] = t.split('-').map(Number);
    while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); if (++m > 12) { m = 1; y++; } }
  } else {
    const ty = +t.slice(0, 4); let y = keys.length ? Math.min(...keys.map(Number)) : ty;
    for (; y <= ty; y++) out.push(String(y));
  }
  return out;
}
function periodLabel(group, k) {
  if (group === 'week') return shortDate(k);
  if (group === 'month') { const [y, m] = k.split('-'); return `${MONTHS[+m - 1]} ${y.slice(2)}`; }
  return k;
}
/** Growth index per period for one parameter: first period with data = 100, higher = better. */
function growthIndex(p, avgs, periods) {
  if (p.type === 'number' && p.higher_is_better === '') return null;
  const first = periods.find(k => avgs[k] && avgs[k].avg > 0);
  if (!first) return null;
  const base = avgs[first].avg, lower = p.type === 'number' && p.higher_is_better === '0';
  return periods.map(k => (avgs[k] && avgs[k].avg > 0) ? Math.round((lower ? base / avgs[k].avg : avgs[k].avg / base) * 1000) / 10 : null);
}
function categoryIndex(cat, data, periods) {
  const series = activeParams(cat).map(p => growthIndex(p, data.params[p.id] || {}, periods)).filter(Boolean);
  return periods.map((_, i) => {
    const v = series.map(s => s[i]).filter(x => x !== null);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : null;
  });
}
const lastOf = arr => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] !== null && arr[i] !== undefined) return [arr[i], i]; return [null, -1]; };
function pctText(idx) {
  if (idx === null) return '<span class="muted">no data</span>';
  const d = Math.round((idx - 100) * 10) / 10;
  return `<span class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '▲ +' : d < 0 ? '▼ ' : ''}${d}%</span>`;
}

function growthShell() {
  const G = S.growth;
  const tabs = (key, opts) => `<div class="tabs" data-gkey="${key}">${Object.entries(opts).map(([v, l]) =>
    `<button type="button" data-v="${v}" class="${G[key] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  return `<h2>📈 Growth monitor</h2>
    <div class="card">
      ${tabs('group', GROUPS)}
      ${tabs('cat', { Overall: 'Overall', Subject: '📘 Academics', Physical: '🏃 Physical' })}
      <div class="row">
        <div id="gGender" style="flex:1 1 100%">${genderTabs(G.gender)}</div>
        <select id="gs" style="flex:1;min-width:130px" aria-label="Course"><option value="">All courses</option>
          ${activeCourses().map(c => `<option value="${c.id}" ${G.course === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      </div></div>
    <div id="growth">${LOADING}</div>`;
}

function bindGrowth() {
  $$('[data-gkey]', app).forEach(t => {
    $$('button', t).forEach(b => {
      b.onclick = () => {
        S.growth[t.dataset.gkey] = b.dataset.v; if (t.dataset.gkey === 'cat') S.growth.pid = '';
        $$('button', t).forEach(x => x.classList.toggle('on', x === b)); renderGrowth();
      };
    });
  });
  $('#gs').onchange = e => { S.growth.course = e.target.value; renderGrowth(); };
  bindGenderTabs($('#gGender'), g => { S.growth.gender = g; renderGrowth(); });
  renderGrowth();
}

function lineChart(canvas, labels, datasets, yExtra = {}, tooltipLabel) {
  const c = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets: datasets.map(d => Object.assign({ tension: 0, cubicInterpolationMode: 'monotone', spanGaps: true,
      pointRadius: 3, borderWidth: 2, fill: false }, d)) },
    options: { animation: false, responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { display: datasets.length > 1, labels: { boxWidth: 12, filter: i => !i.text.startsWith('_') } },
        tooltip: { filter: i => !i.dataset.label.startsWith('_'), callbacks: tooltipLabel ? { label: tooltipLabel } : {} } },
      scales: { y: Object.assign({ ticks: { maxTicksLimit: 6 } }, yExtra), x: { ticks: { maxTicksLimit: 8, autoSkip: true } } } }
  });
  growthCharts.push(c); S.charts.push(c);
  return c;
}

let growthSeq = 0;
function destroyGrowthCharts() {
  growthCharts.forEach(c => { try { c.destroy(); } catch (e) { /* ignore */ } });
  S.charts = S.charts.filter(c => !growthCharts.includes(c)); growthCharts = [];
}

function renderGrowth() {
  const box = $('#growth'); if (!box) return;
  const mine = ++growthSeq, G = S.growth;
  const from = growthFrom(G.group);
  const key = 'growth_' + [G.group, from, G.course, G.gender].join('|');
  if (cacheGet(key) === undefined) { destroyGrowthCharts(); box.innerHTML = LOADING; }
  swr(key, 'growth', { group: G.group, from, course_id: G.course, gender: G.gender }, data => {
    if (mine === growthSeq && document.body.contains(box)) drawGrowth(box, data, from);
  }).catch(e => { if (mine === growthSeq && document.body.contains(box)) box.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; });
}

function drawGrowth(box, data, from) {
  const G = S.growth;
  destroyGrowthCharts();
  const keys = Object.keys(data.entries).sort();
  if (!keys.length) {
    box.innerHTML = `<div class="card empty">No progress data for the ${RANGE_TEXT[G.group]} for <b>${esc(G.course ? courseName(G.course) : 'all courses')}</b>${G.gender ? ' (' + esc(G.gender) + ')' : ''}.</div>`;
    return;
  }
  const periods = periodList(G.group, from || keys[0], keys);
  const labels = periods.map(k => periodLabel(G.group, k));
  const unitWord = GROUPS[G.group].toLowerCase();
  const baseline = { label: '_base', data: periods.map(() => 100), borderColor: '#b9b9b9', borderDash: [5, 5], borderWidth: 1, pointRadius: 0 };
  const idxTooltip = c => `${c.dataset.label}: ${c.parsed.y}`;
  const inScope = activeStudents().filter(s => (!G.course || inCourse(s, G.course)) && genderOk(s, G.gender)).length;
  const scopeLine = `<div class="scope-line">Showing <b>${esc(G.course ? courseName(G.course) : 'All courses')}</b> · <b>${esc(G.gender || 'Male & Female')}</b>
    · ${inScope} active student${inScope === 1 ? '' : 's'}</div>`;
  const single = keys.length === 1 && G.group !== 'week'
    ? `<div class="muted small" style="margin-top:8px">Only one ${unitWord} has data so far, so there is nothing to compare yet. Choose <b>Week</b> to see change over time.</div>` : '';
  const note = `<div class="muted small">Growth index: the first ${unitWord} with data = 100. 110 means 10% better than the start.
    Lower-is-better items (e.g. sprint time) are flipped so up is always good. Range: ${RANGE_TEXT[G.group]}.</div>`;

  if (G.cat === 'Overall') {
    const st = categoryIndex('Subject', data, periods), ph = categoryIndex('Physical', data, periods);
    const [lastEntries] = lastOf(periods.map(k => data.entries[k] ?? null));
    const lastKey = [...periods].reverse().find(k => data.entries[k]);
    box.innerHTML = `${scopeLine}
      <div class="grid stats">
        <div class="stat"><div class="l">📘 Academics growth</div><div class="n" style="font-size:22px">${pctText(lastOf(st)[0])}</div><div class="l">since start of range</div></div>
        <div class="stat"><div class="l">🏃 Physical growth</div><div class="n" style="font-size:22px">${pctText(lastOf(ph)[0])}</div><div class="l">since start of range</div></div>
        <div class="stat"><div class="n">${data.students[lastKey] || 0}</div><div class="l">Students updated (${esc(periodLabel(G.group, lastKey))})</div></div>
        <div class="stat"><div class="n">${lastEntries || 0}</div><div class="l">Values entered (${esc(periodLabel(G.group, lastKey))})</div></div>
      </div>
      <div class="chart-box big" style="margin-top:12px"><h3>Overall growth by category</h3><canvas id="gOverall"></canvas>${note}</div>
      <div class="chart-box big" style="margin-top:12px"><h3>Activity per ${unitWord}</h3><canvas id="gActivity"></canvas></div>${single}`;
    lineChart($('#gOverall'), labels, [
      { label: 'Academics', data: st, borderColor: CAT_COLOR.Subject, backgroundColor: CAT_COLOR.Subject },
      { label: 'Physical', data: ph, borderColor: CAT_COLOR.Physical, backgroundColor: CAT_COLOR.Physical }, baseline], {}, idxTooltip);
    const act = new Chart($('#gActivity'), {
      data: { labels, datasets: [
        { type: 'bar', label: 'Values entered', data: periods.map(k => data.entries[k] || 0), backgroundColor: 'rgba(142,27,46,.25)', borderColor: '#8e1b2e', borderWidth: 1, yAxisID: 'y' },
        { type: 'line', label: 'Students updated', data: periods.map(k => data.students[k] || 0), borderColor: '#f2a33a', backgroundColor: '#f2a33a', pointRadius: 3, yAxisID: 'y1' }] },
      options: { animation: false, responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { labels: { boxWidth: 12 } } },
        scales: { y: { beginAtZero: true, position: 'left', ticks: { maxTicksLimit: 5 } },
          y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false }, ticks: { maxTicksLimit: 5, precision: 0 } },
          x: { ticks: { maxTicksLimit: 8 } } } }
    });
    growthCharts.push(act); S.charts.push(act);
    return;
  }

  const cat = G.cat, params = activeParams(cat).filter(p => p.type === 'number' || p.type === 'grade');
  const withData = params.filter(p => Object.keys(data.params[p.id] || {}).some(k => periods.includes(k)));
  if (G.pid && !withData.some(p => p.id === G.pid)) G.pid = '';
  const shownParams = G.pid ? withData.filter(p => p.id === G.pid) : withData;
  const ci = categoryIndex(cat, data, periods);
  const card = (p, big) => {
    const avgs = data.params[p.id] || {};
    const series = periods.map(k => avgs[k] ? avgs[k].avg : null);
    const [last, li] = lastOf(series);
    const [prev] = lastOf(series.slice(0, li));
    let chg = '';
    if (p.type === 'number' && prev !== null) {
      const d = Math.round((last - prev) * 100) / 100;
      const good = p.higher_is_better === '' ? '' : (d === 0 ? '' : ((d > 0) === (p.higher_is_better === '1') ? 'up' : 'down'));
      chg = `<span class="${good}">${d > 0 ? '+' : ''}${fmtNum(d)}</span> vs previous ${unitWord}`;
    }
    const shown = p.type === 'grade' ? gradeOpts(p)[gradeOpts(p).length - Math.round(last)] || '' : fmtNum(last);
    const dir = p.type === 'number' ? (p.higher_is_better === '1' ? 'higher is better' : p.higher_is_better === '0' ? 'lower is better' : '') : '';
    return `<div class="chart-box${big ? ' big' : ''}"><h3>${esc(p.name)}${p.unit ? ` (${esc(p.unit)})` : ''}</h3>
      <div class="small"><b>Average ${esc(shown)}${p.type === 'number' && p.unit ? ' ' + esc(p.unit) : ''}</b> in ${esc(periodLabel(G.group, periods[li]))} ${chg ? '· ' + chg : ''}</div>
      <div class="muted small">${esc([dir, `${avgs[periods[li]].n} values`].filter(Boolean).join(' · '))}</div>
      <canvas data-gp="${p.id}"></canvas></div>`;
  };
  box.innerHTML = `${scopeLine}
    <div class="tabs" id="gPick">${[['', 'All']].concat(withData.map(p => [p.id, p.name])).map(([v, l]) =>
      `<button type="button" data-pid="${v}" class="${G.pid === v ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>
    ${!withData.length ? '<div class="card empty">No values yet for these filters.</div>' : `
    ${G.pid ? '' : `<div class="muted small" style="margin-bottom:8px">${CAT_LABEL[cat]} overall: <b>${pctText(lastOf(ci)[0])}</b> since the start of the range.
      Tap a name above to see it on its own.</div>`}
    <div class="charts${G.pid ? ' one' : ''}">${shownParams.map(p => card(p, !!G.pid)).join('')}</div>`}
    ${single}`;
  $$('#gPick [data-pid]').forEach(b => { b.onclick = () => { G.pid = b.dataset.pid; drawGrowth(box, data, from); }; });
  $$('#growth canvas[data-gp]').forEach(cv => {
    const p = paramOf(cv.dataset.gp), avgs = data.params[p.id] || {};
    const isGrade = p.type === 'grade', o = gradeOpts(p);
    lineChart(cv, labels, [{ label: p.name, data: periods.map(k => avgs[k] ? avgs[k].avg : null), borderColor: CAT_COLOR[cat],
      backgroundColor: CAT_COLOR[cat], fill: false, pointRadius: periods.length === 1 ? 6 : 3 }],
      isGrade ? { min: 1, max: Math.max(o.length, 1), ticks: { stepSize: 1, callback: v => o[o.length - v] || '' } } : {},
      c => isGrade ? `Avg grade: ${o[o.length - Math.round(c.parsed.y)] || ''} (${c.parsed.y})` : `Avg: ${c.parsed.y} ${p.unit || ''} (${(avgs[periods[c.dataIndex]] || {}).n || 0} values)`);
  });
}

/* ---------------- STUDENTS LIST ---------------- */
function viewStudents() {
  const heading = role() === 'manager' ? 'Students' : 'Insights';
  title(heading);
  const F = S.filter;
  app.innerHTML = `
    <div class="row" style="margin-bottom:10px"><h2 style="margin:0">${heading}</h2><span class="spacer"></span>
      ${canAdmit() ? '<a class="btn small" href="#/student-edit/new">+ New admission</a>' : ''}</div>
    <div class="card">
      ${role() === 'manager' ? '' : '<div class="muted small" style="margin-bottom:8px">Tap a student to see their performance, charts and report card.</div>'}
      <input id="q" type="search" placeholder="Search name, guardian, phone…" value="${esc(F.q)}">
      <div id="fg" style="margin-top:8px">${genderTabs(F.gender)}</div>
      <div class="row" style="margin-top:8px">
        <select id="fs" style="flex:1;min-width:120px" aria-label="Course"><option value="">All courses</option>
          ${activeCourses().map(c => `<option value="${c.id}" ${F.course === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          <option value="-" ${F.course === '-' ? 'selected' : ''}>No course</option></select>
        <select id="fst" style="flex:1;min-width:100px" aria-label="Status">
          <option value="active" ${F.status === 'active' ? 'selected' : ''}>Active</option>
          <option value="inactive" ${F.status === 'inactive' ? 'selected' : ''}>Left / inactive</option>
          <option value="" ${F.status === '' ? 'selected' : ''}>All</option></select>
      </div>
    </div>
    <div class="card"><div id="count" class="muted small"></div><ul class="list" id="slist"></ul></div>`;
  const draw = () => {
    const q = F.q.toLowerCase();
    const list = S.students.filter(s =>
      (!F.course || (F.course === '-' ? !courseIds(s).length : inCourse(s, F.course))) &&
      (!F.status || (s.status || 'active') === F.status) && genderOk(s, F.gender) &&
      (!q || [s.name, s.guardian_name, s.phone, s.student_phone, s.batch].join(' ').toLowerCase().includes(q))
    ).sort((a, b) => a.name.localeCompare(b.name));
    $('#count').textContent = `${list.length} student${list.length === 1 ? '' : 's'}`;
    $('#slist').innerHTML = list.length ? list.map(s => `<li data-id="${s.id}">${avatarHtml(s)}
      <div class="grow"><div class="title">${esc(s.name)}</div>
      <div class="muted">${esc(studentLine(s))}</div></div>
      ${s.status === 'inactive' ? '<span class="tag off">Left</span>' : leaveTag(s)}</li>`).join('')
      : '<div class="empty">No students found.</div>';
    $$('#slist li').forEach(li => { li.onclick = () => go('#/student/' + li.dataset.id); });
  };
  $('#q').oninput = e => { F.q = e.target.value; draw(); };
  $('#fs').onchange = e => { F.course = e.target.value; draw(); };
  $('#fst').onchange = e => { F.status = e.target.value; draw(); };
  bindGenderTabs($('#fg'), g => { F.gender = g; draw(); });
  draw();
  loadThumbs(() => { if ($('#slist')) draw(); });
}

/* ---------------- STUDENT ADD / EDIT ---------------- */
function compressPhoto(file, size = 300) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height); // centre square crop
      const c = document.createElement('canvas'); c.width = size; c.height = size;
      c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      let q = 0.8, data = c.toDataURL('image/jpeg', q);
      while (data.length > 45000 && q > 0.3) { q -= 0.1; data = c.toDataURL('image/jpeg', q); }
      const t = document.createElement('canvas'); t.width = 120; t.height = 120;
      t.getContext('2d').drawImage(c, 0, 0, 120, 120);
      let tq = 0.7, thumb = t.toDataURL('image/jpeg', tq);
      while (thumb.length > 11000 && tq > 0.3) { tq -= 0.1; thumb = t.toDataURL('image/jpeg', tq); }
      URL.revokeObjectURL(url);
      resolve({ data, thumb });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this image')); };
    img.src = url;
  });
}

async function viewStudentEdit(seq, id) {
  const s = id && id !== 'new' ? studentOf(id) : null;
  if (id !== 'new' && !s) throw new Error('Student not found');
  title(s ? 'Edit student' : 'New admission', true);
  const courses = activeCourses();
  courseIds(s).forEach(id => { if (!courses.some(c => c.id === id)) courses.push(courseOf(id)); });
  const fields = [
    { name: 'name', label: 'Full name', required: true },
    { name: 'course_id', label: 'Courses (tick all that apply)', type: 'multi', options: courses.map(c => [c.id, c.name]),
      default: S.filter.course && S.filter.course !== '-' ? S.filter.course : '',
      empty: 'No courses yet: add them in More → Courses.' },
    { name: 'batch', label: 'Batch / section', placeholder: 'e.g. Morning, A' },
    { name: 'gender', label: 'Gender', type: 'select', options: [['', '—'], ['Male', 'Male'], ['Female', 'Female'], ['Other', 'Other']] },
    { name: 'dob', label: 'Date of birth', type: 'date' },
    { name: 'student_phone', label: 'Student phone', type: 'tel', attrs: 'inputmode="tel" autocomplete="off"', placeholder: 'e.g. 98765 43210' },
    { name: 'guardian_name', label: 'Parent / guardian name' },
    { name: 'phone', label: 'Guardian phone', type: 'tel', attrs: 'inputmode="tel" autocomplete="off"', placeholder: 'e.g. 98765 43210' },
    { name: 'join_date', label: 'Admission date', type: 'date', default: today() },
    { type: 'heading', name: '_phys', label: '🏃 Physical stats' },
    { name: 'height_cm', label: 'Height (cm)', type: 'number', attrs: 'inputmode="decimal" step="0.1" min="50" max="250"', placeholder: 'e.g. 165' },
    { name: 'weight_kg', label: 'Weight (kg)', type: 'number', attrs: 'inputmode="decimal" step="0.1" min="10" max="200"', placeholder: 'e.g. 58' },
    { type: 'heading', name: '_other', label: 'Other details' },
    ...(s ? [{ name: 'status', label: 'Status', type: 'segment', options: [['active', 'Active'], ['inactive', 'Left / inactive']] }] : []),
    { name: 'address', label: 'Address', type: 'textarea', full: true },
    { name: 'notes', label: 'Notes (medical, special needs, etc.)', type: 'textarea', full: true }
  ];
  let newPhoto = null;
  app.innerHTML = `<form class="card" id="sf" novalidate>
      <div class="row" style="margin-bottom:6px"><div id="pv">${avatarHtml(s || { id: '', name: '?' }, true)}</div>
        <div><label class="btn secondary small" style="margin:0;color:var(--brand)">📷 Take / choose photo
          <input type="file" accept="image/*" id="photo" hidden></label>
          <div class="muted small" style="margin-top:4px">Saved privately in your Google Sheet</div></div></div>
      <div class="form-grid">${fields.map(f => fieldHtml(f, s ? s[f.name] : undefined)).join('')}</div>
      <div class="row" style="margin-top:16px"><button class="btn" type="submit" style="flex:1">${s ? 'Save changes' : 'Save admission'}</button>
        <a class="btn secondary" href="${s ? '#/student/' + s.id : '#/students'}">Cancel</a></div>
    </form>`;
  if (s) getPhoto(s.id).then(ph => { if (ph && seq === routeSeq && !newPhoto) $('#pv').innerHTML = `<div class="avatar big"><img src="${ph}" alt=""></div>`; }).catch(() => {});
  $('#photo').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { newPhoto = await compressPhoto(f); $('#pv').innerHTML = `<div class="avatar big"><img src="${newPhoto.data}" alt=""></div>`; }
    catch (err) { toast(err.message, true); }
  };
  $('#sf').onsubmit = async e => {
    e.preventDefault();
    const vals = formValues(e.target, fields);
    if (!vals.name) return toast('Full name is required', true);
    if (s) vals.id = s.id;
    await busy($('button[type=submit]', e.target), async () => {
      const saved = await api('saveStudent', vals);
      const i = S.students.findIndex(x => x.id === saved.id);
      if (i >= 0) S.students[i] = saved; else S.students.push(saved);
      if (newPhoto) {
        await api('savePhoto', { student_id: saved.id, data: newPhoto.data, thumb: newPhoto.thumb });
        S.photos[saved.id] = newPhoto.data; cacheSet('ph_' + saved.id, newPhoto.data);
        S.thumbs[saved.id] = newPhoto.thumb; cacheSet('thumbs', S.thumbs);
      }
      saveBoot();
      toast(s ? 'Saved' : 'Admission saved');
      go('#/student/' + saved.id);
    });
  };
}

/* ---------------- PROGRESS MATHS ---------------- */
const PERIODS = { '4w': ['Last 4 weeks', 28], '12w': ['Last 12 weeks', 84], '6m': ['Last 6 months', 182], '1y': ['Last 1 year', 365], all: ['All time', 0] };

function inPeriod(recs) {
  const days = PERIODS[S.period][1];
  const from = days ? addDays(today(), -days) : '';
  return recs.filter(r => r.date >= from);
}

function paramStats(p, recs) {
  const vals = recs.filter(r => r.parameter_id === p.id && r.value !== '').sort((a, b) => a.date.localeCompare(b.date));
  if (!vals.length) return null;
  const latest = vals[vals.length - 1], prev = vals[vals.length - 2];
  const st = { p, vals, latest, prev, count: vals.length, trend: '', change: null, best: null };
  if (p.type === 'number') {
    const nums = vals.map(r => +r.value);
    if (p.higher_is_better === '1') st.best = Math.max(...nums);
    if (p.higher_is_better === '0') st.best = Math.min(...nums);
    if (prev) {
      st.change = +latest.value - +prev.value;
      st.trend = st.change === 0 ? 'same' : p.higher_is_better === '' ? 'neutral'
        : ((st.change > 0) === (p.higher_is_better === '1') ? 'up' : 'down');
    }
  } else if (p.type === 'grade' && prev) {
    const o = gradeOpts(p), a = o.indexOf(latest.value), b = o.indexOf(prev.value);
    st.trend = a === b ? 'same' : (a < b ? 'up' : 'down'); // first option = best
  }
  return st;
}

function changeHtml(st) {
  if (!st.prev) return '<span class="muted">—</span>';
  const arrow = { up: '▲', down: '▼', same: '•', neutral: '' }[st.trend] || '';
  const txt = st.change !== null ? (st.change > 0 ? '+' : '') + fmtNum(st.change) : (st.trend === 'same' ? 'same' : '');
  return `<span class="${st.trend === 'up' ? 'up' : st.trend === 'down' ? 'down' : ''}">${arrow} ${esc(txt)}</span>`;
}

function changeText(st) {
  if (!st.prev) return '-';
  const txt = st.change !== null ? (st.change > 0 ? '+' : '') + fmtNum(st.change) : '';
  const word = { up: 'improved', down: 'dropped', same: 'same', neutral: '' }[st.trend] || '';
  return [txt, word].filter(Boolean).join(' ');
}

/* ---------------- STUDENT PROFILE ---------------- */
async function viewStudent(seq, id) {
  const s = studentOf(id);
  if (!s) throw new Error('Student not found');
  title(s.name, true);
  const canShare = !!(navigator.canShare && window.File);
  const canAdd = myParams().length > 0;
  app.innerHTML = `
    <div class="card"><div class="row" style="align-items:flex-start;flex-wrap:nowrap">
      <div id="pAvatar">${avatarHtml(s, true)}</div>
      <div style="min-width:0"><h2 style="margin:0 0 4px">${esc(s.name)} ${s.status === 'inactive' ? '<span class="tag off">Left</span>' : leaveTag(s)}</h2>
        <div class="muted">${esc(studentLine(s))}</div>
        <div class="muted small" style="margin-top:4px">${esc([s.gender, s.dob && 'DOB ' + fmtDate(s.dob), s.join_date && 'Admitted ' + fmtDate(s.join_date)].filter(Boolean).join(' · '))}</div>
        ${s.height_cm || s.weight_kg ? `<div class="small" style="margin-top:4px">🏃 ${esc([s.height_cm && 'Height ' + s.height_cm + ' cm', s.weight_kg && 'Weight ' + s.weight_kg + ' kg'].filter(Boolean).join(' · '))}</div>` : ''}
        ${s.student_phone ? `<div class="small" style="margin-top:4px">📞 Student: <a href="tel:${esc(s.student_phone.replace(/[^\d+]/g, ''))}">${esc(s.student_phone)}</a></div>` : ''}
        ${s.guardian_name || s.phone ? `<div class="small">👪 ${esc(s.guardian_name || 'Guardian')}${s.phone ? `: <a href="tel:${esc(s.phone.replace(/[^\d+]/g, ''))}">${esc(s.phone)}</a>` : ''}</div>` : ''}
        ${s.notes ? `<div class="small" style="margin-top:6px">📝 ${esc(s.notes)}</div>` : ''}</div></div>
      <div class="row" style="margin-top:12px">
        ${canAdd ? `<a class="btn" href="#/entry/${s.id}">✎ Update scores</a>` : ''}
        <button class="btn secondary" id="pdfBtn">⬇ Report PDF</button>
        ${canShare ? '<button class="btn secondary" id="shareBtn">Share</button>' : ''}
        ${canAdmit() ? `<a class="btn secondary" href="#/student-edit/${s.id}">Edit</a>
          <button class="btn secondary" id="leaveBtn">+ Leave</button>` : ''}</div></div>
    <div id="pLeaves"></div>
    <div class="tabs" id="ptabs">${Object.entries(PERIODS).map(([k, [l]]) => `<button data-p="${k}" class="${S.period === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="pbody">${LOADING}</div>`;
  getPhoto(s.id).then(ph => { if (ph && seq === routeSeq) $('#pAvatar').innerHTML = avatarHtml(s, true); }).catch(() => {});
  let allRecs = [];
  const draw = () => {
    S.charts.forEach(c => c.destroy()); S.charts = [];
    const recs = inPeriod(allRecs);
    const stats = {};
    CATS.forEach(cat => { stats[cat] = activeParams(cat).map(p => paramStats(p, recs)).filter(Boolean); });
    S.view = { s, recs, stats };
    const hasAny = stats.Subject.length || stats.Physical.length;
    $('#pbody').innerHTML = !hasAny ? `<div class="card empty">No progress recorded in this period.${canAdd ? `<br><br><a class="btn" href="#/entry/${s.id}">✎ Update scores</a>` : ''}</div>` :
      CATS.filter(cat => stats[cat].length).map(cat => `
        <h2>${CAT_LABEL[cat]}</h2>
        <div class="card tbl-wrap"><table><thead><tr><th>Parameter</th><th>Latest</th><th>Change</th><th>Best</th><th>Entries</th></tr></thead><tbody>
          ${stats[cat].map(st => `<tr><td>${esc(st.p.name)}${st.p.unit ? ` <span class="muted small">(${esc(st.p.unit)})</span>` : ''}</td>
            <td><b>${esc(st.latest.value)}</b> <span class="muted small">${shortDate(st.latest.date)}</span></td>
            <td>${changeHtml(st)}</td><td>${st.best !== null ? fmtNum(st.best) : '—'}</td><td>${st.count}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="charts">${stats[cat].filter(st => st.p.type === 'number' || st.p.type === 'grade').map(st =>
          `<div class="chart-box"><h3>${esc(st.p.name)}${st.p.unit ? ` (${esc(st.p.unit)})` : ''}</h3><canvas data-pid="${st.p.id}" data-title="${esc(st.p.name + (st.p.unit ? ' (' + st.p.unit + ')' : ''))}"></canvas></div>`).join('')}</div>`).join('')
;
    $$('#pbody canvas').forEach(cv => {
      const st = [...stats.Subject, ...stats.Physical].find(x => x.p.id === cv.dataset.pid);
      S.charts.push(makeChart(cv, st));
    });
  };
  const drawLeaves = () => {
    const list = S.leaves.filter(l => l.student_id === s.id).sort((a, b) => b.from_date.localeCompare(a.from_date));
    const abs = S.absences.filter(a => a.student_id === s.id).sort((a, b) => b.date.localeCompare(a.date));
    const n30 = abs.filter(a => a.date >= addDays(today(), -29)).length;
    $('#pLeaves').innerHTML = `<div class="card"><h3>Attendance</h3>
        <div class="small"><b class="${n30 ? 'down' : 'up'}">${n30}</b> absent day${n30 === 1 ? '' : 's'} in the last 30 days · ${abs.length} in total</div>
        ${abs.length ? `<div class="chips">${abs.slice(0, 12).map(a => `<span class="tag absent" title="${esc(a.reason)}">${fmtDate(a.date)}${a.reason ? ' · ' + esc(a.reason) : ''}</span>`).join('')}</div>` : ''}</div>` +
      (list.length ? `<div class="card"><h3>Leave</h3><ul class="list">${list.slice(0, 10).map(l => leaveLi(l, false)).join('')}</ul></div>` : '');
    bindLeaveList($('#pLeaves'), () => router());
  };
  drawLeaves();
  $$('#ptabs button').forEach(b => { b.onclick = () => { S.period = b.dataset.p; $$('#ptabs button').forEach(x => x.classList.toggle('on', x === b)); draw(); }; });
  if (canAdmit()) $('#leaveBtn').onclick = () => leaveModal(s.id, null, () => router());
  $('#pdfBtn').onclick = e => busy(e.target, () => makeReport(false));
  if (canShare) $('#shareBtn').onclick = e => busy(e.target, () => makeReport(true));
  await swr('rec_' + s.id, 'getStudentRecords', { student_id: s.id }, recs => {
    if (seq !== routeSeq) return;
    allRecs = recs.slice(); draw();
  });
}

function makeChart(canvas, st) {
  const isGrade = st.p.type === 'grade';
  const opts = gradeOpts(st.p);
  const data = st.vals.map(r => isGrade ? opts.length - opts.indexOf(r.value) : +r.value);
  const y = isGrade
    ? { min: 1, max: Math.max(opts.length, 1), ticks: { stepSize: 1, callback: v => opts[opts.length - v] || '' } }
    : { reverse: false, ticks: { maxTicksLimit: 5 } };
  return new Chart(canvas, {
    type: 'line',
    data: { labels: st.vals.map(r => shortDate(r.date)),
      datasets: [{ data, borderColor: '#8e1b2e', backgroundColor: 'rgba(142,27,46,.10)', fill: true, cubicInterpolationMode: 'monotone', pointRadius: 3, pointBackgroundColor: '#f2a33a' }] },
    options: { animation: false, responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => isGrade ? st.vals[c.dataIndex].value : `${c.parsed.y} ${st.p.unit || ''}` } } },
      scales: { y, x: { ticks: { maxTicksLimit: 6 } } } }
  });
}

/* ---------------- PDF REPORT CARD ---------------- */
let logoCache;
async function logoData() {
  if (logoCache === undefined) {
    try {
      const blob = await (await fetch('logo-wide.png')).blob();
      logoCache = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.onerror = () => r(''); fr.readAsDataURL(blob); });
    } catch (e) { logoCache = ''; }
  }
  return logoCache;
}

async function makeReport(share) {
  const V = S.view;
  if (!V) throw new Error('Nothing to export yet');
  const { s, recs, stats } = V;
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, H = 297, M = 14;
  const brand = [142, 27, 46];

  const logo = await logoData();
  if (logo) doc.addImage(logo, 'PNG', M, 8, 56, 24.6);
  doc.setTextColor(...brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('Student Progress Report', W - M, 15, { align: 'right' });
  doc.setTextColor(60); doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(schoolName(), W - M, 21.5, { align: 'right' });
  doc.setFontSize(9); doc.setTextColor(110);
  doc.text(`Period: ${PERIODS[S.period][0]}  |  Generated: ${fmtDate(today())}`, W - M, 27.5, { align: 'right' });
  doc.setDrawColor(...brand); doc.setLineWidth(0.8); doc.line(M, 36, W - M, 36);
  doc.setDrawColor(242, 163, 58); doc.setLineWidth(0.4); doc.line(M, 37.6, W - M, 37.6); doc.setLineWidth(0.2);

  let y = 44, tx = M;
  doc.setTextColor(30);
  const photo = S.photos[s.id];
  if (photo) { try { doc.addImage(photo, 'JPEG', M, y, 30, 30); tx = M + 36; } catch (e) { /* skip photo */ } }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text(s.name, tx, y + 6);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  const info = [
    [courseIds(s).length > 1 ? 'Courses' : 'Course', coursesText(s)], ['Batch', s.batch], ['Gender', s.gender],
    ['Date of birth', fmtDate(s.dob)], ['Student phone', s.student_phone], ['Guardian', s.guardian_name], ['Guardian phone', s.phone],
    ['Admitted', fmtDate(s.join_date)], ['Height', s.height_cm ? s.height_cm + ' cm' : ''], ['Weight', s.weight_kg ? s.weight_kg + ' kg' : ''],
    ['Absent days', String(inPeriod(S.absences.filter(a => a.student_id === s.id)).length) + ' (' + PERIODS[S.period][0].toLowerCase() + ')']
  ].filter(x => x[1]);
  info.forEach(([k, v], i) => {
    const cx = tx + (i % 2) * 80, cy = y + 13 + Math.floor(i / 2) * 6;
    doc.setTextColor(110); doc.text(k + ':', cx, cy); doc.setTextColor(30); doc.text(String(v), cx + 29, cy);
  });
  y = Math.max(y + 34, y + 16 + Math.ceil(info.length / 2) * 6);

  CATS.forEach(cat => {
    if (!stats[cat].length) return;
    doc.autoTable({
      startY: y, margin: { left: M, right: M }, theme: 'grid',
      head: [[cat === 'Subject' ? 'Academics' : 'Physical training', 'Latest', 'Previous', 'Change', 'Best', 'Entries']],
      body: stats[cat].map(st => [
        st.p.name + (st.p.unit ? ` (${st.p.unit})` : ''),
        `${st.latest.value}  (${shortDate(st.latest.date)})`,
        st.prev ? `${st.prev.value}  (${shortDate(st.prev.date)})` : '-',
        changeText(st), st.best !== null ? fmtNum(st.best) : '-', String(st.count)]),
      headStyles: { fillColor: brand }, styles: { fontSize: 9, cellPadding: 2 },
      didParseCell: d => {
        if (d.section === 'body' && d.column.index === 3) {
          const t = String(d.cell.raw);
          if (t.includes('improved')) d.cell.styles.textColor = [30, 138, 76];
          if (t.includes('dropped')) d.cell.styles.textColor = [192, 57, 43];
        }
      }
    });
    y = doc.lastAutoTable.finalY + 8;
  });

  const canvases = $$('#pbody canvas');
  if (canvases.length) {
    if (y > H - 70) { doc.addPage(); y = 18; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Progress charts', M, y); y += 4;
    doc.setFont('helvetica', 'normal');
    const cw = (W - 2 * M - 6) / 2;
    canvases.forEach((cv, i) => {
      const ch = Math.min(cw * cv.height / cv.width, 60);
      if (i % 2 === 0 && y + ch + 10 > H - 16) { doc.addPage(); y = 18; }
      const x = M + (i % 2) * (cw + 6);
      doc.setFontSize(9); doc.setTextColor(60); doc.text(cv.dataset.title, x, y + 4);
      doc.addImage(cv.toDataURL('image/png'), 'PNG', x, y + 6, cw, ch);
      if (i % 2 === 1 || i === canvases.length - 1) y += ch + 12;
    });
  }

  const notes = recs.filter(r => r.remarks).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  if (notes.length) {
    if (y > H - 50) { doc.addPage(); y = 18; }
    doc.autoTable({ startY: y, margin: { left: M, right: M }, theme: 'plain', head: [['Date', 'Teacher remarks']],
      body: notes.map(r => [fmtDate(r.date), `${(paramOf(r.parameter_id) || {}).name || ''}: ${r.remarks}`]),
      headStyles: { textColor: brand }, styles: { fontSize: 9 }, columnStyles: { 0: { cellWidth: 28 } } });
    y = doc.lastAutoTable.finalY + 8;
  }

  if (y > H - 40) { doc.addPage(); y = 18; }
  y = Math.max(y + 14, H - 34);
  doc.setDrawColor(150); doc.setTextColor(90); doc.setFontSize(9);
  ['Teacher', 'Coach', 'Principal'].forEach((t, i) => {
    const x = M + i * 63; doc.line(x, y, x + 50, y); doc.text(t, x, y + 5);
  });

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(140);
    doc.text(`${s.name} · Page ${i} of ${pages}`, W / 2, H - 8, { align: 'center' });
  }

  const fname = `Report_${s.name.replace(/[^a-z0-9]+/gi, '_')}_${today()}.pdf`;
  if (share) {
    const file = new File([doc.output('blob')], fname, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Progress report: ' + s.name }); } catch (e) { /* user cancelled */ }
      return;
    }
    toast('Sharing not supported on this device, downloading instead');
  }
  doc.save(fname);
}

/* ---------------- SINGLE STUDENT ENTRY ---------------- */
function paramInput(p, val, attrs) {
  if (p.type === 'number') {
    return `<input type="number" inputmode="decimal" step="any" ${p.min !== '' ? `min="${esc(p.min)}"` : ''} ${p.max !== '' ? `max="${esc(p.max)}"` : ''}
      value="${esc(val)}" placeholder="${esc(p.unit || 'value')}" ${attrs}>`;
  }
  if (p.type === 'grade' || p.type === 'yesno') {
    const o = p.type === 'grade' ? gradeOpts(p) : ['Yes', 'No'];
    return `<select ${attrs}><option value=""></option>${o.map(x => `<option ${x === val ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>`;
  }
  return `<input type="text" value="${esc(val)}" ${attrs}>`;
}

async function viewEntry(seq, id, date) {
  const s = studentOf(id);
  if (!s) throw new Error('Student not found');
  title('Update scores', true);
  if (!myParams().length) throw new Error(isAdmin() ? 'No subjects set up yet. Add them in More → Subjects & parameters.'
    : 'No subjects are mapped to you yet. Ask the Super Admin.');
  let recs = cacheGet('rec_' + s.id);
  const freshP = api('getStudentRecords', { student_id: s.id }).then(r => { cacheSet('rec_' + s.id, r); return r; });
  if (!recs) { app.innerHTML = LOADING; recs = await freshP; if (seq !== routeSeq) return; }
  let cur = date || today();
  app.innerHTML = `<form id="ef" novalidate>
    <div class="card"><div class="row" style="flex-wrap:nowrap">${avatarHtml(s, true)}<div class="grow"><h2 style="margin:0">${esc(s.name)}</h2>
      <div class="muted small">${esc(studentLine(s))}</div>
      <a class="small" href="#/student/${s.id}">📈 See insights</a></div></div>
      <label for="ed">Date</label><input type="date" id="ed" value="${cur}" max="${today()}">
      <div class="muted small" id="edInfo" style="margin-top:6px"></div></div>
    <div id="eparams"></div>
    <button class="btn block" type="submit">Save scores</button></form>`;
  if (!S.photos[s.id] && !S.thumbs[s.id]) getPhoto(s.id).then(ph => { if (ph && seq === routeSeq) { const a = $('#ef .avatar'); if (a) a.outerHTML = avatarHtml(s, true); } }).catch(() => {});
  const fill = () => {
    const existing = {};
    recs.filter(r => r.date === cur && canEditParam(r.parameter_id)).forEach(r => { existing[r.parameter_id] = r; });
    const n = Object.keys(existing).length;
    const lv = leaveOn(s.id, cur);
    $('#edInfo').innerHTML = (lv ? `<span class="tag leave">On leave</span> ${esc(lv.reason || '')}<br>` : '') +
      esc(n ? `${n} value(s) already saved for this date. You are editing them.` : 'New entry for this date.');
    $('#eparams').innerHTML = CATS.filter(c => myParams(c).length).map(cat => `
      <div class="card"><h3>${CAT_LABEL[cat]}</h3>
      ${myParams(cat).map(p => { const ex = existing[p.id] || {}; return `<div class="param-row">
        <div class="pl">${esc(p.name)} ${p.unit ? `<span class="muted small">(${esc(p.unit)}${p.min !== '' || p.max !== '' ? `, ${esc(p.min)}–${esc(p.max)}` : ''})</span>` : ''}</div>
        <div class="two">${paramInput(p, ex.value || '', `data-pid="${p.id}" data-k="value" data-orig="${esc(ex.value || '')}" aria-label="${esc(p.name)}"`)}
          <input type="text" placeholder="Note (optional)" value="${esc(ex.remarks || '')}" data-pid="${p.id}" data-k="remarks" data-orig="${esc(ex.remarks || '')}"></div></div>`; }).join('')}</div>`).join('');
  };
  fill();
  freshP.then(r => { // newer data arrived: refill only if nothing was typed yet
    if (seq !== routeSeq || $$('#eparams [data-pid]').some(el => el.value.trim() !== el.dataset.orig)) return;
    if (JSON.stringify(r) !== JSON.stringify(recs)) { recs = r; fill(); }
  }).catch(() => {});
  $('#ed').onchange = e => { cur = e.target.value || today(); fill(); };
  $('#ef').onsubmit = async e => {
    e.preventDefault();
    const items = {};
    $$('#eparams [data-pid]').forEach(el => {
      const it = items[el.dataset.pid] = items[el.dataset.pid] || { student_id: s.id, parameter_id: el.dataset.pid, date: cur, changed: false };
      it[el.dataset.k] = el.value.trim();
      if (el.value.trim() !== el.dataset.orig) it.changed = true;
    });
    const list = Object.values(items).filter(i => i.changed);
    if (!list.length) return toast('Nothing changed');
    await busy($('button[type=submit]', e.target), async () => {
      const r = await api('saveRecords', { records: list });
      applyLocalRecords(list);
      toast(`Saved (${r.inserted} new, ${r.updated} updated${r.deleted ? `, ${r.deleted} removed` : ''})`);
      go(role() === 'teacher' ? '#/home' : '#/student/' + s.id);
    });
  };
}

/* ---------------- BULK ENTRY (one subject or more, every student at once) ---------------- */
function batchChoices() {
  const out = [];
  if (isAdmin()) CATS.forEach(c => { if (activeParams(c).length) out.push(['cat:' + c, c === 'Subject' ? '📘 All academics' : '🏃 All physical']); });
  else if (myParams().length > 1) out.push(['mine', `All my subjects (${myParams().length})`]);
  myParams().forEach(p => out.push([p.id, (p.category === 'Physical' ? '🏃 ' : '📘 ') + p.name]));
  return out;
}
function batchParams(sel) {
  if (sel.startsWith('cat:')) return myParams(sel.slice(4));
  if (sel === 'mine') return myParams();
  return myParams().filter(p => p.id === sel);
}

function viewBatch(seq, preset) {
  title('Bulk entry');
  const B = S.batch;
  if (!B.date) B.date = today();
  const choices = batchChoices();
  if (!choices.length) {
    app.innerHTML = `<div class="card empty">${isAdmin() ? 'No subjects set up yet. Add them in More → Subjects &amp; parameters.' : 'No subjects are mapped to you yet. Ask the Super Admin.'}</div>`;
    return;
  }
  if (preset && choices.some(c => c[0] === preset)) B.sel = preset;
  if (!choices.some(c => c[0] === B.sel)) B.sel = choices[0][0];
  app.innerHTML = `
    <div class="card">
      <div class="muted small">Pick a subject and fill it for every student in one go. Changed cells are highlighted, then press Save.</div>
      <div class="form-grid">
        <div class="full"><label for="bk">Subject</label><select id="bk">${choices.map(([v, l]) => `<option value="${esc(v)}" ${B.sel === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
        <div class="full"><label>Gender</label><div id="bg">${genderTabs(B.gender)}</div></div>
        <div><label for="bs">Course</label><select id="bs"><option value="">All courses</option>${activeCourses().map(c => `<option value="${c.id}" ${B.course === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div><label for="bd">Date</label><input type="date" id="bd" value="${B.date}" max="${today()}"></div>
      </div></div>
    <div id="bgrid">${LOADING}</div>`;
  let loadSeq = 0;
  const load = async () => {
    const mine = ++loadSeq;
    const studs = activeStudents().filter(s => (!B.course || inCourse(s, B.course)) && genderOk(s, B.gender)).sort(byName);
    const params = batchParams(B.sel);
    if (!studs.length) { $('#bgrid').innerHTML = '<div class="card empty">No active students match.</div>'; return; }
    $('#bgrid').innerHTML = LOADING;
    let recs;
    try { recs = await api('getRecordsForDate', { date: B.date, student_ids: studs.map(s => s.id) }); }
    catch (e) { if (mine === loadSeq) $('#bgrid').innerHTML = `<div class="card empty">${esc(e.message)}</div>`; return; }
    if (mine !== loadSeq || seq !== routeSeq) return;
    const ex = {};
    recs.forEach(r => { ex[r.student_id + '|' + r.parameter_id] = r; });
    const one = params.length === 1;
    $('#bgrid').innerHTML = `<div class="card tbl-wrap"><table class="batch${one ? ' one' : ''}"><thead><tr><th>Student (${studs.length})</th>
        ${params.map(p => `<th>${esc(p.name)}${p.unit ? `<br><span class="small">${esc(p.unit)}</span>` : ''}</th>`).join('')}</tr></thead>
      <tbody>${studs.map(s => `<tr${leaveOn(s.id, B.date) || absentOn(s.id, B.date) ? ' class="onleave"' : ''}><td><b>${esc(s.name)}</b><div class="muted small">${esc(studentLine(s))}</div>${leaveTag(s, B.date)}</td>
        ${params.map(p => { const v = (ex[s.id + '|' + p.id] || {}).value || '';
          return `<td>${paramInput(p, v, `data-sid="${s.id}" data-pid="${p.id}" data-orig="${esc(v)}" data-rem="${esc((ex[s.id + '|' + p.id] || {}).remarks || '')}" aria-label="${esc(s.name + ' ' + p.name)}"`)}</td>`; }).join('')}</tr>`).join('')}
      </tbody></table></div>
      <div class="savebar">
        <span id="bcount">No changes</span><button class="btn" id="bsave">Save</button></div>`;
    const cells = $$('#bgrid [data-pid]');
    const count = () => { const el = $('#bcount'); if (!el) return; const n = cells.filter(c => c.value.trim() !== c.dataset.orig).length; el.textContent = n ? `${n} change(s) not saved` : 'No changes'; el.parentNode.classList.toggle('dirty', n > 0); };
    cells.forEach(c => { c.oninput = c.onchange = () => { c.classList.toggle('changed', c.value.trim() !== c.dataset.orig); count(); }; });
    $('#bsave').onclick = e => {
      const changed = cells.filter(c => c.value.trim() !== c.dataset.orig);
      if (!changed.length) return toast('Nothing changed');
      busy(e.target, async () => {
        const items = changed.map(c => ({ student_id: c.dataset.sid, parameter_id: c.dataset.pid, date: B.date, value: c.value.trim(), remarks: c.dataset.rem }));
        const r = await api('saveRecords', { records: items });
        applyLocalRecords(items);
        changed.forEach(c => { c.dataset.orig = c.value.trim(); c.classList.remove('changed'); });
        count();
        toast(`Saved (${r.inserted} new, ${r.updated} updated${r.deleted ? `, ${r.deleted} removed` : ''})`);
      });
    };
  };
  const bind = (sel, key) => { $(sel).onchange = e => { B[key] = e.target.value || (key === 'date' ? today() : ''); load(); }; };
  bind('#bs', 'course'); bind('#bk', 'sel'); bind('#bd', 'date');
  bindGenderTabs($('#bg'), g => { B.gender = g; load(); });
  load();
}

/* ---------------- LEAVE (manager + super admin) ---------------- */
function leaveDates(l) { return l.from_date === l.to_date ? fmtDate(l.from_date) : `${fmtDate(l.from_date)} – ${fmtDate(l.to_date)}`; }
function leaveDays(l) { return Math.round((Date.parse(l.to_date) - Date.parse(l.from_date)) / 864e5) + 1; }

function leaveLi(l, withName) {
  const s = studentOf(l.student_id) || { id: '', name: '(removed student)' };
  const t = today(), cur = l.from_date <= t && l.to_date >= t;
  return `<li data-sid="${s.id}" ${withName ? '' : 'style="cursor:default"'}>${withName ? avatarHtml(s) : ''}<div class="grow">
    ${withName ? `<div class="title">${esc(s.name)}</div>` : ''}
    <div class="${withName ? 'muted' : ''}">${leaveDates(l)} <span class="muted small">(${leaveDays(l)} day${leaveDays(l) > 1 ? 's' : ''})</span> ${cur ? '<span class="tag leave">Now</span>' : ''}</div>
    ${l.reason ? `<div class="muted small">${esc(l.reason)}</div>` : ''}</div>
    ${canAdmit() ? `<button class="icon-btn" style="color:var(--muted);font-size:16px" data-ledit="${l.id}" aria-label="Edit leave">✎</button>
      <button class="icon-btn" style="color:var(--bad);font-size:18px" data-ldel="${l.id}" aria-label="Delete leave">🗑</button>` : ''}</li>`;
}

function bindLeaveList(box, after) {
  $$('[data-ldel]', box).forEach(b => {
    b.onclick = async e => {
      e.stopPropagation();
      if (!confirm('Delete this leave?')) return;
      try {
        await api('deleteLeave', { id: b.dataset.ldel });
        S.leaves = S.leaves.filter(l => l.id !== b.dataset.ldel); saveBoot();
        toast('Leave deleted'); after();
      } catch (err) { toast(err.message, true); }
    };
  });
  $$('[data-ledit]', box).forEach(b => {
    b.onclick = e => { e.stopPropagation(); const l = S.leaves.find(x => x.id === b.dataset.ledit); leaveModal(l.student_id, l, after); };
  });
}

function leaveModal(studentId, leave, after) {
  const fields = [
    ...(studentId ? [] : [{ name: 'student_id', label: 'Student', type: 'select', required: true,
      options: [['', '— Select student —'], ...activeStudents().sort(byName).map(s => [s.id, s.name + (coursesText(s) ? ' (' + coursesText(s) + ')' : '')])] }]),
    { name: 'from_date', label: 'From', type: 'date', required: true, default: today() },
    { name: 'to_date', label: 'To (same day if empty)', type: 'date' },
    { name: 'reason', label: 'Reason', placeholder: 'e.g. Fever, family function' }
  ];
  const st = studentOf(studentId);
  formModal({
    title: (leave ? 'Edit leave' : 'Record leave') + (st ? ': ' + st.name : ''),
    values: leave || {}, fields,
    onSubmit: async v => {
      if (studentId) v.student_id = studentId;
      if (leave) v.id = leave.id;
      if (v.to_date && v.to_date < v.from_date) throw new Error('"To" date must be on or after "From" date');
      const saved = await api('saveLeave', v);
      const i = S.leaves.findIndex(l => l.id === saved.id);
      if (i >= 0) S.leaves[i] = saved; else S.leaves.push(saved);
      saveBoot();
      toast('Leave saved');
      after();
    }
  });
}

function viewLeaves() {
  title('Leave');
  const t = today();
  const sorted = S.leaves.slice().sort((a, b) => a.from_date.localeCompare(b.from_date));
  const now = sorted.filter(l => l.from_date <= t && l.to_date >= t);
  const next = sorted.filter(l => l.from_date > t);
  const past = sorted.filter(l => l.to_date < t).reverse().slice(0, 30);
  const section = (h, list, empty) => `<h2>${h} (${list.length})</h2><div class="card">${list.length
    ? `<ul class="list">${list.map(l => leaveLi(l, true)).join('')}</ul>` : `<div class="empty">${empty}</div>`}</div>`;
  app.innerHTML = `<div class="row"><h2 style="margin:0">Student leave</h2><span class="spacer"></span><button class="btn small" id="addL">+ Record leave</button></div>
    ${section('On leave today', now, 'Nobody is on leave today.')}
    ${section('Upcoming', next, 'No upcoming leave.')}
    ${section('Past', past, 'No past leave recorded.')}`;
  $('#addL').onclick = () => leaveModal(null, null, viewLeaves);
  $$('li[data-sid]', app).forEach(li => { li.onclick = () => { if (li.dataset.sid) go('#/student/' + li.dataset.sid); }; });
  bindLeaveList(app, viewLeaves);
}

/* ---------------- ATTENDANCE (manager + super admin): everyone present unless marked absent ---------------- */
function viewAttendance(seq, dateArg) {
  title('Attendance');
  const A = S.att;
  const t = today();
  if (dateArg && /^\d{4}-\d{2}-\d{2}$/.test(dateArg)) A.date = dateArg;
  if (!A.date) A.date = t;
  app.innerHTML = `
    <div class="card">
      <div class="att-date">
        <button class="btn secondary small" id="aPrev" aria-label="Previous day">‹</button>
        <div class="grow"><input type="date" id="aDate" value="${A.date}" aria-label="Date">
          <div class="att-day" id="aDay"></div></div>
        <button class="btn secondary small" id="aNext" aria-label="Next day">›</button>
      </div>
      <div id="aGender" style="margin-top:8px">${genderTabs(A.gender)}</div>
      <div class="row" style="margin-top:8px">
        <select id="aCourse" style="flex:1;min-width:120px" aria-label="Course"><option value="">All courses</option>
          ${activeCourses().map(c => `<option value="${c.id}" ${A.course === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      </div>
      <div class="muted small" style="margin-top:8px">Everyone is <b>present</b> by default. Tap a student to mark them <b>absent</b>, then press Save.
        Future days can be marked too.</div>
      <div class="row" style="margin-top:10px">
        <button class="btn secondary small" id="aLeave" type="button">📅 Leave for several days</button>
        <a class="btn secondary small" href="#/leaves">All leave</a></div>
    </div>
    <div id="aSum" class="att-sum"></div>
    <div class="card"><ul class="list" id="aList"></ul></div>
    <div class="savebar"><span id="aCount">No changes</span><button class="btn" id="aSave">Save</button></div>`;

  let studs = [], orig = {}, cur = {};
  const dirty = () => studs.filter(s => (s.id in orig) !== (s.id in cur) || (s.id in cur && (cur[s.id] || '') !== (orig[s.id] || ''))).length;
  const draw = () => {
    $('#aDay').textContent = dayName(A.date) + (A.date === t ? ' · Today' : A.date > t ? ' · Upcoming' : '');
    const leave = studs.filter(s => leaveOn(s.id, A.date)).length;
    const absent = studs.filter(s => !leaveOn(s.id, A.date) && s.id in cur).length;
    $('#aSum').innerHTML = `<div><b class="up">${studs.length - absent - leave}</b> Present</div>
      <div><b class="down">${absent}</b> Absent</div><div><b class="down">${leave}</b> On leave</div>`;
    $('#aList').innerHTML = studs.length ? studs.map(s => {
      const lv = leaveOn(s.id, A.date), ab = s.id in cur;
      return `<li data-sid="${s.id}" class="att-row${ab ? ' absent' : ''}${lv ? ' leave' : ''}">${avatarHtml(s)}
        <div class="grow"><div class="title">${esc(s.name)}</div><div class="muted small">${esc(studentLine(s))}</div>
          ${ab ? `<input class="att-reason" data-reason="${s.id}" placeholder="Reason (optional)" value="${esc(cur[s.id] || '')}">` : ''}
          ${lv ? `<div class="muted small">${esc(lv.reason || 'On leave')}</div>` : ''}</div>
        <span class="att-pill ${lv ? 'leave' : ab ? 'a' : 'p'}">${lv ? 'On leave' : ab ? 'Absent' : 'Present'}</span></li>`;
    }).join('') : '<div class="empty">No active students match.</div>';
    const n = dirty();
    $('#aCount').textContent = n ? `${n} change(s) not saved` : 'No changes';
    $('#aCount').parentNode.classList.toggle('dirty', n > 0);
    $$('#aList li[data-sid]').forEach(li => {
      li.onclick = e => {
        if (e.target.closest('input') || li.classList.contains('leave')) return;
        const id = li.dataset.sid;
        if (id in cur) delete cur[id]; else cur[id] = orig[id] || '';
        draw();
        if (id in cur) { const r = $(`[data-reason="${id}"]`); if (r) r.focus({ preventScroll: true }); }
      };
    });
    $$('#aList [data-reason]').forEach(inp => {
      inp.oninput = () => { cur[inp.dataset.reason] = inp.value; const n2 = dirty(); $('#aCount').textContent = n2 ? `${n2} change(s) not saved` : 'No changes'; $('#aCount').parentNode.classList.toggle('dirty', n2 > 0); };
    });
  };
  const load = () => {
    studs = activeStudents().filter(s => (!A.course || inCourse(s, A.course)) && genderOk(s, A.gender)).sort(byName);
    orig = {};
    S.absences.forEach(a => { if (a.date === A.date && studs.some(s => s.id === a.student_id)) orig[a.student_id] = a.reason || ''; });
    cur = Object.assign({}, orig);
    draw();
  };
  const change = fn => () => {
    if (dirty() && !confirm('You have unsaved attendance changes. Discard them?')) { $('#aDate').value = A.date; return; }
    fn(); load();
  };
  $('#aPrev').onclick = change(() => { A.date = addDays(A.date, -1); $('#aDate').value = A.date; });
  $('#aNext').onclick = change(() => { A.date = addDays(A.date, 1); $('#aDate').value = A.date; });
  $('#aDate').onchange = change(() => { A.date = $('#aDate').value || t; $('#aDate').value = A.date; });
  $('#aLeave').onclick = () => leaveModal(null, null, () => router());
  $('#aCourse').onchange = change(() => { A.course = $('#aCourse').value; });
  $$('#aGender [data-gv]').forEach(b => {
    b.onclick = change(() => { A.gender = b.dataset.gv; $$('#aGender [data-gv]').forEach(x => x.classList.toggle('on', x === b)); });
  });
  $('#aSave').onclick = e => {
    if (!dirty()) return toast('Nothing changed');
    busy(e.target, async () => {
      const scope = studs.filter(s => !leaveOn(s.id, A.date)).map(s => s.id);
      const absent = {};
      scope.forEach(id => { if (id in cur) absent[id] = (cur[id] || '').trim(); });
      const r = await api('saveAttendance', { date: A.date, student_ids: scope, absent });
      const now = new Date().toISOString();
      S.absences = S.absences.filter(a => !(a.date === A.date && scope.includes(a.student_id)))
        .concat(Object.entries(absent).map(([sid, reason]) => ({ id: 'local_' + sid + A.date, student_id: sid, date: A.date, reason, marked_by: S.user.id, created_at: now })));
      saveBoot(); cacheDrop('dash');
      toast(`Saved: ${r.absent} absent on ${fmtDate(A.date)}`);
      load();
    });
  };
  load();
}

/* ---------------- COURSES (manager + super admin) ---------------- */
function viewCourses() {
  title('Courses', true);
  const list = S.courses.slice().sort((a, b) => (b.active === '1') - (a.active === '1') || byName(a, b));
  app.innerHTML = `<div class="row"><h2 style="margin:0">Courses</h2><span class="spacer"></span><button class="btn small" id="addC">+ Add course</button></div>
    <p class="muted small">The course a student joins for, chosen at admission (e.g. Odisha Police, Air Force).</p>
    <div class="card"><ul class="list">${list.map(c => `<li data-id="${c.id}"><div class="grow">
      <div class="title">${esc(c.name)} ${c.active !== '1' ? '<span class="tag off">inactive</span>' : ''}</div>
      <div class="muted small">${activeStudents().filter(s => inCourse(s, c.id)).length} active students</div></div>›</li>`).join('')
      || '<div class="empty">No courses yet.</div>'}</ul></div>`;
  const edit = c => formModal({
    title: c ? 'Edit course' : 'New course', values: c || { active: '1' },
    fields: [{ name: 'name', label: 'Course name', required: true, placeholder: 'e.g. Odisha Police' },
      { name: 'active', label: 'Active (shown at admission)', type: 'checkbox' }],
    onSubmit: async v => {
      if (c) v.id = c.id;
      const saved = await api('saveCourse', v);
      const i = S.courses.findIndex(x => x.id === saved.id);
      if (i >= 0) S.courses[i] = saved; else S.courses.push(saved);
      saveBoot(); toast('Saved'); viewCourses();
    }
  });
  $('#addC').onclick = () => edit(null);
  $$('li[data-id]', app).forEach(li => { li.onclick = () => edit(courseOf(li.dataset.id)); });
}

/* ---------------- MORE / SETTINGS ---------------- */
function viewMore() {
  title('More');
  const item = (href, t, sub) => `<li data-go="${href}"><div class="grow"><div class="title">${t}</div><div class="muted">${sub}</div></div>›</li>`;
  app.innerHTML = `
    ${isAdmin() ? `<h2>Super Admin</h2><div class="card"><ul class="list">
      ${item('#/users', 'Users &amp; subject mapping', 'Managers, teachers, and which subjects each teacher updates')}
      ${item('#/params', 'Subjects &amp; parameters', 'What is tracked for subjects and physical training')}
      ${item('#/courses', 'Courses', 'Odisha Police, Air Force…')}
      ${item('#/attendance', 'Attendance', 'Mark students absent for any day')}
      ${item('#/leaves', 'Student leave', 'Record and view leave')}
    </ul></div>` : ''}
    ${role() === 'manager' ? `<h2>Manager</h2><div class="card"><ul class="list">
      ${item('#/attendance', 'Attendance', 'Mark students absent for any day')}
      ${item('#/student-edit/new', 'New admission', 'Add a new student')}
      ${item('#/leaves', 'Student leave', 'Record and view leave')}
      ${item('#/courses', 'Courses', 'Odisha Police, Air Force…')}
    </ul></div>` : ''}
    <h2>Account</h2><div class="card"><ul class="list">
      <li id="mPw"><div class="grow"><div class="title">Change password</div><div class="muted">Logged in as ${esc(S.user.username || S.user.name)}</div></div>›</li>
      <li id="mRefresh"><div class="grow"><div class="title">Refresh data</div><div class="muted">Reload the latest from the server</div></div>↻</li>
      <li id="mOut"><div class="grow"><div class="title" style="color:var(--bad)">Log out</div></div></li>
    </ul></div>
    <div class="card muted small"><b>Install on phone:</b> open this site in Chrome (Android) → menu ⋮ → <i>Add to Home screen</i>.
      On iPhone: Safari → Share → <i>Add to Home Screen</i>.</div>`;
  $$('[data-go]', app).forEach(li => { li.onclick = () => go(li.dataset.go); });
  $('#mRefresh').onclick = () => { clearCache(); S.loaded = false; S.photos = {}; toast('Refreshing…'); go('#/home'); };
  $('#mOut').onclick = () => { if (confirm('Log out?')) logout(); };
  $('#mPw').onclick = () => formModal({
    title: 'Change password',
    fields: [{ name: 'old_password', label: 'Current password', type: 'password', required: true },
      { name: 'new_password', label: 'New password (min 6 characters)', type: 'password', required: true },
      { name: 'confirm', label: 'Repeat new password', type: 'password', required: true }],
    onSubmit: async v => {
      if (v.new_password !== v.confirm) throw new Error('New passwords do not match');
      setSession(await api('changePassword', v));
      toast('Password changed');
    }
  });
}

/* ---------------- SUPER ADMIN: SUBJECTS & PARAMETERS ---------------- */
function viewParams() {
  title('Subjects & parameters', true);
  const typeName = { number: 'Number', grade: 'Grade', yesno: 'Yes / No', text: 'Text' };
  const dir = p => p.type !== 'number' ? '' : p.higher_is_better === '1' ? 'higher is better' : p.higher_is_better === '0' ? 'lower is better' : 'neutral';
  app.innerHTML = `<div class="row"><h2 style="margin:0">Subjects &amp; parameters</h2><span class="spacer"></span><button class="btn small" id="addP">+ Add</button></div>
    <p class="muted small">Teachers enter values only for the subjects mapped to them (More → Users). Deactivate instead of deleting to keep old history.</p>
    ${CATS.map(cat => `<h2>${CAT_LABEL[cat]}</h2><div class="card"><ul class="list">
      ${S.params.filter(p => p.category === cat).sort(byOrder).map(p => { const ts = teachersOf(p.id); return `<li data-id="${p.id}"><div class="grow">
        <div class="title">${esc(p.name)} ${p.active !== '1' ? '<span class="tag off">inactive</span>' : ''}</div>
        <div class="muted small">${esc([typeName[p.type], p.unit, (p.min !== '' || p.max !== '') && `${p.min}–${p.max}`, dir(p), p.type === 'grade' && p.options].filter(Boolean).join(' · '))}</div>
        <div class="small ${ts.length ? '' : 'muted'}">👤 ${ts.length ? esc(ts.map(u => u.name).join(', ')) : 'No teacher mapped'}</div></div>›</li>`; }).join('')
        || '<div class="empty">None yet.</div>'}</ul></div>`).join('')}`;
  const edit = p => formModal({
    title: p ? 'Edit subject / parameter' : 'New subject / parameter',
    values: p || { category: 'Subject', type: 'number', higher_is_better: '1', active: '1', sort_order: String(S.params.length + 1) },
    fields: [
      { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Mathematics, 100m Sprint' },
      { name: 'category', label: 'Category', type: 'segment', options: [['Subject', '📘 Academics'], ['Physical', '🏃 Physical']] },
      { name: 'type', label: 'Type of value', type: 'select', options: [['number', 'Number (marks, time, count…)'], ['grade', 'Grade (A, B, C…)'], ['yesno', 'Yes / No'], ['text', 'Text']] },
      { name: 'unit', label: 'Unit', placeholder: 'marks, sec, cm, kg, %' },
      { name: 'min', label: 'Minimum allowed (numbers)', type: 'number', attrs: 'step="any"' },
      { name: 'max', label: 'Maximum allowed (numbers)', type: 'number', attrs: 'step="any"' },
      { name: 'higher_is_better', label: 'Improvement means', type: 'select', options: [['1', 'Higher value is better (marks, push-ups)'], ['0', 'Lower value is better (sprint time)'], ['', 'Neither (height, weight)']] },
      { name: 'options', label: 'Grade options, best first', placeholder: 'A,B,C,D', help: 'Only for Grade type, comma separated' },
      { name: 'sort_order', label: 'Display order', type: 'number' },
      { name: 'active', label: 'Active (shown to teachers)', type: 'checkbox' }
    ],
    onSubmit: async v => {
      if (p) v.id = p.id;
      const saved = await api('saveParameter', v);
      const i = S.params.findIndex(x => x.id === saved.id);
      if (i >= 0) S.params[i] = saved; else S.params.push(saved);
      saveBoot(); toast('Saved'); viewParams();
    }
  });
  $('#addP').onclick = () => edit(null);
  $$('li[data-id]', app).forEach(li => { li.onclick = () => edit(paramOf(li.dataset.id)); });
}

/* ---------------- SUPER ADMIN: USERS & SUBJECT MAPPING ---------------- */
function viewUsers() {
  title('Users & subjects', true);
  const groups = [['admin', 'Super Admins'], ['manager', 'Managers'], ['teacher', 'Teachers']];
  const subjText = u => subjectIds(u).map(paramOf).filter(Boolean).map(p => p.name).join(', ');
  app.innerHTML = `<div class="row"><h2 style="margin:0">Users &amp; subjects</h2><span class="spacer"></span><button class="btn small" id="addU">+ Add user</button></div>
    ${groups.map(([r, h]) => { const list = S.users.filter(u => u.role === r).sort(byName); return `<h2>${h} (${list.length})</h2>
      <div class="card"><ul class="list">${list.map(u => `<li data-id="${u.id}">
        <div class="avatar">${initials(u.name)}</div><div class="grow"><div class="title">${esc(u.name)}</div>
        <div class="muted small">@${esc(u.username)}${u.phone ? ' · ' + esc(u.phone) : ''}</div>
        ${r === 'teacher' ? `<div class="small ${subjText(u) ? '' : 'muted'}">📘 ${esc(subjText(u) || 'No subjects mapped yet')}</div>` : ''}</div>
        ${u.active !== '1' ? '<span class="tag off">inactive</span>' : ''}›</li>`).join('') || '<div class="empty">None yet.</div>'}</ul></div>`; }).join('')}`;
  const edit = u => {
    const opts = CATS.flatMap(c => S.params.filter(p => p.category === c && (p.active === '1' || subjectIds(u).includes(p.id))).sort(byOrder)
      .map(p => [p.id, p.name, CAT_LABEL[c]]));
    formModal({
      title: u ? 'Edit user' : 'New user',
      values: u || { role: 'teacher', active: '1' },
      fields: [
        { name: 'name', label: 'Full name', required: true },
        { name: 'username', label: 'Username (for login)', required: true, attrs: 'autocapitalize="none"' },
        { name: 'phone', label: 'Phone', type: 'tel' },
        { name: 'role', label: 'Role', type: 'segment', options: [['teacher', 'Teacher'], ['manager', 'Manager'], ['admin', 'Super Admin']] },
        { name: 'subjects', label: 'Subjects this teacher updates', type: 'multi', options: opts, empty: 'Add subjects first (More → Subjects & parameters).' },
        { name: 'password', label: u ? 'New password (leave blank to keep)' : 'Password (min 6 characters)', type: 'password', required: !u },
        { name: 'active', label: 'Active (can log in)', type: 'checkbox' }
      ],
      onOpen: form => {
        const sync = () => { $('[data-f="subjects"]', form).hidden = form.elements.role.value !== 'teacher'; };
        $$('input[name="role"]', form).forEach(r => { r.onchange = sync; });
        sync();
      },
      onSubmit: async v => {
        if (u) v.id = u.id;
        if (!v.password) delete v.password;
        if (v.role !== 'teacher') v.subjects = '';
        const saved = await api('saveUser', v);
        const i = S.users.findIndex(x => x.id === saved.id);
        if (i >= 0) S.users[i] = saved; else S.users.push(saved);
        if (saved.id === S.user.id) S.user = Object.assign({}, S.user, saved);
        saveBoot(); toast('Saved'); viewUsers();
      }
    });
  };
  $('#addU').onclick = () => edit(null);
  $$('li[data-id]', app).forEach(li => { li.onclick = () => edit(S.users.find(x => x.id === li.dataset.id)); });
}

/* ---------------- start ---------------- */
const ROUTES = {
  home: viewHome, students: viewStudents, student: viewStudent, 'student-edit': viewStudentEdit,
  entry: viewEntry, batch: viewBatch, more: viewMore, params: viewParams, users: viewUsers, teachers: viewUsers,
  leaves: viewLeaves, courses: viewCourses, attendance: viewAttendance
};

S.token = store.get('st_token');
try { S.user = JSON.parse(store.get('st_user') || 'null'); } catch (e) { S.user = null; }
window.addEventListener('hashchange', router);
$('#backBtn').onclick = () => (history.length > 1 ? history.back() : go('#/home'));
router();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
