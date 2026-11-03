#!/usr/bin/env node
// 直接把任務寫進 Firestore（不經過 App）。App 和桌布都會跟著更新。
//
//   node add.mjs --title "交報告" --quadrant 1 --date 明天 --time 14:00 --notify
//   node add.mjs --title "訂便當" --quadrant 3
//   node add.mjs --json '[{"title":"A","quadrant":1},{"title":"B","quadrant":2,"date":"明天"}]'
//   加 --dry-run 只顯示會寫什麼，不真的寫入

import {
  auth, listDocs, putDoc, pickMatrix, resolveQuadrant, quadName,
  parseDate, parseTime, orderForNew, remindAt, dateLabel, newId,
} from './lib.mjs';

const argv = process.argv.slice(2);
const opts = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const key = argv[i].slice(2);
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) opts[key] = true;
  else { opts[key] = next; i++; }
}

const dryRun = !!opts['dry-run'];

let items;
if (opts.json) {
  try { items = JSON.parse(opts.json); } catch { console.error('--json 不是合法的 JSON'); process.exit(1); }
  if (!Array.isArray(items)) items = [items];
} else if (opts.title) {
  items = [{
    title: opts.title,
    quadrant: opts.quadrant,
    date: opts.date,
    time: opts.time,
    note: opts.note,
    notify: !!opts.notify,
    remind: opts.remind,
    matrix: opts.matrix,
  }];
} else {
  console.error('至少要給 --title 或 --json。用法見 SKILL.md。');
  process.exit(1);
}

try {
  const session = await auth();
  const [matrices, tasks] = await Promise.all([
    listDocs(session, 'matrices'),
    listDocs(session, 'tasks'),
  ]);

  // 同一批裡先加進去的也要算進 order，不然會疊在一起
  const pending = [];
  const written = [];

  for (const raw of items) {
    const matrix = pickMatrix(matrices, raw.matrix);
    const quadrant = resolveQuadrant(raw.quadrant, matrix);
    const date = parseDate(raw.date);
    const time = date ? parseTime(raw.time) : '';
    const notify = !!raw.notify && !!date;

    const task = {
      id: newId(),
      title: String(raw.title || '').trim(),
      note: raw.note ? String(raw.note) : '',
      quadrant,
      matrix: matrix.id,
      date,
      time,
      duration: 60,
      notify,
      remind: String(raw.remind ?? '0'),
      repeat: null,
      done: false,
      createdAt: Date.now(),
      order: orderForNew([...tasks, ...pending], matrix.id, quadrant),
    };
    if (!task.title) throw new Error('任務標題不能是空的');

    const at = remindAt(task);
    const reminder = at ? {
      uid: session.uid,
      taskId: task.id,
      at,
      title: task.title,
      body: [quadName(matrix, quadrant), date ? dateLabel(date) + (time ? ' ' + time : '') : '']
        .filter(Boolean).join(' · '),
    } : null;

    if (!dryRun) {
      await putDoc(session, `users/${session.uid}/tasks/${task.id}`, task);
      if (reminder) await putDoc(session, `reminders/${session.uid}_${task.id}`, reminder);
    }
    pending.push(task);
    written.push({ task, matrix, reminder });
  }

  console.log(dryRun ? '（--dry-run，沒有真的寫入）' : `✓ 已新增 ${written.length} 個任務`);
  for (const { task, matrix, reminder } of written) {
    const bits = [`「${task.title}」`, `${matrix.name} / ${quadName(matrix, task.quadrant)}`];
    if (task.date) bits.push(dateLabel(task.date) + (task.time ? ` ${task.time}` : ''));
    if (reminder) bits.push('會提醒');
    console.log('  · ' + bits.join(' · '));
  }
} catch (e) {
  console.error('✗ ' + (e.message || e));
  process.exit(1);
}
