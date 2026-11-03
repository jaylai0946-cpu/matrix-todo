#!/usr/bin/env node
// 列出目前的任務。加任務前先看一下，避免重複。
//
//   node list.mjs                 預設矩陣的未完成任務
//   node list.mjs --all           所有矩陣
//   node list.mjs --done          連已完成的一起列
//   node list.mjs --matrix 工作
//   node list.mjs --json          給程式讀的格式

import { auth, listDocs, pickMatrix, quadName, dateLabel } from './lib.mjs';

const argv = process.argv.slice(2);
const opts = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const key = argv[i].slice(2);
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) opts[key] = true;
  else { opts[key] = next; i++; }
}

try {
  const session = await auth();
  const [matrices, tasks] = await Promise.all([
    listDocs(session, 'matrices'),
    listDocs(session, 'tasks'),
  ]);
  const live = matrices.filter((m) => !m.deleted).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const targets = opts.all ? live : [pickMatrix(matrices, opts.matrix)];

  const out = [];
  for (const m of targets) {
    for (const q of [1, 2, 3, 4]) {
      const list = tasks
        .filter((t) => !t.deleted && t.matrix === m.id && Number(t.quadrant) === q)
        .filter((t) => (opts.done ? true : !t.done))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      out.push({ matrix: m.name, quadrant: q, quadName: quadName(m, q), tasks: list });
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(out.map((g) => ({
      matrix: g.matrix, quadrant: g.quadrant, quadName: g.quadName,
      tasks: g.tasks.map((t) => ({ id: t.id, title: t.title, date: t.date || '', time: t.time || '', done: !!t.done })),
    })), null, 2));
  } else {
    let last = '';
    for (const g of out) {
      if (g.matrix !== last) { console.log(`\n【${g.matrix}】`); last = g.matrix; }
      console.log(`  ${g.quadName}（${g.tasks.length}）`);
      for (const t of g.tasks) {
        const when = t.date ? ` · ${dateLabel(t.date)}${t.time ? ' ' + t.time : ''}` : '';
        console.log(`    ${t.done ? '✓' : '○'} ${t.title}${when}`);
      }
    }
    if (!out.some((g) => g.tasks.length)) console.log('（沒有任務）');
  }
} catch (e) {
  console.error('✗ ' + (e.message || e));
  process.exit(1);
}
