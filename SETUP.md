# 矩陣待辦：設定步驟

大約 20 分鐘。全部免費。做完之後：電腦和 iPhone 資料即時同步，任務設了提醒，手機會收到通知。

> 只想先用看看？做完 **第 1 步** 就能在手機上用了（資料只存在那台裝置）。第 2～5 步是同步和推播。

---

## 第 1 步：放上 GitHub Pages（讓手機打得開）

1. 到 GitHub 建一個 **Public** 的 repo，名稱例如 `matrix-todo`（要 Public，GitHub Pages 和每 5 分鐘的提醒排程才免費）。
2. 把這個資料夾裡的所有檔案傳上去（或跟 Claude 說 repo 建好了，讓它幫你推）。
3. repo 的 **Settings → Pages** → Source 選 **Deploy from a branch** → Branch 選 `main`、資料夾 `/ (root)` → Save。
4. 等 1～2 分鐘，網址會是：`https://jaylai0946-cpu.github.io/matrix-todo/`

## 第 2 步：建立 Firebase 專案（同步用）

1. 打開 <https://console.firebase.google.com> → **新增專案**，名稱隨意（例如 `matrix-todo`），Google Analytics 可以關掉。
2. 左邊選單 **建構 → Authentication** → **開始使用** → 「登入方式」選 **電子郵件/密碼** → 開啟第一個開關 → 儲存。

## 第 3 步：建立資料庫並貼上安全規則

1. 左邊 **建構 → Firestore Database** → **建立資料庫**。
2. 位置選 **asia-east1（台灣）**，模式選 **正式版模式**。
3. 建好後點上方 **規則** 分頁，把裡面全部刪掉，貼上這個資料夾裡 `firestore.rules` 的內容 → **發布**。
   （這一步確保每個人只看得到自己的任務。）

## 第 4 步：把 Firebase 設定貼進 App

1. 左上角齒輪 → **專案設定** → 往下找「你的應用程式」→ 點 **`</>`（網頁）** 圖示。
2. 暱稱隨便填 → **註冊應用程式**。畫面會出現一段 `const firebaseConfig = { ... }`。
3. 打開 `config.js`，把 `export const FIREBASE_CONFIG = null;` 改成：

   ```js
   export const FIREBASE_CONFIG = {
     apiKey: "（貼上）",
     authDomain: "（貼上）",
     projectId: "（貼上）",
     storageBucket: "（貼上）",
     messagingSenderId: "（貼上）",
     appId: "（貼上）"
   };
   ```

4. 存檔、推上 GitHub。（這段設定公開沒關係，安全靠第 3 步的規則。）

## 第 5 步：開啟「App 關著也能收到」的推播

1. Firebase **專案設定 → 服務帳戶** → **產生新的私密金鑰** → 會下載一個 `.json` 檔。
   ⚠️ 這個檔案等同資料庫的鑰匙，**不要**放進 repo、不要傳給別人。
2. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**，新增 4 個：

   | 名稱 | 內容 |
   |---|---|
   | `FIREBASE_SERVICE_ACCOUNT` | 剛剛下載的 `.json` 檔，用文字編輯器打開，**整份**複製貼上 |
   | `VAPID_PUBLIC_KEY` | `推播金鑰-不要公開.txt` 裡的 PUBLIC KEY |
   | `VAPID_PRIVATE_KEY` | `推播金鑰-不要公開.txt` 裡的 PRIVATE KEY |
   | `VAPID_SUBJECT` | `mailto:jaylai0946@gmail.com` |

3. repo 的 **Actions** 分頁 → 如果看到提示就按啟用 → 左邊點「發送提醒」→ **Run workflow** 跑一次，看到綠色勾勾就成功了。之後它會每 5 分鐘自動跑。

---

## 安裝到 iPhone

1. 用 **Safari** 打開 `https://jaylai0946-cpu.github.io/matrix-todo/`
2. 下方 **分享** 按鈕 → **加入主畫面** → 加入。
3. 從主畫面的「矩陣」圖示打開 → 下方 **設定** → 第一次用按 **建立帳號**（Email＋自己設的密碼），之後都按 **登入**。
4. 同一頁 **提醒通知 → 開啟** → 跳出詢問時按 **允許**。
   （iPhone 要 iOS 16.4 以上，而且一定要從主畫面圖示打開才能開通知。）

## 在 Mac 上用

用 Safari 或 Chrome 打開同一個網址，**設定 → 登入同一個帳號** 就會同步。
Safari 可以按選單 **檔案 → 加入 Dock**，就會像一個獨立 App。

---

## 常見問題

- **右上角小圓點**：綠＝已同步、黃＝同步中、紅＝出錯、灰＝沒登入或沒設定。
- **提醒晚了幾分鐘？** App 開著時會準時跳。App 關著時靠 GitHub 每 5 分鐘檢查一次，GitHub 忙的時候可能再晚幾分鐘。
- **提醒突然都沒了？** GitHub 的規定：repo 連續 60 天沒有任何更新，排程會被自動暫停。到 Actions 分頁重新啟用就好。
- **費用**：Firebase 免費方案（Spark）、GitHub Pages、Public repo 的 Actions 都免費，個人使用遠遠用不完額度。
- **備份**：設定 → 匯出備份，會存一個 JSON 檔；換裝置或出事時可以匯入。
