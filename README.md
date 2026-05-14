# YouTube SEO 分析器 — Chrome 擴充功能

[![MIT License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.10-brightgreen)](https://github.com/lunkerchen/youtube-seo-analyzer)
[![Chrome](https://img.shields.io/badge/chrome-manifest--v3-4285F4)](https://developer.chrome.com/docs/extensions/)

一鍵分析 YouTube 影片的 SEO 表現，直接在影片頁面上提供優化建議。  
以 **P0→P3 嚴重度分級**呈現，附綜合評分與 Markdown 報告匯出。

---

## 功能總覽

### 核心分析引擎
| 分析項目 | 檢查內容 | 等級 |
|----------|----------|------|
| **標題 SEO** | CJK 字數 ≤30（行動截斷線）、關鍵詞密度、搜尋意圖清晰度 | P0–P3 |
| **標籤審計** | 數量（目標 15–20）、覆蓋度、中英文混合 | P0–P1 |
| **說明優化** | 前 150 字有效性、關鍵詞前置、Hashtag 使用、CTA 存在 | P0–P3 |
| **SEO 關鍵詞區塊** | 說明底部是否包含純 SEO 關鍵詞索引區 | P3 |
| **Hashtag 檢測** | 說明/標題中的 #hashtag 數量與主題相關性 | P2 |
| **行動呼籲 (CTA)** | 說明及口語中是否引導訂閱、留言、分享 | P3 |

### 進階分析
| 分析項目 | 技術手段 | 等級 |
|----------|----------|------|
| **縮圖視覺分析** | Canvas 像素級：亮度、對比度、邊緣密度（文字代理）、色彩主調聚類 | P1–P3 |
| **逐字稿分析** | YouTube 字幕 XML：前 30 秒關鍵詞覆蓋、wpm 密度、ASR 品質、口語 CTA | P1–P3 |
| **Shorts 特化** | #Shorts 標籤強制、Hashtag 必備、說明長度門檻下調、標籤數寬限 | P0–P3 |
| **選項頁自訂** | 22 項檢查獨立開關、7 項閾值可調（CJK 上限、標籤數、對比度等） | — |

### 綜合評分
0–100 分，**P0（嚴重）→ P1（重要）→ P2（中等）→ P3（建議）**，每項附具體修復建議。

---

## 安裝

### 從原始碼安裝（Chrome 開發者模式）

```bash
git clone https://github.com/lunkerchen/youtube-seo-analyzer.git
```

1. 開啟 Chrome，前往 `chrome://extensions`
2. 開啟右上角 **「開發者模式」**
3. 點擊 **「載入未封裝項目」**
4. 選擇專案中的 `chrome-extension/` 目錄

### 更新方式
每次更新後 `git pull`，然後到 `chrome://extensions` 點擊 ↻ 重新載入即可。

---

## 使用方式

1. 前往 **YouTube 影片頁面**（`youtube.com/watch?v=...`）或 **Shorts**（`youtube.com/shorts/...`）
2. 右下角出現 **藍色齒輪** ⚙ 按鈕
3. 點擊按鈕 → 右側滑出分析面板
4. 面板包含：
   - **綜合評分**（圓形進度 + 文字說明）
   - **縮圖預覽** + 視覺分析數據
   - **逐字稿資訊**（語言、字數、wpm、關鍵詞覆蓋率）
   - **影片 Metadata**（標題、頻道、長度、觀看、標籤）
   - **✅ 表現良好的項目**
   - **⚠️ 待優化項目**（P0→P3 依序排列）
5. 按 **`Esc`** 或點擊面板外背景 → 關閉
6. 按 **`↓`**（綠色圓鈕）→ 匯出 Markdown 報告
7. 點擊工具列圖示 → 開啟**選項頁**，自訂檢查規則與閾值

### 快捷鍵
| 按鍵 | 動作 |
|------|------|
| 點擊 ⚙ | 開啟分析面板 |
| `Esc` | 關閉面板 |
| 點擊 ↓ | 匯出 Markdown 報告 |

---

## 分析流程

```
頁面載入
  │
  ├─ yt-navigate-finish (SPA 導航) → cleanup + reinject
  │
  └─ 使用者點擊 ⚙ 按鈕
       │
       ├─ extractVideoData()
       │   ├─ ytInitialPlayerResponse (限 videoId 匹配當前 URL)
       │   ├─ DOM query fallback (SPA 導航後自動降級)
       │   └─ meta[itemprop="duration"] (ISO 8601 三層防禦)
       │
       ├─ analyzeThumbnail(data)        ← Canvas 像素分析
       │
       ├─ fetchTranscript(data)         ← YouTube 字幕 XML (含 retry)
       │
       ├─ analyzeTranscript()           ← 30s 關鍵詞 / wpm / CTA / ASR
       │
       └─ analyzeVideo(data, thumb, transcript)
            └─ 合併所有 findings → score + issues + goodPractices
                    │
                    └─ injectPanel() → 使用者閱讀 / 匯出
```

---

## 資料擷取

### 主要來源：`ytInitialPlayerResponse`（限 videoId 匹配）

`ytInitialPlayerResponse` 在頁面首次載入時設定。SPA 導航後此變數**不會更新**，因此 `extractVideoData()` 會比對 `videoDetails.videoId` 與當前 URL，不匹配時自動降級 DOM 提取。

| 路徑 | 對應資料 | 備註 |
|------|----------|------|
| `videoDetails.title` | 標題 |  |
| `videoDetails.shortDescription` | 說明 |  |
| `videoDetails.keywords` | 標籤陣列 |  |
| `videoDetails.author` | 頻道名稱 |  |
| `videoDetails.channelId` | 頻道 ID |  |
| `videoDetails.viewCount` | 觀看次數 |  |
| `videoDetails.lengthSeconds` | 長度（秒） | 降級到 `meta[itemprop="duration"]` |
| `videoDetails.videoId` | 影片 ID |  |
| `videoDetails.isLiveContent` | 直播判斷 |  |
| `videoDetails.isPrivate` | 隱私狀態 |  |
| `videoDetails.thumbnail.thumbnails[]` | 縮圖 URL |  |
| `captions.playerCaptionsTracklistRenderer.captionTracks` | 字幕軌 | 含語言、ASR 判斷 |

### DOM 降級路徑
當 `ytInitialPlayerResponse` 不可用時，依序嘗試：
- `meta[name="keywords"]` → 標籤
- `meta[itemprop="duration"]` → 長度
- `h1.ytd-watch-metadata` / `h1.title` → 標題
- `#description-inner` / `#description` → 說明
- `[itemprop="description"]` → 說明（Shorts）
- `.view-count` / `ytd-video-primary-info-renderer .view-count` → 觀看
- `#owner #channel-name a` / `ytd-channel-name a` → 頻道名稱

---

## SEO 檢查清單

### P0 — 嚴重（立即處理）

- [ ] 標籤是否為空
- [ ] 標題中文字元 > 30（行動截斷）
- [ ] 說明為空
- [ ] Shorts 標題缺少 #Shorts

### P1 — 重要

- [ ] 標籤數量 < 10（非 Shorts）/ < 8（Shorts）
- [ ] 前 150 字為通用開場白
- [ ] 標題關鍵詞未出現在說明開頭
- [ ] 前 30 秒逐字稿未提及標題關鍵詞
- [ ] 逐字稿與標籤關聯性低
- [ ] 縮圖解析度低於 1280px
- [ ] 縮圖對比度偏低

### P2 — 中等

- [ ] 標題過短
- [ ] 說明未使用 Hashtag
- [ ] 說明文字偏短
- [ ] 標題關鍵詞完全未出現在口語中
- [ ] 口語密度偏低（< 50 wpm）
- [ ] 縮圖偏暗
- [ ] 縮圖可能含有大量文字
- [ ] 縮圖為自動生成
- [ ] XSS / 安全性防護

### P3 — 建議

- [ ] 說明缺乏 CTA
- [ ] 缺少 SEO 關鍵詞區塊
- [ ] 搜尋意圖模糊
- [ ] 結尾缺乏口語 CTA
- [ ] 字幕為 ASR（非手動）
- [ ] 縮圖色彩單一

---

## 版本歷程

| 版本 | 日期 | 變更 |
|------|------|------|
| v1.0 | — | 基礎 SEO 分析（標題、標籤、說明） |
| v1.1 | — | Shorts 支援、縮圖視覺分析（Canvas） |
| v1.2 | — | 逐字稿分析（字幕 XML） |
| v1.3 | — | Duration 小時格式化修復 |
| v1.4 | — | 安全性修復（XSS escape、Canvas try/catch、parseInt radix、injected flag clean） |
| v1.5 | — | 匯出 Markdown 報告、Firefox scrollbar 相容、Color bucket Map 優化 |
| v1.6 | 2026-05-14 | 影片長度擷取修復：新增 `meta[itemprop="duration"]` 三層降級機制 |
| v1.7 | 2026-05-14 | 效能優化：像素迴圈合併 3→1 pass、createSEOInfo 拆 9 組件、預計算快取 |
| v1.8 | 2026-05-14 | 選項頁：22 項檢查開關 + 7 項閾值自訂（settings.js + chrome.storage.sync） |
| v1.9 | 2026-05-14 | 工具列圖示點擊 → 開啟選項頁（background service worker） |
| v1.10 | 2026-05-14 | 修復 SPA 導航後分析停留在舊影片（videoId 比對 + DOM 自動降級） |

---

## 專案結構

```
youtube-seo-analyzer/
├── README.md               # 文件
├── LICENSE                 # MIT
├── .gitignore
└── chrome-extension/
    ├── manifest.json       # Manifest v3 設定（含 options_ui + action）
    ├── content.js          # 主邏輯：資料擷取 + 分析引擎 + UI 面板
    ├── settings.js         # 共用設定模組（chrome.storage.sync 讀取）
    ├── background.js       # Service worker（工具列圖示點擊處理）
    ├── styles.css          # 注入樣式：深色主題面板 + FAB + 縮圖顯示
    ├── options/
    │   ├── options.html    # 選項頁 UI
    │   ├── options.js      # 選項頁邏輯（載入/儲存設定）
    │   └── options.css     # 選項頁樣式
    └── icons/
        ├── icon16.png
        ├── icon48.png
        └── icon128.png
```

---

## 安全性

### Content Script 防護

- **所有使用者資料**透過 `escapeHtml()` 過濾後才注入 DOM（防 XSS）
- Canvas `getImageData()` 包裹 `try/catch`（防 tainted canvas）
- `parseInt()` 強制指定 radix 10
- 不使用 `eval()`、`innerText`、字串拼接 SQL 等危險 API

### 權限最小化

| Permission | 用途 |
|------------|------|
| `storage` | 擴充功能設定儲存 |
| `https://www.youtube.com/*` | 執行 content script |
| `https://i.ytimg.com/*` | 載入縮圖進行 Canvas 分析 |

不需要 `tabs`、`cookies`、`webRequest`、`background`。

---

## 開發

```bash
# 修改後重新載入
chrome://extensions → 重新載入

# 語法檢查
node --check chrome-extension/content.js

# 來源
git clone https://github.com/lunkerchen/youtube-seo-analyzer.git
```

---

## 常見問題

### 按鈕沒有出現？
- 確認在 `youtube.com/watch?v=...` 或 `youtube.com/shorts/...` 頁面
- 重新整理頁面後再試
- 檢查 `chrome://extensions` 中擴充功能已啟用

### SEO 分數好像不準？
- 分析基於頁面資料與 canvas 像素估算，非 YouTube 內部 API
- 縮圖文字分析為邊緣密度代理測量，非精確 OCR
- 建議作為優化參考，非絕對標準

### 逐字稿分析無結果？
- 影片必須有啟用字幕（手動上傳或 YouTube 自動產生）
- Shorts 通常沒有字幕，逐字稿分析會跳過

---

## 未來計劃

- [ ] 多影片批次分析（頻道層級 SEO 健檢）
- [ ] 對比多個影片的 SEO 分數

---

## License

MIT License — 詳見 [LICENSE](LICENSE)。
