#!/usr/bin/env node
// 登入一次，把 refresh token 存進 macOS 鑰匙圈。不會儲存密碼。
//
//   node login.mjs                       互動輸入（在 Terminal 裡跑）
//   node login.mjs --email a@b.c         只問密碼
//   MATRIX_TODO_PASSWORD=... node login.mjs --email a@b.c   完全非互動
//   node login.mjs --status              看目前登入狀態
//   node login.mjs --logout              清掉鑰匙圈裡的憑證

import readline from 'node:readline';
import { Writable } from 'node:stream';
import { signIn, keychainSet, keychainGet, keychainDelete, SERVICES } from './lib.mjs';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true);
};

if (flag('--status')) {
  const has = !!keychainGet(SERVICES.refresh);
  const uid = keychainGet(SERVICES.uid);
  console.log(has ? `已登入（uid ${uid.slice(0, 8)}…）` : '尚未登入');
  process.exit(0);
}

if (flag('--logout')) {
  const a = keychainDelete(SERVICES.refresh);
  const b = keychainDelete(SERVICES.uid);
  console.log(a || b ? '已清除鑰匙圈裡的登入憑證' : '本來就沒有登入憑證');
  process.exit(0);
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    if (!hidden) {
      // 一般輸入就交給 readline 自己畫提示字；先前手動 write 會被它的重繪蓋掉，
      // 結果使用者只看到下一行的「密碼」，以為不用輸入 Email。
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
      rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); });
      return;
    }
    // 密碼：提示字照常顯示，但輸入的內容不回顯
    process.stdout.write(question);
    const muted = new Writable({ write(chunk, enc, cb) { cb(); } });
    const rl = readline.createInterface({ input: process.stdin, output: muted, terminal: true });
    rl.question('', (ans) => { rl.close(); process.stdout.write('\n'); resolve(ans.trim()); });
  });
}

const email = typeof flag('--email') === 'string' ? flag('--email')
  : process.env.MATRIX_TODO_EMAIL || await ask('Email: ');

let password = process.env.MATRIX_TODO_PASSWORD || '';
if (!password) {
  if (!process.stdin.isTTY) {
    console.error('沒有 TTY 可以安全地輸入密碼。請在 Terminal 裡執行，或設定 MATRIX_TODO_PASSWORD。');
    process.exit(1);
  }
  password = await ask('密碼（不會顯示）: ', { hidden: true });
}

try {
  const r = await signIn(email, password);
  keychainSet(SERVICES.refresh, r.refreshToken);
  keychainSet(SERVICES.uid, r.localId);
  console.log(`✓ 已登入 ${email}`);
  console.log('  refresh token 存在 macOS 鑰匙圈，密碼沒有被儲存。');
} catch (e) {
  console.error('✗ ' + (e.message || e));
  process.exit(1);
}
