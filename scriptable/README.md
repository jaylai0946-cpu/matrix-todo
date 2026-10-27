# Scriptable 腳本

放在這裡是為了讓腳本能自己檢查更新 —— Mac → iPhone 的 iCloud 同步不一定會動。

- `wallpaper.js` — 產生鎖定畫面桌布給「捷徑」換桌布（檔名在 Scriptable 裡是「矩陣待辦桌布」）
- `widget.js` — 主畫面／鎖定畫面小工具（檔名在 Scriptable 裡是「矩陣待辦」）

`wallpaper.js` 在 App 內執行時選單有「檢查腳本更新」，會抓這個目錄下的同名檔案比對
`VERSION` 常數，有新版就覆寫自己。所以改完記得同步更新這裡的副本。
