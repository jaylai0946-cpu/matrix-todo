// Firebase 同步：Email 帳號登入 + Firestore 即時同步
// 資料結構：
//   users/{uid}/tasks/{taskId}
//   users/{uid}/matrices/{matrixId}
//   users/{uid}/push/{subId}          ← 這台裝置的推播訂閱
//   reminders/{uid}_{taskId}           ← 待發送的提醒，GitHub Actions 每 5 分鐘讀取
const V = '10.12.2';
const BASE = `https://www.gstatic.com/firebasejs/${V}/`;

let fb = null;       // { auth, db, fs, au }
let user = null;
let hooks = null;
let unsubs = [];
const KINDS = ['tasks', 'matrices'];

export const configured = (cfg) => !!(cfg && cfg.apiKey && cfg.projectId);

export async function init(cfg, h) {
  hooks = h;
  if (!configured(cfg)) { hooks.onState({ status: 'off', user: null }); return; }
  try {
    const [{ initializeApp }, au, fs] = await Promise.all([
      import(BASE + 'firebase-app.js'),
      import(BASE + 'firebase-auth.js'),
      import(BASE + 'firebase-firestore.js'),
    ]);
    const app = initializeApp(cfg);
    const auth = au.getAuth(app);
    const db = fs.getFirestore(app);
    fb = { auth, db, fs, au };
    au.onAuthStateChanged(auth, (u) => {
      unsubs.forEach((f) => f()); unsubs = [];
      user = u;
      if (!u) { hooks.onState({ status: 'signedout', user: null, error: '' }); return; }
      hooks.onState({ status: 'syncing', user: { uid: u.uid, email: u.email }, error: '' });
      startListening();
    });
  } catch (err) {
    console.warn('Firebase 載入失敗（可能離線）', err);
    hooks.onState({ status: 'error', user: null, error: '無法連線到同步服務' });
  }
}

function startListening() {
  const { db, fs } = fb;
  let firstDone = 0;
  KINDS.forEach((kind) => {
    let first = true;
    const un = fs.onSnapshot(fs.collection(db, 'users', user.uid, kind), (snap) => {
      if (first) {
        first = false;
        const remote = new Map();
        snap.docs.forEach((d) => { const v = d.data(); remote.set(d.id, v); hooks.onRemote(kind, v); });
        // 本機比較新的（或雲端沒有的）往上傳
        hooks.getLocal(kind).forEach((doc) => {
          const r = remote.get(doc.id);
          if (!r || (doc.updatedAt || 0) > (r.updatedAt || 0)) push(kind, doc);
        });
        if (kind === 'tasks') resyncAllReminders();
        if (++firstDone === KINDS.length) hooks.onState({ status: 'on' });
        return;
      }
      snap.docChanges().forEach((ch) => {
        if (ch.doc.metadata.hasPendingWrites) return;
        if (ch.type === 'added' || ch.type === 'modified') hooks.onRemote(kind, ch.doc.data());
      });
    }, (err) => {
      console.error(err);
      hooks.onState({ status: 'error', error: errMsg(err) });
    });
    unsubs.push(un);
  });
}

const clean = (o) => JSON.parse(JSON.stringify(o));

export function push(kind, doc) {
  if (!fb || !user) return;
  const { db, fs } = fb;
  fs.setDoc(fs.doc(db, 'users', user.uid, kind, doc.id), clean(doc)).catch((err) => {
    console.error('寫入失敗', err);
    hooks.onState({ status: 'error', error: errMsg(err) });
  });
}

// 有提醒時間 → 寫進 reminders；沒有 / 已完成 / 已刪除 → 移除
export function syncReminder(task, at) {
  if (!fb || !user) return;
  const { db, fs } = fb;
  const ref = fs.doc(db, 'reminders', `${user.uid}_${task.id}`);
  const active = at && !task.done && !task.deleted && at > Date.now() - 60 * 1000;
  if (active) {
    fs.setDoc(ref, {
      uid: user.uid, taskId: task.id, at,
      title: task.title, body: hooks.reminderBody(task),
    }).catch((e) => console.warn('提醒寫入失敗', e));
  } else {
    fs.deleteDoc(ref).catch(() => {});
  }
}
function resyncAllReminders() {
  hooks.getLocal('tasks').forEach((t) => {
    const at = hooks.remindTime(t);
    if (at && !t.done && !t.deleted && at > Date.now()) syncReminder(t, at);
  });
}

export async function savePushSub(sub) {
  if (!fb || !user) throw new Error('請先登入同步帳號');
  const { db, fs } = fb;
  const id = await sha1(sub.endpoint);
  await fs.setDoc(fs.doc(db, 'users', user.uid, 'push', id), {
    endpoint: sub.endpoint, keys: sub.keys, ua: navigator.userAgent.slice(0, 160), createdAt: Date.now(),
  });
}
async function sha1(s) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signIn(email, pw) {
  if (!fb) throw new Error('同步服務還沒載入');
  await fb.au.signInWithEmailAndPassword(fb.auth, email, pw);
}
export async function signUp(email, pw) {
  if (!fb) throw new Error('同步服務還沒載入');
  await fb.au.createUserWithEmailAndPassword(fb.auth, email, pw);
}
export async function signOut() {
  if (fb) await fb.au.signOut(fb.auth);
}

export function errMsg(err) {
  const c = err && err.code;
  return ({
    'auth/invalid-credential': 'Email 或密碼錯誤',
    'auth/wrong-password': 'Email 或密碼錯誤',
    'auth/user-not-found': '找不到這個帳號，要先「建立帳號」',
    'auth/email-already-in-use': '這個 Email 已經註冊過，直接登入就好',
    'auth/weak-password': '密碼至少要 6 碼',
    'auth/invalid-email': 'Email 格式不對',
    'auth/network-request-failed': '網路連不上',
    'auth/too-many-requests': '嘗試太多次，稍後再試',
    'auth/operation-not-allowed': 'Firebase 還沒開啟「電子郵件/密碼」登入（見 SETUP.md 第 2 步）',
    'permission-denied': '沒有權限：Firestore 規則還沒貼上（見 SETUP.md 第 3 步）',
  })[c] || (err && err.message) || String(err);
}
