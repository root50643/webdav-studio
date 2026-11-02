# 驗證紀錄

驗證日期：2026-11-03（Asia/Taipei）。

## 自動化檢查

- TypeScript 型別檢查與 Vite 正式建置通過。
- Vitest：6 個測試檔案、50 項測試通過。
- 格式檢查通過。
- 實際 HTTP WebDAV 整合測試包含 PROPFIND、OPTIONS、PUT、GET、MKCOL、MOVE、COPY、DELETE，並以 SHA-256 比對上傳／下載位元組。
- 覆蓋路徑邊界、特殊檔名、XML namespace、207 部分失敗、401／403／404／409／412／423／507、取消、逾時、無 Content-Length 的下載容量上限、串流目的地失敗與佇列切換。
- 密碼庫測試涵蓋錯誤主密碼、密文遭竄改、新 IV、變更主密碼、IndexedDB 保存及保存失敗時保留舊資料。
- 紀錄遮蔽測試涵蓋一般、URL 編碼、XML 與 JSON 跳脫的憑證反射內容。

## 實際瀏覽器檢查

使用 Chromium 型的應用程式內瀏覽器，桌機 1280 × 720 與手機 390 × 844 排版。

- 建立密碼庫、保存測試連線、實際跨來源讀取 WebDAV。
- 檔案拖放入口／多檔選擇入口、實際選擇並上傳含中文、空格、`#`、`%` 的測試檔案。
- 新增資料夾、重新命名、選擇目的資料夾與複製。
- 文字預覽、Escape 關閉、名稱搜尋、清單／網格切換與兩種主題。
- 重新整理後設定維持加密鎖定；錯誤主密碼不修改資料；正確解鎖後恢復原資料夾路徑。
- 使用刻意不回傳 CORS 標頭的測試端點，確認顯示「可能原因」而非虛構 HTTP 狀態或確定的根因。
- 正式 `dist/` 使用不提供 SPA fallback 的靜態伺服器，在 `/pages-check/` 子路徑載入及 hash 導覽重新整理成功。
- 正式建置的範例工作區沒有瀏覽器 error 紀錄；手機根元素寬度與 scrollWidth 均為 390，沒有水平溢出。

## 驗證限制

尚未使用實際 Firefox、Safari、原生系統存檔選擇器或使用者的 NAS 驗證。串流寫入與錯誤處理已以測試目的地驗證；各主機仍需正確設定 HTTPS、CORS、WebDAV 路徑與帳號權限。

GitHub repository 為 [root50643/webdav-studio](https://github.com/root50643/webdav-studio)，Pages 設定為 GitHub Actions 部署。最新的線上檢查與部署結果可在 [Actions](https://github.com/root50643/webdav-studio/actions) 查看；網站網址為 <https://root50643.github.io/webdav-studio/>。

## 介面截圖

- [桌機淺色](screenshots/desktop-light.jpg)
- [桌機深色](screenshots/desktop-dark.jpg)
- [手機淺色](screenshots/mobile-light.jpg)
