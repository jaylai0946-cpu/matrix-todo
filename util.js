// 共用小工具：日期、文字、圖示
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const today = () => ymd(new Date());
export const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export const fromMin = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
export const DOW = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
export const DOW1 = ['日', '一', '二', '三', '四', '五', '六'];

export function dateLabel(s) {
  const t = today();
  if (s === t) return '今天';
  if (s === addDays(t, 1)) return '明天';
  if (s === addDays(t, -1)) return '昨天';
  const d = parseYmd(s);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${sameYear ? '' : d.getFullYear() + '/'}${d.getMonth() + 1}/${d.getDate()}（${DOW1[d.getDay()]}）`;
}
export function longDate(s) {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}月${d.getDate()}日 ${DOW[d.getDay()]}`;
}
export function hourLabel(h) {
  if (h === 0) return '上午12時';
  if (h < 12) return `上午${h}時`;
  if (h === 12) return '下午12時';
  return `下午${h - 12}時`;
}
export function timeLabel(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ap = h < 12 ? '上午' : '下午';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${ap}${hh}:${pad(m)}`;
}
export function clockLabel(ts) {
  const d = new Date(ts);
  return timeLabel(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
}
export function durLabel(min) {
  if (min < 60) return `${min} 分鐘`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} 小時 ${m} 分` : `${h} 小時`;
}

export const ICONS = {
  fire: '<svg class="ico" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 3.5-1.5 5.2-2.6 7.2C8.4 11 9 13 10.5 13.6 9.6 11.8 11 10.6 12 9.5c.6 2.6 3.4 3.6 3.4 6.5A3.9 3.9 0 0 1 11.5 20c-3.4 0-6-2.6-6-6 0-5.3 5.4-7.5 6.5-12zm3.8 7.5c2 1.6 3.2 3.8 3.2 6.2A7.3 7.3 0 0 1 12 22a7.3 7.3 0 0 0 5.4-6.4c.1-2.3-.6-4.3-1.6-6.1z"/></svg>',
  cal: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  bolt: '<svg class="ico" viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 2 4 14h7l-1.5 8L20 10h-7z"/></svg>',
  list: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  plusCircle: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8" stroke-linecap="round"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  chevronR: '<svg viewBox="0 0 24 24" width="12" height="12"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  left: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  sliders: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  sun: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  timer: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/></svg>',
  bell: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  note: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 3h9l4 4v14H6z"/><path d="M9 12h6M9 16h4"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  image: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
};

// 象限自訂可選的圖示（用 emoji，在 iPhone 上最清楚）
export const ICON_CHOICES = ['🔥', '⚡', '⚠️', '🔔', '⏰', '⏱️', '📅', '📋', '📁', '📥', '📄', '⭐', '❤️', '🚩', '🔖', '🏷️', '📌', '🏆',
  '💬', '✉️', '📞', '📣', '👤', '👥', '🌿', '☀️', '🌙', '☁️', '💧', '💼', '📚', '🎓', '💻', '💡', '🎵', '🎮', '🎁', '🌐', '🏠', '🚗', '🍕', '🛒'];

export const COLOR_CHOICES = ['#ff5a5f', '#f07070', '#f5a524', '#f0b429', '#f5d33f', '#5cc96a', '#4fd1c5', '#4fb3d9',
  '#7cc4f7', '#4f8cff', '#6366f1', '#a855f7', '#f0506e', '#a1866f', '#9a9aa3'];

export const DEFAULT_QUADS = {
  1: { name: '重要且緊急', icon: 'fire', color: '#ff5a5f' },
  2: { name: '重要不緊急', icon: 'cal', color: '#4f8cff' },
  3: { name: '緊急較不重要', icon: 'bolt', color: '#f5a524' },
  4: { name: '不緊急不重要', icon: 'list', color: '#9a9aa3' },
};

export function iconHtml(icon) {
  if (ICONS[icon]) return ICONS[icon];
  return `<span class="ico emoji">${esc(icon)}</span>`;
}
