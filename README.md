# REA 案例排行榜 · REA Case Rankings

全世界的人用 [REA（Reverse Engineer Anything）](https://github.com/morluto/rea) 拆開了什麼：人工整理的案例加上每天自動蒐集的新項目，全部用同一套 1–5 分標準評分排名，並翻成繁中、简中、English、日本語、한국어。

**網站：** https://miles990.github.io/rea-awesome/

## 每日流程

`.github/workflows/daily.yml` 每天 UTC 01:00 執行：

| 工作 | 做什麼 | 權限 |
|---|---|---|
| collect | 查詢 GitHub、Hacker News、DEV、Qiita、V2EX、YouTube，去重後寫入 `data/discovered.json` | `contents: read`，碰不到 Claude token |
| enrich | Claude Code 依評分標準打分、寫摘要並翻譯 | `claude` environment（只限 main），Claude 以無工具、單回合模式執行 |
| publish | 把資料提交回 repo，產生每種語言的靜態頁 | `contents: write` |
| deploy | 部署到 GitHub Pages | `pages: write` |

沒有 `CLAUDE_CODE_OAUTH_TOKEN` 時 enrich 會略過，新項目仍會以「待評分」進入頁面。

## 資料

- `data/cases.json`：人工整理的案例（評分、驗證程度、摘要）
- `data/discovered.json`：自動蒐集與 AI 評分的項目
- `data/i18n.json`：翻譯快取（原文變更才重新翻譯）

想新增或修正案例，直接改 `data/cases.json` 開 PR。

## 本機建置

```bash
node scripts/collect.mjs all   # 需要 gh 登入與 claude CLI 才會評分
node scripts/translate.mjs
node scripts/build.mjs         # 輸出 dist/pages/ 與 dist/artifact.html
```

## 安全設計

- 工作流程只由排程與 `workflow_dispatch` 觸發，沒有 `pull_request` 觸發，fork 永遠拿不到 secret。
- Claude token 放在 `claude` environment，限定 `main` 分支，只注入評分與翻譯兩個步驟。
- 抓到的網頁內容視為不可信資料：Claude 以 `--tools ""`、`--max-turns 1` 執行，輸出只取白名單欄位並限制長度；頁面輸出一律 HTML 跳脫，連結只允許 http(s)。
- 所有 Actions 釘選 commit SHA，CLI 與 yt-dlp 釘選版本。
