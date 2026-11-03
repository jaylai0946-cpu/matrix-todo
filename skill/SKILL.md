---
name: matrix-todo
description: 讀寫「矩陣待辦」App 的任務（jaylai0946-cpu/matrix-todo，Firebase 專案 matrix-todo-jaylai）。使用者說「幫我加到待辦／記一下／排進去／提醒我」就新增；說「那件事做完了／完成了／搞定了」「這個改成明天／移到第二象限／不用做了」就更新既有任務；問「我有哪些待辦」就查詢。全部直接寫 Firestore，不用打開 App。**對話中他提到某件已經記錄過的事有進展時，主動更新它。**
---

# 矩陣待辦 · 從對話直接加任務

直接讀寫 Firestore（`users/{uid}/tasks`），App、小工具、鎖定畫面桌布都會跟著更新。
不需要打開 App，也不經過瀏覽器。

專案：`matrix-todo-jaylai` · App：https://jaylai0946-cpu.github.io/matrix-todo/

## 什麼時候用

**要用：**
- 「幫我加到待辦」「記一下」「排進去」「加個任務」「提醒我 X」→ `add.mjs`
- 他問「我現在有哪些待辦 / 今天要做什麼」→ `list.mjs`
- **他提到某件已經在清單上的事有進展** → `update.mjs`，不要叫他自己去改：
  - 「報價單寄出去了」「那個做完了」「搞定」→ `--done`
  - 「這個拖到下週三」「改成明天下午」→ `--date` / `--time`
  - 「這件變急了」「移到第二象限」→ `--quadrant`
  - 「不用做了」「取消」→ `--delete`

**開工前先 `list.mjs`**，才知道他講的事在不在清單上、標題是什麼。

**不要用：**
- 他只是在描述現況、抱怨、或聊到某件事，沒有要你記 → 不要自作主張加
- 一次要加很多但內容含糊 → 先用 `--dry-run` 列出來給他看，確認再寫

## 先確認有沒有登入

```bash
node ~/.claude/skills/matrix-todo/scripts/login.mjs --status
```

沒登入的話，**請他自己在 Terminal 執行**（密碼不要經過對話）：

```bash
node ~/.claude/skills/matrix-todo/scripts/login.mjs
```

會問 Email 和密碼（就是他在矩陣待辦 App 裡用的那組），登入後只把 refresh token
存進 macOS 鑰匙圈，**不存密碼**。之後都不用再登入。

## 加任務

```bash
cd ~/.claude/skills/matrix-todo/scripts

# 單筆
node add.mjs --title "交季度報告" --quadrant 1 --date 明天 --time 14:00 --notify

# 多筆（建議；order 會正確遞減，不會疊在一起）
node add.mjs --json '[
  {"title":"交季度報告","quadrant":1,"date":"明天","time":"14:00","notify":true},
  {"title":"回客戶的報價信","quadrant":1},
  {"title":"健身 30 分鐘","quadrant":2,"date":"今天"}
]'

# 先看會寫什麼，不真的寫
node add.mjs --json '[...]' --dry-run
```

| 參數 | 說明 |
|---|---|
| `--title` | 必填 |
| `--quadrant` | `1`–`4`，或象限名稱（支援他自訂過的名字）。預設 1 |
| `--date` | `今天`／`明天`／`後天`／`下週三`／`2026-11-05`／`11-05` |
| `--time` | `14:30`／`下午2點`／`晚上8:15`。沒有 `--date` 的話會被忽略 |
| `--notify` | 要推播提醒。**需要同時有 `--date`**，否則自動關掉 |
| `--remind` | 提前幾分鐘提醒，預設 `0` |
| `--note` | 備註 |
| `--matrix` | 指定矩陣名稱，預設用第一個 |
| `--dry-run` | 只顯示不寫入 |

## 改任務

```bash
node update.mjs --find "報價單" --done            # 標記完成
node update.mjs --find "健身" --quadrant 1         # 換象限
node update.mjs --find "報告" --date 下週三 --time 14:00 --notify
node update.mjs --find "舊的" --delete             # 刪除（和 App 一樣是軟刪除）
node update.mjs --json '[{"find":"A","done":true},{"find":"B","quadrant":2}]'
```

| 參數 | 說明 |
|---|---|
| `--find` | 標題的部分字串，不分大小寫。**對到多筆會停下來**並列出候選，這時要問他是哪一個 |
| `--id` | 知道確切 id 時用（`list.mjs --json` 看得到） |
| `--done` / `--undone` | 標記完成 / 取消完成 |
| `--quadrant` | 換象限，排序會自動重算 |
| `--date` `--time` `--clear-date` | 改時程 |
| `--title` `--note` | 改名、改備註 |
| `--matrix` | 搬到另一個矩陣 |
| `--delete` | 刪除 |
| `--dry-run` | 只顯示不寫入 |

`--find` 會**優先比對未完成的任務**，找不到才看已完成的。
標記完成或刪除時，會一併清掉那筆的推播提醒。

## 查任務

```bash
node list.mjs            # 預設矩陣的未完成任務
node list.mjs --all      # 所有矩陣
node list.mjs --json     # 給程式讀
```

**加之前先 `list.mjs` 看一下**，避免加到重複的東西。

## 象限怎麼選

艾森豪矩陣。拿不準就問他，不要亂猜：

| | 說明 | 典型 |
|---|---|---|
| **1 重要且緊急** | 有死線、不做會出事 | 今天要交的東西、客戶在等 |
| **2 重要不緊急** | 對長期有價值，但沒人催 | 運動、學習、規劃、維護 |
| **3 緊急較不重要** | 有時間壓力但價值低 | 雜事、跑腿、臨時交辦 |
| **4 不緊急不重要** | 可做可不做 | 整理、備查、想到再說 |

象限名稱可能被他改過（`list.mjs` 看得到實際名稱），`--quadrant` 吃得下自訂名稱。

## 規矩

- **寫完一定回報做了什麼**：標題、象限、日期時間、有沒有設提醒。不要只說「好了」
- **更新前先確認對到的是哪一筆**。`--find` 對到多筆時腳本會中止並列出候選，去問他，不要自己挑一個
- **他只是順口提到進度、沒有要你改** → 還是可以更新，但要在回覆裡講你改了什麼，讓他能喊停
- **一次多筆就用 `--json`**，不要跑迴圈呼叫 `add.mjs` —— 每次呼叫都會重新抓一次資料，而且排序會算錯
- **`--notify` 沒有 `--date` 不會生效**，腳本會自動關掉。要提醒就一定要給日期
- 他講的日期時間照他的話轉換，**不要自己加碼**（沒說時間就不要塞一個）
- 推播是 GitHub Actions 每 5 分鐘跑一次，所以提醒可能晚幾分鐘，這是正常的

## 出錯時

- `還沒登入` → 跑 `login.mjs --status` 確認，請他在 Terminal 登入
- `登入憑證失效` → 他改過密碼，重新 `login.mjs`
- `找不到矩陣「X」` → 訊息會列出現有的矩陣名稱
- `PERMISSION_DENIED` → 登入的帳號和資料的擁有者不一致，重新登入

相關記憶：`[[project-matrix-todo]]`
