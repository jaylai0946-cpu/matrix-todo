#!/usr/bin/env node
// 改既有的任務：完成、移象限、改日期、改名、刪除。
//
//   node update.mjs --find "報價單" --done
//   node update.mjs --find "健身" --quadrant 1
//   node update.mjs --find "報告" --date 下週三 --time 14:00 --notify
//   node update.mjs --find "舊任務" --delete
//   node update.mjs --json '[{"find":"A","done":true},{"find":"B","quadrant":2}]'
//
// --find 是標題的部分字串，不分大小寫。對到多筆會停下來請你講清楚。
// 加 --dry-run 只顯示會改什麼。

import {
  auth, listDocs, putDoc, FS, pickMatrix, resolveQuadrant, quadName,
  parseDate, parseTime, orderForNew, remindAt, dateLabel,
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

let edits;
if (opts.json) {
  try { edits = JSON.parse(opts.json); } catch { console.error('--json 不是合法的 JSON'); process.exit(1); }
  if (!Array.isArray(edits)) edits = [edits];
} else if (opts.find || opts.id) {
  edits = [{
    find: opts.find, id: opts.id,
    done: opts.done ? true : opts.undone ? false : undefined,
    quadrant: opts.quadrant,
    date: opts['clear-date'] ? '' : opts.date,
    time: opts.time,
    title: opts.title,
    note: opts.note,
    notify: opts.notify ? true : undefined,
    remind: opts.remind,
    matrix: opts.matrix,
    delete: !!opts.delete,
  }];
} else {
  console.error('至少要給 --find 或 --id（或 --json）。');
  process.exit(1);
}

async function deleteDoc(session, path) {
  const r = await fetch(`${FS}/${path}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${session.idToken}` },
  });
  // 本來就不存在也算成功
  if (!r.ok && r.status !== 404) {
    const j = await r.json().catch(() => ({}));
    throw new Error(`刪除 ${path} 失敗：${(j.error && j.error.message) || r.status}`);
  }
}

try {
  const session = await auth();
  const [matrices, tasks] = await Promise.all([
    listDocs(session, 'matrices'),
    listDocs(session, 'tasks'),
  ]);
  const live = tasks.filter((t) => !t.deleted);
  const results = [];

  for (const e of edits) {
    // ---- 找出要改的那一筆 ----
    let task;
    if (e.id) {
      task = live.find((t) => t.id === e.id);
      if (!task) throw new Error(`找不到 id 是 ${e.id} 的任務`);
    } else {
      const needle = String(e.find || '').trim().toLowerCase();
      if (!needle) throw new Error('--find 不能是空的');
      let hits = live.filter((t) => String(t.title || '').toLowerCase().includes(needle));
      // 一律先找未完成的；只有在未完成裡找不到時才看已完成的
      const open = hits.filter((t) => !t.done);
      if (open.length) hits = open;
      if (!hits.length) throw new Error(`找不到標題含有「${e.find}」的任務`);
      if (hits.length > 1) {
        const list = hits.map((t) => `「${t.title}」${t.done ? '（已完成）' : ''}`).join('、');
        throw new Error(`「${e.find}」對到 ${hits.length} 筆：${list}。請講得更具體。`);
      }
      task = hits[0];
    }

    const before = { ...task };
    const changes = [];

    // ---- 刪除（和 App 一樣用軟刪除）----
    if (e.delete) {
      const next = { ...task, deleted: true };
      if (!dryRun) {
        await putDoc(session, `users/${session.uid}/tasks/${task.id}`, next);
        await deleteDoc(session, `reminders/${session.uid}_${task.id}`);
      }
      results.push({ task: next, changes: ['已刪除'] });
      Object.assign(task, next);
      continue;
    }

    const next = { ...task };

    if (e.done !== undefined && !!e.done !== !!task.done) {
      next.done = !!e.done;
      next.doneAt = next.done ? Date.now() : null;
      changes.push(next.done ? '標記完成' : '取消完成');
    }

    if (e.title) { next.title = String(e.title).trim(); changes.push(`改名為「${next.title}」`); }
    if (e.note !== undefined) { next.note = String(e.note); changes.push('改了備註'); }

    let matrix = matrices.find((m) => m.id === task.matrix) || pickMatrix(matrices);
    if (e.matrix) {
      matrix = pickMatrix(matrices, e.matrix);
      if (matrix.id !== task.matrix) { next.matrix = matrix.id; changes.push(`移到「${matrix.name}」`); }
    }

    if (e.quadrant !== undefined && e.quadrant !== '') {
      const q = resolveQuadrant(e.quadrant, matrix);
      if (q !== Number(task.quadrant)) { next.quadrant = q; changes.push(`移到「${quadName(matrix, q)}」`); }
    }
    // 換了矩陣或象限就要重算排序，不然會卡在舊位置
    if (next.matrix !== task.matrix || Number(next.quadrant) !== Number(task.quadrant)) {
      next.order = orderForNew(live.filter((t) => t.id !== task.id), next.matrix, next.quadrant);
    }

    if (e.date !== undefined) {
      next.date = e.date === '' ? '' : parseDate(e.date);
      changes.push(next.date ? `日期改成 ${dateLabel(next.date)}` : '清掉日期');
    }
    if (e.time !== undefined && e.time !== '') next.time = parseTime(e.time);
    if (!next.date) { next.time = ''; next.notify = false; }
    if (e.notify !== undefined) next.notify = !!e.notify && !!next.date;
    if (e.remind !== undefined) next.remind = String(e.remind);
    if (next.done) next.notify = false; // 完成了就不該再提醒

    if (!changes.length) { results.push({ task: next, changes: ['沒有變化'] }); continue; }

    if (!dryRun) {
      await putDoc(session, `users/${session.uid}/tasks/${task.id}`, next);
      const at = remindAt(next);
      if (at && !next.done) {
        await putDoc(session, `reminders/${session.uid}_${task.id}`, {
          uid: session.uid, taskId: task.id, at, title: next.title,
          body: [quadName(matrix, next.quadrant),
            next.date ? dateLabel(next.date) + (next.time ? ' ' + next.time : '') : ''].filter(Boolean).join(' · '),
        });
      } else {
        await deleteDoc(session, `reminders/${session.uid}_${task.id}`);
      }
    }
    Object.assign(task, next); // 同一批後面的要看到改過的狀態
    results.push({ task: next, changes, before });
  }

  console.log(dryRun ? '（--dry-run，沒有真的寫入）' : `✓ 已更新 ${results.length} 筆`);
  for (const r of results) {
    console.log(`  · 「${r.task.title}」：${r.changes.join('、')}`);
  }
} catch (e) {
  console.error('✗ ' + (e.message || e));
  process.exit(1);
}
