// 鎖定畫面桌布：把目前矩陣畫成一張 iPhone 尺寸的圖片
export const BG_CHOICES = [
  ['#0e0e10', '深黑'], ['#1c2333', '夜藍'], ['#24302a', '墨綠'], ['#f4f1ea', '米白'], ['#fde7e4', '淡粉'], ['#e7eefc', '淡藍'],
];

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
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

// quads: [{name, color, emoji, tasks:[title...]}] ×4
export function draw({ quads, bg = '#0e0e10', title = '' }) {
  const W = 1179, H = 2556;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const dark = luminance(bg) < 0.4;
  const fg = dark ? '#f2f2f5' : '#1a1a1e';
  const muted = dark ? 'rgba(242,242,245,.55)' : 'rgba(26,26,30,.5)';
  const card = dark ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.75)';
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
  const font = '-apple-system, "PingFang TC", "Noto Sans TC", sans-serif';

  // 上方留給時鐘（約 34%），下方留給手電筒/相機按鈕
  const top = Math.round(H * 0.36), bottom = H - 300, side = 70, gap = 34;
  if (title) {
    ctx.fillStyle = muted; ctx.font = `600 40px ${font}`;
    ctx.fillText(title, side + 6, top - 30);
  }
  const cw = (W - side * 2 - gap) / 2, ch = (bottom - top - gap) / 2;
  quads.forEach((q, i) => {
    const x = side + (i % 2) * (cw + gap), y = top + Math.floor(i / 2) * (ch + gap);
    roundRect(ctx, x, y, cw, ch, 44);
    ctx.fillStyle = card; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = q.color + '88'; ctx.stroke();
    ctx.fillStyle = q.color; ctx.font = `700 40px ${font}`;
    const head = (q.emoji ? q.emoji + ' ' : '') + q.name;
    ctx.fillText(wrapLines(ctx, head, cw - 60, 1)[0] || '', x + 32, y + 70);
    let ty = y + 140;
    ctx.font = `500 38px ${font}`;
    const maxY = y + ch - 40;
    let shown = 0;
    for (const t of q.tasks) {
      const lines = wrapLines(ctx, t, cw - 100, 2);
      const need = lines.length * 50 + 18;
      if (ty + need > maxY) break;
      ctx.beginPath(); ctx.arc(x + 46, ty - 12, 12, 0, Math.PI * 2);
      ctx.lineWidth = 4; ctx.strokeStyle = q.color; ctx.stroke();
      ctx.fillStyle = fg;
      lines.forEach((l, k) => ctx.fillText(l, x + 76, ty + k * 50));
      ty += need; shown++;
    }
    const rest = q.tasks.length - shown;
    if (rest > 0) { ctx.fillStyle = muted; ctx.font = `500 32px ${font}`; ctx.fillText(`還有 ${rest} 項…`, x + 76, Math.min(ty + 10, maxY)); }
    if (!q.tasks.length) { ctx.fillStyle = muted; ctx.font = `500 34px ${font}`; ctx.fillText('—', x + 36, ty); }
  });
  return c.toDataURL('image/png');
}
