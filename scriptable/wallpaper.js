// 矩陣待辦 · 鎖定畫面桌布產生器（Scriptable）
//
// 所有設定都在「矩陣待辦」App 裡調：設定 → 鎖定畫面桌布
//（位置／大小／字體／模糊／亮度／背景色／背景照片）。
// 設定和照片都同步到 Firestore，這支腳本開工時讀下來，
// 所以 App 裡看到的預覽就是鎖定畫面的結果。這支腳本只負責產圖給「捷徑」。
//
// 用法：
//   1. 先執行一次「矩陣待辦」那支腳本完成登入（兩支共用同一組憑證）。
//   2. 捷徑：執行腳本「矩陣待辦桌布」(Run in App 關掉) → 將 鎖定畫面 的 背景圖片 設為 〔Output〕
//   3. 自動化：設定觸發時機。

// 版本標記：在 Scriptable 裡執行會顯示，用來確認手機上的腳本有沒有更新到
const VERSION = '2026-10-27 d';

// 這支腳本本身也放在網站上，可以自己檢查有沒有新版。
// Mac → iPhone 的 iCloud 同步不一定會動，有了這個就不用手動搬檔。
const SCRIPT_URL = 'https://jaylai0946-cpu.github.io/matrix-todo/scriptable/wallpaper.js';

const PROJECT_ID = 'matrix-todo-jaylai';
const API_KEY = 'AIzaSyAEcXgLcD6xGDf0CYVFEtwLJWGjDMX1URA';

const K_REFRESH = 'matrixTodo.refreshToken';
const K_UID = 'matrixTodo.uid';

const WALLPAPER_FILENAME = 'matrix-wallpaper.png';     // 成品，捷徑接不到圖時的備援
const BACKGROUND_FILENAME = 'matrix-wallpaper-bg.jpg'; // 從雲端抓下來的背景照片快取（離線時沿用）
const CACHE_FILENAME = 'matrix-wallpaper.json';        // 上次讀到的設定，離線時沿用

const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

const DEFAULT_QUADS = {
  1: { name: '重要且緊急', color: '#ff5a5f' },
  2: { name: '重要不緊急', color: '#4f8cff' },
  3: { name: '緊急較不重要', color: '#f5a524' },
  4: { name: '不緊急不重要', color: '#9a9aa3' },
};

// App 的 util.js 裡有內建 SVG 圖示的名稱；象限 icon 不在這份清單裡時才當成 emoji 畫出來。
// 和 app.js 的 `ICONS[info.icon] ? '' : info.icon` 規則一致。
const BUILTIN_ICONS = new Set(['fire', 'cal', 'bolt', 'list', 'plus', 'plusCircle', 'chevron',
  'chevronR', 'left', 'right', 'pencil', 'trash', 'search', 'sliders', 'sun', 'timer', 'repeat',
  'bell', 'clock', 'note', 'copy', 'check', 'close', 'image']);

// 和 App 的 wallpaper.js WALL_RANGE 必須一致
const RANGE = {
  pos: { min: 20, max: 60, def: 36 },
  size: { min: 25, max: 65, def: 52.27 },
  font: { min: 70, max: 130, def: 100 },
  blur: { min: 0, max: 100, def: 0 },
  bright: { min: -80, max: 80, def: 0 },
};
const DEFAULTS = { bg: '#0e0e10', bgMode: 'color', sort: 'custom', showTitle: true };
for (const [k, r] of Object.entries(RANGE)) DEFAULTS[k] = r.def;

const num = (v, r) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(r.max, Math.max(r.min, n)) : r.def;
};
function normalize(s) {
  const out = {};
  for (const [k, r] of Object.entries(RANGE)) out[k] = num(s[k], r);
  out.bg = /^#[0-9a-fA-F]{6}$/.test(String(s.bg || '')) ? s.bg : DEFAULTS.bg;
  out.bgMode = s.bgMode === 'photo' ? 'photo' : 'color';
  out.sort = ['dueAsc', 'dueDesc'].includes(s.sort) ? s.sort : 'custom';
  out.showTitle = s.showTitle !== false; // 沒設定過就維持顯示
  return out;
}

/* ====================== 檔案 ====================== */

function safe(fn) { try { return fn(); } catch (e) { return null; } }
const fileManagers = () => [safe(() => FileManager.iCloud()), safe(() => FileManager.local())].filter(Boolean);
const docPath = (fm, name) => fm.joinPath(fm.documentsDirectory(), name);

function findFile(name) {
  for (const fm of fileManagers()) {
    const p = docPath(fm, name);
    if (safe(() => fm.fileExists(p))) return { fm, path: p };
  }
  return null;
}
function writeFile(name, write) {
  for (const fm of fileManagers()) {
    const p = docPath(fm, name);
    if (safe(() => { write(fm, p); return true; })) return p;
  }
  return null;
}
async function ensureDownloaded(name) {
  const hit = findFile(name);
  if (!hit) return;
  if (safe(() => hit.fm.isFileDownloaded(hit.path)) === false) {
    try { await hit.fm.downloadFileFromiCloud(hit.path); } catch (e) { /* 抓不到就用預設 */ }
  }
}

const loadCached = () => {
  const hit = findFile(CACHE_FILENAME);
  const saved = hit ? safe(() => JSON.parse(hit.fm.readString(hit.path))) : null;
  return normalize({ ...DEFAULTS, ...(saved || {}) });
};
const saveCached = (s) => writeFile(CACHE_FILENAME, (fm, p) => fm.writeString(p, JSON.stringify(s)));

const loadBackground = () => {
  const hit = findFile(BACKGROUND_FILENAME);
  return hit ? safe(() => hit.fm.readImage(hit.path)) : null;
};
const cacheBackground = (image) => writeFile(BACKGROUND_FILENAME, (fm, p) => fm.writeImage(p, image));
function clearBackgroundCache() {
  const hit = findFile(BACKGROUND_FILENAME);
  return hit ? !!safe(() => { hit.fm.remove(hit.path); return true; }) : false;
}

/* ====================== 取資料 ====================== */

async function postJSON(url, body) {
  const req = new Request(url);
  req.method = 'POST';
  req.headers = { 'Content-Type': 'application/json' };
  req.body = JSON.stringify(body);
  return req.loadJSON();
}

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

async function getDoc(idToken, path) {
  const req = new Request(`${FS}/${path}`);
  req.headers = { Authorization: `Bearer ${idToken}` };
  const r = await req.loadJSON();
  if (!r || r.error) return null; // 沒設定過就是 404，正常
  return decodeFields(r.fields || {});
}

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

function pickMatrix(matrices, wanted) {
  const live = matrices.filter((m) => !m.deleted);
  if (!live.length) return null;
  if (wanted) {
    const hit = live.find((m) => (m.name || '').trim() === String(wanted).trim());
    if (hit) return hit;
  }
  return live.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
}

// 和 App 的 sorter() 行為一致：依 prefs.sort 決定「到期日優先」還是「自訂順序」
function makeSorter(sort) {
  const key = (t) => (t.date ? t.date + (t.time || '99:99') : null);
  if (sort === 'dueAsc' || sort === 'dueDesc') {
    const dir = sort === 'dueAsc' ? 1 : -1;
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

// 轉成和 App 的 openWallpaper 一樣的 quads 結構
function buildQuads(tasks, matrix, sort) {
  const mine = tasks.filter((t) =>
    !t.done && !t.deleted && (!matrix || !t.matrix || t.matrix === matrix.id));
  const by = makeSorter(sort);
  return [1, 2, 3, 4].map((q) => {
    const custom = ((matrix && matrix.quads) || {})[q] || {};
    const info = { ...DEFAULT_QUADS[q], ...custom };
    const list = mine.filter((t) => Number(t.quadrant) === q).sort(by);
    const icon = info.icon;
    return {
      name: info.name,
      color: info.color,
      emoji: icon && !BUILTIN_ICONS.has(icon) ? icon : '',
      tasks: list.map((t) => t.title || '（無標題）'),
    };
  });
}

/* ====================== 畫圖（對齊 App 的 wallpaper.js） ====================== */

const W = 1179, H = 2556; // 和 App 一樣用固定畫布，兩邊結果才會一致
const hexColor = (c, a) => new Color(String(c).replace('#', ''), a);

function luminance(hexStr) {
  const n = parseInt(hexStr.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i], 0);
}

// Scriptable 的 drawText 是以文字左上角定位，Canvas 的 fillText 是以基線定位。
// 從 App 移植座標時要把基線換算成左上角。
const topFromBaseline = (baselineY, size) => baselineY - size * 0.8;

// 粗估字寬：中日韓字元約等於字級，其餘約 0.55 倍
function textWidth(s, size) {
  let w = 0;
  for (const ch of String(s)) w += /[　-鿿＀-￯]/.test(ch) ? size : size * 0.55;
  return w;
}
// 和 App 的 wrapLines 同樣的行為：逐字塞，超出就換行，最後一行塞不下就加省略號
function wrapLines(text, maxW, maxLines, size) {
  const out = [];
  let line = '';
  for (const ch of String(text)) {
    if (textWidth(line + ch, size) > maxW) {
      out.push(line); line = ch;
      if (out.length === maxLines) break;
    } else line += ch;
  }
  if (out.length < maxLines && line) out.push(line);
  if (out.length === maxLines && out.join('').length < String(text).length) {
    let last = out[maxLines - 1];
    while (last && textWidth(last + '…', size) > maxW) last = last.slice(0, -1);
    out[maxLines - 1] = last + '…';
  }
  return out;
}

function roundRectPath(x, y, w, h, r) {
  const p = new Path();
  p.addRoundedRect(new Rect(x, y, w, h), r, r);
  return p;
}

function drawCover(ctx, img) {
  const scale = Math.max(W / img.size.width, H / img.size.height);
  const w = img.size.width * scale;
  const h = img.size.height * scale;
  ctx.drawImageInRect(img, new Rect((W - w) / 2, (H - h) / 2, w, h));
}

// 純色背景的亮度：直接調整色值。和 App 的 wallpaper.js shade() 同一套算法。
function shade(hexStr, bright) {
  if (!bright) return hexStr;
  const f = (100 + bright) / 100;
  const n = parseInt(hexStr.slice(1), 16);
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0'))
    .join('');
}

function drawWallpaper(quads, title, st, photo) {
  const k = st.font / 100;
  const ctx = new DrawContext();
  ctx.size = new Size(W, H);
  ctx.opaque = true;
  ctx.respectScreenScale = false;

  let dark;
  if (photo) {
    // 模糊和亮度已經在 App 端烘焙進這張圖了，這裡直接畫，不要再處理一次
    drawCover(ctx, photo);
    ctx.setFillColor(new Color('000000', 0.45)); // 讓照片上的字讀得清楚
    ctx.fillRect(new Rect(0, 0, W, H));
    dark = true;
  } else {
    // 純色背景的亮度直接調色值，不疊半透明色
    const bg = shade(st.bg, st.bright);
    ctx.setFillColor(hexColor(bg));
    ctx.fillRect(new Rect(0, 0, W, H));
    dark = luminance(bg) < 0.4;
  }

  const fg = dark ? new Color('f2f2f5') : new Color('1a1a1e');
  const muted = dark ? new Color('f2f2f5', 0.55) : new Color('1a1a1e', 0.5);
  const card = dark ? new Color('ffffff', photo ? 0.12 : 0.07) : new Color('ffffff', 0.75);

  const top = Math.round(H * (st.pos / 100));
  const bottom = Math.min(H - 180, top + Math.round(H * (st.size / 100)));
  const side = 70, gap = 34;

  if (title) {
    ctx.setFont(Font.semiboldSystemFont(40 * k));
    ctx.setTextColor(muted);
    ctx.drawText(title, new Point(side + 6, topFromBaseline(top - 30 * k, 40 * k)));
  }

  const cw = (W - side * 2 - gap) / 2;
  const ch = (bottom - top - gap) / 2;

  quads.forEach((q, i) => {
    const x = side + (i % 2) * (cw + gap);
    const y = top + Math.floor(i / 2) * (ch + gap);
    const accent = hexColor(q.color);

    ctx.addPath(roundRectPath(x, y, cw, ch, 44));
    ctx.setFillColor(card);
    ctx.fillPath();
    ctx.addPath(roundRectPath(x, y, cw, ch, 44));
    ctx.setStrokeColor(hexColor(q.color, 0.53)); // App 用 q.color + '88'
    ctx.setLineWidth(3);
    ctx.strokePath();

    const head = (q.emoji ? q.emoji + ' ' : '') + q.name;
    ctx.setFont(Font.boldSystemFont(40 * k));
    ctx.setTextColor(accent);
    ctx.drawText(wrapLines(head, cw - 60, 1, 40 * k)[0] || '',
      new Point(x + 32, topFromBaseline(y + 70 * k, 40 * k)));

    let ty = y + 140 * k;
    const maxY = y + ch - 40 * k;
    let shown = 0;
    for (const t of q.tasks) {
      const lines = wrapLines(t, cw - 100, 2, 38 * k);
      const need = lines.length * 50 * k + 18 * k;
      if (ty + need > maxY) break;

      const ring = new Path();
      ring.addEllipse(new Rect(x + 46 - 12 * k, ty - 12 * k - 12 * k, 24 * k, 24 * k));
      ctx.addPath(ring);
      ctx.setStrokeColor(accent);
      ctx.setLineWidth(4);
      ctx.strokePath();

      ctx.setFont(Font.mediumSystemFont(38 * k));
      ctx.setTextColor(fg);
      lines.forEach((l, j) => ctx.drawText(l, new Point(x + 76, topFromBaseline(ty + j * 50 * k, 38 * k))));
      ty += need;
      shown++;
    }

    const rest = q.tasks.length - shown;
    if (rest > 0) {
      ctx.setFont(Font.mediumSystemFont(32 * k));
      ctx.setTextColor(muted);
      ctx.drawText(`還有 ${rest} 項…`,
        new Point(x + 76, topFromBaseline(Math.min(ty + 10 * k, maxY), 32 * k)));
    }
    if (!q.tasks.length) {
      ctx.setFont(Font.mediumSystemFont(34 * k));
      ctx.setTextColor(muted);
      ctx.drawText('—', new Point(x + 36, topFromBaseline(ty, 34 * k)));
    }
  });

  return ctx.getImage();
}

function errorImage(msg) {
  const ctx = new DrawContext();
  ctx.size = new Size(W, H);
  ctx.opaque = true;
  ctx.respectScreenScale = false;
  ctx.setFillColor(new Color('0e0e10'));
  ctx.fillRect(new Rect(0, 0, W, H));
  ctx.setFont(Font.semiboldSystemFont(46));
  ctx.setTextColor(new Color('f2f2f5', 0.9));
  ctx.drawTextInRect('矩陣待辦桌布\n' + msg, new Rect(80, H * 0.42, W - 160, 600));
  return ctx.getImage();
}

/* ====================== 進入點 ====================== */

async function loadAll() {
  const idToken = await freshIdToken();
  if (!idToken) throw new Error('還沒登入。請先在 Scriptable 裡執行「矩陣待辦」完成登入。');
  const uid = Keychain.get(K_UID);
  const [tasks, matrices, remote, remoteBg] = await Promise.all([
    listDocs(idToken, uid, 'tasks'),
    listDocs(idToken, uid, 'matrices'),
    getDoc(idToken, `users/${uid}/prefs/wallpaper`).catch(() => null),
    getDoc(idToken, `users/${uid}/prefs/wallpaperBg`).catch(() => null),
  ]);
  const wanted = args.shortcutParameter || args.widgetParameter || (args.plainTexts || [])[0] || null;
  const matrix = pickMatrix(matrices, wanted);

  // App 的設定優先；讀不到就沿用上次快取，再不行才是預設值
  let st = loadCached();
  if (remote) {
    st = normalize({ ...st, ...remote });
    saveCached(st);
  }

  // 背景照片是在 App 裡選的，壓縮後存在 Firestore。這裡抓下來並快取，離線時沿用上次那張。
  let photo = null;
  if (st.bgMode === 'photo') {
    const b64 = remoteBg && typeof remoteBg.data === 'string' ? remoteBg.data : null;
    if (b64) {
      photo = safe(() => Image.fromData(Data.fromBase64String(b64)));
      if (photo) cacheBackground(photo);
    } else if (remoteBg) {
      clearBackgroundCache(); // App 裡移除了照片
    }
    if (!photo) photo = loadBackground();
  }

  const title = st.showTitle ? (matrix ? matrix.name : '矩陣待辦') : '';
  return { quads: buildQuads(tasks, matrix, st.sort), title, st, photo };
}

// 回傳 { version, text } 代表有新版；null 代表已是最新或連不上
async function fetchUpdate() {
  try {
    const text = await new Request(SCRIPT_URL).loadString();
    const m = text.match(/const VERSION = '([^']+)'/);
    if (!m || m[1] === VERSION) return null;
    if (!text.includes('drawWallpaper')) return null; // 抓到的不是這支腳本就別亂寫
    return { version: m[1], text };
  } catch (e) {
    return null;
  }
}

function applyUpdate(text) {
  // module.filename 是這支腳本自己的路徑，直接覆寫
  for (const fm of fileManagers()) {
    if (safe(() => { fm.writeString(module.filename, text); return true; })) return true;
  }
  return false;
}

async function tell(title, message) {
  const a = new Alert();
  a.title = title;
  a.message = message;
  a.addAction('好');
  await a.presentAlert();
}

await ensureDownloaded(CACHE_FILENAME);
await ensureDownloaded(BACKGROUND_FILENAME);

if (config.runsInApp) {
  let data = null;
  let err = null;
  try { data = await loadAll(); } catch (e) { err = String((e && e.message) || e); }

  if (!data) {
    await tell('沒辦法讀取資料', err);
  } else {
    let again = true;
    while (again) {
      again = false;
      const a = new Alert();
      a.title = `矩陣待辦桌布（${VERSION}）`;
      a.message = '全部設定（版面、背景色、背景照片）都在「矩陣待辦」App 的 設定 → 鎖定畫面桌布 裡調。'
        + '\n\n這支腳本只負責產生圖片給「捷徑」換桌布。'
        + (data.photo ? '\n\n目前有背景照片。' : '\n\n目前用純色背景。');
      a.addAction('預覽目前的桌布');
      a.addAction('存到「照片」');
      a.addAction('檢查腳本更新');
      a.addCancelAction('關閉');

      const idx = await a.presentAlert();
      if (idx === 2) {
        const up = await fetchUpdate();
        if (!up) await tell('已經是最新版', `目前版本 ${VERSION}`);
        else if (applyUpdate(up.text)) await tell('已更新', `${VERSION} → ${up.version}\n\n關掉 Scriptable 再打開，新版才會生效。`);
        else await tell('更新失敗', '沒辦法寫入腳本檔案。');
        again = true;
      } else if (idx === 0) {
        QuickLook.present(drawWallpaper(data.quads, data.title, data.st, data.photo), true);
        again = true;
      } else if (idx === 1) {
        Photos.save(drawWallpaper(data.quads, data.title, data.st, data.photo));
        await tell('已存到「照片」', '');
        again = true;
      }
    }
  }
} else {
  let img;
  try {
    const { quads, title, st, photo } = await loadAll();
    img = drawWallpaper(quads, title, st, photo);
  } catch (e) {
    img = errorImage(String((e && e.message) || e));
  }

  // 不論成敗都存一份，捷徑若接不到圖片可以改用「取得檔案」讀這個檔
  const savedPath = writeFile(WALLPAPER_FILENAME, (fm, p) => fm.writeImage(p, img));

  // Scriptable 各版本能交給捷徑的型別不同，依序試
  const attempts = [
    () => Script.setShortcutOutput(img),
    () => Script.setShortcutOutput(Data.fromPNG(img)),
    () => Script.setShortcutOutput(Data.fromJPEG(img)),
  ];
  let ok = false;
  for (const attempt of attempts) {
    if (safe(() => { attempt(); return true; })) { ok = true; break; }
  }
  if (!ok) safe(() => Script.setShortcutOutput(savedPath || ''));
}

Script.complete();
