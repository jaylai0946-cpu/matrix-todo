// 專注模式：倒數計時（或不限時正數），結束後記錄成一段專注時間
import { esc, clockLabel, pad } from './util.js';

const KEY = 'matrix-todo:focus';
let state = null;   // { taskId, title, color, start, target(min|0), pausedAt, paused(ms) }
let timer = null, wake = null, hooks = null, el = null, alerted = false;

export function init(h) {
  hooks = h;
  try { state = JSON.parse(localStorage.getItem(KEY)); } catch { state = null; }
  if (state) mount();
}
const save = () => { try { state ? localStorage.setItem(KEY, JSON.stringify(state)) : localStorage.removeItem(KEY); } catch {} };
export const running = () => !!state;

function elapsedMs() {
  if (!state) return 0;
  const end = state.pausedAt || Date.now();
  return Math.max(0, end - state.start - (state.paused || 0));
}
const fmt = (ms) => { const s = Math.floor(ms / 1000); const h = Math.floor(s / 3600); return (h ? h + ':' : '') + `${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };

export function start(task, minutes, color) {
  state = { taskId: task.id, title: task.title, color, start: Date.now(), target: minutes, pausedAt: null, paused: 0 };
  alerted = false;
  save();
  mount();
}

async function keepAwake() {
  try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => (wake = null)); } } catch {}
}

function mount() {
  if (!el) {
    el = document.createElement('div');
    el.className = 'focus';
    document.body.appendChild(el);
    el.addEventListener('click', onClick);
  }
  el.style.setProperty('--fc', state.color || 'var(--accent)');
  el.innerHTML = `
    <div class="focus-top"><small>開始</small><div>${clockLabel(state.start)}</div></div>
    <div class="focus-mid">
      <small>專注中</small>
      <h2>${esc(state.title)}</h2>
      <div class="ring">
        <svg viewBox="0 0 200 200"><circle class="track" cx="100" cy="100" r="88"/><circle class="bar" cx="100" cy="100" r="88"/></svg>
        <div class="ring-text"><div class="big" id="fBig">--:--</div><small id="fBigLabel"></small></div>
      </div>
      <div class="focus-stats"><div><b id="fEl">00:00</b><small>已過</small></div><i></i><div><b id="fTg">${state.target ? fmt(state.target * 60000) : '∞'}</b><small>目標</small></div></div>
    </div>
    <div class="focus-actions">
      <button class="btn ghost" data-a="pause">${state.pausedAt ? '繼續' : '暫停'}</button>
      <button class="btn danger-solid" data-a="end">結束</button>
    </div>
    ${state.target ? '<button class="focus-add" data-a="add">＋ 加 5 分鐘</button>' : '<div class="focus-add"></div>'}`;
  document.body.classList.add('focusing');
  tick();
  clearInterval(timer);
  timer = setInterval(tick, 500);
  keepAwake();
}

function tick() {
  if (!state || !el) return;
  const e = elapsedMs();
  const bar = el.querySelector('.bar');
  const C = 2 * Math.PI * 88;
  if (state.target) {
    const total = state.target * 60000;
    const left = Math.max(0, total - e);
    el.querySelector('#fBig').textContent = fmt(left);
    el.querySelector('#fBigLabel').textContent = state.pausedAt ? '已暫停' : '剩餘時間';
    bar.style.strokeDasharray = C;
    bar.style.strokeDashoffset = C * (e / total > 1 ? 0 : 1 - e / total);
    if (left === 0 && !alerted) {
      alerted = true;
      hooks.notify('專注時間到', state.title);
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      finish();
      return;
    }
  } else {
    el.querySelector('#fBig').textContent = fmt(e);
    el.querySelector('#fBigLabel').textContent = state.pausedAt ? '已暫停' : '不限時';
    bar.style.strokeDasharray = C;
    bar.style.strokeDashoffset = C * (1 - ((e / 60000) % 60) / 60);
  }
  el.querySelector('#fEl').textContent = fmt(e);
}

function onClick(ev) {
  const a = ev.target.closest('[data-a]')?.dataset.a;
  if (!a || !state) return;
  if (a === 'pause') {
    if (state.pausedAt) { state.paused += Date.now() - state.pausedAt; state.pausedAt = null; }
    else state.pausedAt = Date.now();
    save(); mount();
  }
  if (a === 'add') { state.target += 5; alerted = false; save(); mount(); }
  if (a === 'end') finish();
  if (a === 'later') close(false);
  if (a === 'complete') close(true);
}

function finish() {
  if (!state.pausedAt) state.pausedAt = Date.now();
  save();
  const mins = Math.round(elapsedMs() / 60000);
  const box = document.createElement('div');
  box.className = 'focus-done';
  box.innerHTML = `<div class="card"><h3>辛苦了！</h3><p>專注了 ${mins < 1 ? '不到 1' : mins} 分鐘。<br>要把「${esc(state.title)}」標記為完成嗎？</p>
    <div class="btn-row"><button class="btn ghost" data-a="later">稍後繼續</button><button class="btn" data-a="complete">標記為完成</button></div></div>`;
  el.appendChild(box);
}

function close(complete) {
  const s = state;
  const ms = elapsedMs();
  state = null; save();
  clearInterval(timer);
  if (wake) { wake.release().catch(() => {}); wake = null; }
  document.body.classList.remove('focusing');
  el.remove(); el = null;
  if (ms >= 60 * 1000) hooks.record({ taskId: s.taskId, title: s.title, start: s.start, end: s.start + ms + (s.paused || 0), minutes: Math.round(ms / 60000) });
  if (complete) hooks.complete(s.taskId);
}

// 選擇持續時間的面板內容
export const DURATIONS = [15, 25, 30, 45, 60, 90];
