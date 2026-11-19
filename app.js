'use strict';
/* School & Training Progress Tracker — frontend (plain JavaScript, no build step) */

const CFG = window.APP_CONFIG || {};
const S = {
  token: null, user: null, loaded: false,
  schools: [], params: [], students: [], users: [],
  photos: {}, charts: [], view: null,
  filter: { q: '', school: '', cls: '', status: 'active' },
  batch: { school: '', cls: '', cat: 'Study', date: '' },
  period: '12w',
  growth: { group: 'month', cat: 'Overall', school: '', cls: '' }
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
const apiUrl = () => store.get('st_api') || CFG.API_URL || '';

async function api(action, data = {}) {
  const url = apiUrl();
  if (!url) throw new Error('Server URL is not set. Open "Server settings" on the login screen.');
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
  if (S.loaded) cacheSet('boot', { me: S.user, schools: S.schools, parameters: S.params, students: S.students, users: S.users });
}

/* ---------------- helpers ---------------- */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function today() { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
function addDays(s, n) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
function fmtDate(s) { if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || ''; const [y, m, d] = s.split('-'); return `${+d} ${MONTHS[+m - 1]} ${y}`; }
function shortDate(s) { const [, m, d] = s.split('-'); return `${+d} ${MONTHS[+m - 1]}`; }
function fmtNum(n) { return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100); }
function initials(name) { return esc(String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')); }

const schoolOf = id => S.schools.find(s => s.id === id);
const studentOf = id => S.students.find(s => s.id === id);
const paramOf = id => S.params.find(p => p.id === id);
const userName = id => (S.users.find(u => u.id === id) || {}).name || '—';
const isAdmin = () => S.user && S.user.role === 'admin';
const byOrder = (a, b) => (+a.sort_order || 0) - (+b.sort_order || 0) || a.name.localeCompare(b.name);
const activeParams = cat => S.params.filter(p => p.active === '1' && (!cat || p.category === cat)).sort(byOrder);
const activeSchools = () => S.schools.filter(s => s.active === '1');
const classesList = () => [...new Set(S.students.map(s => s.class_name).filter(Boolean))].sort();
const gradeOpts = p => String(p.options || '').split(',').map(x => x.trim()).filter(Boolean);

function avatarHtml(s, big) {
  const ph = S.photos[s.id];
  return `<div class="avatar${big ? ' big' : ''}">${ph ? `<img src="${ph}" alt="">` : initials(s.name)}</div>`;
}

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
  if (f.type === 'checkbox') {
    return `<div class="${f.full ? 'full' : ''}"><label class="check" style="margin-top:14px"><input type="checkbox" name="${f.name}" ${v === '1' ? 'checked' : ''}> ${esc(f.label)}</label></div>`;
  }
  if (f.type === 'segment') {
    const cur = f.options.some(([ov]) => String(ov) === String(v)) ? String(v) : String(f.options[0][0]);
    return `<div class="${f.full ? 'full' : ''}"><label>${esc(f.label)}</label><div class="seg" role="radiogroup" aria-label="${esc(f.label)}">${f.options.map(([ov, ol]) =>
      `<label><input type="radio" name="${f.name}" value="${esc(ov)}" ${String(ov) === cur ? 'checked' : ''}><span>${esc(ol)}</span></label>`).join('')}</div></div>`;
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
  return `<div class="${f.full ? 'full' : ''}"><label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>${input}
    ${f.help ? `<div class="muted small">${esc(f.help)}</div>` : ''}</div>`;
}

function formValues(form, fields) {
  const out = {};
  fields.forEach(f => {
    const el = form.elements[f.name];
    if (!el) return;
    out[f.name] = f.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value.trim();
  });
  return out;
}

function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }

function formModal({ title: t, fields, values = {}, submitText = 'Save', onSubmit }) {
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
      <details style="margin-top:14px"><summary class="muted">Server settings</summary>
        <label for="la">Server URL (Apps Script Web App)</label>
        <input id="la" name="api" value="${esc(apiUrl())}" placeholder="https://script.google.com/macros/s/…/exec">
      </details>
    </form></div>`;
  $('#loginForm').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    const url = f.api.value.trim();
    store.set('st_api', url && url !== CFG.API_URL ? url : null);
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
  S.schools = d.schools; S.params = d.parameters; S.students = d.students; S.users = d.users;
  S.loaded = true;
  $('#whoAmI').innerHTML = `<span class="uc-text"><b>${esc(S.user.name)}</b><small>${S.user.role === 'admin' ? 'Admin' : 'Teacher'}</small></span>
    <span class="uc-av">${initials(S.user.name)}</span>`;
}

/* ---------------- router ---------------- */
let routeSeq = 0;
const ADMIN_VIEWS = { params: 1, teachers: 1, schools: 1 };

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
    if (ADMIN_VIEWS[name] && !isAdmin()) return go('#/home');
    const nav = { home: 'home', students: 'students', student: 'students', 'student-edit': 'students', entry: 'batch', batch: 'batch' }[name] || 'more';
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
async function viewHome(seq) {
  title('Home');
  app.innerHTML = `
    <div class="home-logo"><img src="logo-wide.png" alt="${esc(CFG.APP_NAME || 'Logo')}"></div>
    <h2 style="margin-top:4px">Hello, ${esc(S.user.name.split(' ')[0])}</h2>
    <div id="hStats">${LOADING}</div>
    <div class="row" style="margin:14px 0">
      <a class="btn" href="#/batch">✎ Weekly entry</a>
      <a class="btn secondary" href="#/student-edit/new">+ Add student</a>
      ${isAdmin() ? '<a class="btn secondary" href="#/params">Parameters</a>' : ''}
    </div>
    ${isAdmin() ? growthShell() : ''}
    <div id="hLists"></div>`;
  if (isAdmin()) bindGrowth();
  await swr('dash', 'dashboard', {}, d => { if (seq === routeSeq) renderDash(d); });
}

function renderDash(d) {
  if (!$('#hStats')) return;
  const pending = d.pending_student_ids.map(studentOf).filter(Boolean);
  const perSchool = activeSchools().map(sc => [sc, S.students.filter(s => s.school_id === sc.id && s.status !== 'inactive').length]);
  $('#hStats').innerHTML = `
    <div class="grid stats">
      <div class="stat"><div class="n">${d.active_students}</div><div class="l">Active students</div></div>
      <div class="stat"><div class="n">${d.updated_this_week}</div><div class="l">Updated in last 7 days</div></div>
      <div class="stat"><div class="n">${pending.length}</div><div class="l">Pending this week</div></div>
      <div class="stat"><div class="n">${d.entries_this_week}</div><div class="l">Values entered (7 days)</div></div>
    </div>`;
  $('#hLists').innerHTML = `
    ${perSchool.length > 1 ? `<div class="card"><h3>Students by school</h3>
      <ul class="list">${perSchool.map(([sc, n]) => `<li data-school="${sc.id}"><div class="grow">${esc(sc.name)}</div><b>${n}</b></li>`).join('')}</ul></div>` : ''}
    <div class="card"><h3>Pending this week (${pending.length})</h3>
      ${pending.length ? `<ul class="list">${pending.slice(0, 12).map(s => `<li data-go="#/entry/${s.id}">
        ${avatarHtml(s)}<div class="grow"><div class="title">${esc(s.name)}</div>
        <div class="muted">${esc([s.class_name, s.batch].filter(Boolean).join(' · '))}</div></div><span class="tag">Add</span></li>`).join('')}</ul>
        ${pending.length > 12 ? `<div class="muted small" style="margin-top:6px">+ ${pending.length - 12} more. Use Weekly entry to fill all at once.</div>` : ''}`
      : '<div class="empty">All students updated in the last 7 days 🎉</div>'}</div>
    <div class="card"><h3>Recent entries</h3>
      ${d.recent.length ? `<ul class="list">${d.recent.map(r => {
        const s = studentOf(r.student_id), p = paramOf(r.parameter_id);
        if (!s || !p) return '';
        return `<li data-go="#/student/${s.id}"><div class="grow"><div class="title">${esc(s.name)}</div>
          <div class="muted">${esc(p.name)}: <b>${esc(r.value)}</b> ${esc(p.unit)} · ${fmtDate(r.date)} · by ${esc(userName(r.entered_by))}</div></div></li>`;
      }).join('')}</ul>` : '<div class="empty">No entries yet.</div>'}</div>`;
  $$('#hLists [data-go]').forEach(li => { li.onclick = () => go(li.dataset.go); });
  $$('#hLists [data-school]').forEach(li => { li.onclick = () => { S.filter.school = li.dataset.school; go('#/students'); }; });
}

/* ---------------- GROWTH MONITOR (admin home) ---------------- */
const GROUPS = { week: 'Week', month: 'Month', year: 'Year' };
const RANGE_TEXT = { week: 'last 12 weeks', month: 'last 12 months', year: 'all years' };
const CAT_COLOR = { Study: '#8e1b2e', Physical: '#f2a33a' };
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
      ${tabs('cat', { Overall: 'Overall', Study: '📘 Study', Physical: '🏃 Physical' })}
      <div class="row">
        <select id="gs" style="flex:1;min-width:130px"><option value="">All schools</option>
          ${S.schools.map(s => `<option value="${s.id}" ${G.school === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
        <select id="gc" style="flex:1;min-width:110px"><option value="">All classes</option>
          ${classesList().map(c => `<option ${G.cls === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      </div></div>
    <div id="growth">${LOADING}</div>`;
}

function bindGrowth() {
  $$('[data-gkey]', app).forEach(t => {
    $$('button', t).forEach(b => {
      b.onclick = () => { S.growth[t.dataset.gkey] = b.dataset.v; $$('button', t).forEach(x => x.classList.toggle('on', x === b)); renderGrowth(); };
    });
  });
  $('#gs').onchange = e => { S.growth.school = e.target.value; renderGrowth(); };
  $('#gc').onchange = e => { S.growth.cls = e.target.value; renderGrowth(); };
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
  const key = 'growth_' + [G.group, from, G.school, G.cls].join('|');
  if (cacheGet(key) === undefined) { destroyGrowthCharts(); box.innerHTML = LOADING; }
  swr(key, 'growth', { group: G.group, from, school_id: G.school, class_name: G.cls }, data => {
    if (mine === growthSeq && document.body.contains(box)) drawGrowth(box, data, from);
  }).catch(e => { if (mine === growthSeq && document.body.contains(box)) box.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; });
}

function drawGrowth(box, data, from) {
  const G = S.growth;
  destroyGrowthCharts();
  const keys = Object.keys(data.entries).sort();
  if (!keys.length) { box.innerHTML = `<div class="card empty">No progress data for the ${RANGE_TEXT[G.group]} with these filters.</div>`; return; }
  const periods = periodList(G.group, from || keys[0], keys);
  const labels = periods.map(k => periodLabel(G.group, k));
  const unitWord = GROUPS[G.group].toLowerCase();
  const baseline = { label: '_base', data: periods.map(() => 100), borderColor: '#b9b9b9', borderDash: [5, 5], borderWidth: 1, pointRadius: 0 };
  const idxTooltip = c => `${c.dataset.label}: ${c.parsed.y}`;
  const note = `<div class="muted small">Growth index: the first ${unitWord} with data = 100. 110 means 10% better than the start.
    Lower-is-better items (e.g. sprint time) are flipped so up is always good. Range: ${RANGE_TEXT[G.group]}.</div>`;

  if (G.cat === 'Overall') {
    const st = categoryIndex('Study', data, periods), ph = categoryIndex('Physical', data, periods);
    const [lastEntries] = lastOf(periods.map(k => data.entries[k] ?? null));
    const lastKey = [...periods].reverse().find(k => data.entries[k]);
    box.innerHTML = `
      <div class="grid stats">
        <div class="stat"><div class="l">📘 Study growth</div><div class="n" style="font-size:22px">${pctText(lastOf(st)[0])}</div><div class="l">since start of range</div></div>
        <div class="stat"><div class="l">🏃 Physical growth</div><div class="n" style="font-size:22px">${pctText(lastOf(ph)[0])}</div><div class="l">since start of range</div></div>
        <div class="stat"><div class="n">${data.students[lastKey] || 0}</div><div class="l">Students updated (${esc(periodLabel(G.group, lastKey))})</div></div>
        <div class="stat"><div class="n">${lastEntries || 0}</div><div class="l">Values entered (${esc(periodLabel(G.group, lastKey))})</div></div>
      </div>
      <div class="chart-box big" style="margin-top:12px"><h3>Overall growth by category</h3><canvas id="gOverall"></canvas>${note}</div>
      <div class="chart-box big" style="margin-top:12px"><h3>Activity per ${unitWord}</h3><canvas id="gActivity"></canvas></div>`;
    lineChart($('#gOverall'), labels, [
      { label: 'Study', data: st, borderColor: CAT_COLOR.Study, backgroundColor: CAT_COLOR.Study },
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
  const ci = categoryIndex(cat, data, periods);
  const cards = params.map(p => {
    const avgs = data.params[p.id] || {};
    const series = periods.map(k => avgs[k] ? avgs[k].avg : null);
    const [last, li] = lastOf(series);
    if (last === null) return '';
    const [prev] = lastOf(series.slice(0, li));
    let chg = '';
    if (p.type === 'number' && prev !== null) {
      const d = Math.round((last - prev) * 100) / 100;
      const good = p.higher_is_better === '' ? '' : (d === 0 ? '' : ((d > 0) === (p.higher_is_better === '1') ? 'up' : 'down'));
      chg = `<span class="${good}">${d > 0 ? '+' : ''}${fmtNum(d)}</span> vs previous ${unitWord}`;
    }
    const shown = p.type === 'grade' ? gradeOpts(p)[gradeOpts(p).length - Math.round(last)] || '' : fmtNum(last);
    const dir = p.type === 'number' ? (p.higher_is_better === '1' ? 'higher is better' : p.higher_is_better === '0' ? 'lower is better' : '') : '';
    return `<div class="chart-box"><h3>${esc(p.name)}${p.unit ? ` (${esc(p.unit)})` : ''}</h3>
      <div class="small"><b>Avg ${esc(shown)}</b> ${chg ? '· ' + chg : ''}</div>
      <div class="muted small">${esc([dir, `${avgs[periods[li]].n} values in ${periodLabel(G.group, periods[li])}`].filter(Boolean).join(' · '))}</div>
      <canvas data-gp="${p.id}"></canvas></div>`;
  }).join('');
  box.innerHTML = `
    <div class="chart-box big"><div class="row"><h3 style="margin:0">${cat === 'Study' ? '📘 Study' : '🏃 Physical'} growth index</h3>
      <span class="spacer"></span><b>${pctText(lastOf(ci)[0])}</b></div><canvas id="gCat"></canvas>${note}</div>
    <h3 style="margin:16px 0 8px">Class average per ${unitWord}</h3>
    <div class="charts">${cards || '<div class="card empty">No values yet.</div>'}</div>`;
  lineChart($('#gCat'), labels, [{ label: cat, data: ci, borderColor: CAT_COLOR[cat], backgroundColor: CAT_COLOR[cat] }, baseline], {}, idxTooltip);
  $$('#growth canvas[data-gp]').forEach(cv => {
    const p = paramOf(cv.dataset.gp), avgs = data.params[p.id] || {};
    const isGrade = p.type === 'grade', o = gradeOpts(p);
    lineChart(cv, labels, [{ label: p.name, data: periods.map(k => avgs[k] ? avgs[k].avg : null), borderColor: CAT_COLOR[cat],
      backgroundColor: CAT_COLOR[cat], fill: false }],
      isGrade ? { min: 1, max: Math.max(o.length, 1), ticks: { stepSize: 1, callback: v => o[o.length - v] || '' } } : {},
      c => isGrade ? `Avg grade: ${o[o.length - Math.round(c.parsed.y)] || ''} (${c.parsed.y})` : `Avg: ${c.parsed.y} ${p.unit || ''} (${(avgs[periods[c.dataIndex]] || {}).n || 0} values)`);
  });
}

/* ---------------- STUDENTS LIST ---------------- */
function viewStudents() {
  title('Students');
  const F = S.filter;
  const classes = classesList();
  app.innerHTML = `
    <div class="row" style="margin-bottom:10px"><h2 style="margin:0">Students</h2><span class="spacer"></span>
      <a class="btn small" href="#/student-edit/new">+ Add student</a></div>
    <div class="card">
      <input id="q" type="search" placeholder="Search name, guardian, phone…" value="${esc(F.q)}">
      <div class="row" style="margin-top:8px">
        <select id="fs" style="flex:1;min-width:120px"><option value="">All schools</option>
          ${S.schools.map(s => `<option value="${s.id}" ${F.school === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
        <select id="fc" style="flex:1;min-width:100px"><option value="">All classes</option>
          ${classes.map(c => `<option ${F.cls === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
        <select id="fst" style="flex:1;min-width:100px">
          <option value="active" ${F.status === 'active' ? 'selected' : ''}>Active</option>
          <option value="inactive" ${F.status === 'inactive' ? 'selected' : ''}>Left / inactive</option>
          <option value="" ${F.status === '' ? 'selected' : ''}>All</option></select>
      </div>
    </div>
    <div class="card"><div id="count" class="muted small"></div><ul class="list" id="slist"></ul></div>`;
  const draw = () => {
    const q = F.q.toLowerCase();
    const list = S.students.filter(s =>
      (!F.school || s.school_id === F.school) && (!F.cls || s.class_name === F.cls) &&
      (!F.status || (s.status || 'active') === F.status) &&
      (!q || [s.name, s.guardian_name, s.phone, s.batch].join(' ').toLowerCase().includes(q))
    ).sort((a, b) => a.name.localeCompare(b.name));
    $('#count').textContent = `${list.length} student${list.length === 1 ? '' : 's'}`;
    $('#slist').innerHTML = list.length ? list.map(s => `<li data-id="${s.id}">${avatarHtml(s)}
      <div class="grow"><div class="title">${esc(s.name)}</div>
      <div class="muted">${esc([s.class_name, s.batch, (schoolOf(s.school_id) || {}).name].filter(Boolean).join(' · '))}</div></div>
      ${s.status === 'inactive' ? '<span class="tag off">Left</span>' : ''}</li>`).join('')
      : '<div class="empty">No students found.</div>';
    $$('#slist li').forEach(li => { li.onclick = () => go('#/student/' + li.dataset.id); });
  };
  $('#q').oninput = e => { F.q = e.target.value; draw(); };
  $('#fs').onchange = e => { F.school = e.target.value; draw(); };
  $('#fc').onchange = e => { F.cls = e.target.value; draw(); };
  $('#fst').onchange = e => { F.status = e.target.value; draw(); };
  draw();
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
      URL.revokeObjectURL(url);
      resolve(data);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this image')); };
    img.src = url;
  });
}

async function viewStudentEdit(seq, id) {
  const s = id && id !== 'new' ? studentOf(id) : null;
  if (id !== 'new' && !s) throw new Error('Student not found');
  title(s ? 'Edit student' : 'Add student', true);
  const schools = s ? S.schools : activeSchools();
  if (!schools.length) throw new Error(isAdmin() ? 'Add a school first (More → Schools).' : 'No school set up yet. Ask the admin.');
  const fields = [
    { name: 'name', label: 'Full name', required: true },
    { name: 'school_id', label: 'School', type: 'select', required: true, options: schools.map(x => [x.id, x.name]),
      default: S.filter.school || (schools[0] || {}).id },
    { name: 'class_name', label: 'Class', attrs: 'list="classList"', placeholder: 'e.g. 6' },
    { name: 'batch', label: 'Batch / section', placeholder: 'e.g. Morning, A' },
    { name: 'gender', label: 'Gender', type: 'select', options: [['', '—'], ['Male', 'Male'], ['Female', 'Female'], ['Other', 'Other']] },
    { name: 'dob', label: 'Date of birth', type: 'date' },
    { name: 'guardian_name', label: 'Parent / guardian name' },
    { name: 'phone', label: 'Phone', type: 'tel' },
    { name: 'join_date', label: 'Joining date', type: 'date', default: today() },
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
      <datalist id="classList">${classesList().map(c => `<option value="${esc(c)}">`).join('')}</datalist>
      <div class="form-grid">${fields.map(f => fieldHtml(f, s ? s[f.name] : undefined)).join('')}</div>
      <div class="row" style="margin-top:16px"><button class="btn" type="submit" style="flex:1">${s ? 'Save changes' : 'Add student'}</button>
        <a class="btn secondary" href="${s ? '#/student/' + s.id : '#/students'}">Cancel</a></div>
    </form>`;
  if (s) getPhoto(s.id).then(ph => { if (ph && seq === routeSeq && !newPhoto) $('#pv').innerHTML = `<div class="avatar big"><img src="${ph}" alt=""></div>`; }).catch(() => {});
  $('#photo').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { newPhoto = await compressPhoto(f); $('#pv').innerHTML = `<div class="avatar big"><img src="${newPhoto}" alt=""></div>`; }
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
      if (newPhoto) { await api('savePhoto', { student_id: saved.id, data: newPhoto }); S.photos[saved.id] = newPhoto; cacheSet('ph_' + saved.id, newPhoto); }
      toast(s ? 'Saved' : 'Student added');
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
  const sc = schoolOf(s.school_id);
  const canShare = !!(navigator.canShare && window.File);
  app.innerHTML = `
    <div class="card"><div class="row" style="align-items:flex-start;flex-wrap:nowrap">
      <div id="pAvatar">${avatarHtml(s, true)}</div>
      <div style="min-width:0"><h2 style="margin:0 0 4px">${esc(s.name)} ${s.status === 'inactive' ? '<span class="tag off">Left</span>' : ''}</h2>
        <div class="muted">${esc([sc && sc.name, s.class_name && 'Class ' + s.class_name, s.batch].filter(Boolean).join(' · '))}</div>
        <div class="muted small" style="margin-top:4px">${esc([s.gender, s.dob && 'DOB ' + fmtDate(s.dob), s.join_date && 'Joined ' + fmtDate(s.join_date)].filter(Boolean).join(' · '))}</div>
        <div class="muted small">${esc([s.guardian_name, s.phone].filter(Boolean).join(' · '))}</div>
        ${s.notes ? `<div class="small" style="margin-top:6px">📝 ${esc(s.notes)}</div>` : ''}</div></div>
      <div class="row" style="margin-top:12px">
        <a class="btn" href="#/entry/${s.id}">+ Add progress</a>
        <button class="btn secondary" id="pdfBtn">⬇ Report PDF</button>
        ${canShare ? '<button class="btn secondary" id="shareBtn">Share</button>' : ''}
        <a class="btn secondary" href="#/student-edit/${s.id}">Edit</a></div></div>
    <div class="tabs" id="ptabs">${Object.entries(PERIODS).map(([k, [l]]) => `<button data-p="${k}" class="${S.period === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div id="pbody">${LOADING}</div>`;
  getPhoto(s.id).then(ph => { if (ph && seq === routeSeq) $('#pAvatar').innerHTML = avatarHtml(s, true); }).catch(() => {});
  let allRecs = [];
  const draw = () => {
    S.charts.forEach(c => c.destroy()); S.charts = [];
    const recs = inPeriod(allRecs);
    const stats = {};
    ['Study', 'Physical'].forEach(cat => { stats[cat] = activeParams(cat).map(p => paramStats(p, recs)).filter(Boolean); });
    S.view = { s, recs, stats };
    const hasAny = stats.Study.length || stats.Physical.length;
    $('#pbody').innerHTML = !hasAny ? `<div class="card empty">No progress recorded in this period.<br><br><a class="btn" href="#/entry/${s.id}">+ Add progress</a></div>` :
      ['Study', 'Physical'].filter(cat => stats[cat].length).map(cat => `
        <h2>${cat === 'Study' ? '📘 Study' : '🏃 Physical training'}</h2>
        <div class="card tbl-wrap"><table><thead><tr><th>Parameter</th><th>Latest</th><th>Change</th><th>Best</th><th>Entries</th></tr></thead><tbody>
          ${stats[cat].map(st => `<tr><td>${esc(st.p.name)}${st.p.unit ? ` <span class="muted small">(${esc(st.p.unit)})</span>` : ''}</td>
            <td><b>${esc(st.latest.value)}</b> <span class="muted small">${shortDate(st.latest.date)}</span></td>
            <td>${changeHtml(st)}</td><td>${st.best !== null ? fmtNum(st.best) : '—'}</td><td>${st.count}</td></tr>`).join('')}
        </tbody></table></div>
        <div class="charts">${stats[cat].filter(st => st.p.type === 'number' || st.p.type === 'grade').map(st =>
          `<div class="chart-box"><h3>${esc(st.p.name)}${st.p.unit ? ` (${esc(st.p.unit)})` : ''}</h3><canvas data-pid="${st.p.id}" data-title="${esc(st.p.name + (st.p.unit ? ' (' + st.p.unit + ')' : ''))}"></canvas></div>`).join('')}</div>`).join('')
      + `<h2>History</h2><div id="hist"></div>`;
    $$('#pbody canvas').forEach(cv => {
      const st = [...stats.Study, ...stats.Physical].find(x => x.p.id === cv.dataset.pid);
      S.charts.push(makeChart(cv, st));
    });
    if (hasAny) drawHistory(recs);
  };
  const drawHistory = recs => {
    const byDate = {};
    recs.forEach(r => { (byDate[r.date] = byDate[r.date] || []).push(r); });
    const dates = Object.keys(byDate).sort().reverse();
    $('#hist').innerHTML = dates.map(dt => `<div class="card"><div class="row"><h3 style="margin:0">${fmtDate(dt)}</h3><span class="spacer"></span>
        <a class="btn small secondary" href="#/entry/${s.id}/${dt}">Edit</a></div>
      <ul class="list">${byDate[dt].map(r => { const p = paramOf(r.parameter_id); return p ? `<li style="cursor:default">
        <div class="grow"><b>${esc(p.name)}</b>: ${esc(r.value)} ${esc(p.unit)}${r.remarks ? ` <span class="muted">— ${esc(r.remarks)}</span>` : ''}
        <div class="muted small">by ${esc(userName(r.entered_by))}</div></div>
        <button class="icon-btn" style="color:var(--bad);font-size:18px" data-del="${r.id}" aria-label="Delete">🗑</button></li>` : ''; }).join('')}</ul></div>`).join('');
    $$('#hist [data-del]').forEach(b => {
      b.onclick = async () => {
        if (!confirm('Delete this entry?')) return;
        try {
          await api('deleteRecord', { id: b.dataset.del });
          const i = allRecs.findIndex(r => r.id === b.dataset.del); if (i >= 0) allRecs.splice(i, 1);
          cacheSet('rec_' + s.id, allRecs); cacheDrop('dash');
          toast('Deleted'); draw();
        } catch (e) { toast(e.message, true); }
      };
    });
  };
  $$('#ptabs button').forEach(b => { b.onclick = () => { S.period = b.dataset.p; $$('#ptabs button').forEach(x => x.classList.toggle('on', x === b)); draw(); }; });
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
  const sc = schoolOf(s.school_id);
  const brand = [142, 27, 46];

  const logo = await logoData();
  if (logo) doc.addImage(logo, 'PNG', M, 8, 56, 25);
  doc.setTextColor(...brand); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('Student Progress Report', W - M, 15, { align: 'right' });
  doc.setTextColor(60); doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  if (sc) doc.text(sc.name, W - M, 21.5, { align: 'right' });
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
    ['Class', [s.class_name, s.batch].filter(Boolean).join(' / ')], ['Gender', s.gender], ['Date of birth', fmtDate(s.dob)],
    ['Guardian', s.guardian_name], ['Phone', s.phone], ['Joined', fmtDate(s.join_date)]
  ].filter(x => x[1]);
  info.forEach(([k, v], i) => {
    const cx = tx + (i % 2) * 75, cy = y + 13 + Math.floor(i / 2) * 6;
    doc.setTextColor(110); doc.text(k + ':', cx, cy); doc.setTextColor(30); doc.text(String(v), cx + 24, cy);
  });
  y = Math.max(y + 34, y + 16 + Math.ceil(info.length / 2) * 6);

  ['Study', 'Physical'].forEach(cat => {
    if (!stats[cat].length) return;
    doc.autoTable({
      startY: y, margin: { left: M, right: M }, theme: 'grid',
      head: [[cat === 'Study' ? 'Study' : 'Physical training', 'Latest', 'Previous', 'Change', 'Best', 'Entries']],
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
  ['Class Teacher', 'Coach', 'Principal'].forEach((t, i) => {
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
  title('Add progress', true);
  if (!activeParams().length) throw new Error('No parameters set up yet. ' + (isAdmin() ? 'Add them in More → Parameters.' : 'Ask the admin.'));
  let recs = cacheGet('rec_' + s.id);
  const freshP = api('getStudentRecords', { student_id: s.id }).then(r => { cacheSet('rec_' + s.id, r); return r; });
  if (!recs) { app.innerHTML = LOADING; recs = await freshP; if (seq !== routeSeq) return; }
  let cur = date || today();
  app.innerHTML = `<form id="ef" novalidate>
    <div class="card"><div class="row" style="flex-wrap:nowrap">${avatarHtml(s)}<div class="grow"><b>${esc(s.name)}</b>
      <div class="muted small">${esc([s.class_name, s.batch].filter(Boolean).join(' · '))}</div></div></div>
      <label for="ed">Date</label><input type="date" id="ed" value="${cur}" max="${today()}">
      <div class="muted small" id="edInfo" style="margin-top:6px"></div></div>
    <div id="eparams"></div>
    <button class="btn block" type="submit">Save progress</button></form>`;
  const fill = () => {
    const existing = {};
    recs.filter(r => r.date === cur).forEach(r => { existing[r.parameter_id] = r; });
    const n = Object.keys(existing).length;
    $('#edInfo').textContent = n ? `${n} value(s) already saved for this date. You are editing them.` : 'New entry for this date.';
    $('#eparams').innerHTML = ['Study', 'Physical'].filter(c => activeParams(c).length).map(cat => `
      <div class="card"><h3>${cat === 'Study' ? '📘 Study' : '🏃 Physical training'}</h3>
      ${activeParams(cat).map(p => { const ex = existing[p.id] || {}; return `<div class="param-row">
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
      go('#/student/' + s.id);
    });
  };
}

/* ---------------- BATCH (WEEKLY) ENTRY ---------------- */
function viewBatch(seq) {
  title('Weekly entry');
  const B = S.batch;
  if (!B.date) B.date = today();
  const schools = activeSchools();
  if (!B.school && schools.length === 1) B.school = schools[0].id;
  app.innerHTML = `
    <div class="card">
      <div class="muted small">Enter values for a whole class at once. Changed cells are highlighted, then press Save.</div>
      <div class="form-grid">
        <div><label>School</label><select id="bs"><option value="">All schools</option>${schools.map(x => `<option value="${x.id}" ${B.school === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
        <div><label>Class</label><select id="bc"><option value="">All classes</option>${classesList().map(c => `<option ${B.cls === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <div><label>Category</label><select id="bk"><option ${B.cat === 'Study' ? 'selected' : ''}>Study</option><option value="Physical" ${B.cat === 'Physical' ? 'selected' : ''}>Physical</option></select></div>
        <div><label>Date</label><input type="date" id="bd" value="${B.date}" max="${today()}"></div>
      </div></div>
    <div id="bgrid">${LOADING}</div>`;
  let loadSeq = 0;
  const load = async () => {
    const mine = ++loadSeq;
    const studs = S.students.filter(s => s.status !== 'inactive' && (!B.school || s.school_id === B.school) && (!B.cls || s.class_name === B.cls))
      .sort((a, b) => a.name.localeCompare(b.name));
    const params = activeParams(B.cat);
    if (!studs.length) { $('#bgrid').innerHTML = '<div class="card empty">No active students match.</div>'; return; }
    if (!params.length) { $('#bgrid').innerHTML = `<div class="card empty">No ${B.cat} parameters set up yet.</div>`; return; }
    $('#bgrid').innerHTML = LOADING;
    let recs;
    try { recs = await api('getRecordsForDate', { date: B.date, student_ids: studs.map(s => s.id) }); }
    catch (e) { if (mine === loadSeq) $('#bgrid').innerHTML = `<div class="card empty">${esc(e.message)}</div>`; return; }
    if (mine !== loadSeq || seq !== routeSeq) return;
    const ex = {};
    recs.forEach(r => { ex[r.student_id + '|' + r.parameter_id] = r; });
    $('#bgrid').innerHTML = `<div class="card tbl-wrap"><table class="batch"><thead><tr><th>Student</th>
        ${params.map(p => `<th>${esc(p.name)}${p.unit ? `<br><span class="small">${esc(p.unit)}</span>` : ''}</th>`).join('')}</tr></thead>
      <tbody>${studs.map(s => `<tr><td><b>${esc(s.name)}</b><div class="muted small">${esc([s.class_name, s.batch].filter(Boolean).join(' · '))}</div></td>
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
  bind('#bs', 'school'); bind('#bc', 'cls'); bind('#bk', 'cat'); bind('#bd', 'date');
  load();
}

/* ---------------- MORE / SETTINGS ---------------- */
function viewMore() {
  title('More');
  app.innerHTML = `
    ${isAdmin() ? `<h2>Admin</h2><div class="card"><ul class="list">
      <li data-go="#/params"><div class="grow"><div class="title">Parameters</div><div class="muted">What is tracked for study and physical training</div></div>›</li>
      <li data-go="#/teachers"><div class="grow"><div class="title">Teachers &amp; admins</div><div class="muted">Logins and access</div></div>›</li>
      <li data-go="#/schools"><div class="grow"><div class="title">Schools</div><div class="muted">Students are tagged to a school</div></div>›</li>
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

/* ---------------- ADMIN: PARAMETERS ---------------- */
function viewParams() {
  title('Parameters', true);
  const typeName = { number: 'Number', grade: 'Grade', yesno: 'Yes / No', text: 'Text' };
  const dir = p => p.type !== 'number' ? '' : p.higher_is_better === '1' ? 'higher is better' : p.higher_is_better === '0' ? 'lower is better' : 'neutral';
  app.innerHTML = `<div class="row"><h2 style="margin:0">Parameters</h2><span class="spacer"></span><button class="btn small" id="addP">+ Add parameter</button></div>
    <p class="muted small">Teachers see these fields when entering progress. Deactivate instead of deleting to keep old history.</p>
    ${['Study', 'Physical'].map(cat => `<h2>${cat === 'Study' ? '📘 Study' : '🏃 Physical training'}</h2><div class="card"><ul class="list">
      ${S.params.filter(p => p.category === cat).sort(byOrder).map(p => `<li data-id="${p.id}"><div class="grow">
        <div class="title">${esc(p.name)} ${p.active !== '1' ? '<span class="tag off">inactive</span>' : ''}</div>
        <div class="muted small">${esc([typeName[p.type], p.unit, (p.min !== '' || p.max !== '') && `${p.min}–${p.max}`, dir(p), p.type === 'grade' && p.options].filter(Boolean).join(' · '))}</div></div>›</li>`).join('')
        || '<div class="empty">None yet.</div>'}</ul></div>`).join('')}`;
  const edit = p => formModal({
    title: p ? 'Edit parameter' : 'New parameter',
    values: p || { category: 'Study', type: 'number', higher_is_better: '1', active: '1', sort_order: String(S.params.length + 1) },
    fields: [
      { name: 'name', label: 'Name', required: true, placeholder: 'e.g. 100m Sprint' },
      { name: 'category', label: 'Category', type: 'segment', options: [['Study', '📘 Study'], ['Physical', '🏃 Physical']] },
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
      toast('Saved'); viewParams();
    }
  });
  $('#addP').onclick = () => edit(null);
  $$('li[data-id]', app).forEach(li => { li.onclick = () => edit(paramOf(li.dataset.id)); });
}

/* ---------------- ADMIN: TEACHERS ---------------- */
function viewTeachers() {
  title('Teachers & admins', true);
  app.innerHTML = `<div class="row"><h2 style="margin:0">Teachers &amp; admins</h2><span class="spacer"></span><button class="btn small" id="addU">+ Add user</button></div>
    <div class="card" style="margin-top:12px"><ul class="list">${S.users.slice().sort((a, b) => a.name.localeCompare(b.name)).map(u => `<li data-id="${u.id}">
      <div class="avatar">${initials(u.name)}</div><div class="grow"><div class="title">${esc(u.name)}</div>
      <div class="muted small">@${esc(u.username)}${u.phone ? ' · ' + esc(u.phone) : ''}</div></div>
      <span class="tag ${u.active !== '1' ? 'off' : ''}">${u.active !== '1' ? 'inactive' : u.role}</span></li>`).join('')}</ul></div>`;
  const edit = u => formModal({
    title: u ? 'Edit user' : 'New teacher / admin',
    values: u || { role: 'teacher', active: '1' },
    fields: [
      { name: 'name', label: 'Full name', required: true },
      { name: 'username', label: 'Username (for login)', required: true, attrs: 'autocapitalize="none"' },
      { name: 'phone', label: 'Phone', type: 'tel' },
      { name: 'role', label: 'Role', type: 'segment', options: [['teacher', 'Teacher'], ['admin', 'Admin']] },
      { name: 'password', label: u ? 'New password (leave blank to keep)' : 'Password (min 6 characters)', type: 'password', required: !u },
      { name: 'active', label: 'Active (can log in)', type: 'checkbox' }
    ],
    onSubmit: async v => {
      if (u) v.id = u.id;
      if (!v.password) delete v.password;
      const saved = await api('saveUser', v);
      const i = S.users.findIndex(x => x.id === saved.id);
      if (i >= 0) S.users[i] = saved; else S.users.push(saved);
      toast('Saved'); viewTeachers();
    }
  });
  $('#addU').onclick = () => edit(null);
  $$('li[data-id]', app).forEach(li => { li.onclick = () => edit(S.users.find(x => x.id === li.dataset.id)); });
}

/* ---------------- ADMIN: SCHOOLS ---------------- */
function viewSchools() {
  title('Schools', true);
  app.innerHTML = `<div class="row"><h2 style="margin:0">Schools</h2><span class="spacer"></span><button class="btn small" id="addS">+ Add school</button></div>
    <div class="card" style="margin-top:12px"><ul class="list">${S.schools.map(sc => `<li data-id="${sc.id}"><div class="grow">
      <div class="title">${esc(sc.name)}</div><div class="muted small">${esc(sc.address)} · ${S.students.filter(s => s.school_id === sc.id).length} students</div></div>
      ${sc.active !== '1' ? '<span class="tag off">inactive</span>' : ''}›</li>`).join('') || '<div class="empty">No schools yet.</div>'}</ul></div>`;
  const edit = sc => formModal({
    title: sc ? 'Edit school' : 'New school', values: sc || { active: '1' },
    fields: [{ name: 'name', label: 'School name', required: true }, { name: 'address', label: 'Address', type: 'textarea' },
      { name: 'active', label: 'Active', type: 'checkbox' }],
    onSubmit: async v => {
      if (sc) v.id = sc.id;
      const saved = await api('saveSchool', v);
      const i = S.schools.findIndex(x => x.id === saved.id);
      if (i >= 0) S.schools[i] = saved; else S.schools.push(saved);
      toast('Saved'); viewSchools();
    }
  });
  $('#addS').onclick = () => edit(null);
  $$('li[data-id]', app).forEach(li => { li.onclick = () => edit(schoolOf(li.dataset.id)); });
}

/* ---------------- start ---------------- */
const ROUTES = {
  home: viewHome, students: viewStudents, student: viewStudent, 'student-edit': viewStudentEdit,
  entry: viewEntry, batch: viewBatch, more: viewMore, params: viewParams, teachers: viewTeachers, schools: viewSchools
};

S.token = store.get('st_token');
try { S.user = JSON.parse(store.get('st_user') || 'null'); } catch (e) { S.user = null; }
window.addEventListener('hashchange', router);
$('#backBtn').onclick = () => (history.length > 1 ? history.back() : go('#/home'));
router();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
