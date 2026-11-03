// 矩陣待辦 · 共用函式（直接讀寫 Firestore，不經過 App）
import { execFileSync } from 'node:child_process';

export const API_KEY = 'AIzaSyAEcXgLcD6xGDf0CYVFEtwLJWGjDMX1URA';
export const PROJECT_ID = 'matrix-todo-jaylai';
export const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// 憑證放 macOS 鑰匙圈，不要落在檔案系統上
const KC_ACCOUNT = 'matrix-todo';
const KC_REFRESH = 'matrix-todo-refresh';
const KC_UID = 'matrix-todo-uid';

export function keychainGet(service) {
  try {
    return execFileSync('security', ['find-generic-password', '-a', KC_ACCOUNT, '-s', service, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}
export function keychainSet(service, value) {
  execFileSync('security', ['add-generic-password', '-U', '-a', KC_ACCOUNT, '-s', service, '-w', value],
    { stdio: ['ignore', 'ignore', 'ignore'] });
}
export function keychainDelete(service) {
  try {
    execFileSync('security', ['delete-generic-password', '-a', KC_ACCOUNT, '-s', service],
      { stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch { return false; }
}

export const SERVICES = { refresh: KC_REFRESH, uid: KC_UID };

async function postJSON(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

export async function signIn(email, password) {
  const r = await postJSON(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    { email, password, returnSecureToken: true });
  if (!r.idToken) throw new Error(authMessage(r));
  return r;
}

export function authMessage(r) {
  const c = (r.error && r.error.message) || '';
  return ({
    INVALID_LOGIN_CREDENTIALS: 'Email 或密碼錯誤',
    INVALID_PASSWORD: 'Email 或密碼錯誤',
    EMAIL_NOT_FOUND: '找不到這個帳號',
    USER_DISABLED: '這個帳號已被停用',
    TOO_MANY_ATTEMPTS_TRY_LATER: '嘗試太多次，稍後再試',
  })[c] || c || '登入失敗';
}

// refresh token 不會過期（除非改密碼或撤銷），所以不存密碼
export async function auth() {
  const refresh = keychainGet(KC_REFRESH);
  if (!refresh) {
    throw new Error('還沒登入。先執行 scripts/login.mjs（見 SKILL.md）。');
  }
  const r = await postJSON(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`,
    { grant_type: 'refresh_token', refresh_token: refresh });
  if (!r.id_token) throw new Error('登入憑證失效了（可能改過密碼），請重新執行 login.mjs。');
  if (r.refresh_token && r.refresh_token !== refresh) keychainSet(KC_REFRESH, r.refresh_token);
  const uid = keychainGet(KC_UID) || r.user_id;
  if (!uid) throw new Error('取不到帳號 ID，請重新執行 login.mjs。');
  return { idToken: r.id_token, uid };
}

/* ---------- Firestore 的型別包裝 ---------- */

export function encode(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  return { mapValue: { fields: encodeFields(v) } };
}
export const encodeFields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, encode(v)]));

export function decode(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) return decodeFields((v.mapValue || {}).fields || {});
  if ('arrayValue' in v) return ((v.arrayValue || {}).values || []).map(decode);
  return null;
}
export const decodeFields = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, decode(v)]));

export async function listDocs({ idToken, uid }, kind) {
  const out = [];
  let pageToken = '';
  do {
    const url = `${FS}/users/${uid}/${kind}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const r = await (await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } })).json();
    if (r.error) throw new Error(`讀取 ${kind} 失敗：${r.error.message}`);
    (r.documents || []).forEach((d) => out.push(decodeFields(d.fields || {})));
    pageToken = r.nextPageToken || '';
  } while (pageToken);
  return out;
}

export async function putDoc({ idToken }, path, obj) {
  const r = await fetch(`${FS}/${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ fields: encodeFields(obj) }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`寫入 ${path} 失敗：${(j.error && j.error.message) || r.status}`);
  return j;
}

/* ---------- 任務相關 ---------- */

export const DEFAULT_QUADS = {
  1: { name: '重要且緊急' },
  2: { name: '重要不緊急' },
  3: { name: '緊急較不重要' },
  4: { name: '不緊急不重要' },
};

// App 用的是 crypto.randomUUID 之外的短 id，這裡用同樣風格即可（只要唯一）
export const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// 支援 今天/明天/後天/大後天/下週一… / YYYY-MM-DD / MM-DD / M月D日
export function parseDate(input) {
  if (!input) return '';
  const s = String(input).trim();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const rel = { 今天: 0, 今日: 0, 明天: 1, 明日: 1, 後天: 2, 大後天: 3 };
  if (s in rel) { const d = new Date(today); d.setDate(d.getDate() + rel[s]); return ymd(d); }
  const dow = ['日', '一', '二', '三', '四', '五', '六'];
  const wk = s.match(/^(這|下|下下)?(週|星期|禮拜)([日一二三四五六])$/);
  if (wk) {
    const want = dow.indexOf(wk[3]);
    const weeks = wk[1] === '下' ? 1 : wk[1] === '下下' ? 2 : 0;
    const d = new Date(today);
    let diff = (want - d.getDay() + 7) % 7;
    if (weeks === 0 && diff === 0) diff = 7; // 「週三」當天已過就算下一個
    d.setDate(d.getDate() + diff + weeks * 7);
    return ymd(d);
  }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/^(\d{1,2})[-/月](\d{1,2})日?$/);
  if (m) {
    const y = today.getFullYear();
    const cand = `${y}-${pad(+m[1])}-${pad(+m[2])}`;
    // 已經過了就算明年
    return cand < ymd(today) ? `${y + 1}-${pad(+m[1])}-${pad(+m[2])}` : cand;
  }
  throw new Error(`看不懂的日期：「${s}」。可用：今天／明天／後天／下週三／2026-11-05／11-05`);
}

export function parseTime(input) {
  if (!input) return '';
  const s = String(input).trim();
  let m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) return `${pad(+m[1])}:${m[2]}`;
  m = s.match(/^(上午|早上|下午|晚上)?(\d{1,2})(?::(\d{2})|點(\d{1,2})?分?)?$/);
  if (m) {
    let h = +m[2];
    const mm = m[3] ? +m[3] : m[4] ? +m[4] : 0;
    if (/下午|晚上/.test(m[1] || '') && h < 12) h += 12;
    if (/上午|早上/.test(m[1] || '') && h === 12) h = 0;
    return `${pad(h)}:${pad(mm)}`;
  }
  throw new Error(`看不懂的時間：「${s}」。可用：14:30／下午2點／晚上8:15`);
}

export function resolveQuadrant(input, matrix) {
  if (input === undefined || input === null || input === '') return 1;
  const n = Number(input);
  if (Number.isInteger(n) && n >= 1 && n <= 4) return n;
  const name = String(input).trim();
  for (const q of [1, 2, 3, 4]) {
    const custom = ((matrix && matrix.quads) || {})[q] || {};
    const label = custom.name || DEFAULT_QUADS[q].name;
    if (label === name) return q;
  }
  throw new Error(`看不懂的象限：「${name}」。可用 1–4，或象限名稱。`);
}

export const quadName = (matrix, q) =>
  (((matrix && matrix.quads) || {})[q] || {}).name || DEFAULT_QUADS[q].name;

export function pickMatrix(matrices, wanted) {
  const live = matrices.filter((m) => !m.deleted);
  if (!live.length) throw new Error('這個帳號裡還沒有任何矩陣，先在 App 裡開一個。');
  if (wanted) {
    const hit = live.find((m) => (m.name || '').trim() === String(wanted).trim());
    if (!hit) throw new Error(`找不到矩陣「${wanted}」。現有：${live.map((m) => m.name).join('、')}`);
    return hit;
  }
  return live.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
}

// App 預設把新任務放在最上面（prefs.addPos = 'top'）
export function orderForNew(tasks, matrixId, quadrant) {
  const same = tasks.filter((t) => !t.deleted && t.matrix === matrixId && Number(t.quadrant) === Number(quadrant));
  if (!same.length) return Date.now();
  return Math.min(...same.map((t) => t.order ?? 0)) - 1;
}

// 和 App 的 remindTime 一致
export function remindAt(task) {
  if (!task.notify || !task.date) return null;
  const [y, mo, d] = task.date.split('-').map(Number);
  const [h, mi] = (task.time || '09:00').split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi, 0, 0).getTime() - Number(task.remind || 0) * 60000;
}

export function dateLabel(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const t = ymd(today);
  const [y, m, d] = dateStr.split('-').map(Number);
  const tm = new Date(today); tm.setDate(tm.getDate() + 1);
  if (dateStr === t) return '今天';
  if (dateStr === ymd(tm)) return '明天';
  return `${m}月${d}日`;
}
