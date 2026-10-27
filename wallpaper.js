// 鎖定畫面桌布：把目前矩陣畫成一張 iPhone 尺寸的圖片
//
// 版面參數（pos/size/font）和 Scriptable 的「矩陣待辦桌布」共用同一組定義，
// 設定會同步到 Firestore，兩邊畫出來的結果要一致。
export const WALL_RANGE = {
  pos:    { min: 20, max: 60, def: 36 },   // 矩陣頂端位置，佔畫面高度 %
  // 52.27% 是精確還原改版前「bottom = H - 300」的值，動過滑桿之後就是整數
  size:   { min: 25, max: 65, def: 52.27 }, // 矩陣區塊高度，佔畫面高度 %
  font:   { min: 70, max: 130, def: 100 }, // 字體大小 %
  blur:   { min: 0, max: 100, def: 0 },    // 背景模糊（只有在 Scriptable 設了背景照片時有效）
  bright: { min: -80, max: 80, def: 0 },   // 背景亮度（同上）
};

export const BG_CHOICES = [
  ['#0e0e10', '深黑'], ['#1c2333', '夜藍'], ['#24302a', '墨綠'], ['#f4f1ea', '米白'], ['#fde7e4', '淡粉'], ['#e7eefc', '淡藍'],
];

// 夾進合法範圍；沒給或給了怪東西就用預設值
function num(v, r) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(r.max, Math.max(r.min, n)) : r.def;
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// 等比填滿、超出的裁掉。模糊會採樣到畫面外（邊緣會透出底色），
// 所以多畫 12% 再讓它溢出去裁掉。
function drawCover(ctx, img, W, H) {
  const over = ctx.filter && ctx.filter !== 'none' ? 1.12 : 1;
  const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight) * over;
  const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapLines(ctx, text, maxW, maxLines) {
  const out = [];
  let line = '';
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxW) {
      out.push(line); line = ch;
      if (out.length === maxLines) break;
    } else line += ch;
  }
  if (out.length < maxLines && line) out.push(line);
  if (out.length === maxLines && out.join('').length < text.length) {
    let last = out[maxLines - 1];
    while (last && ctx.measureText(last + '…').width > maxW) last = last.slice(0, -1);
    out[maxLines - 1] = last + '…';
  }
  return out;
}

// 背景照片要先壓縮再存，Firestore 單一文件上限 1 MiB。
// 反正會被壓暗 45% 再蓋卡片，解析度不用太高。
export const BG_MAX_W = 900;
export const BG_QUALITY = 0.62;

// 把使用者選的照片等比裁切成直式，再轉成 JPEG base64
export async function compressBackground(file) {
  const bitmap = await createImageBitmap(file);
  const ratio = 2556 / 1179;
  const w = Math.min(BG_MAX_W, bitmap.width);
  const h = Math.round(w * ratio);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const scale = Math.max(w / bitmap.width, h / bitmap.height);
  const dw = bitmap.width * scale, dh = bitmap.height * scale;
  ctx.drawImage(bitmap, (w - dw) / 2, (h - dh) / 2, dw, dh);
  bitmap.close?.();
  return c.toDataURL('image/jpeg', BG_QUALITY).split(',')[1];
}

// 模糊和亮度都用真正的 canvas 濾鏡。
// 亮度用 brightness() 而不是疊半透明白/黑 —— 疊色只會讓照片變灰變濁，不是真的變亮。
export function bgFilter(blur, bright) {
  const b = num(blur, WALL_RANGE.blur), br = num(bright, WALL_RANGE.bright);
  const out = [];
  if (b) out.push(`blur(${(b / 100) * 30}px)`);
  if (br) out.push(`brightness(${(100 + br) / 100})`);
  return out.length ? out.join(' ') : 'none';
}

// 純色背景的亮度：直接調整色值，不疊色。和 Scriptable 端用同一套算法。
export function shade(hex, bright) {
  const br = num(bright, WALL_RANGE.bright);
  if (!br) return hex;
  const f = (100 + br) / 100;
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
  return '#' + ch.map((v) => v.toString(16).padStart(2, '0')).join('');
}

// 把濾鏡「烘焙」進照片再存起來：Scriptable 沒有濾鏡 API，
// 讓它直接畫這張處理好的圖，兩邊結果才會一模一樣。
export function bakeBackground(img, blur, bright) {
  const w = BG_MAX_W, h = Math.round(w * (2556 / 1179));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.filter = bgFilter(blur, bright);
  drawCover(ctx, img, w, h);
  return c.toDataURL('image/jpeg', BG_QUALITY).split(',')[1];
}

export function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

// quads: [{name, color, emoji, tasks:[title...]}] ×4
// bgImage 有值時蓋過 bg 色；blur/bright 只對照片有意義
export function draw({ quads, bg = '#0e0e10', title = '', pos, size, font, bgImage = null, blur, bright, baked = false }) {
  const P = {
    pos: num(pos, WALL_RANGE.pos),
    size: num(size, WALL_RANGE.size),
    font: num(font, WALL_RANGE.font),
  };
  const B = { blur: num(blur, WALL_RANGE.blur), bright: num(bright, WALL_RANGE.bright) };
  const k = P.font / 100; // 字級與行高的縮放
  const W = 1179, H = 2556;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const dark = bgImage ? true : luminance(bg) < 0.4;
  const fg = dark ? '#f2f2f5' : '#1a1a1e';
  const muted = dark ? 'rgba(242,242,245,.55)' : 'rgba(26,26,30,.5)';
  const card = dark ? `rgba(255,255,255,${bgImage ? '.12' : '.07'})` : 'rgba(255,255,255,.75)';

  if (bgImage) {
    // baked = 照片已經烘焙過濾鏡（從雲端拿回來的那張），不要再套一次
    ctx.filter = baked ? 'none' : bgFilter(B.blur, B.bright);
    drawCover(ctx, bgImage, W, H);
    ctx.filter = 'none';
    ctx.fillStyle = 'rgba(0,0,0,.45)'; // 讓照片上的白字讀得清楚
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = shade(bg, B.bright);
    ctx.fillRect(0, 0, W, H);
  }
  const face = '-apple-system, "PingFang TC", "Noto Sans TC", sans-serif';

  // 上方留給時鐘與小工具，下方留給手電筒/相機按鈕
  const top = Math.round(H * (P.pos / 100));
  const bottom = Math.min(H - 180, top + Math.round(H * (P.size / 100)));
  const side = 70, gap = 34;
  if (title) {
    ctx.fillStyle = muted; ctx.font = `600 ${40 * k}px ${face}`;
    ctx.fillText(title, side + 6, top - 30 * k);
  }
  const cw = (W - side * 2 - gap) / 2, ch = (bottom - top - gap) / 2;
  quads.forEach((q, i) => {
    const x = side + (i % 2) * (cw + gap), y = top + Math.floor(i / 2) * (ch + gap);
    roundRect(ctx, x, y, cw, ch, 44);
    ctx.fillStyle = card; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = q.color + '88'; ctx.stroke();
    ctx.fillStyle = q.color; ctx.font = `700 ${40 * k}px ${face}`;
    const head = (q.emoji ? q.emoji + ' ' : '') + q.name;
    ctx.fillText(wrapLines(ctx, head, cw - 60, 1)[0] || '', x + 32, y + 70 * k);
    let ty = y + 140 * k;
    ctx.font = `500 ${38 * k}px ${face}`;
    const maxY = y + ch - 40 * k;
    let shown = 0;
    for (const t of q.tasks) {
      const lines = wrapLines(ctx, t, cw - 100, 2);
      const need = lines.length * 50 * k + 18 * k;
      if (ty + need > maxY) break;
      ctx.beginPath(); ctx.arc(x + 46, ty - 12 * k, 12 * k, 0, Math.PI * 2);
      ctx.lineWidth = 4; ctx.strokeStyle = q.color; ctx.stroke();
      ctx.fillStyle = fg;
      lines.forEach((l, i2) => ctx.fillText(l, x + 76, ty + i2 * 50 * k));
      ty += need; shown++;
    }
    const rest = q.tasks.length - shown;
    if (rest > 0) { ctx.fillStyle = muted; ctx.font = `500 ${32 * k}px ${face}`; ctx.fillText(`還有 ${rest} 項…`, x + 76, Math.min(ty + 10 * k, maxY)); }
    if (!q.tasks.length) { ctx.fillStyle = muted; ctx.font = `500 ${34 * k}px ${face}`; ctx.fillText('—', x + 36, ty); }
  });
  return c.toDataURL('image/png');
}
