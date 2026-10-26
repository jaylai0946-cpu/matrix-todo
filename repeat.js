// 重複任務：計算下一次的日期
import { addDays, parseYmd, ymd, today } from './util.js';

export const REPEAT_TYPES = [
  ['daily', '每天'], ['weekdays', '工作日'], ['weekly', '每週'], ['biweekly', '雙週'], ['monthly', '每月'],
];

export function repeatLabel(r) {
  if (!r || !r.type) return '';
  const base = {
    daily: '每天', weekdays: '工作日', weekly: '每週', biweekly: '每兩週', monthly: '每月',
    everyN: `每 ${r.n || 2} 天`, everyNWeeks: `每 ${r.n || 2} 週`,
  }[r.type] || '';
  return base + (r.fromCompletion ? '（完成後起算）' : '') + (r.until ? `，到 ${r.until.slice(5).replace('-', '/')}` : '');
}

export function nextDate(fromStr, r) {
  if (!r || !r.type) return null;
  const n = Math.max(1, Number(r.n) || 2);
  let next;
  switch (r.type) {
    case 'daily': next = addDays(fromStr, 1); break;
    case 'weekdays': {
      next = addDays(fromStr, 1);
      while ([0, 6].includes(parseYmd(next).getDay())) next = addDays(next, 1);
      break;
    }
    case 'weekly': next = addDays(fromStr, 7); break;
    case 'biweekly': next = addDays(fromStr, 14); break;
    case 'everyN': next = addDays(fromStr, n); break;
    case 'everyNWeeks': next = addDays(fromStr, 7 * n); break;
    case 'monthly': {
      const d = parseYmd(fromStr);
      const want = r.day || d.getDate();
      const m = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const last = new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
      m.setDate(Math.min(want, last));
      next = ymd(m);
      break;
    }
    default: return null;
  }
  if (r.until && next > r.until) return null;
  return next;
}

// 完成一個重複任務時，下一次是哪天
export function nextOccurrence(task) {
  const r = task.repeat;
  if (!r || !r.type) return null;
  let base = r.fromCompletion ? today() : (task.date || today());
  let next = nextDate(base, r);
  // 不是「完成後起算」時，如果已經落後很多天，跳到今天以後
  let guard = 0;
  while (next && !r.fromCompletion && next < today() && guard++ < 400) next = nextDate(next, r);
  return next;
}

// 列出未來幾次（給「即將重複的任務」用）
export function upcoming(task, count = 3) {
  const out = [];
  let d = task.date || today();
  for (let i = 0; i < count; i++) {
    d = nextDate(d, task.repeat);
    if (!d) break;
    out.push(d);
  }
  return out;
}
