import { FIREBASE_CONFIG, VAPID_PUBLIC_KEY } from './config.js';
import * as sync from './sync.js';

/* =========================================================
   常數
   ========================================================= */
const ICONS = {
  fire: '<svg class="ico" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 3.5-1.5 5.2-2.6 7.2C8.4 11 9 13 10.5 13.6 9.6 11.8 11 10.6 12 9.5c.6 2.6 3.4 3.6 3.4 6.5A3.9 3.9 0 0 1 11.5 20c-3.4 0-6-2.6-6-6 0-5.3 5.4-7.5 6.5-12zm3.8 7.5c2 1.6 3.2 3.8 3.2 6.2A7.3 7.3 0 0 1 12 22a7.3 7.3 0 0 0 5.4-6.4c.1-2.3-.6-4.3-1.6-6.1z"/></svg>',
  cal: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  bolt: '<svg class="ico" viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 2 4 14h7l-1.5 8L20 10h-7z"/></svg>',
  list: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  plusCircle: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8" stroke-linecap="round"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  bell: '🔔',
};
const QUADS = {
  1: { name: '重要且緊急', icon: ICONS.fire },
  2: { name: '重要不緊急', icon: ICONS.cal },
  3: { name: '緊急較不重要', icon: ICONS.bolt },
  4: { name: '不緊急不重要', icon: ICONS.list },
};
const REMIND_OPTS = [
  ['', '不提醒'], ['0', '準時'], ['5', '5 分鐘前'], ['15', '15 分鐘前'],
  ['30', '30 分鐘前'], ['60', '1 小時前'], ['1440', '1 天前'],
];
const DUR_OPTS = [15, 30, 45, 60, 90, 120, 180, 240];
const DOW = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

/* =========================================================
   小工具
   ========================================================= */
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const today = () => ymd(new Date());
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const fromMin = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;

function dateLabel(s) {
  const t = today();
  if (s === t) return '今天';
  if (s === addDays(t, 1)) return '明天';
  if (s === addDays(t, -1)) return '昨天';
  const d = parseYmd(s);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${sameYear ? '' : d.getFullYear() + '/'}${d.getMonth() + 1}/${d.getDate()}（${DOW[d.getDay()].slice(1)}）`;
}
function hourLabel(h) {
  if (h === 0) return '上午12時';
  if (h < 12) return `上午${h}時`;
  if (h === 12) return '下午12時';
  return `下午${h - 12}時`;
}
function timeLabel(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ap = h < 12 ? '上午' : '下午';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${ap}${hh}:${pad(m)}`;
}
export function remindTime(t) {
  if (t.remind === '' || t.remind == null || !t.date) return null;
  const d = parseYmd(t.date);
  const [h, m] = (t.time || '09:00').split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d.getTime() - Number(t.remind) * 60000;
}

/* =========================================================
   資料（本機）
   ========================================================= */
const KEY = 'matrix-todo:v1';
const UIKEY = 'matrix-todo:ui';

function loadData() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && d.tasks && d.matrices) return d;
  } catch {}
  const now = Date.now();
  return { matrices: { default: { id: 'default', name: '預設矩陣', order: 0, updatedAt: now } }, tasks: {} };
}
function loadUi() {
  try { return { tab: 'matrix', matrix: 'default', sel: today(), doneOpen: {}, ...JSON.parse(localStorage.getItem(UIKEY)) }; }
  catch { return { tab: 'matrix', matrix: 'default', sel: today(), doneOpen: {} }; }
}
const data = loadData();
const ui = loadUi();
ui.sel = today();

let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {}
  }, 60);
}
function persistUi() { try { localStorage.setItem(UIKEY, JSON.stringify(ui)); } catch {} }

const matrices = () => Object.values(data.matrices).filter((m) => !m.deleted).sort((a, b) => a.order - b.order || a.updatedAt - b.updatedAt);
const tasks = () => Object.values(data.tasks).filter((t) => !t.deleted);
function currentMatrix() {
  const ms = matrices();
  let m = ms.find((x) => x.id === ui.matrix);
  if (!m) { m = ms[0]; if (!m) { m = { id: uid(), name: '預設矩陣', order: 0 }; putMatrix(m); } ui.matrix = m.id; }
  return m;
}

function putTask(t, { silent } = {}) {
  t.updatedAt = Date.now();
  data.tasks[t.id] = t;
  persist();
  sync.push('tasks', t);
  sync.syncReminder(t, remindTime(t));
  scheduleLocalReminders();
  if (!silent) render();
}
function putMatrix(m) {
  m.updatedAt = Date.now();
  data.matrices[m.id] = m;
  persist();
  sync.push('matrices', m);
  render();
}

// 從雲端收到的資料：比較 updatedAt，新的贏
let remoteRenderTimer;
function applyRemote(kind, doc) {
  const store = data[kind];
  const local = store[doc.id];
  if (local && (local.updatedAt || 0) >= (doc.updatedAt || 0)) return false;
  store[doc.id] = doc;
  persist();
  clearTimeout(remoteRenderTimer);
  remoteRenderTimer = setTimeout(() => { render(); scheduleLocalReminders(); }, 50);
  return true;
}

/* =========================================================
   畫面：矩陣
   ========================================================= */
const elMatrix = $('#matrix');

function sortActive(a, b) {
  const ka = a.date ? a.date + (a.time || '99:99') : '9999';
  const kb = b.date ? b.date + (b.time || '99:99') : '9999';
  if (ka !== kb) return ka < kb ? -1 : 1;
  return (a.createdAt || 0) - (b.createdAt || 0);
}

function taskHtml(t) {
  const meta = [];
  if (t.date) {
    const overdue = !t.done && t.date < today();
    meta.push(`<span class="${overdue ? 'overdue' : ''}">${dateLabel(t.date)}${t.time ? ' ' + timeLabel(t.time) : ''}</span>`);
  }
  if (t.remind !== '' && t.remind != null && t.date && !t.done) meta.push('<span>🔔</span>');
  if (t.note) meta.push('<span>📝</span>');
  return `<div class="task ${t.done ? 'done' : ''}" data-id="${t.id}">
    <button class="check" aria-label="${t.done ? '取消完成' : '完成'}"></button>
    <div class="task-main">
      <div class="task-title">${esc(t.title)}</div>
      ${meta.length ? `<div class="task-meta">${meta.join('')}</div>` : ''}
    </div>
  </div>`;
}

function renderMatrix() {
  const m = currentMatrix();
  $('#matrixName').textContent = m.name;
  const all = tasks().filter((t) => t.matrix === m.id);
  elMatrix.innerHTML = [1, 2, 3, 4].map((q) => {
    const list = all.filter((t) => Number(t.quadrant) === q);
    const active = list.filter((t) => !t.done).sort(sortActive);
    const done = list.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    const open = !!ui.doneOpen[q];
    let body = active.map(taskHtml).join('');
    if (done.length) {
      body += `<button class="done-toggle ${open ? 'open' : ''}" data-q="${q}"><span>已完成 ${done.length}</span>${ICONS.chevron}</button>`;
      if (open) body += done.map(taskHtml).join('');
    }
    if (!active.length && !done.length) {
      body = `<div class="quad-empty"><button class="quad-add-empty" data-q="${q}">${ICONS.plusCircle}<span>輕點以加入</span></button></div>`;
    }
    return `<div class="quad" data-q="${q}">
      <div class="quad-head">${QUADS[q].icon}<span class="quad-title">${QUADS[q].name}</span>
        <span class="quad-count">${active.length || ''}</span>
        <button class="quad-add" data-q="${q}" aria-label="新增到${QUADS[q].name}">${ICONS.plus}</button>
      </div>
      <div class="quad-body">${body}</div>
    </div>`;
  }).join('');
}

let suppressClick = false;
elMatrix.addEventListener('click', (e) => {
  if (suppressClick) { suppressClick = false; return; }
  const add = e.target.closest('.quad-add, .quad-add-empty');
  if (add) return openEditor(null, { quadrant: Number(add.dataset.q) });
  const tog = e.target.closest('.done-toggle');
  if (tog) { ui.doneOpen[tog.dataset.q] = !ui.doneOpen[tog.dataset.q]; persistUi(); return renderMatrix(); }
  const taskEl = e.target.closest('.task');
  if (!taskEl) return;
  const t = data.tasks[taskEl.dataset.id];
  if (!t) return;
  if (e.target.closest('.check')) return toggleDone(t);
  openEditor(t);
});

function toggleDone(t) {
  const was = { done: t.done, doneAt: t.doneAt };
  t.done = !t.done;
  t.doneAt = t.done ? Date.now() : null;
  putTask(t);
  if (t.done) toast('已完成', () => { Object.assign(t, was); putTask(t); });
}

/* ---- 長按拖曳到別的象限 ---- */
let pending = null, drag = null;
elMatrix.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.task');
  if (!el || e.target.closest('.check') || e.button > 0) return;
  pending = { x: e.clientX, y: e.clientY, el, id: el.dataset.id, mouse: e.pointerType === 'mouse' };
  if (!pending.mouse) pending.timer = setTimeout(() => beginDrag(pending.x, pending.y), 320);
});
function beginDrag(x, y) {
  if (!pending) return;
  const t = data.tasks[pending.id];
  if (!t) { pending = null; return; }
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.textContent = t.title;
  document.body.appendChild(ghost);
  pending.el.classList.add('dragging');
  drag = { ...pending, ghost, t };
  pending = null;
  moveDrag(x, y);
  if (navigator.vibrate) navigator.vibrate(10);
}
function quadAt(x, y) {
  const el = document.elementFromPoint(x, y);
  return el ? el.closest('.quad') : null;
}
function moveDrag(x, y) {
  drag.ghost.style.left = x + 'px';
  drag.ghost.style.top = y + 'px';
  const q = quadAt(x, y);
  elMatrix.querySelectorAll('.quad').forEach((n) => n.classList.toggle('drop', n === q && Number(n.dataset.q) !== Number(drag.t.quadrant)));
}
window.addEventListener('pointermove', (e) => {
  if (drag) return moveDrag(e.clientX, e.clientY);
  if (!pending) return;
  const dist = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
  if (dist > 8) {
    if (pending.mouse) beginDrag(e.clientX, e.clientY);
    else { clearTimeout(pending.timer); pending = null; }
  }
});
function endDrag(e, cancel) {
  if (pending) { clearTimeout(pending.timer); pending = null; }
  if (!drag) return;
  const q = cancel ? null : quadAt(e.clientX, e.clientY);
  drag.ghost.remove();
  drag.el.classList.remove('dragging');
  elMatrix.querySelectorAll('.quad').forEach((n) => n.classList.remove('drop'));
  const t = drag.t;
  drag = null;
  suppressClick = true;
  setTimeout(() => (suppressClick = false), 400);
  if (q && Number(q.dataset.q) !== Number(t.quadrant)) {
    const from = t.quadrant;
    t.quadrant = Number(q.dataset.q);
    putTask(t);
    toast(`移到「${QUADS[t.quadrant].name}」`, () => { t.quadrant = from; putTask(t); });
  }
}
window.addEventListener('pointerup', (e) => endDrag(e, false));
window.addEventListener('pointercancel', (e) => endDrag(e, true));
// 拖曳中禁止畫面捲動（iOS 需要非被動的 touchmove）
document.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', (e) => { if (e.target.closest('.task')) e.preventDefault(); });

/* =========================================================
   畫面：行事曆
   ========================================================= */
const elWeek = $('#week'), elAllday = $('#allday'), elTimeline = $('#timeline'), elTlWrap = $('#timelineWrap');

function tasksOn(dateStr) {
  return tasks().filter((t) => t.date === dateStr);
}

function renderCal() {
  const sel = parseYmd(ui.sel);
  const ml = $('#monthLabel');
  ml.innerHTML = `${sel.getFullYear()}年${sel.getMonth() + 1}月 ${ICONS.chevron}<input type="date" id="jumpDate" value="${ui.sel}" aria-label="跳到日期">`;
  ml.style.position = 'relative';
  ml.style.display = 'flex';
  ml.style.alignItems = 'center';
  ml.style.gap = '4px';
  const jd = $('#jumpDate');
  Object.assign(jd.style, { position: 'absolute', inset: '0', opacity: '0', width: '100%' });
  jd.onchange = () => { if (jd.value) { ui.sel = jd.value; persistUi(); renderCal(); scrollTimeline(); } };

  // 週條（週日開始）
  const start = addDays(ui.sel, -sel.getDay());
  const t0 = today();
  let wk = '';
  for (let i = 0; i < 7; i++) {
    const ds = addDays(start, i);
    const d = parseYmd(ds);
    const qs = [...new Set(tasksOn(ds).filter((t) => !t.done).map((t) => Number(t.quadrant)))].sort().slice(0, 4);
    wk += `<button class="day ${i === 0 || i === 6 ? 'weekend' : ''} ${ds === t0 ? 'today' : ''} ${ds === ui.sel ? 'sel' : ''}" data-d="${ds}">
      <span class="dow">${DOW[d.getDay()]}</span><span class="num">${d.getDate()}</span>
      <span class="dots">${qs.map((q) => `<i data-q="${q}"></i>`).join('')}</span></button>`;
  }
  elWeek.innerHTML = wk;

  // 全天
  const dayTasks = tasksOn(ui.sel);
  const allday = dayTasks.filter((t) => !t.time).sort((a, b) => a.done - b.done || a.quadrant - b.quadrant);
  elAllday.innerHTML = allday.length
    ? `<div class="allday-label">全天</div>` + allday.map((t) => `<button class="ev-chip ${t.done ? 'done' : ''}" data-q="${t.quadrant}" data-id="${t.id}">${esc(t.title)}</button>`).join('')
    : '';

  // 時間軸
  let html = '';
  for (let h = 0; h < 24; h++) html += `<div class="hour" style="top:calc(var(--hour) * ${h})"><span>${h === 0 ? '' : hourLabel(h)}</span></div>`;
  const timed = dayTasks.filter((t) => t.time).map((t) => {
    const s = toMin(t.time);
    return { t, s, e: Math.min(24 * 60, s + (Number(t.duration) || 30)) };
  }).sort((a, b) => a.s - b.s || b.e - a.e);
  // 重疊時分欄
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const cols = [];
    cluster.forEach((it) => {
      let c = cols.findIndex((end) => end <= it.s);
      if (c === -1) { c = cols.length; cols.push(0); }
      cols[c] = it.e; it.col = c;
    });
    cluster.forEach((it) => (it.cols = cols.length));
    cluster = [];
  };
  timed.forEach((it) => {
    if (it.s >= clusterEnd && cluster.length) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.e);
  });
  if (cluster.length) flush();
  const hourPx = 56, left = 62;
  timed.forEach(({ t, s, e, col, cols }) => {
    const top = (s / 60) * hourPx;
    const height = Math.max(22, ((e - s) / 60) * hourPx - 2);
    const w = `calc((100% - ${left}px) / ${cols})`;
    html += `<button class="ev ${t.done ? 'done' : ''}" data-q="${t.quadrant}" data-id="${t.id}"
      style="top:${top}px;height:${height}px;left:calc(${left}px + ${w} * ${col});width:calc(${w} - 3px)">
      <b>${esc(t.title)}</b>${height > 34 ? `<small>${timeLabel(t.time)} – ${timeLabel(fromMin(e))}</small>` : ''}</button>`;
  });
  if (ui.sel === t0) {
    const n = new Date();
    html += `<div class="now-line" style="top:${((n.getHours() * 60 + n.getMinutes()) / 60) * hourPx}px"></div>`;
  }
  elTimeline.innerHTML = html;
}

function scrollTimeline() {
  const n = new Date();
  const h = ui.sel === today() ? Math.max(0, n.getHours() - 1) : 8;
  elTlWrap.scrollTop = h * 56;
}

elWeek.addEventListener('click', (e) => {
  const d = e.target.closest('.day');
  if (!d) return;
  ui.sel = d.dataset.d; persistUi(); renderCal();
});
// 左右滑動換週
let wx = null;
elWeek.addEventListener('touchstart', (e) => (wx = e.touches[0].clientX), { passive: true });
elWeek.addEventListener('touchend', (e) => {
  if (wx == null) return;
  const dx = e.changedTouches[0].clientX - wx;
  wx = null;
  if (Math.abs(dx) > 50) { ui.sel = addDays(ui.sel, dx < 0 ? 7 : -7); persistUi(); renderCal(); }
});
$('#todayBtn').addEventListener('click', () => { ui.sel = today(); persistUi(); renderCal(); scrollTimeline(); });
elAllday.addEventListener('click', (e) => {
  const c = e.target.closest('[data-id]');
  if (c && data.tasks[c.dataset.id]) openEditor(data.tasks[c.dataset.id]);
});
elTimeline.addEventListener('click', (e) => {
  const ev = e.target.closest('.ev');
  if (ev) return data.tasks[ev.dataset.id] && openEditor(data.tasks[ev.dataset.id]);
  const rect = elTimeline.getBoundingClientRect();
  const min = Math.floor(((e.clientY - rect.top) / 56) * 2) * 30;
  if (min < 0 || min >= 24 * 60) return;
  openEditor(null, { date: ui.sel, time: fromMin(min), duration: 60, quadrant: 2 });
});

/* =========================================================
   編輯任務（底部面板）
   ========================================================= */
const elSheet = $('#sheet'), elBackdrop = $('#backdrop');
let sheetClose = null;

function showSheet(html, onClose) {
  elSheet.innerHTML = `<div class="grabber"></div>${html}`;
  elSheet.hidden = false; elBackdrop.hidden = false;
  requestAnimationFrame(() => { elSheet.classList.add('show'); elBackdrop.classList.add('show'); });
  sheetClose = onClose || null;
}
function hideSheet() {
  elSheet.classList.remove('show'); elBackdrop.classList.remove('show');
  setTimeout(() => { elSheet.hidden = true; elBackdrop.hidden = true; elSheet.innerHTML = ''; }, 220);
  const f = sheetClose; sheetClose = null;
  if (f) f();
}
elBackdrop.addEventListener('click', hideSheet);
// 往下滑關閉
let sy = null;
elSheet.addEventListener('touchstart', (e) => { sy = elSheet.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
elSheet.addEventListener('touchend', (e) => {
  if (sy != null && e.changedTouches[0].clientY - sy > 90 && !e.target.closest('input,textarea,select')) hideSheet();
  sy = null;
});

function openEditor(task, defaults = {}) {
  const isNew = !task;
  const d = isNew
    ? { id: uid(), title: '', note: '', quadrant: 1, matrix: currentMatrix().id, date: '', time: '', duration: 60, remind: '', done: false, createdAt: Date.now(), ...defaults }
    : { ...task };
  if (d.time && !d.date) d.date = ui.sel;

  const ms = matrices();
  const formRows = () => `
    <div class="row"><span>日期</span>
      ${d.date
        ? `<span style="display:flex;align-items:center"><input type="date" id="fDate" value="${d.date}"><button class="clear" id="clrDate">清除</button></span>`
        : `<button class="link" id="setDate">加入日期</button>`}
    </div>
    ${d.date ? `<div class="row"><span>時間</span>
      ${d.time
        ? `<span style="display:flex;align-items:center"><input type="time" id="fTime" value="${d.time}"><button class="clear" id="clrTime">全天</button></span>`
        : `<button class="link" id="setTime">全天 · 設定時間</button>`}
    </div>` : ''}
    ${d.date && d.time ? `<div class="row"><span>長度</span><select id="fDur">${DUR_OPTS.map((m) => `<option value="${m}" ${Number(d.duration) === m ? 'selected' : ''}>${m < 60 ? m + ' 分鐘' : m / 60 + ' 小時'}</option>`).join('')}</select></div>` : ''}
    ${d.date ? `<div class="row"><span>提醒</span><select id="fRemind">${REMIND_OPTS.map(([v, l]) => `<option value="${v}" ${String(d.remind ?? '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : ''}
    ${ms.length > 1 ? `<div class="row"><span>矩陣</span><select id="fMatrix">${ms.map((m) => `<option value="${m.id}" ${m.id === d.matrix ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>` : ''}
  `;

  showSheet(`
    <div class="sheet-head">
      <button class="link muted" id="eCancel">取消</button>
      <h3>${isNew ? '新增任務' : '編輯任務'}</h3>
      <button class="link" id="eSave">${isNew ? '加入' : '完成'}</button>
    </div>
    <input class="title-input" id="fTitle" placeholder="要做什麼？" value="${esc(d.title)}" enterkeyhint="done">
    <textarea class="note-input" id="fNote" placeholder="備註" rows="2">${esc(d.note)}</textarea>
    <div class="qpick" id="qpick">${[1, 2, 3, 4].map((q) => `<button data-q="${q}" class="${Number(d.quadrant) === q ? 'on' : ''}">${QUADS[q].icon}${QUADS[q].name}</button>`).join('')}</div>
    <div class="form" id="form">${formRows()}</div>
    ${!isNew ? `<div class="btn-row" style="margin-top:14px">
      <button class="btn ghost" id="eDone">${d.done ? '標為未完成' : '標為完成'}</button>
      <button class="btn danger" id="eDel">刪除</button></div>` : ''}
  `);

  const readForm = () => {
    d.title = $('#fTitle').value.trim();
    d.note = $('#fNote').value.trim();
    if ($('#fDate')) d.date = $('#fDate').value || '';
    if ($('#fTime')) d.time = $('#fTime').value || '';
    if ($('#fDur')) d.duration = Number($('#fDur').value);
    if ($('#fRemind')) d.remind = $('#fRemind').value;
    if ($('#fMatrix')) d.matrix = $('#fMatrix').value;
  };
  const rerenderForm = () => { $('#form').innerHTML = formRows(); };

  elSheet.onclick = (e) => {
    const qb = e.target.closest('#qpick button');
    if (qb) {
      d.quadrant = Number(qb.dataset.q);
      elSheet.querySelectorAll('#qpick button').forEach((b) => b.classList.toggle('on', b === qb));
      return;
    }
    const id = e.target.closest('button')?.id;
    if (!id) return;
    if (id === 'setDate') { readForm(); d.date = ui.tab === 'cal' ? ui.sel : today(); rerenderForm(); }
    if (id === 'clrDate') { readForm(); d.date = ''; d.time = ''; d.remind = ''; rerenderForm(); }
    if (id === 'setTime') {
      readForm();
      const n = new Date();
      d.time = d.date === today() ? fromMin(Math.min(23 * 60, (n.getHours() + 1) * 60)) : '09:00';
      rerenderForm();
    }
    if (id === 'clrTime') { readForm(); d.time = ''; rerenderForm(); }
    if (id === 'eCancel') hideSheet();
    if (id === 'eSave') save();
    if (id === 'eDone') {
      readForm();
      d.done = !d.done; d.doneAt = d.done ? Date.now() : null;
      save();
    }
    if (id === 'eDel') {
      const orig = data.tasks[d.id];
      orig.deleted = true;
      putTask(orig);
      hideSheet();
      toast('已刪除', () => { orig.deleted = false; putTask(orig); });
    }
  };
  function save() {
    readForm();
    if (!d.title) {
      if (isNew) return hideSheet();
      $('#fTitle').focus();
      return;
    }
    if (!d.date) { d.time = ''; d.remind = ''; }
    putTask(isNew ? d : Object.assign(data.tasks[d.id], d));
    hideSheet();
  }
  $('#fTitle').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); save(); } });
  if (isNew) setTimeout(() => $('#fTitle')?.focus(), 260);
}

/* =========================================================
   切換矩陣
   ========================================================= */
$('#matrixSwitch').addEventListener('click', openMatrixSheet);
function openMatrixSheet() {
  const draw = () => {
    const ms = matrices();
    const counts = {};
    tasks().forEach((t) => { if (!t.done) counts[t.matrix] = (counts[t.matrix] || 0) + 1; });
    return `<div class="sheet-head"><span></span><h3>矩陣</h3><button class="link" id="mDone">完成</button></div>
      ${ms.map((m) => `<div class="list-item ${m.id === ui.matrix ? 'on' : ''}" data-id="${m.id}">
        <button class="grow" data-act="pick" style="text-align:left">${esc(m.name)}</button>
        <span class="count">${counts[m.id] || 0}</span>
        <button class="icon-btn" data-act="rename" aria-label="改名">${ICONS.pencil}</button>
        ${ms.length > 1 ? `<button class="icon-btn" data-act="del" aria-label="刪除">${ICONS.trash}</button>` : ''}
      </div>`).join('')}
      <button class="btn ghost" id="mAdd" style="width:100%;margin-top:14px">＋ 新增矩陣</button>`;
  };
  showSheet(draw());
  const redraw = () => { elSheet.innerHTML = `<div class="grabber"></div>${draw()}`; };
  elSheet.onclick = (e) => {
    if (e.target.closest('#mDone')) return hideSheet();
    if (e.target.closest('#mAdd')) {
      const name = prompt('新矩陣的名稱', '');
      if (name && name.trim()) {
        const m = { id: uid(), name: name.trim(), order: matrices().length };
        putMatrix(m); ui.matrix = m.id; persistUi(); render(); redraw();
      }
      return;
    }
    const row = e.target.closest('.list-item');
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!row || !act) return;
    const m = data.matrices[row.dataset.id];
    if (act === 'pick') { ui.matrix = m.id; persistUi(); render(); hideSheet(); }
    if (act === 'rename') {
      const name = prompt('矩陣名稱', m.name);
      if (name && name.trim()) { m.name = name.trim(); putMatrix(m); redraw(); }
    }
    if (act === 'del') {
      const n = tasks().filter((t) => t.matrix === m.id).length;
      if (!confirm(`刪除「${m.name}」${n ? `和裡面的 ${n} 個任務` : ''}？`)) return;
      tasks().filter((t) => t.matrix === m.id).forEach((t) => { t.deleted = true; putTask(t, { silent: true }); });
      m.deleted = true; putMatrix(m);
      if (ui.matrix === m.id) { ui.matrix = matrices()[0]?.id; persistUi(); }
      render(); redraw();
    }
  };
}

/* =========================================================
   設定頁
   ========================================================= */
let syncState = { status: sync.configured(FIREBASE_CONFIG) ? 'signedout' : 'off', user: null, error: '' };

function renderSettings() {
  const s = syncState;
  let account = '';
  if (s.status === 'off') {
    account = `<div class="card"><div class="row"><div><div>尚未設定同步</div>
      <div class="sub">在 config.js 填入 Firebase 設定後，電腦和手機就能同步（步驟見 SETUP.md）。目前資料只存在這台裝置。</div></div></div></div>`;
  } else if (!s.user) {
    account = `<div class="card"><div class="row col">
      <div class="sub" style="margin-bottom:8px">登入同一個帳號，電腦和手機就會即時同步。</div>
      <input class="field" id="sEmail" type="email" placeholder="Email" autocomplete="username" style="margin-bottom:8px">
      <input class="field" id="sPw" type="password" placeholder="密碼（至少 6 碼）" autocomplete="current-password" style="margin-bottom:10px">
      <div class="btn-row"><button class="btn" id="sIn">登入</button><button class="btn ghost" id="sUp">建立帳號</button></div>
      ${s.error ? `<div class="sub" style="color:var(--danger);margin-top:8px">${esc(s.error)}</div>` : ''}
    </div></div>`;
  } else {
    const label = { syncing: '同步中…', on: '已同步', error: '同步出錯' }[s.status] || '';
    account = `<div class="card">
      <div class="row"><div><div>${esc(s.user.email)}</div><div class="sub">${label}${s.error ? '：' + esc(s.error) : ''}</div></div>
      <button class="link danger" id="sOut">登出</button></div></div>`;
  }

  const notifSupported = 'Notification' in window && 'serviceWorker' in navigator;
  const perm = notifSupported ? Notification.permission : 'unsupported';
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  let notifSub = '';
  if (!notifSupported) notifSub = isIOS && !standalone ? 'iPhone 要先用 Safari「分享 → 加入主畫面」，再從主畫面的圖示打開，才能開通知。' : '這個瀏覽器不支援通知。';
  else if (perm === 'granted') notifSub = localStorage.getItem('pushOn') === '1' ? '已開啟（App 關著也會收到）' : '已開啟（App 開著時會跳提醒）';
  else if (perm === 'denied') notifSub = '你之前拒絕了通知，要到系統設定裡打開。';
  else notifSub = '任務設了提醒，時間到會跳通知。';

  $('#settings').innerHTML = `
    <div class="group-title" style="margin-top:4px">同步帳號</div>${account}
    <div class="group-title">通知</div>
    <div class="card">
      <div class="row"><div><div>提醒通知</div><div class="sub">${notifSub}</div></div>
        ${notifSupported && perm !== 'denied' ? `<button class="link" id="nOn">${perm === 'granted' ? '測試' : '開啟'}</button>` : ''}</div>
      ${notifSupported && perm === 'granted' && syncState.user && VAPID_PUBLIC_KEY && localStorage.getItem('pushOn') !== '1'
        ? `<div class="row"><span>App 關著也要收到</span><button class="link" id="nPush">開啟</button></div>` : ''}
    </div>
    <div class="group-title">資料</div>
    <div class="card">
      <div class="row"><span>匯出備份</span><button class="link" id="dExport">匯出</button></div>
      <div class="row"><span>匯入備份</span><label class="link" style="cursor:pointer">匯入<input type="file" id="dImport" accept="application/json,.json" hidden></label></div>
      <div class="row"><span>清除目前矩陣的已完成任務</span><button class="link danger" id="dClear">清除</button></div>
    </div>
    ${!standalone ? `<p class="note">在 iPhone 上：用 Safari 打開這個網址 → 點下方「分享」→「加入主畫面」，就會像 App 一樣全螢幕使用。</p>` : ''}
    <p class="note">矩陣待辦 · v1.0</p>`;
}

$('#settings').addEventListener('click', async (e) => {
  const id = e.target.closest('button')?.id;
  if (id === 'sIn' || id === 'sUp') {
    const email = $('#sEmail').value.trim(), pw = $('#sPw').value;
    if (!email || !pw) { syncState.error = '請輸入 Email 和密碼'; return renderSettings(); }
    syncState.error = ''; e.target.textContent = '處理中…';
    try { id === 'sIn' ? await sync.signIn(email, pw) : await sync.signUp(email, pw); }
    catch (err) { syncState.error = sync.errMsg(err); renderSettings(); }
  }
  if (id === 'sOut') { if (confirm('登出後這台裝置不再同步（資料會留在這台）。確定？')) { localStorage.removeItem('pushOn'); await sync.signOut(); } }
  if (id === 'nOn') {
    if (Notification.permission === 'granted') { await showLocalNotification('測試通知', '通知正常運作 👍', 'test'); }
    else { await enableNotifications(); }
    renderSettings();
  }
  if (id === 'nPush') { await enablePush(); renderSettings(); }
  if (id === 'dExport') exportData();
  if (id === 'dClear') {
    const done = tasks().filter((t) => t.matrix === currentMatrix().id && t.done);
    if (!done.length) return toast('沒有已完成的任務');
    if (!confirm(`清除 ${done.length} 個已完成任務？`)) return;
    done.forEach((t) => { t.deleted = true; putTask(t, { silent: true }); });
    render(); toast(`已清除 ${done.length} 個`);
  }
});
$('#settings').addEventListener('change', async (e) => {
  if (e.target.id !== 'dImport') return;
  const f = e.target.files[0];
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    let n = 0;
    for (const kind of ['matrices', 'tasks']) {
      for (const doc of Object.values(j[kind] || {})) {
        if (applyRemote(kind, doc)) { n++; sync.push(kind, doc); if (kind === 'tasks') sync.syncReminder(doc, remindTime(doc)); }
      }
    }
    toast(`匯入完成，更新了 ${n} 筆`);
  } catch { toast('檔案格式不對'); }
  e.target.value = '';
});

function exportData() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `矩陣待辦備份-${today()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* =========================================================
   通知
   ========================================================= */
let swReg = null;
async function getReg() {
  if (swReg) return swReg;
  if (!('serviceWorker' in navigator)) return null;
  swReg = await navigator.serviceWorker.ready;
  return swReg;
}
async function showLocalNotification(title, body, tag) {
  const reg = await getReg();
  if (reg) return reg.showNotification(title, { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: './' } });
  new Notification(title, { body, tag });
}
async function enableNotifications() {
  const p = await Notification.requestPermission();
  if (p !== 'granted') return toast('沒有開啟通知');
  toast('通知已開啟');
  scheduleLocalReminders();
  if (syncState.user && VAPID_PUBLIC_KEY) await enablePush();
}
function b64ToU8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
async function enablePush() {
  try {
    const reg = await getReg();
    if (!reg || !reg.pushManager) return toast('這台裝置不支援推播');
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(VAPID_PUBLIC_KEY) });
    await sync.savePushSub(sub.toJSON());
    localStorage.setItem('pushOn', '1');
    toast('推播已開啟，App 關著也會提醒');
  } catch (err) {
    console.error(err);
    toast('推播開啟失敗：' + (err.message || err));
  }
}

// App 開著時的本機提醒（這台沒開推播時才用，避免重複）
let localTimers = [];
function scheduleLocalReminders() {
  localTimers.forEach(clearTimeout);
  localTimers = [];
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (localStorage.getItem('pushOn') === '1') return;
  const now = Date.now();
  tasks().forEach((t) => {
    if (t.done) return;
    const at = remindTime(t);
    if (!at || at <= now || at - now > 24 * 3600 * 1000) return;
    localTimers.push(setTimeout(() => {
      const cur = data.tasks[t.id];
      if (!cur || cur.deleted || cur.done || remindTime(cur) !== at) return;
      showLocalNotification(cur.title, reminderBody(cur), cur.id);
    }, at - now));
  });
}
export function reminderBody(t) {
  const parts = [QUADS[t.quadrant]?.name];
  if (t.date) parts.push(dateLabel(t.date) + (t.time ? ' ' + timeLabel(t.time) : ''));
  return parts.filter(Boolean).join(' · ');
}

/* =========================================================
   分頁 / FAB / 提示
   ========================================================= */
const views = { matrix: $('#viewMatrix'), cal: $('#viewCal'), settings: $('#viewSettings') };
$('#tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  setTab(b.dataset.tab);
});
function setTab(tab) {
  const wide = matchMedia('(min-width: 960px)').matches;
  if (wide && tab === 'cal') tab = 'matrix';
  const prev = ui.tab;
  ui.tab = tab; persistUi();
  Object.entries(views).forEach(([k, v]) => v.classList.toggle('active', k === tab));
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#fab').hidden = tab === 'settings';
  $('#matrixSwitch').style.visibility = tab === 'matrix' || wide ? 'visible' : 'hidden';
  render();
  if (tab === 'cal' && prev !== 'cal') scrollTimeline();
}
$('#fab').addEventListener('click', () => {
  const wide = matchMedia('(min-width: 960px)').matches;
  if (ui.tab === 'cal' && !wide) {
    const n = new Date();
    const time = ui.sel === today() ? fromMin(Math.min(23 * 60, (n.getHours() + 1) * 60)) : '09:00';
    openEditor(null, { date: ui.sel, time, duration: 60, quadrant: 2 });
  } else openEditor(null, { quadrant: 1 });
});

let toastTimer;
function toast(msg, undo) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button id="undoBtn">復原</button>' : ''}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), undo ? 4000 : 2200);
  if (undo) $('#undoBtn').onclick = () => { el.hidden = true; undo(); };
}

function render() {
  const wide = matchMedia('(min-width: 960px)').matches;
  if (ui.tab === 'matrix' || wide) renderMatrix();
  if (ui.tab === 'cal' || wide) renderCal();
  if (ui.tab === 'settings') renderSettings();
  const dot = $('#syncDot');
  dot.className = 'sync-dot ' + ({ on: 'on', syncing: 'busy', error: 'err' }[syncState.status] || '');
  dot.title = { off: '未設定同步', signedout: '未登入', syncing: '同步中', on: '已同步', error: '同步出錯' }[syncState.status];
}

/* =========================================================
   啟動
   ========================================================= */
matchMedia('(min-width: 960px)').addEventListener('change', () => setTab(ui.tab));
setInterval(() => { if (ui.tab === 'cal' || matchMedia('(min-width: 960px)').matches) renderCal(); }, 60000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { render(); scheduleLocalReminders(); }
});

setTab(ui.tab === 'settings' ? 'matrix' : ui.tab);
scrollTimeline();
scheduleLocalReminders();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW 註冊失敗', e));
}

sync.init(FIREBASE_CONFIG, {
  getLocal: (kind) => Object.values(data[kind]),
  onRemote: applyRemote,
  remindTime,
  reminderBody,
  onState: (s) => {
    syncState = { ...syncState, ...s };
    if (!s.user && s.status === 'signedout') localStorage.removeItem('pushOn');
    render();
  },
});
