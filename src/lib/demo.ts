import type { DavEntry } from '../types';
const time = new Date().toISOString();
export const demoEntries: DavEntry[] = [
  { path: '/demo/專案文件/', name: '專案文件', directory: true, modified: time },
  { path: '/demo/設計素材/', name: '設計素材', directory: true, modified: time },
  { path: '/demo/照片備份/', name: '照片備份', directory: true, modified: time },
  {
    path: '/demo/開始使用.md',
    name: '開始使用.md',
    directory: false,
    size: 512,
    modified: time,
    contentType: 'text/markdown',
  },
  {
    path: '/demo/專案計畫.pdf',
    name: '專案計畫.pdf',
    directory: false,
    size: 2_413_800,
    modified: time,
    contentType: 'application/pdf',
  },
  {
    path: '/demo/靈感筆記.txt',
    name: '靈感筆記.txt',
    directory: false,
    size: 2048,
    modified: time,
    contentType: 'text/plain',
  },
  {
    path: '/demo/網站設定.json',
    name: '網站設定.json',
    directory: false,
    size: 356,
    modified: time,
    contentType: 'application/json',
  },
];
export function demoText(entry: DavEntry): string {
  return entry.name.endsWith('.json')
    ? JSON.stringify(
        {
          name: 'WebDAV Studio',
          language: 'zh-TW',
          storage: '你的 WebDAV 主機',
          privacy: '連線資料只在此瀏覽器加密保存',
        },
        null,
        2,
      )
    : '# 歡迎來到 WebDAV Studio\n\n這是互動範例，所有資料都是示意內容。\n\n1. 點選「新增連線」，建立本機密碼庫。\n2. 填入 HTTPS WebDAV 網址、帳號與密碼。\n3. 確認主機已允許此網站來源的 CORS 請求。\n4. 開始瀏覽、上傳與管理你的檔案。\n\n底部的除錯面板可查看每一次 WebDAV 請求。\n檔案直接在瀏覽器與你的主機之間傳輸。';
}
