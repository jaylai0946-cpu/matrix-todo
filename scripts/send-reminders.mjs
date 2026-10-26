// 每 5 分鐘由 GitHub Actions 執行：把到期的提醒用 Web Push 送到你的手機/電腦
// 需要的 GitHub Secrets：
//   FIREBASE_SERVICE_ACCOUNT  Firebase 服務帳戶金鑰（整個 JSON）
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY  推播金鑰
//   VAPID_SUBJECT  例如 mailto:你的信箱

const EARLY_MS = 60 * 1000;          // 最多提早 1 分鐘送
const STALE_MS = 6 * 3600 * 1000;    // 超過 6 小時沒送出的就放棄

export async function processReminders({ db, push, now = Date.now(), log = console.log }) {
  const snap = await db.collection('reminders').where('at', '<=', now + EARLY_MS).get();
  let sent = 0, skipped = 0;
  for (const r of snap.docs) {
    const rem = r.data();
    if (now - rem.at > STALE_MS) { await r.ref.delete(); skipped++; continue; }
    const subs = await db.collection(`users/${rem.uid}/push`).get();
    const payload = JSON.stringify({ title: rem.title || '提醒', body: rem.body || '', tag: rem.taskId, url: './' });
    for (const s of subs.docs) {
      const sub = s.data();
      try {
        await push.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, { TTL: 3600, urgency: 'high' });
        sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          log(`訂閱已失效，移除：${s.id}`);
          await s.ref.delete();
        } else {
          log(`推播失敗（${err.statusCode || ''}）：${err.body || err.message}`);
        }
      }
    }
    await r.ref.delete();
  }
  log(`到期提醒 ${snap.size} 則，送出 ${sent} 則推播，過期略過 ${skipped} 則`);
  return { total: snap.size, sent, skipped };
}

async function main() {
  const { default: admin } = await import('firebase-admin');
  const { default: webpush } = await import('web-push');
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:example@example.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  await processReminders({ db: admin.firestore(), push: webpush });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
