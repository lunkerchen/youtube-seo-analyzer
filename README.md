# YouTube SEO 分析器 — Chrome 擴充功能

一鍵分析 YouTube 影片的 SEO 表現，直接在影片頁面上提供優化建議。

## 功能

- **標題分析** — 檢查中文字元是否超過 30 字（行動裝置截斷線）、是否過短
- **標籤審計** — 檢查標籤數量與覆蓋度（目標 15-20 個）
- **說明優化** — 前 150 字是否浪費在通用開場白、關鍵詞是否出現在說明開頭
- **Hashtag 檢查** — 說明中是否使用 hashtag
- **CTA 檢測** — 說明及口語中是否包含訂閱/留言等行動呼籲
- **SEO 關鍵詞區塊** — 說明底部是否包含純 SEO 關鍵詞區塊
- **逐字稿分析** — 從頁面字幕取得逐字稿，檢驗前 30 秒關鍵詞覆蓋率、口語與標籤關聯性、口語密度（wpm）
- **縮圖視覺分析** — Canvas 像素級分析亮度、對比度、文字存在機率、色彩主調
- **Shorts 支援** — 自動辨識 Shorts 頁面並調整檢查規則
- **綜合評分** — 0-100 分，附優先級引導

問題依嚴重度分級：**P0（嚴重）→ P1（重要）→ P2（中等）→ P3（建議）**

## 安裝

1. 開啟 Chrome，前往 `chrome://extensions`
2. 開啟右上角「開發者模式」
3. 點擊「載入未封裝項目」
4. 選擇 `chrome-extension/` 目錄

## 使用方式

1. 前往任何 YouTube 影片頁面（`youtube.com/watch?v=...`）
2. 右下角會出現藍色齒輪圖示按鈕
3. 點擊按鈕即彈出 SEO 分析側面板
4. 按 `Esc` 或點擊背景即可關閉

## 技術說明

- **Manifest v3** — Chrome 最新擴充功能標準
- **Content Script** — 直接從頁面擷取 `ytInitialPlayerResponse` 資料
- **無後端** — 所有分析在瀏覽器中完成，不需 API key 或伺服器
- **SPA 相容** — 支援 YouTube 的 SPA 導航，切換影片自動重新分析

## 資料來源

分析基於 YouTube 頁面中嵌入的 `ytInitialPlayerResponse` 物件，包含：
- `videoDetails.title` — 標題
- `videoDetails.shortDescription` — 說明
- `videoDetails.keywords` — 標籤陣列
- `videoDetails.author` — 頻道名稱
- `videoDetails.viewCount` — 觀看次數
- `videoDetails.lengthSeconds` — 影片長度

若 `ytInitialPlayerResponse` 不可用，會降級使用 DOM 查詢 (`meta[name="keywords"]`、`#description` 等)。

## 專案結構

```
youtube-seo-analyzer/
└── chrome-extension/
    ├── manifest.json       # 擴充功能設定
    ├── content.js          # 主要邏輯（資料擷取 + 分析 + UI）
    ├── styles.css          # 注入樣式（深色主題）
    └── icons/
        ├── icon16.png
        ├── icon48.png
        └── icon128.png
```

## 開發

```bash
# 修改後重新載入擴充功能
chrome://extensions → 重新載入

# 或使用 Chrome 的「自動重新載入」功能
```

## 未來計劃

- [ ] YouTube Shorts 支援
- [ ] 縮圖文字分析（vision-based）
- [ ] 匯出分析報告
- [ ] 多影片批次分析
