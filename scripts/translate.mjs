// Fills data/i18n.json with translations of every case's text fields.
// Source text is Traditional Chinese; each entry stores a hash of its source so
// an edited case is translated again. Unchanged cases are never re-sent.
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { askClaudeJSON, claudeAvailable, clean } from "./claude.mjs";
import { allRecords } from "./records.mjs";

const ROOT = new URL("..", import.meta.url);
const I18N = new URL("data/i18n.json", ROOT);
export const TARGETS = { en: "English", "zh-CN": "简体中文", ja: "日本語", ko: "한국어" };
const FIELDS = ["title", "summary", "target", "metric"];
const MAX_PER_RUN = Number(process.env.MAX_TRANSLATED_PER_RUN || 80);

const hashOf = (r) => createHash("sha1").update(FIELDS.map((f) => r[f] || "").join("\u0001")).digest("hex").slice(0, 12);

async function main() {
  let cache = {};
  try {
    cache = JSON.parse(await readFile(I18N, "utf8"));
  } catch {}
  if (!claudeAvailable()) {
    console.log("claude CLI unavailable; translations unchanged");
    return;
  }

  const records = await allRecords();
  const todo = records.filter((r) => cache[r.id]?.hash !== hashOf(r)).slice(0, MAX_PER_RUN);
  let done = 0;
  for (let i = 0; i < todo.length; i += 6) {
    const batch = todo.slice(i, i + 6);
    const payload = batch.map((r, n) => ({ n, ...Object.fromEntries(FIELDS.map((f) => [f, r[f] || ""])) }));
    const prompt = `把下面每個項目的 title、summary、target、metric 從繁體中文翻成 ${Object.entries(TARGETS).map(([k, v]) => `${k}（${v}）`).join("、")}。
這些是逆向工程案例的介紹。專有名詞（產品名、人名、函式名、REA、Ghidra、IPC 等）保留原文；數字與單位保持不變；語氣簡潔自然，像該語言的技術編輯寫的。
只輸出 JSON：{"items":[{"n":0,"en":{"title":"","summary":"","target":"","metric":""},"zh-CN":{...},"ja":{...},"ko":{...}}]}

${JSON.stringify(payload)}`;
    try {
      for (const out of askClaudeJSON(prompt).items || []) {
        const r = batch[out.n];
        if (!r) continue;
        const entry = { hash: hashOf(r) };
        for (const lang of Object.keys(TARGETS)) {
          const t = out[lang] || {};
          entry[lang] = Object.fromEntries(FIELDS.map((f) => [f, clean(t[f], f === "summary" ? 700 : 200)]));
        }
        cache[r.id] = entry;
        done++;
      }
    } catch (e) {
      console.error(`translation batch failed: ${e.message.slice(0, 160)}`);
    }
    await writeFile(I18N, JSON.stringify(cache, null, 2) + "\n");
  }
  console.log(`translated ${done} of ${todo.length} pending`);
}

main();
