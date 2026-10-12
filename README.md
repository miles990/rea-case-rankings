# REA 案例排行榜 · REA Case Rankings

全世界的人用 [REA（Reverse Engineer Anything）](https://github.com/morluto/rea) 做了什麼：人工整理的案例，加上每天從各語言來源自動蒐集的新項目、相關應用、教學與報導，全部用同一套 1–5 分標準評分、依熱度排序。網站提供繁中、簡中與英文。

**網站：** https://miles990.github.io/rea-awesome/ · **JSON：** [`api/records.json`](https://miles990.github.io/rea-awesome/api/records.json) · **給 AI agent：** [`llms.txt`](https://miles990.github.io/rea-awesome/llms.txt) · **RSS：** [`feed.xml`](https://miles990.github.io/rea-awesome/feed.xml)

## 網站功能

- **探索器**：左側篩選欄（即時計數長條）、中間五種同步檢視（清單、卡片、表格、時間 × 分數泡泡圖、關係節點圖）、右側詳情窗格與相關項目
- **⌘K 快速跳轉**，鍵盤 `/` 搜尋、`J`/`K` 上下、`O` 開來源、`1`–`5` 切換檢視
- **網址即狀態**：`?q=&type=&cat=&via=&lang=&status=&min=&sort=&view=#r-<id>`，可分享，也能讓 agent 直接開啟

## 排名方式

1. **分數 1–5**（人工或 Claude 依同一準則評分，見網站「說明」）
2. **熱度 0–100**：星數、HN 分數、讚數各算 1，討論票算 3，每 100 次觀看算 1，取對數換算
3. 驗證程度（有測試 > 有成果 > 自述），再來是日期

## 每日流程

| 時間 | 在哪裡 | 做什麼 |
|---|---|---|
| 08:15（台灣） | 本機 launchd：`scripts/x-daily.sh` | Grok 搜尋 X 上的新貼文並推到 repo（Grok 訂閱憑證不離開本機） |
| 01:00 UTC | GitHub Actions `collect` | GitHub、Hacker News、DEV、Qiita、V2EX、YouTube、Bluesky、Mastodon；去重；碰不到 Claude token |
| | `enrich`（`claude` environment，限 main） | Claude 在無工具、單回合模式下評分與翻譯 |
| | `publish` | 縮圖、資料驗證、提交、建置、**Playwright 瀏覽器檢查**（失敗就不部署） |
| | `deploy` | GitHub Pages |

## 開發

```bash
npm install && npx playwright install chromium
npm run dev        # validate → build → 瀏覽器檢查（含 3 種寬度、深淺色、互動冒煙測試）
node scripts/check.mjs --shots   # 另存截圖到 dist/shots/
```

| 腳本 | 用途 |
|---|---|
| `scripts/collect.mjs collect\|score\|all\|x` | 蒐集、評分、或只跑 X |
| `scripts/translate.mjs` | 只翻譯 2 分以上、內容有變更的項目（英文、簡中） |
| `scripts/thumbs.mjs` | 下載並縮小預覽圖；SVG 經安全過濾 |
| `scripts/validate.mjs` | 資料結構、連結安全、重複來源、翻譯與介面字串覆蓋 |
| `scripts/build.mjs` | 產生各語言頁面、JSON、llms.txt、RSS、sitemap、Artifact 版本 |
| `scripts/check.mjs` | Playwright：主控台錯誤、水平溢出、未翻譯字串、五種檢視與互動 |

想新增或修正案例，改 `data/cases.json` 後開 PR。

## 安全設計

- 只由排程與 `workflow_dispatch` 觸發，沒有 `pull_request` 觸發，fork 永遠拿不到 secret。
- Claude token 放在 `claude` environment，限定 `main` 分支，只注入評分與翻譯步驟；蒐集網頁內容的 job 拿不到它。
- 抓到的內容一律視為不可信：Claude 以 `--tools ""`、`--max-turns 1` 執行，輸出只取白名單欄位並限制長度；頁面輸出全部 HTML 跳脫，連結只允許 http(s)；SVG 縮圖拒絕任何腳本、事件屬性與外部連結。
- 所有 Actions 釘選 commit SHA，Claude Code、Playwright、yt-dlp 釘選版本。

### 設定 Claude token（只需一次）

在你自己的終端機（不要在任何 AI 對話裡）執行：

```bash
claude setup-token                       # 產生訂閱用的長期 token
gh secret set CLAUDE_CODE_OAUTH_TOKEN --env claude -R miles990/rea-awesome
```

沒有設定時，新項目仍會以「待評分」出現在網站上。
