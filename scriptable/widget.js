// 矩陣待辦 · iPhone 主畫面小工具
// 在 Scriptable 裡執行。第一次請「在 App 內執行」一次完成登入，之後小工具才讀得到資料。
//
// 登入後只會把 refreshToken 存進 Keychain，不會存你的密碼。
// 要登出或換帳號：在 App 內執行這支腳本，選「登出」。

const PROJECT_ID = 'matrix-todo-jaylai';
const API_KEY = 'AIzaSyAEcXgLcD6xGDf0CYVFEtwLJWGjDMX1URA';
const APP_URL = 'https://jaylai0946-cpu.github.io/matrix-todo/';

const K_REFRESH = 'matrixTodo.refreshToken';
const K_UID = 'matrixTodo.uid';
const K_EMAIL = 'matrixTodo.email';

const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const DEFAULT_QUADS = {
  1: { name: '重要且緊急', color: '#ff5a5f' },
  2: { name: '重要不緊急', color: '#4f8cff' },
  3: { name: '緊急較不重要', color: '#f5a524' },
  4: { name: '不緊急不重要', color: '#9a9aa3' },
};

/* ====================== 認證 ====================== */

async function signIn(email, password) {
  const r = await postJSON(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    { email, password, returnSecureToken: true },
  );
  if (!r.idToken) throw new Error(authMessage(r));
  Keychain.set(K_REFRESH, r.refreshToken);
  Keychain.set(K_UID, r.localId);
  Keychain.set(K_EMAIL, email);
  return r.idToken;
}

// refreshToken 不會過期（除非改密碼或撤銷），所以不必存密碼。
async function freshIdToken() {
  if (!Keychain.contains(K_REFRESH)) return null;
  const r = await postJSON(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`, {
    grant_type: 'refresh_token',
    refresh_token: Keychain.get(K_REFRESH),
  });
  if (!r.id_token) return null;
  if (r.refresh_token) Keychain.set(K_REFRESH, r.refresh_token);
  return r.id_token;
}

function signOut() {
  [K_REFRESH, K_UID, K_EMAIL].forEach((k) => { if (Keychain.contains(k)) Keychain.remove(k); });
}

function authMessage(r) {
  const c = (r.error && r.error.message) || '';
  return ({
    INVALID_LOGIN_CREDENTIALS: 'Email 或密碼錯誤',
    INVALID_PASSWORD: 'Email 或密碼錯誤',
    EMAIL_NOT_FOUND: '找不到這個帳號',
    USER_DISABLED: '這個帳號已被停用',
    TOO_MANY_ATTEMPTS_TRY_LATER: '嘗試太多次，稍後再試',
  })[c] || c || '登入失敗';
}

/* ====================== 讀取資料 ====================== */

async function postJSON(url, body) {
  const req = new Request(url);
  req.method = 'POST';
  req.headers = { 'Content-Type': 'application/json' };
  req.body = JSON.stringify(body);
  return req.loadJSON();
}

// Firestore REST 回來的值是 {stringValue:…}/{integerValue:…} 這種包裝，拆成一般 JS 值
function decode(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return decodeFields((v.mapValue || {}).fields || {});
  if ('arrayValue' in v) return ((v.arrayValue || {}).values || []).map(decode);
  return null;
}
const decodeFields = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, decode(v)]));

async function listDocs(idToken, uid, kind) {
  const out = [];
  let pageToken = '';
  do {
    const url = `${FS}/users/${uid}/${kind}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const req = new Request(url);
    req.headers = { Authorization: `Bearer ${idToken}` };
    const r = await req.loadJSON();
    if (r.error) throw new Error(r.error.message || '讀取失敗');
    (r.documents || []).forEach((d) => out.push(decodeFields(d.fields || {})));
    pageToken = r.nextPageToken || '';
  } while (pageToken);
  return out;
}

/* ====================== 整理 ====================== */

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function pickMatrix(matrices, wanted) {
  const live = matrices.filter((m) => !m.deleted);
  if (!live.length) return null;
  if (wanted) {
    const hit = live.find((m) => (m.name || '').trim() === wanted.trim());
    if (hit) return hit;
  }
  return live.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
}

function group(tasks, matrix) {
  const today = ymd(new Date());
  const mine = tasks.filter((t) =>
    !t.done && !t.deleted && (!matrix || !t.matrix || t.matrix === matrix.id));

  const by = { 1: [], 2: [], 3: [], 4: [] };
  mine.forEach((t) => {
    const q = Number(t.quadrant) || 4;
    if (by[q]) by[q].push(t);
  });
  // 有日期的排前面（愈近愈前），其次照 App 裡的排序
  Object.values(by).forEach((list) => list.sort((a, b) => {
    if (!!a.date !== !!b.date) return a.date ? -1 : 1;
    if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (a.order ?? a.createdAt ?? 0) - (b.order ?? b.createdAt ?? 0);
  }));
  const overdue = mine.filter((t) => t.date && t.date < today).length;
  return { by, today, todayCount: mine.filter((t) => t.date === today).length, overdue, total: mine.length };
}

function quadMeta(matrix, q) {
  const custom = ((matrix && matrix.quads) || {})[q] || {};
  return { ...DEFAULT_QUADS[q], ...custom };
}

/* ====================== 畫面 ====================== */

// Scriptable 不會告訴你小工具實際多大，只能照螢幕寬度查表換算，
// 否則四個象限方塊寬度不一致，排不成格子。
const WIDGET_SIZES = {
  430: { small: 170, medium: 364, large: 364 },
  428: { small: 170, medium: 364, large: 364 },
  414: { small: 169, medium: 360, large: 379 },
  406: { small: 162, medium: 344, large: 344 },
  402: { small: 162, medium: 348, large: 348 },
  393: { small: 158, medium: 338, large: 354 },
  390: { small: 158, medium: 338, large: 354 },
  375: { small: 155, medium: 329, large: 345 },
  360: { small: 155, medium: 329, large: 345 },
  320: { small: 141, medium: 291, large: 299 },
};
const WIDGET_HEIGHTS = { small: 1, medium: 0.47, large: 1.06 }; // 相對於同家族寬度

function widgetBox(family) {
  const w = Math.round(Device.screenSize().width);
  let table = WIDGET_SIZES[w];
  if (!table) {
    // 查不到的新機型：用最接近的螢幕寬度推估
    const near = Object.keys(WIDGET_SIZES).map(Number)
      .sort((a, b) => Math.abs(a - w) - Math.abs(b - w))[0];
    table = WIDGET_SIZES[near];
  }
  const width = table[family] || table.medium;
  const small = table.small;
  return { width, height: family === 'small' ? small : Math.round(width * WIDGET_HEIGHTS[family]) };
}

const BG = Color.dynamic(new Color('#f2f2f7'), new Color('#1c1c1e'));
const CARD = Color.dynamic(new Color('#ffffff'), new Color('#2c2c2e'));
const TEXT = Color.dynamic(new Color('#1c1c1e'), new Color('#ffffff'));
const DIM = Color.dynamic(new Color('#8e8e93'), new Color('#98989e'));

const ACCESSORY = ['accessoryCircular', 'accessoryRectangular', 'accessoryInline'];
const isLockScreen = (family) => ACCESSORY.includes(family);

function shell(family) {
  const w = new ListWidget();
  if (isLockScreen(family)) {
    // 鎖定畫面的小工具會被系統染成單色，不要自己設背景色，
    // 改用系統提供的那層霧面底（圓形／長方形才有）。
    if (family !== 'accessoryInline' && w.addAccessoryWidgetBackground !== undefined) {
      w.addAccessoryWidgetBackground = true;
    }
  } else {
    w.backgroundColor = BG;
  }
  w.url = APP_URL;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  return w;
}

// 跨象限挑出「最該先看」的幾件：逾期 → 今天 → 其餘，同組再照象限順序
function topTasks(g, n) {
  const all = [];
  [1, 2, 3, 4].forEach((q) => g.by[q].forEach((t) => all.push({ ...t, q })));
  const rank = (t) => (t.date && t.date < g.today ? 0 : t.date === g.today ? 1 : 2);
  all.sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.q !== b.q) return a.q - b.q;
    if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (a.order ?? a.createdAt ?? 0) - (b.order ?? b.createdAt ?? 0);
  });
  return all.slice(0, n);
}

function buildAccessory(family, matrix, g) {
  const w = shell(family);
  const W = Color.white();
  const dim = new Color('ffffff', 0.7);

  if (family === 'accessoryInline') {
    // 時間下面那一行，只能放一行純文字，愈短愈好
    const t = w.addText(g.total ? summaryLine(g) : '今天沒安排');
    t.font = Font.systemFont(13);
    return w;
  }

  if (family === 'accessoryCircular') {
    w.setPadding(0, 0, 0, 0);
    const s = w.addStack();
    s.layoutVertically();
    s.centerAlignContent();
    const n = g.overdue || g.todayCount || g.total;
    const big = s.addText(String(n));
    big.font = Font.boldRoundedSystemFont(22);
    big.textColor = W;
    big.centerAlignText();
    const label = s.addText(g.overdue ? '逾期' : g.todayCount ? '今天' : '待辦');
    label.font = Font.systemFont(9);
    label.textColor = dim;
    label.centerAlignText();
    return w;
  }

  // accessoryRectangular：約 160x72pt，放得下標題列 + 2 條任務
  w.setPadding(2, 2, 2, 2);
  const head = w.addText(`${matrix ? matrix.name : '矩陣待辦'} · ${summaryLine(g)}`);
  head.font = Font.semiboldSystemFont(12);
  head.textColor = W;
  head.lineLimit = 1;

  const list = topTasks(g, 2);
  if (!list.length) {
    w.addSpacer(2);
    const e = w.addText('全部完成');
    e.font = Font.systemFont(12);
    e.textColor = dim;
    return w;
  }
  list.forEach((t) => {
    w.addSpacer(1);
    const mark = t.date && t.date < g.today ? '! ' : t.date === g.today ? '· ' : '  ';
    const line = w.addText(mark + (t.title || '（無標題）'));
    line.font = Font.systemFont(12);
    line.textColor = dim;
    line.lineLimit = 1;
  });
  return w;
}

function notice(family, title, lines) {
  const w = shell(family);
  if (isLockScreen(family)) {
    // 鎖定畫面空間太小，只放得下標題
    const t = w.addText(title);
    t.font = Font.systemFont(family === 'accessoryCircular' ? 10 : 12);
    t.textColor = Color.white();
    t.lineLimit = family === 'accessoryCircular' ? 2 : 1;
    if (family === 'accessoryCircular') t.centerAlignText();
    return w;
  }
  w.setPadding(16, 16, 16, 16);
  const t = w.addText(title);
  t.font = Font.semiboldSystemFont(15);
  t.textColor = TEXT;
  lines.forEach((line) => {
    w.addSpacer(4);
    const s = w.addText(line);
    s.font = Font.systemFont(12);
    s.textColor = DIM;
  });
  return w;
}

function buildWidget(size, matrix, g) {
  const w = shell(size);
  const PAD = 12;
  const gap = size === 'small' ? 6 : 8;
  const box = widgetBox(size);
  const tileW = Math.floor((box.width - PAD * 2 - gap) / 2);
  const headH = size === 'small' ? 40 : 28;
  const tileH = Math.floor((box.height - PAD * 2 - headH - gap) / 2);
  w.setPadding(PAD, PAD, PAD, PAD);

  if (size === 'small') {
    const head = w.addText(matrix ? matrix.name : '矩陣待辦');
    head.font = Font.semiboldSystemFont(13);
    head.textColor = TEXT;
    head.lineLimit = 1;
    w.addSpacer(2);
    const sub = w.addText(summaryLine(g));
    sub.font = Font.systemFont(10);
    sub.textColor = g.overdue ? new Color('ff5a5f') : DIM;
    sub.lineLimit = 1;
    w.addSpacer(8);
    [[1, 2], [3, 4]].forEach((row, i) => {
      const r = w.addStack();
      r.spacing = gap;
      row.forEach((q) => countTile(r, quadMeta(matrix, q), g.by[q].length, tileW, tileH));
      if (i === 0) w.addSpacer(gap);
    });
    return w;
  }

  // 中型小工具每格只有約 49pt 高，放得下標題列 + 1 條任務；大型放得下 5 條。
  const perQuad = size === 'large' ? 5 : 1;
  const head = w.addStack();
  head.centerAlignContent();
  const title = head.addText(matrix ? matrix.name : '矩陣待辦');
  title.font = Font.semiboldSystemFont(14);
  title.textColor = TEXT;
  title.lineLimit = 1;
  head.addSpacer();
  const meta = head.addText(summaryLine(g));
  meta.font = Font.systemFont(11);
  meta.textColor = g.overdue ? new Color('ff5a5f') : DIM;
  w.addSpacer(8);

  [[1, 2], [3, 4]].forEach((row, i) => {
    const r = w.addStack();
    r.spacing = gap;
    row.forEach((q) => quadTile(r, quadMeta(matrix, q), g.by[q], perQuad, g.today, size, tileW, tileH));
    if (i === 0) w.addSpacer(gap);
  });
  return w;
}

function summaryLine(g) {
  if (g.overdue) return `逾期 ${g.overdue} · 今天 ${g.todayCount}`;
  if (g.todayCount) return `今天 ${g.todayCount} 件`;
  return g.total ? `${g.total} 件未完成` : '今天沒安排';
}

function countTile(parent, meta, n, tileW, tileH) {
  const s = parent.addStack();
  s.layoutVertically();
  s.backgroundColor = CARD;
  s.cornerRadius = 9;
  s.setPadding(6, 8, 6, 8);
  s.size = new Size(tileW, tileH);
  const dotRow = s.addStack();
  dotRow.centerAlignContent();
  dot(dotRow, meta.color);
  dotRow.addSpacer(4);
  const c = dotRow.addText(String(n));
  c.font = Font.semiboldRoundedSystemFont(15);
  c.textColor = TEXT;
  s.addSpacer(1);
  const name = s.addText(meta.name);
  name.font = Font.systemFont(9);
  name.textColor = DIM;
  name.lineLimit = 1;
  s.addSpacer();
}

function quadTile(parent, meta, list, limit, today, size, tileW, tileH) {
  const s = parent.addStack();
  s.layoutVertically();
  s.backgroundColor = CARD;
  s.cornerRadius = 10;
  s.setPadding(7, 9, 7, 9);
  s.size = new Size(tileW, tileH);

  const head = s.addStack();
  head.centerAlignContent();
  dot(head, meta.color);
  head.addSpacer(4);
  const n = head.addText(meta.name);
  n.font = Font.semiboldSystemFont(size === 'large' ? 11 : 10);
  n.textColor = new Color(meta.color.replace('#', ''));
  n.lineLimit = 1;
  head.addSpacer();
  const c = head.addText(String(list.length));
  c.font = Font.semiboldRoundedSystemFont(size === 'large' ? 11 : 10);
  c.textColor = DIM;

  if (!list.length) {
    s.addSpacer(3);
    const e = s.addText('—');
    e.font = Font.systemFont(10);
    e.textColor = DIM;
    return;
  }
  list.slice(0, limit).forEach((t) => {
    s.addSpacer(3);
    const line = s.addStack();
    line.centerAlignContent();
    const label = line.addText(t.title || '（無標題）');
    label.font = Font.systemFont(size === 'large' ? 11 : 10);
    label.textColor = TEXT;
    label.lineLimit = 1;
    if (t.date && t.date < today) {
      line.addSpacer(3);
      const od = line.addText('!');
      od.font = Font.boldSystemFont(10);
      od.textColor = new Color('#ff5a5f');
    } else if (t.date === today) {
      line.addSpacer(3);
      const td = line.addText('今');
      td.font = Font.systemFont(9);
      td.textColor = DIM;
    }
  });
  // 中型高度不夠，而且標題列右邊已經有總數了，就不再多一行
  const rest = size === 'large' ? list.length - limit : 0;
  if (rest > 0) {
    s.addSpacer(2);
    const m = s.addText(`還有 ${rest} 件`);
    m.font = Font.systemFont(9);
    m.textColor = DIM;
  }
  s.addSpacer(); // 內容靠上對齊
}

function dot(parent, hex) {
  const d = parent.addStack();
  d.size = new Size(7, 7);
  d.cornerRadius = 3.5;
  d.backgroundColor = new Color(hex.replace('#', ''));
}

/* ====================== 在 App 內執行時的選單 ====================== */

async function runInApp() {
  const signedIn = Keychain.contains(K_REFRESH);
  const a = new Alert();
  a.title = '矩陣待辦小工具';
  a.message = signedIn
    ? `已登入：${Keychain.contains(K_EMAIL) ? Keychain.get(K_EMAIL) : ''}\n可以把小工具加到主畫面了。`
    : '還沒登入。請先用你在 App 裡用的同一組帳號登入。';
  if (!signedIn) a.addAction('登入');
  else { a.addAction('預覽小工具'); a.addDestructiveAction('登出'); }
  a.addCancelAction('關閉');
  const idx = await a.presentAlert();
  if (idx === -1) return;

  if (!signedIn) {
    const f = new Alert();
    f.title = '登入';
    f.message = '和 App 裡同一組帳號密碼。只會儲存登入憑證，不會儲存密碼。';
    f.addTextField('Email', Keychain.contains(K_EMAIL) ? Keychain.get(K_EMAIL) : '');
    f.addSecureTextField('密碼', '');
    f.addAction('登入');
    f.addCancelAction('取消');
    if (await f.presentAlert() === -1) return;
    try {
      await signIn(f.textFieldValue(0).trim(), f.textFieldValue(1));
      const ok = new Alert();
      ok.title = '登入成功';
      ok.message = '長按主畫面 → 加入小工具 → 選 Scriptable，再把這支腳本選起來。';
      ok.addAction('好');
      await ok.presentAlert();
    } catch (e) {
      const bad = new Alert();
      bad.title = '登入失敗';
      bad.message = String(e.message || e);
      bad.addAction('好');
      await bad.presentAlert();
    }
    return;
  }
  if (idx === 1) { signOut(); return; }
  const w = await build('medium');
  await w.presentMedium();
}

/* ====================== 進入點 ====================== */

async function build(size) {
  const idToken = await freshIdToken();
  if (!idToken) {
    return notice(size, '還沒登入', ['在 Scriptable 裡打開這支腳本', '執行一次完成登入']);
  }
  const uid = Keychain.get(K_UID);
  try {
    const [tasks, matrices] = await Promise.all([
      listDocs(idToken, uid, 'tasks'),
      listDocs(idToken, uid, 'matrices'),
    ]);
    const matrix = pickMatrix(matrices, args.widgetParameter);
    const g = group(tasks, matrix);
    return isLockScreen(size)
      ? buildAccessory(size, matrix, g)
      : buildWidget(size, matrix, g);
  } catch (e) {
    return notice(size, '讀取失敗', [String(e.message || e), '確認網路後再試']);
  }
}

if (config.runsInWidget) {
  const w = await build(config.widgetFamily || 'medium');
  Script.setWidget(w);
} else {
  await runInApp();
}
Script.complete();
