import { FIREBASE_CONFIG, VAPID_PUBLIC_KEY } from './config.js';
import * as sync from './sync.js';
import * as weather from './weather.js';
import * as focus from './focus.js';
import * as wallpaper from './wallpaper.js';
import { REPEAT_TYPES, repeatLabel, nextOccurrence, upcoming } from './repeat.js';
import {
  $, $$, esc, uid, pad, ymd, parseYmd, addDays, today, toMin, fromMin, DOW, DOW1,
  dateLabel, longDate, hourLabel, timeLabel, clockLabel, durLabel,
  ICONS, ICON_CHOICES, COLOR_CHOICES, DEFAULT_QUADS, iconHtml,
} from './util.js';

/* =========================================================
   常數
   ========================================================= */
const REMIND_OPTS = [['0', '準時'], ['5', '5 分鐘前'], ['15', '15 分鐘前'], ['30', '30 分鐘前'], ['60', '1 小時前'], ['1440', '1 天前']];
const DUR_OPTS = [15, 30, 45, 60, 90, 120, 180, 240];
const TIME_PRESETS = [['早上', '09:00'], ['中午', '12:00'], ['晚上', '18:00'], ['夜晚', '21:00']];
const ACCENTS = ['#3b82f6', '#f5a524', '#a855f7', '#22c55e', '#ff5a5f', '#14b8a6', '#ec4899'];
const ALL = '__all__';
const HOUR = 56;

/* =========================================================
   偏好設定（每台裝置各自的）
   ========================================================= */
const PKEY = 'matrix-todo:prefs';
const prefs = {
  weekStart: 0, hideTasksInCal: false, hideDoneInCal: false, autoDelete: 0,
  theme: 'system', accent: '#3b82f6', summaryAuto: true, showWeather: true, unit: 'c', useGps: false,
  sort: 'custom', filter: 'all', addPos: 'top',
  calMode: 'timeline', monthStyle: 'line', calLayout: 'side', calScale: 1, wallBg: '#0e0e10',
  // 鎖定畫面桌布的版面參數，預設值 = 改版前的外觀。會同步到 Firestore 給 Scriptable 用。
  wallPos: wallpaper.WALL_RANGE.pos.def, wallSize: wallpaper.WALL_RANGE.size.def,
  wallFont: wallpaper.WALL_RANGE.font.def, wallBlur: wallpaper.WALL_RANGE.blur.def,
  wallBright: wallpaper.WALL_RANGE.bright.def, wallBgMode: 'color', wallMockNP: false,
  wallShortcut: '設定背景圖片的照片', // 一鍵更新要叫的捷徑名稱
  wallShowTitle: true, // 桌布左上角要不要顯示矩陣名稱
  ...(() => { try { return JSON.parse(localStorage.getItem(PKEY)) || {}; } catch { return {}; } })(),
};
const savePrefs = () => { try { localStorage.setItem(PKEY, JSON.stringify(prefs)); } catch {} };

/* =========================================================
   資料
   ========================================================= */
const KEY = 'matrix-todo:v1';
const UIKEY = 'matrix-todo:ui';
function loadData() {
  let d;
  try { d = JSON.parse(localStorage.getItem(KEY)); } catch {}
  if (!d || !d.tasks || !d.matrices) {
    d = { matrices: { default: { id: 'default', name: '預設矩陣', order: 0, updatedAt: Date.now() } }, tasks: {} };
  }
  d.sessions = d.sessions || {};
  // 舊版提醒格式（remind 有值就代表要通知）
  Object.values(d.tasks).forEach((t) => {
    if (t.notify === undefined) t.notify = t.remind !== '' && t.remind != null;
    if (t.notify && (t.remind === '' || t.remind == null)) t.remind = '0';
    if (t.order === undefined) t.order = t.createdAt || 0;
  });
  return d;
}
const data = loadData();
const ui = { tab: 'matrix', matrix: 'default', sel: today(), doneOpen: {}, search: '', ...(() => { try { return JSON.parse(localStorage.getItem(UIKEY)) || {}; } catch { return {}; } })() };
ui.sel = today(); ui.search = '';
const persistUi = () => { try { localStorage.setItem(UIKEY, JSON.stringify({ tab: ui.tab, matrix: ui.matrix, doneOpen: ui.doneOpen })); } catch {} };

let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {} }, 60);
}

const matrices = () => Object.values(data.matrices).filter((m) => !m.deleted).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.updatedAt - b.updatedAt);
const tasks = () => Object.values(data.tasks).filter((t) => !t.deleted);
const sessions = () => Object.values(data.sessions).filter((s) => !s.deleted);
function currentMatrix() {
  if (ui.matrix === ALL) return { id: ALL, name: '所有任務', quads: matrices()[0]?.quads };
  const ms = matrices();
  let m = ms.find((x) => x.id === ui.matrix);
  if (!m) { m = ms[0]; if (!m) { m = { id: uid(), name: '預設矩陣', order: 0 }; putMatrix(m, true); } ui.matrix = m.id; }
  return m;
}
function quad(matrixId, q) {
  const m = data.matrices[matrixId] || matrices()[0] || {};
  return { ...DEFAULT_QUADS[q], ...((m.quads || {})[q] || {}) };
}
const qColor = (t) => quad(t.matrix, t.quadrant).color;

export function remindTime(t) {
  if (!t.notify || !t.date) return null;
  const d = parseYmd(t.date);
  const [h, m] = (t.time || '09:00').split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d.getTime() - Number(t.remind || 0) * 60000;
}
export function reminderBody(t) {
  const parts = [quad(t.matrix, t.quadrant).name];
  if (t.date) parts.push(dateLabel(t.date) + (t.time ? ' ' + timeLabel(t.time) : ''));
  return parts.filter(Boolean).join(' · ');
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
function putMatrix(m, silent) {
  m.updatedAt = Date.now();
  data.matrices[m.id] = m;
  persist();
  sync.push('matrices', m);
  if (!silent) render();
}
function putSession(s) {
  s.updatedAt = Date.now();
  data.sessions[s.id] = s;
  persist();
  sync.push('sessions', s);
  render();
}
let remoteRenderTimer;
function applyRemote(kind, doc) {
  const store = data[kind];
  if (!store) return false;
  const local = store[doc.id];
  if (local && (local.updatedAt || 0) >= (doc.updatedAt || 0)) return false;
  store[doc.id] = doc;
  persist();
  clearTimeout(remoteRenderTimer);
  remoteRenderTimer = setTimeout(() => { render(); scheduleLocalReminders(); }, 50);
  return true;
}

function newTask(defaults = {}) {
  const mid = ui.matrix === ALL ? matrices()[0].id : currentMatrix().id;
  return {
    id: uid(), title: '', note: '', quadrant: 1, matrix: mid, date: '', time: '', duration: 60,
    notify: false, remind: '0', repeat: null, done: false, createdAt: Date.now(), ...defaults,
  };
}
function orderFor(t) {
  const same = tasks().filter((x) => x.matrix === t.matrix && Number(x.quadrant) === Number(t.quadrant) && x.id !== t.id);
  if (!same.length) return Date.now();
  const os = same.map((x) => x.order ?? 0);
  return prefs.addPos === 'top' ? Math.min(...os) - 1 : Math.max(...os) + 1;
}

/* ---- 完成 / 重複 ---- */
function setDone(t, done) {
  if (!!t.done === done) return;
  if (done && t.repeat && t.repeat.type) {
    const next = nextOccurrence(t);
    t.done = true; t.doneAt = Date.now();
    let nt = null;
    if (next) {
      nt = { ...t, id: uid(), date: next, done: false, doneAt: null, createdAt: Date.now(), repeatOf: t.repeatOf || t.id };
      putTask(nt, { silent: true });
    }
    putTask(t);
    toast(next ? `已完成，下一次：${dateLabel(next)}` : '已完成（重複已結束）', () => {
      t.done = false; t.doneAt = null; putTask(t, { silent: true });
      if (nt) { nt.deleted = true; putTask(nt); } else render();
    });
    return;
  }
  t.done = done; t.doneAt = done ? Date.now() : null;
  putTask(t);
  if (done) toast('已完成', () => { t.done = false; t.doneAt = null; putTask(t); });
}

/* =========================================================
   畫面：矩陣
   ========================================================= */
const elMatrix = $('#matrix');

function filterTasks(list) {
  const t0 = today();
  if (prefs.filter === 'today') return list.filter((t) => t.done ? t.doneAt && ymd(new Date(t.doneAt)) === t0 : (t.date && t.date <= t0));
  if (prefs.filter === 'todayRepeat') return list.filter((t) => t.repeat && t.repeat.type && (t.done ? t.doneAt && ymd(new Date(t.doneAt)) === t0 : (t.date && t.date <= t0)));
  return list;
}
function sorter() {
  const key = (t) => (t.date ? t.date + (t.time || '99:99') : null);
  if (prefs.sort === 'dueAsc' || prefs.sort === 'dueDesc') {
    const dir = prefs.sort === 'dueAsc' ? 1 : -1;
    return (a, b) => {
      const ka = key(a), kb = key(b);
      if (ka && !kb) return -1;
      if (!ka && kb) return 1;
      if (ka !== kb) return (ka < kb ? -1 : 1) * dir;
      return (a.order ?? 0) - (b.order ?? 0);
    };
  }
  return (a, b) => (a.order ?? 0) - (b.order ?? 0);
}

function taskHtml(t, { showMatrix } = {}) {
  const meta = [];
  if (t.date) {
    const overdue = !t.done && t.date < today();
    meta.push(`<span class="${overdue ? 'overdue' : ''}">${dateLabel(t.date)}${t.time ? ' ' + timeLabel(t.time) : ''}</span>`);
  }
  if (t.repeat && t.repeat.type) meta.push(`<span class="mi">${ICONS.repeat}</span>`);
  if (t.notify && t.date && !t.done) meta.push(`<span class="mi">${ICONS.bell}</span>`);
  if (t.note) meta.push(`<span class="mi">${ICONS.note}</span>`);
  if (showMatrix && data.matrices[t.matrix]) meta.push(`<span>${esc(data.matrices[t.matrix].name)}</span>`);
  return `<div class="task ${t.done ? 'done' : ''}" data-id="${t.id}" style="--qc:${qColor(t)}">
    <button class="check" aria-label="${t.done ? '取消完成' : '完成'}"></button>
    <div class="task-main">
      <div class="task-title">${esc(t.title)}</div>
      ${meta.length ? `<div class="task-meta">${meta.join('')}</div>` : ''}
    </div>
  </div>`;
}

function matrixTasks() {
  const m = currentMatrix();
  return tasks().filter((t) => m.id === ALL || t.matrix === m.id);
}

function renderMatrix() {
  const m = currentMatrix();
  const all = filterTasks(matrixTasks());
  const sort = sorter();
  const mid = m.id === ALL ? matrices()[0]?.id : m.id;
  elMatrix.innerHTML = [1, 2, 3, 4].map((q) => {
    const info = quad(mid, q);
    const list = all.filter((t) => Number(t.quadrant) === q);
    const active = list.filter((t) => !t.done).sort(sort);
    const done = list.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    const open = !!ui.doneOpen[q];
    let body = active.map((t) => taskHtml(t, { showMatrix: m.id === ALL })).join('');
    if (done.length) {
      body += `<button class="done-toggle ${open ? 'open' : ''}" data-q="${q}"><span>已完成 ${done.length}</span>${ICONS.chevron}</button>`;
      if (open) body += done.map((t) => taskHtml(t, { showMatrix: m.id === ALL })).join('');
    }
    if (!active.length && !done.length) {
      body = `<div class="quad-empty"><button class="quad-add-empty" data-q="${q}">${ICONS.plusCircle}<span>輕點以加入</span></button></div>`;
    }
    return `<div class="quad" data-q="${q}" style="--qc:${info.color}">
      <div class="quad-head">
        <button class="quad-open" data-q="${q}">${iconHtml(info.icon)}<span class="quad-title">${esc(info.name)}</span>${ICONS.chevronR}</button>
        <span class="quad-count">${active.length || ''}</span>
        <button class="quad-add" data-q="${q}" aria-label="新增到${esc(info.name)}">${ICONS.plus}</button>
      </div>
      <div class="quad-body">${body}</div>
    </div>`;
  }).join('');

  const chip = $('#filterChip');
  const label = { today: '只顯示今天的任務', todayRepeat: '只顯示今天的重複任務' }[prefs.filter];
  chip.hidden = !label;
  if (label) chip.innerHTML = `<span>${label}</span><button class="link" id="clearFilter">顯示全部</button>`;
}

let suppressClick = false;
function onTaskListClick(e) {
  if (suppressClick) { suppressClick = false; return; }
  const add = e.target.closest('.quad-add, .quad-add-empty');
  if (add) return openEditor(null, { quadrant: Number(add.dataset.q) });
  const open = e.target.closest('.quad-open');
  if (open) return openQuadSheet(Number(open.dataset.q));
  const tog = e.target.closest('.done-toggle');
  if (tog) { ui.doneOpen[tog.dataset.q] = !ui.doneOpen[tog.dataset.q]; persistUi(); return renderMatrix(); }
  const taskEl = e.target.closest('.task');
  if (!taskEl) return;
  const t = data.tasks[taskEl.dataset.id];
  if (!t) return;
  if (e.target.closest('.check')) return setDone(t, !t.done);
  openDetail(t);
}
elMatrix.addEventListener('click', onTaskListClick);
document.addEventListener('click', (e) => { if (e.target.id === 'clearFilter') { prefs.filter = 'all'; savePrefs(); render(); } });

/* ---- 長按拖曳：換象限或調整順序 ---- */
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
function dropTarget(x, y) {
  drag.ghost.style.display = 'none';
  const el = document.elementFromPoint(x, y);
  drag.ghost.style.display = '';
  if (!el) return {};
  const q = el.closest('.quad');
  const over = el.closest('.task:not(.done)');
  let before = null;
  if (over && over.dataset.id !== drag.t.id) {
    const r = over.getBoundingClientRect();
    before = y < r.top + r.height / 2 ? over.dataset.id : { after: over.dataset.id };
  }
  return { q, before };
}
function moveDrag(x, y) {
  drag.ghost.style.left = x + 'px';
  drag.ghost.style.top = y + 'px';
  const { q, before } = dropTarget(x, y);
  $$('.quad', elMatrix).forEach((n) => n.classList.toggle('drop', n === q));
  $$('.task.drop-before, .task.drop-after', elMatrix).forEach((n) => n.classList.remove('drop-before', 'drop-after'));
  if (before && prefs.sort === 'custom') {
    const id = typeof before === 'string' ? before : before.after;
    elMatrix.querySelector(`.task[data-id="${id}"]`)?.classList.add(typeof before === 'string' ? 'drop-before' : 'drop-after');
  }
}
window.addEventListener('pointermove', (e) => {
  if (drag) return moveDrag(e.clientX, e.clientY);
  if (!pending) return;
  if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > 8) {
    if (pending.mouse) beginDrag(e.clientX, e.clientY);
    else { clearTimeout(pending.timer); pending = null; }
  }
});
function endDrag(e, cancel) {
  if (pending) { clearTimeout(pending.timer); pending = null; }
  if (!drag) return;
  const { q, before } = cancel ? {} : dropTarget(e.clientX, e.clientY);
  drag.ghost.remove();
  drag.el.classList.remove('dragging');
  $$('.quad', elMatrix).forEach((n) => n.classList.remove('drop'));
  $$('.task', elMatrix).forEach((n) => n.classList.remove('drop-before', 'drop-after'));
  const t = drag.t;
  drag = null;
  suppressClick = true;
  setTimeout(() => (suppressClick = false), 400);
  if (!q) return;
  const from = { quadrant: t.quadrant, order: t.order };
  const newQ = Number(q.dataset.q);
  const moved = newQ !== Number(t.quadrant);
  t.quadrant = newQ;
  if (before && prefs.sort === 'custom') {
    const list = tasks().filter((x) => x.matrix === t.matrix && Number(x.quadrant) === newQ && !x.done && x.id !== t.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const refId = typeof before === 'string' ? before : before.after;
    const idx = list.findIndex((x) => x.id === refId);
    const insertAt = typeof before === 'string' ? idx : idx + 1;
    const prev = list[insertAt - 1], next = list[insertAt];
    t.order = prev && next ? ((prev.order ?? 0) + (next.order ?? 0)) / 2 : prev ? (prev.order ?? 0) + 1 : next ? (next.order ?? 0) - 1 : Date.now();
  } else if (moved) {
    t.order = orderFor(t);
  } else return;
  putTask(t);
  if (moved) toast(`移到「${quad(t.matrix, newQ).name}」`, () => { Object.assign(t, from); putTask(t); });
}
window.addEventListener('pointerup', (e) => endDrag(e, false));
window.addEventListener('pointercancel', (e) => endDrag(e, true));
document.addEventListener('touchmove', (e) => { if (drag) e.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', (e) => { if (e.target.closest('.task')) e.preventDefault(); });

/* ---- 搜尋 ---- */
const elSearch = $('#searchbar'), elSearchInput = $('#searchInput'), elResults = $('#searchResults');
$('.search-ico').innerHTML = ICONS.search;
function openSearch() {
  elSearch.hidden = false;
  elSearchInput.value = ui.search;
  setTimeout(() => elSearchInput.focus(), 50);
  renderSearch();
}
function closeSearch() { ui.search = ''; elSearch.hidden = true; renderSearch(); }
function renderSearch() {
  const q = ui.search.trim().toLowerCase();
  const on = !elSearch.hidden && q;
  elResults.hidden = !on;
  elMatrix.hidden = !!on;
  if (!on) return;
  const hits = matrixTasks().filter((t) => (t.title + ' ' + (t.note || '')).toLowerCase().includes(q))
    .sort((a, b) => a.done - b.done || (b.updatedAt || 0) - (a.updatedAt || 0));
  elResults.innerHTML = hits.length
    ? `<div class="group-title">找到 ${hits.length} 個</div><div class="card list-card">${hits.map((t) => taskHtml(t, { showMatrix: true })).join('')}</div>`
    : '<div class="empty-state">沒有符合的任務</div>';
}
elSearchInput.addEventListener('input', () => { ui.search = elSearchInput.value; renderSearch(); });
$('#searchCancel').addEventListener('click', closeSearch);
elResults.addEventListener('click', onTaskListClick);

/* =========================================================
   底部面板
   ========================================================= */
const elSheet = $('#sheet'), elBackdrop = $('#backdrop');
let sheetStack = [];
function showSheet(html, { onClose, tall } = {}) {
  elSheet.innerHTML = `<div class="grabber"></div>${html}`;
  elSheet.classList.toggle('tall', !!tall);
  elSheet.scrollTop = 0;
  elSheet.hidden = false; elBackdrop.hidden = false;
  requestAnimationFrame(() => { elSheet.classList.add('show'); elBackdrop.classList.add('show'); });
  sheetStack = [onClose];
  elSheet.onclick = null;
  elSheet.onchange = null;
  elSheet.oninput = null;
}
function hideSheet() {
  elSheet.classList.remove('show'); elBackdrop.classList.remove('show');
  setTimeout(() => { if (!elSheet.classList.contains('show')) { elSheet.hidden = true; elBackdrop.hidden = true; elSheet.innerHTML = ''; } }, 220);
  const f = sheetStack.pop();
  if (f) f();
}
elBackdrop.addEventListener('click', hideSheet);
let sy = null;
elSheet.addEventListener('touchstart', (e) => { sy = elSheet.scrollTop <= 0 && !e.target.closest('input,textarea,select,.no-swipe') ? e.touches[0].clientY : null; }, { passive: true });
elSheet.addEventListener('touchend', (e) => { if (sy != null && e.changedTouches[0].clientY - sy > 90) hideSheet(); sy = null; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !elSheet.hidden) hideSheet(); });

/* =========================================================
   任務詳細
   ========================================================= */
function focusTotal(taskId) {
  return sessions().filter((s) => s.taskId === taskId).reduce((n, s) => n + (s.minutes || 0), 0);
}
function openDetail(t) {
  const info = quad(t.matrix, t.quadrant);
  const row = (ico, label, val) => `<div class="drow"><span class="dl">${ico}${label}</span><span class="dv ${val ? '' : 'none'}">${val || '—'}</span></div>`;
  const total = focusTotal(t.id);
  showSheet(`
    <div class="detail" style="--qc:${info.color}">
      <div class="detail-top">
        <span class="qtag">${iconHtml(info.icon)}${esc(info.name)}</span>
        <span class="grow"></span>
        <button class="icon-btn" data-a="copy" aria-label="複製標題">${ICONS.copy}</button>
        <button class="icon-btn danger" data-a="del" aria-label="刪除">${ICONS.trash}</button>
        <button class="icon-btn" data-a="close" aria-label="關閉">${ICONS.close}</button>
      </div>
      <h2 class="detail-title ${t.done ? 'done' : ''}">${esc(t.title)}</h2>
      <div class="drows">
        ${row(ICONS.cal.replace('class="ico"', 'class="ico sm"'), '截止日期', t.date ? longDate(t.date) + (t.time ? ' ' + timeLabel(t.time) : '') : '')}
        ${row(ICONS.repeat, '重複', repeatLabel(t.repeat))}
        ${row(ICONS.bell, '通知', t.notify && t.date ? (REMIND_OPTS.find(([v]) => v === String(t.remind))?.[1] || '準時') : '')}
        ${row(ICONS.note, '備註', t.note ? esc(t.note).replace(/\n/g, '<br>') : '')}
        ${total ? row(ICONS.timer, '專注', durLabel(total)) : ''}
      </div>
      <div class="drow muted"><span class="dl">${ICONS.clock}建立日期</span><span class="dv">${t.createdAt ? longDate(ymd(new Date(t.createdAt))) : '—'}</span></div>
      <div class="move-row"><span>移至象限</span><div class="move-chips">${[1, 2, 3, 4].map((q) => {
        const qi = quad(t.matrix, q);
        return `<button data-move="${q}" class="${Number(t.quadrant) === q ? 'on' : ''}" style="--qc:${qi.color}">${iconHtml(qi.icon)}</button>`;
      }).join('')}</div></div>
      ${!t.done ? `<button class="btn big" data-a="focus">${ICONS.timer}開始專注模式</button>` : ''}
      <div class="btn-row">
        <button class="btn ghost" data-a="edit">${ICONS.pencil}編輯</button>
        <button class="btn ghost ok" data-a="done">${ICONS.check}${t.done ? '標記為未完成' : '完成'}</button>
      </div>
    </div>`);
  elSheet.onclick = async (e) => {
    const mv = e.target.closest('[data-move]');
    if (mv) {
      const q = Number(mv.dataset.move);
      if (q !== Number(t.quadrant)) { t.quadrant = q; t.order = orderFor(t); putTask(t); toast(`移到「${quad(t.matrix, q).name}」`); }
      return hideSheet();
    }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') hideSheet();
    if (a === 'copy') { try { await navigator.clipboard.writeText(t.title); toast('已複製標題'); } catch { toast('無法複製'); } }
    if (a === 'del') { t.deleted = true; putTask(t); hideSheet(); toast('已刪除', () => { t.deleted = false; putTask(t); }); }
    if (a === 'edit') openEditor(t);
    if (a === 'done') { hideSheet(); setDone(t, !t.done); }
    if (a === 'focus') openFocusPicker(t);
  };
}

/* =========================================================
   新增 / 編輯任務（照 Taska 的版面）
   ========================================================= */
function openEditor(task, defaults = {}) {
  const isNew = !task;
  const d = isNew ? newTask(defaults) : JSON.parse(JSON.stringify(task));
  if (d.time && !d.date) d.date = ui.sel;
  const ms = matrices();
  const t0 = today(), t1 = addDays(t0, 1);
  const sw = (id, on) => `<button class="switch ${on ? 'on' : ''}" id="${id}" role="switch" aria-checked="${on}"></button>`;

  const body = () => {
    const info = quad(d.matrix, d.quadrant);
    const r = d.repeat || {};
    const custom = d.date && d.date !== t0 && d.date !== t1;
    return `
    <div class="sheet-head">
      <button class="link muted" data-a="cancel">取消</button>
      <h3 style="color:${info.color}">${iconHtml(info.icon)} ${esc(info.name)}</h3>
      <button class="link" data-a="save">${isNew ? '新增' : '儲存'}</button>
    </div>
    <div class="box"><input class="title-input" id="fTitle" placeholder="輸入任務" value="${esc(d.title)}" enterkeyhint="done"></div>
    <div class="box"><textarea class="note-input" id="fNote" placeholder="備註（可選）" rows="2">${esc(d.note)}</textarea></div>

    <div class="box">
      <div class="box-head">${ICONS.cal.replace('class="ico"', 'class="ico sm"')}<b>截止日期</b><span class="grow"></span><span class="muted-s">${d.date ? longDate(d.date) : ''}</span></div>
      <div class="chips">
        <button class="chip ${d.date === t0 ? 'on' : ''}" data-date="${t0}">☀️ 今天</button>
        <button class="chip ${d.date === t1 ? 'on' : ''}" data-date="${t1}">🌅 明天</button>
        <label class="chip ${custom ? 'on' : ''}">📆 自訂<input type="date" id="fDate" value="${d.date || ''}"></label>
        ${d.date ? `<button class="chip-x" data-a="clearDate" aria-label="清除日期">${ICONS.close}</button>` : ''}
      </div>
      ${d.date ? `
      <div class="sub-row"><span>${ICONS.clock}時間</span>${sw('swTime', !!d.time)}</div>
      ${d.time ? `<div class="chips">${TIME_PRESETS.map(([l, v]) => `<button class="chip ${d.time === v ? 'on' : ''}" data-time="${v}">${l}</button>`).join('')}</div>
        <div class="inline-row"><span>選擇時間</span><input type="time" id="fTime" value="${d.time}"></div>
        <div class="inline-row"><span>長度</span><select id="fDur">${DUR_OPTS.map((m) => `<option value="${m}" ${Number(d.duration) === m ? 'selected' : ''}>${durLabel(m)}</option>`).join('')}</select></div>` : ''}
      <div class="sub-row"><span>${ICONS.bell}通知</span>${sw('swNotify', !!d.notify)}</div>
      ${d.notify ? `<div class="inline-row"><span>提醒時間</span><select id="fRemind">${REMIND_OPTS.map(([v, l]) => `<option value="${v}" ${String(d.remind) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>` : ''}
      ` : ''}
    </div>

    <div class="box">
      <div class="box-head">${ICONS.repeat}<b>重複</b><span class="grow"></span>${sw('swRepeat', !!r.type)}</div>
      ${r.type ? `
        <div class="muted-s" style="margin:-2px 0 8px">在設定時間重複</div>
        <div class="chips">${REPEAT_TYPES.map(([v, l]) => `<button class="chip ${r.type === v ? 'on' : ''}" data-rep="${v}">${l}</button>`).join('')}</div>
        <div class="divider-label">自訂</div>
        <div class="chips">
          <button class="chip ${r.type === 'everyN' ? 'on' : ''}" data-rep="everyN"># 每 N 天</button>
          <button class="chip ${r.type === 'everyNWeeks' ? 'on' : ''}" data-rep="everyNWeeks"># 每 N 週</button>
        </div>
        ${r.type === 'everyN' || r.type === 'everyNWeeks' ? `<div class="inline-row"><span>每</span><span><input type="number" id="fRepN" min="1" max="365" value="${r.n || 2}" class="num-in"> ${r.type === 'everyN' ? '天' : '週'}</span></div>` : ''}
        <div class="sub-row"><span>結束日期</span>${sw('swUntil', !!r.until)}</div>
        ${r.until ? `<div class="inline-row"><span>重複到</span><input type="date" id="fUntil" value="${r.until}"></div>` : ''}
        <div class="sub-row"><span>完成後才排下一次<small>從完成那天起算下一次</small></span>${sw('swFromDone', !!r.fromCompletion)}</div>
      ` : ''}
    </div>

    <div class="box">
      <div class="box-head"><b>象限</b></div>
      <div class="qpick">${[1, 2, 3, 4].map((q) => { const qi = quad(d.matrix, q); return `<button data-q="${q}" class="${Number(d.quadrant) === q ? 'on' : ''}" style="--qc:${qi.color}">${iconHtml(qi.icon)}${esc(qi.name)}</button>`; }).join('')}</div>
      ${ms.length > 1 ? `<div class="inline-row"><span>矩陣</span><select id="fMatrix">${ms.map((m) => `<option value="${m.id}" ${m.id === d.matrix ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>` : ''}
    </div>
    ${!isNew ? `<button class="btn danger" data-a="del" style="width:100%;margin-top:4px">${ICONS.trash} 刪除</button>` : ''}`;
  };

  const read = () => {
    const v = (id) => $('#' + id, elSheet);
    if (v('fTitle')) d.title = v('fTitle').value.trim();
    if (v('fNote')) d.note = v('fNote').value.trim();
    if (v('fTime')) d.time = v('fTime').value || d.time;
    if (v('fDur')) d.duration = Number(v('fDur').value);
    if (v('fRemind')) d.remind = v('fRemind').value;
    if (v('fMatrix')) d.matrix = v('fMatrix').value;
    if (v('fRepN') && d.repeat) d.repeat.n = Math.max(1, Number(v('fRepN').value) || 1);
    if (v('fUntil') && d.repeat) d.repeat.until = v('fUntil').value || d.repeat.until;
  };
  const redraw = () => {
    const st = elSheet.scrollTop;
    elSheet.innerHTML = `<div class="grabber"></div>${body()}`;
    elSheet.scrollTop = st;
    bindTitle();
  };
  const bindTitle = () => $('#fTitle', elSheet).addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); save(); } });

  showSheet(body(), { tall: true });
  bindTitle();
  if (isNew) setTimeout(() => $('#fTitle', elSheet)?.focus(), 260);

  elSheet.onchange = (e) => {
    if (e.target.id === 'fDate') { read(); d.date = e.target.value || ''; if (!d.date) { d.time = ''; d.notify = false; } redraw(); }
    if (e.target.id === 'fMatrix') { read(); redraw(); }
  };
  elSheet.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    read();
    if (b.dataset.date) { d.date = b.dataset.date; return redraw(); }
    if (b.dataset.time) { d.time = b.dataset.time; return redraw(); }
    if (b.dataset.q) { d.quadrant = Number(b.dataset.q); return redraw(); }
    if (b.dataset.rep) { d.repeat = { ...(d.repeat || {}), type: b.dataset.rep }; if (!d.date) d.date = t0; return redraw(); }
    switch (b.id) {
      case 'swTime': d.time = d.time ? '' : (d.date === t0 ? fromMin(Math.min(23 * 60, (new Date().getHours() + 1) * 60)) : '09:00'); return redraw();
      case 'swNotify': d.notify = !d.notify; if (d.notify && !('Notification' in window && Notification.permission === 'granted')) toast('記得到「設定 → 提醒通知」開啟通知'); return redraw();
      case 'swRepeat': d.repeat = d.repeat && d.repeat.type ? null : { type: 'daily' }; if (d.repeat && !d.date) d.date = t0; return redraw();
      case 'swUntil': d.repeat.until = d.repeat.until ? null : addDays(d.date || t0, 30); return redraw();
      case 'swFromDone': d.repeat.fromCompletion = !d.repeat.fromCompletion; return redraw();
    }
    const a = b.dataset.a;
    if (a === 'clearDate') { d.date = ''; d.time = ''; d.notify = false; d.repeat = null; return redraw(); }
    if (a === 'cancel') return hideSheet();
    if (a === 'save') return save();
    if (a === 'del') {
      const orig = data.tasks[d.id];
      orig.deleted = true; putTask(orig); hideSheet();
      toast('已刪除', () => { orig.deleted = false; putTask(orig); });
    }
  };
  function save() {
    read();
    if (!d.title) { if (isNew) return hideSheet(); $('#fTitle', elSheet).focus(); return; }
    if (!d.date) { d.time = ''; d.notify = false; }
    if (d.repeat && d.repeat.type === 'monthly' && d.date) d.repeat.day = parseYmd(d.date).getDate();
    if (isNew) d.order = orderFor(d);
    else if (Number(task.quadrant) !== Number(d.quadrant) || task.matrix !== d.matrix) d.order = orderFor(d);
    putTask(isNew ? d : Object.assign(data.tasks[d.id], d));
    hideSheet();
  }
}

/* =========================================================
   象限：展開清單 / 自訂名稱圖示顏色
   ========================================================= */
function openQuadSheet(q) {
  const m = currentMatrix();
  const mid = m.id === ALL ? matrices()[0].id : m.id;
  const draw = () => {
    const info = quad(mid, q);
    const list = filterTasks(matrixTasks()).filter((t) => Number(t.quadrant) === q);
    const active = list.filter((t) => !t.done).sort(sorter());
    const done = list.filter((t) => t.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    return `<div class="qsheet" style="--qc:${info.color}">
      <div class="sheet-head">
        <h3 class="qs-title">${iconHtml(info.icon)} ${esc(info.name)} <span class="badge">${active.length}</span>
          ${m.id !== ALL ? `<button class="icon-btn" data-a="custom" aria-label="自訂象限">${ICONS.pencil}</button>` : ''}</h3>
        <button class="icon-btn" data-a="close">${ICONS.close}</button>
      </div>
      <div class="qs-list">${active.map((t) => taskHtml(t)).join('') || '<div class="empty-state">還沒有任務</div>'}
        ${done.length ? `<div class="group-title">已完成 ${done.length}</div>${done.map((t) => taskHtml(t)).join('')}` : ''}</div>
      <button class="btn big qs-add" data-a="add">＋ 新增任務</button>
    </div>`;
  };
  showSheet(draw(), { tall: true });
  const redraw = () => { elSheet.innerHTML = `<div class="grabber"></div>${draw()}`; };
  elSheet.onclick = (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') return hideSheet();
    if (a === 'add') return openEditor(null, { quadrant: q });
    if (a === 'custom') return openQuadCustom(mid, q);
    const tEl = e.target.closest('.task');
    if (!tEl) return;
    const t = data.tasks[tEl.dataset.id];
    if (e.target.closest('.check')) { setDone(t, !t.done); redraw(); return; }
    openDetail(t);
  };
}

function openQuadCustom(mid, q) {
  const m = data.matrices[mid];
  const cur = quad(mid, q);
  const d = { ...cur };
  const draw = () => `
    <div class="sheet-head"><button class="link muted" data-a="cancel">取消</button><h3>自訂象限</h3><button class="link" data-a="save">儲存</button></div>
    <div class="box qc-name" style="--qc:${d.color}"><span class="qc-ico">${iconHtml(d.icon)}</span><input class="title-input" id="qName" value="${esc(d.name)}" maxlength="20"></div>
    <div class="group-title">圖示</div>
    <div class="icon-grid">${['fire', 'bolt', 'cal', 'list', ...ICON_CHOICES].map((i) => `<button data-icon="${esc(i)}" class="${d.icon === i ? 'on' : ''}">${iconHtml(i)}</button>`).join('')}</div>
    <div class="group-title">顏色</div>
    <div class="color-grid">${COLOR_CHOICES.map((c) => `<button data-color="${c}" class="${d.color === c ? 'on' : ''}" style="background:${c}"></button>`).join('')}</div>
    <button class="btn ghost" data-a="reset" style="width:100%;margin-top:16px">恢復預設值</button>`;
  showSheet(draw(), { tall: true });
  const redraw = () => { d.name = $('#qName', elSheet).value; elSheet.innerHTML = `<div class="grabber"></div>${draw()}`; };
  elSheet.onclick = (e) => {
    const ib = e.target.closest('[data-icon]'); if (ib) { d.icon = ib.dataset.icon; return redraw(); }
    const cb = e.target.closest('[data-color]'); if (cb) { d.color = cb.dataset.color; return redraw(); }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'cancel') return openQuadSheet(q);
    if (a === 'reset') { Object.assign(d, DEFAULT_QUADS[q]); return redraw(); }
    if (a === 'save') {
      d.name = $('#qName', elSheet).value.trim() || DEFAULT_QUADS[q].name;
      m.quads = { ...(m.quads || {}), [q]: { name: d.name, icon: d.icon, color: d.color } };
      putMatrix(m);
      openQuadSheet(q);
    }
  };
}

/* =========================================================
   矩陣清單
   ========================================================= */
function openMatrixSheet() {
  const draw = () => {
    const ms = matrices();
    const counts = (mid) => [1, 2, 3, 4].map((q) => tasks().filter((t) => !t.done && (mid === ALL || t.matrix === mid) && Number(t.quadrant) === q).length);
    const card = (id, name, star) => {
      const c = counts(id);
      return `<div class="mcard ${id === ui.matrix ? 'on' : ''}" data-id="${id}">
        <button class="mcard-main" data-act="pick"><span class="mname">${star ? '★ ' : ''}${esc(name)}</span><span class="mtotal">${c.reduce((a, b) => a + b, 0)}</span></button>
        <div class="mcounts">${[1, 2, 3, 4].map((q, i) => `<span style="--qc:${quad(id === ALL ? ms[0].id : id, q).color}"><i></i>${c[i]}</span>`).join('')}</div>
        ${id !== ALL ? `<div class="mcard-acts">
          <button class="icon-btn" data-act="up" aria-label="上移">↑</button>
          <button class="icon-btn" data-act="down" aria-label="下移">↓</button>
          <button class="icon-btn" data-act="rename" aria-label="改名">${ICONS.pencil}</button>
          ${ms.length > 1 ? `<button class="icon-btn danger" data-act="del" aria-label="刪除">${ICONS.trash}</button>` : ''}
        </div>` : ''}
      </div>`;
    };
    return `<div class="sheet-head"><span></span><h3>矩陣</h3><button class="link" data-a="done">完成</button></div>
      ${ms.map((m, i) => card(m.id, m.name, i === 0)).join('')}
      ${ms.length > 1 ? card(ALL, '顯示所有任務') : ''}
      <button class="btn ghost" data-a="add" style="width:100%;margin-top:12px">＋ 新增矩陣</button>`;
  };
  showSheet(draw(), { tall: true });
  const redraw = () => { elSheet.innerHTML = `<div class="grabber"></div>${draw()}`; };
  elSheet.onclick = (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'done') return hideSheet();
    if (a === 'add') {
      const name = prompt('新矩陣的名稱', '');
      if (name && name.trim()) {
        const m = { id: uid(), name: name.trim(), order: Math.max(0, ...matrices().map((x) => x.order ?? 0)) + 1 };
        putMatrix(m); ui.matrix = m.id; persistUi(); render(); redraw();
      }
      return;
    }
    const row = e.target.closest('.mcard');
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!row || !act) return;
    if (act === 'pick') { ui.matrix = row.dataset.id; persistUi(); render(); return hideSheet(); }
    const m = data.matrices[row.dataset.id];
    const ms = matrices();
    if (act === 'up' || act === 'down') {
      const i = ms.indexOf(m), j = act === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= ms.length) return;
      [ms[i], ms[j]] = [ms[j], ms[i]];
      ms.forEach((x, k) => { if (x.order !== k) { x.order = k; putMatrix(x, true); } });
      render(); return redraw();
    }
    if (act === 'rename') {
      const name = prompt('矩陣名稱', m.name);
      if (name && name.trim()) { m.name = name.trim(); putMatrix(m); redraw(); }
    }
    if (act === 'del') {
      const list = tasks().filter((t) => t.matrix === m.id);
      if (!confirm(`刪除「${m.name}」${list.length ? `和裡面的 ${list.length} 個任務` : ''}？`)) return;
      list.forEach((t) => { t.deleted = true; putTask(t, { silent: true }); });
      m.deleted = true; putMatrix(m);
      if (ui.matrix === m.id) { ui.matrix = matrices()[0]?.id; persistUi(); }
      render(); redraw();
    }
  };
}
function stepMatrix(dir) {
  const ms = matrices();
  const i = ms.findIndex((m) => m.id === ui.matrix);
  const n = ms[(i + dir + ms.length) % ms.length];
  if (n) { ui.matrix = n.id; persistUi(); render(); toast(n.name); }
}

/* =========================================================
   排序 / 顯示範圍
   ========================================================= */
function openSortSheet() {
  const opt = (group, v, label, sub) => `<button class="opt ${prefs[group] === v ? 'on' : ''}" data-g="${group}" data-v="${v}"><span>${label}${sub ? `<small>${sub}</small>` : ''}</span>${prefs[group] === v ? ICONS.check : ''}</button>`;
  const draw = () => `<div class="sheet-head"><span></span><h3>排序與顯示</h3><button class="link" data-a="done">完成</button></div>
    <div class="group-title">排序方式</div>
    <div class="card">${opt('sort', 'custom', '自訂順序', '長按任務拖曳排序')}${opt('sort', 'dueAsc', '截止日期最早')}${opt('sort', 'dueDesc', '截止日期最晚')}</div>
    <div class="group-title">顯示範圍</div>
    <div class="card">${opt('filter', 'all', '顯示全部', '顯示所有任務')}${opt('filter', 'todayRepeat', '僅顯示今天的重複任務', '重複任務中今天到期或已逾期的')}${opt('filter', 'today', '僅顯示今天的任務', '今天到期或已逾期的任務（含重複任務）')}
      <button class="opt" data-a="upcoming"><span>查看即將重複的任務</span>${ICONS.chevronR}</button></div>
    <div class="group-title">任務加入位置（自訂順序）</div>
    <div class="card">${opt('addPos', 'top', '在頂部加入任務')}${opt('addPos', 'bottom', '在底部加入任務')}</div>`;
  showSheet(draw(), { tall: true });
  elSheet.onclick = (e) => {
    const b = e.target.closest('[data-g]');
    if (b) { prefs[b.dataset.g] = b.dataset.v; savePrefs(); render(); elSheet.innerHTML = `<div class="grabber"></div>${draw()}`; return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'done') hideSheet();
    if (a === 'upcoming') openUpcoming();
  };
}
function openUpcoming() {
  const reps = tasks().filter((t) => !t.done && t.repeat && t.repeat.type).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  showSheet(`<div class="sheet-head"><span></span><h3>即將重複的任務</h3><button class="link" data-a="done">完成</button></div>
    ${reps.length ? `<div class="card">${reps.map((t) => `<div class="rep-row" data-id="${t.id}" style="--qc:${qColor(t)}">
      <div><b>${esc(t.title)}</b><small>${repeatLabel(t.repeat)}</small></div>
      <div class="rep-dates">${[t.date, ...upcoming(t, 3)].filter(Boolean).map((d) => `<span>${dateLabel(d)}</span>`).join('')}</div></div>`).join('')}</div>`
      : '<div class="empty-state">目前沒有重複任務</div>'}`, { tall: true });
  elSheet.onclick = (e) => {
    if (e.target.closest('[data-a="done"]')) return hideSheet();
    const r = e.target.closest('.rep-row');
    if (r) openDetail(data.tasks[r.dataset.id]);
  };
}

/* =========================================================
   天氣 + 今日摘要
   ========================================================= */
let wx = weather.cached();
async function loadWeather(force) {
  if (!prefs.showWeather) return;
  try { wx = await weather.load({ useGps: prefs.useGps, unit: prefs.unit, force }); render(); } catch (e) { console.warn(e); }
}
const deg = (v) => (v == null ? '—' : `${Math.round(v)}°`);

function openSummary() {
  const t0 = today();
  const due = tasks().filter((t) => !t.done && t.date && t.date <= t0).sort((a, b) => (a.date + (a.time || '99')).localeCompare(b.date + (b.time || '99')));
  const doneToday = tasks().filter((t) => t.done && t.doneAt && ymd(new Date(t.doneAt)) === t0);
  const focusToday = sessions().filter((s) => ymd(new Date(s.start)) === t0).reduce((n, s) => n + (s.minutes || 0), 0);
  const day = wx?.days?.[t0];
  let open = false;
  const wxBox = () => wx && prefs.showWeather ? `
    <button class="wx-card" data-a="wx">
      <div class="wx-row"><span>${longDate(t0)}・${esc(wx.place)}</span><span class="wx-now">${weather.wIcon(wx.now.code, wx.now.day)} ${deg(wx.now.temp)} ${ICONS.chevron}</span></div>
      ${open ? `<div class="wx-detail"><b>${weather.wText(wx.now.code)}</b>
        <div class="wx-grid">
          <div><small>🌡️ 體感溫度</small>${deg(wx.now.feel)}</div><div><small>💨 風</small>${Math.round(wx.now.wind)} km/h</div>
          <div><small>💧 濕度</small>${wx.now.hum}%</div><div><small>☀️ 紫外線指數</small>${weather.uvText(day?.uv)}</div>
          <div><small>☔ 降水機率</small>${day?.rain ?? '—'}%</div><div><small>↕️ 最高／最低</small>${deg(day?.max)}／${deg(day?.min)}</div>
        </div></div>` : ''}
    </button>` : `<div class="wx-card"><div class="wx-row"><span>${longDate(t0)}</span></div></div>`;
  const draw = () => `<div class="sheet-head"><span></span><h3>今日摘要</h3><button class="icon-btn" data-a="close">${ICONS.close}</button></div>
    ${wxBox()}
    ${due.length ? `<div class="group-title">今天要做（${due.length}）</div><div class="card list-card">${due.map((t) => taskHtml(t)).join('')}</div>`
      : `<div class="relax"><div class="relax-ico">✅</div><b>今天沒安排</b><span>放輕鬆吧</span></div>`}
    ${doneToday.length || focusToday ? `<p class="note">今天已完成 ${doneToday.length} 項${focusToday ? `，專注 ${durLabel(focusToday)}` : ''}。</p>` : ''}`;
  showSheet(draw(), { tall: true });
  elSheet.onclick = (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') return hideSheet();
    if (a === 'wx') { open = !open; elSheet.innerHTML = `<div class="grabber"></div>${draw()}`; return; }
    const tEl = e.target.closest('.task');
    if (!tEl) return;
    const t = data.tasks[tEl.dataset.id];
    if (e.target.closest('.check')) { setDone(t, true); hideSheet(); return; }
    openDetail(t);
  };
}

/* =========================================================
   行事曆
   ========================================================= */
const elWeek = $('#week'), elAllday = $('#allday'), elTimeline = $('#timeline'), elTlWrap = $('#timelineWrap');
function calTasksOn(ds) {
  if (prefs.hideTasksInCal) return [];
  return tasks().filter((t) => t.date === ds && !(prefs.hideDoneInCal && t.done));
}
const sessionsOn = (ds) => sessions().filter((s) => ymd(new Date(s.start)) === ds);

function weekStartOf(ds) {
  const d = parseYmd(ds);
  return addDays(ds, -((d.getDay() - prefs.weekStart + 7) % 7));
}

function renderCalHead() {
  const sel = parseYmd(ui.sel);
  $('#calHead').innerHTML = `
    <button class="month-label">${sel.getFullYear()}年${sel.getMonth() + 1}月 ${ICONS.chevron}<input type="date" id="jumpDate" value="${ui.sel}" aria-label="跳到日期"></button>
    <div class="cal-tools">
      ${prefs.calMode === 'month' ? `<button class="icon-btn" data-a="prev">${ICONS.left}</button><button class="icon-btn" data-a="next">${ICONS.right}</button>` : ''}
      <div class="seg"><button class="${prefs.calMode === 'timeline' ? 'on' : ''}" data-mode="timeline">時間軸</button><button class="${prefs.calMode === 'month' ? 'on' : ''}" data-mode="month">月曆</button></div>
      <button class="icon-btn" data-a="calopts" aria-label="行事曆選項">${ICONS.sliders}</button>
      <button class="chip" data-a="today">今天</button>
    </div>`;
}
$('#calHead').addEventListener('change', (e) => {
  if (e.target.id === 'jumpDate' && e.target.value) { ui.sel = e.target.value; renderCal(); scrollTimeline(); }
});
$('#calHead').addEventListener('click', (e) => {
  const mode = e.target.closest('[data-mode]')?.dataset.mode;
  if (mode) { prefs.calMode = mode; savePrefs(); renderCal(); if (mode === 'timeline') scrollTimeline(); return; }
  const a = e.target.closest('[data-a]')?.dataset.a;
  if (a === 'today') { ui.sel = today(); renderCal(); scrollTimeline(); }
  if (a === 'prev' || a === 'next') {
    const d = parseYmd(ui.sel);
    d.setDate(1); d.setMonth(d.getMonth() + (a === 'next' ? 1 : -1));
    ui.sel = ymd(d); renderCal();
  }
  if (a === 'calopts') openCalOptions();
});

function openCalOptions() {
  const opt = (g, v, l) => `<button class="opt ${prefs[g] === v ? 'on' : ''}" data-g="${g}" data-v="${v}"><span>${l}</span>${prefs[g] === v ? ICONS.check : ''}</button>`;
  const draw = () => `<div class="sheet-head"><span></span><h3>行事曆顯示</h3><button class="link" data-a="done">完成</button></div>
    <div class="group-title">時間軸：同時段的任務</div><div class="card">${opt('calLayout', 'side', '並排')}${opt('calLayout', 'stack', '重疊')}</div>
    <div class="group-title">月曆：任務顯示方式</div><div class="card">${opt('monthStyle', 'line', '線性（顯示標題）')}${opt('monthStyle', 'dot', '點')}</div>
    <div class="group-title">文字大小</div>
    <div class="card"><div class="row"><span>目前 ${Math.round(prefs.calScale * 100)}%</span><div class="seg"><button data-a="smaller">A−</button><button data-a="bigger">A＋</button></div></div></div>`;
  showSheet(draw());
  elSheet.onclick = (e) => {
    const b = e.target.closest('[data-g]');
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (b) { prefs[b.dataset.g] = b.dataset.v; }
    if (a === 'smaller') prefs.calScale = Math.max(0.8, +(prefs.calScale - 0.1).toFixed(2));
    if (a === 'bigger') prefs.calScale = Math.min(1.4, +(prefs.calScale + 0.1).toFixed(2));
    if (a === 'done') return hideSheet();
    savePrefs(); applyTheme(); renderCal();
    elSheet.innerHTML = `<div class="grabber"></div>${draw()}`;
  };
}

function renderCal() {
  renderCalHead();
  const month = prefs.calMode === 'month';
  $('#calDay').hidden = month;
  $('#calMonth').hidden = !month;
  if (month) return renderMonth();
  renderWeekStrip();
  renderDay();
}

function renderWeekStrip() {
  const start = weekStartOf(ui.sel);
  const t0 = today();
  let wk = '';
  for (let i = 0; i < 7; i++) {
    const ds = addDays(start, i);
    const d = parseYmd(ds);
    const qs = [...new Set(calTasksOn(ds).filter((t) => !t.done).map((t) => qColor(t)))].slice(0, 4);
    const w = prefs.showWeather && wx?.days?.[ds];
    wk += `<button class="day ${[0, 6].includes(d.getDay()) ? 'weekend' : ''} ${ds === t0 ? 'today' : ''} ${ds === ui.sel ? 'sel' : ''}" data-d="${ds}">
      <span class="dow">${DOW[d.getDay()]}</span><span class="num">${d.getDate()}</span>
      ${w ? `<span class="wx-mini">${weather.wIcon(w.code)}${Math.round(w.max)}°</span>` : ''}
      <span class="dots">${qs.map((c) => `<i style="background:${c}"></i>`).join('')}</span></button>`;
  }
  elWeek.innerHTML = wk;
}

function layoutColumns(items) {
  let cluster = [], end = -1;
  const flush = () => {
    const cols = [];
    cluster.forEach((it) => {
      let c = cols.findIndex((e) => e <= it.s);
      if (c === -1) { c = cols.length; cols.push(0); }
      cols[c] = it.e; it.col = c;
    });
    cluster.forEach((it) => (it.cols = cols.length));
    cluster = [];
  };
  items.forEach((it) => { if (it.s >= end && cluster.length) flush(); cluster.push(it); end = Math.max(end, it.e); });
  if (cluster.length) flush();
}

function renderDay() {
  const ds = ui.sel, t0 = today();
  const dayTasks = calTasksOn(ds);
  const allday = dayTasks.filter((t) => !t.time).sort((a, b) => a.done - b.done || a.quadrant - b.quadrant);
  elAllday.innerHTML = allday.length
    ? `<div class="allday-label">全天</div>` + allday.map((t) => `<button class="ev-chip ${t.done ? 'done' : ''}" style="--qc:${qColor(t)}" data-id="${t.id}">${t.done ? '✓ ' : ''}${esc(t.title)}</button>`).join('')
    : '';

  let html = '';
  for (let h = 0; h < 24; h++) html += `<div class="hour" style="top:${h * HOUR}px"><span>${h === 0 ? '' : hourLabel(h)}</span></div>`;
  const items = dayTasks.filter((t) => t.time).map((t) => {
    const s = toMin(t.time);
    return { kind: 't', t, s, e: Math.min(24 * 60, s + (Number(t.duration) || 30)) };
  });
  sessionsOn(ds).forEach((x) => {
    const st = new Date(x.start);
    const s = st.getHours() * 60 + st.getMinutes();
    items.push({ kind: 's', x, s, e: Math.min(24 * 60, s + Math.max(15, x.minutes || 0)) });
  });
  items.sort((a, b) => a.s - b.s || b.e - a.e);
  layoutColumns(items);
  const left = 66;
  items.forEach((it, idx) => {
    const top = (it.s / 60) * HOUR;
    const height = Math.max(24, ((it.e - it.s) / 60) * HOUR - 2);
    let pos;
    if (prefs.calLayout === 'stack') {
      const off = it.col * 18;
      pos = `left:${left + off}px;right:0;z-index:${2 + it.col}`;
    } else {
      const w = `calc((100% - ${left}px) / ${it.cols})`;
      pos = `left:calc(${left}px + ${w} * ${it.col});width:calc(${w} - 3px)`;
    }
    if (it.kind === 't') {
      const t = it.t;
      html += `<button class="ev ${t.done ? 'done' : ''}" style="--qc:${qColor(t)};top:${top}px;height:${height}px;${pos}" data-id="${t.id}">
        <b>${esc(t.title)}</b>${height > 34 ? `<small>${timeLabel(t.time)} – ${timeLabel(fromMin(it.e))}</small>` : ''}</button>`;
    } else {
      const x = it.x;
      html += `<button class="ev session" style="top:${top}px;height:${height}px;${pos}" data-sid="${x.id}">
        <b>✓ ${esc(x.title)}</b>${height > 34 ? `<small>專注 ${durLabel(x.minutes)} · ${clockLabel(x.start)}</small>` : ''}</button>`;
    }
  });
  const w = prefs.showWeather && wx?.days?.[ds];
  if (w?.sunrise) html += `<div class="sun-line" style="top:${(toMin(w.sunrise) / 60) * HOUR}px"><span>🌅 ${timeLabel(w.sunrise)}</span></div>`;
  if (w?.sunset) html += `<div class="sun-line" style="top:${(toMin(w.sunset) / 60) * HOUR}px"><span>🌇 ${timeLabel(w.sunset)}</span></div>`;
  if (ds === t0) {
    const n = new Date();
    html += `<div class="now-line" style="top:${((n.getHours() * 60 + n.getMinutes()) / 60) * HOUR}px"></div>`;
  }
  elTimeline.innerHTML = html;
}

function scrollTimeline() {
  const n = new Date();
  const h = ui.sel === today() ? Math.max(0, n.getHours() - 1) : 8;
  elTlWrap.scrollTop = h * HOUR;
}

function renderMonth() {
  const sel = parseYmd(ui.sel);
  const first = ymd(new Date(sel.getFullYear(), sel.getMonth(), 1));
  const start = weekStartOf(first);
  const t0 = today();
  let html = `<div class="mhead">${[0, 1, 2, 3, 4, 5, 6].map((i) => { const d = (i + prefs.weekStart) % 7; return `<span class="${d === 0 || d === 6 ? 'we' : ''}">${DOW1[d]}</span>`; }).join('')}</div><div class="mgrid">`;
  for (let i = 0; i < 42; i++) {
    const ds = addDays(start, i);
    const d = parseYmd(ds);
    if (i >= 35 && d.getMonth() !== sel.getMonth()) break;
    const list = calTasksOn(ds).sort((a, b) => a.done - b.done || (a.time || '99').localeCompare(b.time || '99'));
    const ss = sessionsOn(ds);
    let marks = '';
    if (prefs.monthStyle === 'dot') {
      marks = `<span class="mdots">${list.slice(0, 5).map((t) => `<i style="background:${qColor(t)};opacity:${t.done ? 0.4 : 1}"></i>`).join('')}${ss.length ? '<i class="sdot"></i>' : ''}</span>`;
    } else {
      marks = list.slice(0, 3).map((t) => `<span class="mbar ${t.done ? 'done' : ''}" style="--qc:${qColor(t)}">${esc(t.title)}</span>`).join('')
        + (list.length > 3 ? `<span class="mmore">+${list.length - 3}</span>` : '')
        + (ss.length ? `<span class="mbar session">✓ 專注 ${ss.length}</span>` : '');
    }
    html += `<button class="mcell ${d.getMonth() !== sel.getMonth() ? 'other' : ''} ${ds === t0 ? 'today' : ''} ${ds === ui.sel ? 'sel' : ''}" data-d="${ds}">
      <span class="mnum">${d.getDate()}</span>${marks}</button>`;
  }
  html += '</div>';
  $('#month').innerHTML = html;
  const dayList = calTasksOn(ui.sel).sort((a, b) => a.done - b.done || (a.time || '').localeCompare(b.time || ''));
  const ss = sessionsOn(ui.sel);
  $('#monthList').innerHTML = `<div class="ml-head">${longDate(ui.sel)} <span class="muted-s">${dayList.length + ss.length || ''}</span></div>
    ${dayList.length ? `<div class="card list-card">${dayList.map((t) => taskHtml(t)).join('')}</div>` : ''}
    ${ss.map((x) => `<div class="session-row">✓ ${esc(x.title)}<small>專注 ${durLabel(x.minutes)} · ${clockLabel(x.start)}</small></div>`).join('')}
    ${!dayList.length && !ss.length ? '<div class="empty-state">這天沒有任務</div>' : ''}`;
}

elWeek.addEventListener('click', (e) => { const d = e.target.closest('.day'); if (d) { ui.sel = d.dataset.d; renderCal(); } });
let swipeX = null;
elWeek.addEventListener('touchstart', (e) => (swipeX = e.touches[0].clientX), { passive: true });
elWeek.addEventListener('touchend', (e) => {
  if (swipeX == null) return;
  const dx = e.changedTouches[0].clientX - swipeX; swipeX = null;
  if (Math.abs(dx) > 50) { ui.sel = addDays(ui.sel, dx < 0 ? 7 : -7); renderCal(); }
});
$('#month').addEventListener('click', (e) => { const c = e.target.closest('.mcell'); if (c) { ui.sel = c.dataset.d; renderCal(); } });
let mSwipe = null;
$('#month').addEventListener('touchstart', (e) => (mSwipe = e.touches[0].clientX), { passive: true });
$('#month').addEventListener('touchend', (e) => {
  if (mSwipe == null) return;
  const dx = e.changedTouches[0].clientX - mSwipe; mSwipe = null;
  if (Math.abs(dx) > 60) { const d = parseYmd(ui.sel); d.setDate(1); d.setMonth(d.getMonth() + (dx < 0 ? 1 : -1)); ui.sel = ymd(d); renderCal(); }
});
$('#monthList').addEventListener('click', onTaskListClick);
elAllday.addEventListener('click', (e) => { const c = e.target.closest('[data-id]'); if (c && data.tasks[c.dataset.id]) openDetail(data.tasks[c.dataset.id]); });
elTimeline.addEventListener('click', (e) => {
  const ev = e.target.closest('.ev');
  if (ev?.dataset.id) return data.tasks[ev.dataset.id] && openDetail(data.tasks[ev.dataset.id]);
  if (ev?.dataset.sid) return openSession(data.sessions[ev.dataset.sid]);
  const rect = elTimeline.getBoundingClientRect();
  const min = Math.floor(((e.clientY - rect.top) / HOUR) * 2) * 30;
  if (min < 0 || min >= 24 * 60) return;
  openEditor(null, { date: ui.sel, time: fromMin(min), duration: 60, quadrant: 2 });
});
function openSession(s) {
  if (!s) return;
  showSheet(`<div class="sheet-head"><span></span><h3>專注紀錄</h3><button class="icon-btn" data-a="close">${ICONS.close}</button></div>
    <div class="card"><div class="row"><span>任務</span><b>${esc(s.title)}</b></div>
    <div class="row"><span>開始</span><span>${longDate(ymd(new Date(s.start)))} ${clockLabel(s.start)}</span></div>
    <div class="row"><span>結束</span><span>${clockLabel(s.end)}</span></div>
    <div class="row"><span>專注時間</span><span>${durLabel(s.minutes)}</span></div></div>
    <button class="btn danger" data-a="del" style="width:100%;margin-top:14px">${ICONS.trash} 刪除這筆紀錄</button>`);
  elSheet.onclick = (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'close') hideSheet();
    if (a === 'del') { s.deleted = true; putSession(s); hideSheet(); toast('已刪除紀錄', () => { s.deleted = false; putSession(s); }); }
  };
}

/* =========================================================
   專注模式
   ========================================================= */
function openFocusPicker(t) {
  let sel = 25;
  const draw = () => `<div class="sheet-head"><button class="link muted" data-a="cancel">取消</button><h3>選擇持續時間</h3><span style="width:40px"></span></div>
    <p class="focus-task" style="--qc:${qColor(t)}">${esc(t.title)}</p>
    <div class="dur-grid">${focus.DURATIONS.map((m) => `<button class="${sel === m ? 'on' : ''}" data-m="${m}">${m} 分鐘</button>`).join('')}
      <button class="${sel === 0 ? 'on' : ''}" data-m="0">∞ 不限時</button></div>
    <div class="card"><div class="row"><span>自訂</span><span><input type="number" id="fCustom" class="num-in" min="1" max="600" value="${sel || 25}"> 分鐘</span></div></div>
    <button class="btn big" data-a="start" style="margin-top:16px">開始</button>`;
  showSheet(draw());
  elSheet.onclick = (e) => {
    const m = e.target.closest('[data-m]');
    if (m) { sel = Number(m.dataset.m); elSheet.innerHTML = `<div class="grabber"></div>${draw()}`; return; }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'cancel') hideSheet();
    if (a === 'start') {
      hideSheet();
      focus.start(t, sel, qColor(t));
    }
  };
  elSheet.oninput = (e) => { if (e.target.id === 'fCustom') { sel = Math.max(1, Number(e.target.value) || 25); $$('.dur-grid button', elSheet).forEach((b) => b.classList.toggle('on', Number(b.dataset.m) === sel)); } };
}
focus.init({
  notify: (title, body) => { if ('Notification' in window && Notification.permission === 'granted') showLocalNotification(title, body, 'focus'); },
  record: (s) => putSession({ id: uid(), ...s }),
  complete: (id) => { const t = data.tasks[id]; if (t && !t.done) setDone(t, true); },
});

/* =========================================================
   鎖定畫面桌布
   ========================================================= */
// 背景照片另外存，不放進 prefs（prefs 每次設定變動都會整包寫 localStorage，照片太大）
// 原圖留著，調模糊/亮度時要重新烘焙；烘焙後那張才是上傳給 Scriptable 用的
const WBG_RAW = 'matrix-todo:wallBgRaw';
const WBG_OLD = 'matrix-todo:wallBg'; // 改成保留原圖之前用的 key
function loadWallBgRaw() {
  try {
    let v = localStorage.getItem(WBG_RAW);
    if (!v) {
      // 舊版把照片存在另一個 key，搬過來，不然使用者的照片會像是憑空消失
      const old = localStorage.getItem(WBG_OLD);
      if (old) { localStorage.setItem(WBG_RAW, old); localStorage.removeItem(WBG_OLD); v = old; }
    }
    return v || '';
  } catch { return ''; }
}
function saveWallBgRaw(b64) {
  try {
    if (b64) localStorage.setItem(WBG_RAW, b64);
    else { localStorage.removeItem(WBG_RAW); localStorage.removeItem(WBG_OLD); }
  } catch {}
}
// Scriptable 沒有濾鏡 API，所以把模糊和亮度烘焙進圖片再上傳，兩邊結果才會一致
function pushWallBg(bakedB64) {
  try { sync.push('prefs', { id: 'wallpaperBg', data: bakedB64, updatedAt: Date.now() }); } catch {}
}

// 版面參數同時存在本機和 Firestore：Scriptable 的「矩陣待辦桌布」會讀 Firestore 這份，
// 自動更新鎖定畫面時才會跟這裡調的結果一致。沒登入的話 sync.push 自己會略過。
function pushWallPrefs() {
  try {
    sync.push('prefs', {
      id: 'wallpaper',
      pos: prefs.wallPos, size: prefs.wallSize, font: prefs.wallFont,
      blur: prefs.wallBlur, bright: prefs.wallBright, bg: prefs.wallBg, bgMode: prefs.wallBgMode,
      sort: prefs.sort, // 讓 Scriptable 用一樣的任務排序
      showTitle: prefs.wallShowTitle,
      updatedAt: Date.now(),
    });
  } catch { /* 沒登入或離線就只存本機 */ }
}

const WALL_SLIDERS = [
  ['wallPos', 'pos', '矩陣位置', '%'],
  ['wallSize', 'size', '最大矩陣大小', '%'],
  ['wallFont', 'font', '字體大小', '%'],
  ['wallBlur', 'blur', '背景模糊', ''],
  ['wallBright', 'bright', '背景亮度', '%'],
];
const wallLabel = (key, rk, unit) => {
  const v = Math.round(prefs[key]);
  return `${rk === 'bright' && v > 0 ? '+' : ''}${v}${unit}`;
};

async function openWallpaper() {
  const m = currentMatrix();
  const mid = m.id === ALL ? matrices()[0].id : m.id;

  // 預覽要把照片畫進去，所以先把它載好（build 是同步的）
  let bgImg = null;
  const reloadBg = async () => {
    const b64 = loadWallBgRaw();
    bgImg = (prefs.wallBgMode === 'photo' && b64)
      ? await wallpaper.loadImage('data:image/jpeg;base64,' + b64).catch(() => null)
      : null;
  };
  await reloadBg();

  // 把目前的模糊/亮度烘焙進照片再上傳。拖滑桿時不做（太慢），放手才做。
  const bakeAndPush = () => {
    if (!bgImg) { pushWallBg(''); return; }
    try { pushWallBg(wallpaper.bakeBackground(bgImg, prefs.wallBlur, prefs.wallBright)); } catch {}
  };

  const build = () => {
    const quads = [1, 2, 3, 4].map((q) => {
      const info = quad(mid, q);
      const list = matrixTasks().filter((t) => !t.done && Number(t.quadrant) === q).sort(sorter());
      return { name: info.name, color: info.color, emoji: ICONS[info.icon] ? '' : info.icon, tasks: list.map((t) => t.title) };
    });
    return wallpaper.draw({
      quads, bg: prefs.wallBg, title: prefs.wallShowTitle ? m.name : '',
      pos: prefs.wallPos, size: prefs.wallSize, font: prefs.wallFont,
      bgImage: bgImg, blur: prefs.wallBlur, bright: prefs.wallBright, baked: false,
    });
  };

  // 要是函式，不能是算好的字串：換背景時會重建整張表單，那時得用當下的 prefs 重畫
  const sliders = () => WALL_SLIDERS.map(([key, rk, label, unit]) => {
    const r = wallpaper.WALL_RANGE[rk];
    const dim = (rk === 'blur' || rk === 'bright') && !bgImg ? ' dim' : '';
    return `<label class="wall-slider${dim}"><span>${label}<b data-wv="${key}">${wallLabel(key, rk, unit)}</b></span>
      <input type="range" data-wall="${key}" data-rk="${rk}" data-unit="${unit}" min="${r.min}" max="${r.max}" step="1" value="${Math.round(prefs[key])}"></label>`;
  }).join('');

  const bgSection = () => {
    const photo = prefs.wallBgMode === 'photo';
    const picker = photo
      ? `<div class="wall-photo">
           <button class="btn ghost" data-a="pick">${bgImg ? '換一張照片' : '選擇照片'}</button>
           ${bgImg ? '<button class="btn ghost danger" data-a="rmphoto">移除</button>' : ''}
           <input type="file" accept="image/*" id="wallPhotoInput" hidden>
         </div>`
      : `<div class="wall-bgs">${wallpaper.BG_CHOICES.map(([c, l]) => `<button data-bg="${c}" class="${prefs.wallBg === c ? 'on' : ''}" style="background:${c}" aria-label="${l}"></button>`).join('')}</div>`;
    return `<div class="wall-seg">
        <button data-bgmode="color" class="${photo ? '' : 'on'}">顏色</button>
        <button data-bgmode="photo" class="${photo ? 'on' : ''}">照片</button>
      </div>${picker}`;
  };

  // 疊在預覽上的鎖定畫面參考框：日期、時鐘、小工具列、下方按鈕的實際位置。
  // 只是預覽用的參考，不會畫進真正的桌布圖裡。
  const mock = () => {
    const now = new Date();
    const d = `${now.getMonth() + 1}月${now.getDate()}日 ${DOW[now.getDay()]}`;
    const t = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
    // 有音樂在播時，鎖定畫面會多出「正在播放」那張卡，會蓋掉中間一大塊
    const np = prefs.wallMockNP ? '<span class="m-np" data-label="正在播放"></span>' : '';
    return `<div class="wall-mock" aria-hidden="true">
      <span class="m-date">${d}</span>
      <span class="m-time">${t}</span>
      <span class="m-widgets" data-label="小工具區"></span>
      ${np}
      <span class="m-btn m-left"></span><span class="m-btn m-right"></span>
    </div>`;
  };

  const draw = (url) => `<div class="sheet-head"><span></span><h3>鎖定畫面桌布</h3><button class="link" data-a="done">完成</button></div>
    <div class="wall-layout">
      <div class="wall-left">
        <div class="wall-frame"><img class="wall-preview" src="${url}" alt="桌布預覽">${mock()}</div>
        <p class="note center">虛線＝系統佔用</p>
        <div class="wall-chips">
          <button data-mock="np" class="${prefs.wallMockNP ? 'on' : ''}">播放中的音樂</button>
          <button data-a="title" class="${prefs.wallShowTitle ? 'on' : ''}">顯示矩陣名稱</button>
        </div>
      </div>
      <div class="wall-right">
        <div class="wall-sliders">${sliders()}</div>
        ${bgSection()}
      </div>
    </div>
    <p class="note" id="wallNote">${prefs.wallBgMode === 'photo' && !bgImg ? '還沒選照片，目前用純色背景。' : '自動更新鎖定畫面時會用這裡的設定，和上面的預覽一致。'}</p>
    <a class="btn" style="display:block;width:100%" data-a="runsc"
       href="shortcuts://run-shortcut?name=${encodeURIComponent(prefs.wallShortcut)}">立即更新鎖定畫面</a>
    <p class="note center">用捷徑「${esc(prefs.wallShortcut)}」更新 · <button class="link" data-a="scname">改名稱</button></p>`;

  const rerender = () => { elSheet.innerHTML = `<div class="grabber"></div>${draw(build())}`; };
  showSheet(draw(build()), { tall: true });

  // 拖滑桿時只換預覽圖，不重建整張表單（重建會中斷拖曳）。
  // 畫一張 1179×2556 的圖不便宜，所以用 rAF 壓成每幀最多一次。
  let queued = false;
  const refreshPreview = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const img = elSheet.querySelector('.wall-preview');
      if (img) img.src = build();
    });
  };

  elSheet.oninput = (e) => {
    const s = e.target.closest('[data-wall]');
    if (!s) return;
    prefs[s.dataset.wall] = Number(s.value);
    savePrefs();
    const lab = elSheet.querySelector(`[data-wv="${s.dataset.wall}"]`);
    if (lab) lab.textContent = wallLabel(s.dataset.wall, s.dataset.rk, s.dataset.unit);
    // 沒有照片的話，模糊和亮度不會影響畫面，不用重畫
    if (bgImg || (s.dataset.rk !== 'blur' && s.dataset.rk !== 'bright')) refreshPreview();
  };

  elSheet.onchange = async (e) => {
    const sl = e.target.closest('[data-wall]');
    if (sl) {
      pushWallPrefs();
      // 模糊/亮度是烘焙進照片的，放開滑桿才重做一次（拖曳途中做太慢）
      if (sl.dataset.rk === 'blur' || sl.dataset.rk === 'bright') bakeAndPush();
      return;
    }
    const file = e.target.id === 'wallPhotoInput' && e.target.files && e.target.files[0];
    if (!file) return;
    const note = elSheet.querySelector('#wallNote');
    if (note) note.textContent = '處理照片中…';
    try {
      const b64 = await wallpaper.compressBackground(file);
      saveWallBgRaw(b64);
      await reloadBg();
      bakeAndPush();
      rerender();
      toast('背景照片已更新');
    } catch (err) {
      if (note) note.textContent = '這張照片讀不進來，換一張試試。';
    }
  };

  elSheet.onclick = (e) => {
    const mk = e.target.closest('[data-mock]');
    if (mk) { prefs.wallMockNP = !prefs.wallMockNP; savePrefs(); rerender(); return; }
    if (e.target.closest('[data-a="title"]')) {
      prefs.wallShowTitle = !prefs.wallShowTitle;
      savePrefs(); pushWallPrefs(); rerender();
      return;
    }
    const mode = e.target.closest('[data-bgmode]');
    if (mode) {
      prefs.wallBgMode = mode.dataset.bgmode;
      savePrefs(); pushWallPrefs();
      reloadBg().then(rerender);
      return;
    }
    const b = e.target.closest('[data-bg]');
    if (b) { prefs.wallBg = b.dataset.bg; savePrefs(); pushWallPrefs(); rerender(); return; }
    if (e.target.closest('[data-a="pick"]')) { elSheet.querySelector('#wallPhotoInput').click(); return; }
    if (e.target.closest('[data-a="rmphoto"]')) {
      saveWallBgRaw('');
      pushWallBg('');
      reloadBg().then(rerender);
      return;
    }
    if (e.target.closest('[data-a="scname"]')) {
      const v = prompt('捷徑的確切名稱（在「捷徑」App 的資料庫裡看得到）', prefs.wallShortcut);
      if (v && v.trim()) { prefs.wallShortcut = v.trim(); savePrefs(); rerender(); }
      return;
    }
    if (e.target.closest('[data-a="runsc"]')) {
      // 連結本身是 shortcuts:// 開頭，點下去 iOS 會切到「捷徑」跑完再跳回來。
      // 這裡只是先把設定推上 Firestore，捷徑那邊是現抓的，拿到的就是最新狀態。
      pushWallPrefs();
      return; // 不擋預設行為，讓它正常導向
    }
    if (e.target.closest('[data-a="done"]')) hideSheet();
  };
}

/* =========================================================
   設定頁
   ========================================================= */
let syncState = { status: sync.configured(FIREBASE_CONFIG) ? 'signedout' : 'off', user: null, error: '' };
const sw = (id, on) => `<button class="switch ${on ? 'on' : ''}" data-sw="${id}" role="switch" aria-checked="${on}"></button>`;
const sel = (id, opts, v) => `<select data-pref="${id}">${opts.map(([k, l]) => `<option value="${k}" ${String(v) === String(k) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;

function renderSettings() {
  const s = syncState;
  let account = '';
  if (s.status === 'off') {
    account = `<div class="card"><div class="row"><div><div>尚未設定同步</div><div class="sub">在 config.js 填入 Firebase 設定後，電腦和手機就能同步（步驟見 SETUP.md）。目前資料只存在這台裝置。</div></div></div></div>`;
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
    account = `<div class="card"><div class="row"><div><div>${esc(s.user.email)}</div><div class="sub">${label}${s.error ? '：' + esc(s.error) : ''}</div></div>
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
  else notifSub = '任務開了通知，時間到會提醒你。';
  const sessCount = sessions().length;

  $('#settings').innerHTML = `
    <h1 class="page-title">設定</h1>
    <div class="group-title">同步帳號</div>${account}

    <div class="group-title">顯示</div>
    <div class="card">
      <div class="row"><span>主題</span>${sel('theme', [['system', '跟隨系統'], ['light', '淺色'], ['dark', '深色']], prefs.theme)}</div>
      <div class="row col"><span>主題色</span><div class="accent-row">${ACCENTS.map((c) => `<button data-accent="${c}" class="${prefs.accent === c ? 'on' : ''}" style="background:${c}"></button>`).join('')}</div></div>
      <div class="row"><span>鎖定畫面桌布<div class="sub">外觀、背景照片、版面都在這裡調</div></span><button class="link" id="wallBtn">設定</button></div>
      <div class="row"><span>立即更新鎖定畫面<div class="sub">不等排程，馬上用捷徑「${esc(prefs.wallShortcut)}」換一張</div></span><a class="link" data-a="runsc" href="shortcuts://run-shortcut?name=${encodeURIComponent(prefs.wallShortcut)}">更新</a></div>
    </div>

    <div class="group-title">日曆</div>
    <div class="card">
      <div class="row"><span>一週開始日</span>${sel('weekStart', [[0, '星期日'], [1, '星期一']], prefs.weekStart)}</div>
      <div class="row"><span>隱藏預定任務<div class="sub">在行事曆中不顯示有日期的任務</div></span>${sw('hideTasksInCal', prefs.hideTasksInCal)}</div>
      <div class="row"><span>隱藏已完成任務<div class="sub">在行事曆中不顯示已完成的任務</div></span>${sw('hideDoneInCal', prefs.hideDoneInCal)}</div>
    </div>

    <div class="group-title">今日摘要與天氣</div>
    <div class="card">
      <div class="row"><span>自動顯示今日摘要<div class="sub">每天第一次打開 App 時顯示</div></span>${sw('summaryAuto', prefs.summaryAuto)}</div>
      <div class="row"><span>顯示天氣</span>${sw('showWeather', prefs.showWeather)}</div>
      <div class="row"><span>溫度單位</span>${sel('unit', [['c', '°C 攝氏'], ['f', '°F 華氏']], prefs.unit)}</div>
      <div class="row"><span>天氣位置<div class="sub">${prefs.useGps ? '使用目前位置' : '林口區'}</div></span>${sel('useGps', [['false', '林口區'], ['true', '目前位置']], String(prefs.useGps))}</div>
    </div>

    <div class="group-title">通知</div>
    <div class="card">
      <div class="row"><div><div>提醒通知</div><div class="sub">${notifSub}</div></div>
        ${notifSupported && perm !== 'denied' ? `<button class="link" id="nOn">${perm === 'granted' ? '測試' : '開啟'}</button>` : ''}</div>
      ${notifSupported && perm === 'granted' && syncState.user && VAPID_PUBLIC_KEY && localStorage.getItem('pushOn') !== '1'
        ? `<div class="row"><span>App 關著也要收到</span><button class="link" id="nPush">開啟</button></div>` : ''}
    </div>

    <div class="group-title">資料</div>
    <div class="card">
      <div class="row"><span>自動刪除已完成項目</span>${sel('autoDelete', [[0, '不刪除'], [1, '1 天後'], [7, '7 天後'], [30, '30 天後']], prefs.autoDelete)}</div>
      <div class="row"><span>匯出備份</span><button class="link" id="dExport">匯出</button></div>
      <div class="row"><span>匯入備份</span><label class="link" style="cursor:pointer">匯入<input type="file" id="dImport" accept="application/json,.json" hidden></label></div>
      <div class="row"><span>清除目前矩陣的已完成任務</span><button class="link danger" id="dClear">清除</button></div>
      ${sessCount ? `<div class="row"><span>專注紀錄<div class="sub">共 ${sessCount} 筆，${durLabel(sessions().reduce((n, x) => n + (x.minutes || 0), 0))}</div></span></div>` : ''}
    </div>

    <div class="group-title">說明</div>
    <div class="card">
      <div class="row"><span>新增練習任務<div class="sub">加幾個範例任務，看看各功能怎麼用</div></span><button class="link" id="demoBtn">新增</button></div>
      <div class="row"><span>快捷鍵（電腦）<div class="sub">N 新增 · 1–4 新增到象限 · / 搜尋 · [ ] 切換矩陣 · T 今天</div></span></div>
    </div>
    ${!standalone ? `<p class="note">在 iPhone 上：用 Safari 打開這個網址 → 點下方「分享」→「加入主畫面」，就會像 App 一樣全螢幕使用。</p>` : ''}
    <p class="note">矩陣待辦 · v2.0 · 天氣資料 Open-Meteo</p>
    <p class="note" id="envInfo"></p>`;

  // 要等 innerHTML 套用、分頁列也量得到之後才填
  const info = $('#envInfo');
  if (info) info.textContent = envInfo();
}

// 版面在不同裝置上會出現解釋不了的留白，把實際數值印出來才查得動
function envInfo() {
  // 用量測元素讀，不要用 getComputedStyle —— 自訂屬性裡的 min() 不會被解算成數值
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:-9999px;bottom:0;width:1px;height:env(safe-area-inset-bottom,0px)';
  document.body.appendChild(probe);
  const rawBottom = probe.getBoundingClientRect().height;
  probe.style.height = 'env(safe-area-inset-top,0px)';
  const rawTop = probe.getBoundingClientRect().height;
  probe.style.height = 'var(--safe-bottom)';
  const used = probe.getBoundingClientRect().height;
  probe.remove();
  const tb = document.querySelector('#tabbar');
  const r = tb ? tb.getBoundingClientRect() : { height: 0, bottom: 0 };
  const mode = matchMedia('(display-mode: standalone)').matches ? '獨立模式' : '瀏覽器';
  const screenH = (window.screen && window.screen.height) || innerHeight;
  return `視窗 ${innerWidth}×${innerHeight} / 螢幕 ${screenH} · 安全區 上${rawTop.toFixed(0)} 下${rawBottom.toFixed(0)}`
    + ` · 實際用 ${used.toFixed(0)} · 分頁列 高${r.height.toFixed(0)} 底${(innerHeight - r.bottom).toFixed(0)} · ${mode}`;
}

// iOS 獨立模式有時會把視窗給得比螢幕矮（狀態列那段），視窗底部其實已經離
// home indicator 很遠了，這時再保留 34pt 等於白白浪費。把已經空出來的扣掉。
function syncViewportGap() {
  const standalone = matchMedia('(display-mode: standalone)').matches;
  // 上方安全區 > 0 代表視窗是從螢幕頂端開始的，少掉的高度就落在底部。
  // 若狀態列模式改成不透明，視窗會改從狀態列下方開始，少掉的高度在上面，
  // 這時候補償會補錯邊，所以要先確認。
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:-9999px;width:1px;height:env(safe-area-inset-top,0px)';
  document.body.appendChild(probe);
  const topInset = probe.getBoundingClientRect().height;
  probe.remove();

  const screenH = (window.screen && window.screen.height) || window.innerHeight;
  const missing = Math.max(0, Math.round(screenH - window.innerHeight));
  const gap = (standalone && topInset > 0) ? missing : 0;
  document.documentElement.style.setProperty('--vgap', gap + 'px');
}
syncViewportGap();
addEventListener('resize', syncViewportGap);
addEventListener('orientationchange', syncViewportGap);

const elSettings = $('#settings');
elSettings.addEventListener('click', async (e) => {
  const swb = e.target.closest('[data-sw]');
  if (swb) {
    const k = swb.dataset.sw; prefs[k] = !prefs[k]; savePrefs();
    if (k === 'showWeather' && prefs.showWeather) loadWeather(true);
    render(); return;
  }
  const ac = e.target.closest('[data-accent]');
  if (ac) { prefs.accent = ac.dataset.accent; savePrefs(); applyTheme(); render(); return; }
  // 捷徑連結：先把設定推上 Firestore 再讓它導向，捷徑那邊拿到的才是最新的
  if (e.target.closest('[data-a="runsc"]')) { pushWallPrefs(); return; }
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
    if (Notification.permission === 'granted') await showLocalNotification('測試通知', '通知正常運作 👍', 'test');
    else await enableNotifications();
    renderSettings();
  }
  if (id === 'nPush') { await enablePush(); renderSettings(); }
  if (id === 'wallBtn') openWallpaper();
  if (id === 'demoBtn') addDemo();
  if (id === 'dExport') exportData();
  if (id === 'dClear') {
    const done = matrixTasks().filter((t) => t.done);
    if (!done.length) return toast('沒有已完成的任務');
    if (!confirm(`清除 ${done.length} 個已完成任務？`)) return;
    done.forEach((t) => { t.deleted = true; putTask(t, { silent: true }); });
    render(); toast(`已清除 ${done.length} 個`);
  }
});
elSettings.addEventListener('change', async (e) => {
  const p = e.target.dataset.pref;
  if (p) {
    let v = e.target.value;
    if (p === 'weekStart' || p === 'autoDelete') v = Number(v);
    if (p === 'useGps') v = v === 'true';
    prefs[p] = v; savePrefs(); applyTheme();
    if (p === 'unit' || p === 'useGps') loadWeather(true);
    if (p === 'autoDelete') autoDelete();
    render(); return;
  }
  if (e.target.id !== 'dImport') return;
  const f = e.target.files[0];
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    let n = 0;
    for (const kind of ['matrices', 'tasks', 'sessions']) {
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

function addDemo() {
  const mid = currentMatrix().id === ALL ? matrices()[0].id : currentMatrix().id;
  const t0 = today();
  const demo = [
    { title: '練習：點我看詳細、開始專注模式', quadrant: 1, date: t0 },
    { title: '練習：長按我拖到別的象限', quadrant: 2 },
    { title: '練習：每天重複的任務，勾完會自動排明天', quadrant: 2, date: t0, repeat: { type: 'daily' } },
    { title: '練習：下午 3 點的任務，會出現在時間軸', quadrant: 3, date: t0, time: '15:00', duration: 60 },
    { title: '練習：點象限標題可以改名字、圖示、顏色', quadrant: 4 },
  ];
  demo.forEach((x) => { const t = newTask({ ...x, matrix: mid }); t.order = orderFor(t); putTask(t, { silent: true }); });
  render(); toast('已加入 5 個練習任務');
}

function autoDelete() {
  if (!prefs.autoDelete) return;
  const cut = Date.now() - prefs.autoDelete * 86400000;
  let n = 0;
  tasks().forEach((t) => { if (t.done && t.doneAt && t.doneAt < cut) { t.deleted = true; putTask(t, { silent: true }); n++; } });
  if (n) render();
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
  const p = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/'));
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

/* =========================================================
   上方工具列 / 分頁 / 主題
   ========================================================= */
const wide = () => matchMedia('(min-width: 960px)').matches;
function renderTopbar() {
  const tb = $('#titleBtn'), ta = $('#topActions');
  if (ui.tab === 'settings' && !wide()) { tb.innerHTML = ''; ta.innerHTML = ''; return; }
  tb.innerHTML = ui.tab === 'cal' && !wide() ? '<span>行事曆</span>' : `<span>${esc(currentMatrix().name)}</span>${ICONS.chevron}`;
  const w = prefs.showWeather && wx ? `<button class="wx-pill" data-a="summary">${weather.wIcon(wx.now.code, wx.now.day)} ${deg(wx.now.temp)}</button>` : `<button class="icon-btn" data-a="summary" aria-label="今日摘要">${ICONS.sun}</button>`;
  ta.innerHTML = ui.tab === 'matrix' || wide()
    ? `${w}<button class="icon-btn" data-a="search" aria-label="搜尋">${ICONS.search}</button><button class="icon-btn" data-a="sort" aria-label="排序與顯示">${ICONS.sliders}</button>`
    : w;
}
$('#titleBtn').addEventListener('click', () => { if (ui.tab === 'matrix' || wide()) openMatrixSheet(); });
$('#topActions').addEventListener('click', (e) => {
  const a = e.target.closest('[data-a]')?.dataset.a;
  if (a === 'summary') openSummary();
  if (a === 'search') { if (ui.tab !== 'matrix') setTab('matrix'); openSearch(); }
  if (a === 'sort') openSortSheet();
});

const views = { matrix: $('#viewMatrix'), cal: $('#viewCal'), settings: $('#viewSettings') };
$('#tabbar').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) setTab(b.dataset.tab); });
function setTab(tab) {
  if (wide() && tab === 'cal') tab = 'matrix';
  const prev = ui.tab;
  ui.tab = tab; persistUi();
  Object.entries(views).forEach(([k, v]) => v.classList.toggle('active', k === tab));
  $$('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('#fab').hidden = tab === 'settings';
  document.body.dataset.tab = tab;
  render();
  if (tab === 'cal' && prev !== 'cal') scrollTimeline();
}
$('#fab').addEventListener('click', () => {
  if (ui.tab === 'cal' && !wide()) {
    const n = new Date();
    const time = ui.sel === today() ? fromMin(Math.min(23 * 60, (n.getHours() + 1) * 60)) : '09:00';
    openEditor(null, prefs.calMode === 'month' ? { date: ui.sel, quadrant: 2 } : { date: ui.sel, time, duration: 60, quadrant: 2 });
  } else openEditor(null, { quadrant: 1 });
});

function applyTheme() {
  const root = document.documentElement;
  if (prefs.theme === 'system') delete root.dataset.theme; else root.dataset.theme = prefs.theme;
  root.style.setProperty('--accent', prefs.accent);
  root.style.setProperty('--cal-scale', prefs.calScale);
  const dark = prefs.theme === 'dark' || (prefs.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name="theme-color"]').setAttribute('content', dark ? '#0e0e10' : '#f4f4f6');
}

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
  renderTopbar();
  if (ui.tab === 'matrix' || wide()) { renderMatrix(); renderSearch(); }
  if (ui.tab === 'cal' || wide()) renderCal();
  if (ui.tab === 'settings') renderSettings();
  const dot = $('#syncDot');
  dot.className = 'sync-dot ' + ({ on: 'on', syncing: 'busy', error: 'err' }[syncState.status] || '');
  dot.title = { off: '未設定同步', signedout: '未登入', syncing: '同步中', on: '已同步', error: '同步出錯' }[syncState.status];
}

/* ---- 電腦快捷鍵 ---- */
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey || !elSheet.hidden || focus.running()) return;
  const k = e.key.toLowerCase();
  if (k === 'n') { e.preventDefault(); openEditor(null, { quadrant: 1 }); }
  if (['1', '2', '3', '4'].includes(k)) { e.preventDefault(); openEditor(null, { quadrant: Number(k) }); }
  if (k === '/') { e.preventDefault(); setTab('matrix'); openSearch(); }
  if (k === '[') stepMatrix(-1);
  if (k === ']') stepMatrix(1);
  if (k === 't') { ui.sel = today(); renderCal(); scrollTimeline(); }
});

/* =========================================================
   啟動
   ========================================================= */
applyTheme();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
matchMedia('(min-width: 960px)').addEventListener('change', () => setTab(ui.tab));
setInterval(() => { if (ui.tab === 'cal' || wide()) renderCal(); }, 60000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { render(); scheduleLocalReminders(); maybeSummary(); }
});

autoDelete();
setTab(ui.tab === 'settings' ? 'matrix' : ui.tab);
scrollTimeline();
scheduleLocalReminders();
loadWeather();
setInterval(() => loadWeather(), 30 * 60 * 1000);

function maybeSummary() {
  if (!prefs.summaryAuto || focus.running() || !elSheet.hidden) return;
  const t0 = today();
  if (localStorage.getItem('matrix-todo:summaryDay') === t0) return;
  localStorage.setItem('matrix-todo:summaryDay', t0);
  setTimeout(openSummary, 400);
}
maybeSummary();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW 註冊失敗', e));
}

sync.init(FIREBASE_CONFIG, {
  getLocal: (kind) => Object.values(data[kind] || {}),
  onRemote: applyRemote,
  remindTime,
  reminderBody,
  onState: (s) => {
    syncState = { ...syncState, ...s };
    if (!s.user && s.status === 'signedout') localStorage.removeItem('pushOn');
    render();
  },
});
