// Fills data/i18n.json with translations of every case's text fields.
// Source text is Traditional Chinese; each entry stores a hash of its source so
// an edited case is translated again. Unchanged cases are never re-sent.
import { pathToFileURL } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { askClaudeJSONAsync, claudeAvailable, clean } from "./claude.mjs";
import { allRecords } from "./records.mjs";

const ROOT = new URL("..", import.meta.url);
const I18N = new URL("data/i18n.json", ROOT);
// Same 19 locales as REA's own READMEs (Traditional Chinese is the source).
export const TARGETS = { en: "English", "zh-CN": "简体中文", ja: "日本語", ko: "한국어", tr: "Türkçe", ru: "Русский", vi: "Tiếng Việt", th: "ไทย", de: "Deutsch", es: "Español", fr: "Français", uk: "Українська", pl: "Polski", "pt-BR": "Português (Brasil)", ar: "العربية", fa: "فارسی", id: "Bahasa Indonesia", it: "Italiano" };
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
  const missing = (r) => (cache[r.id]?.hash !== hashOf(r) ? Object.keys(TARGETS) : Object.keys(TARGETS).filter((l) => !cache[r.id]?.[l]?.title));
  const todo = records.filter((r) => missing(r).length).slice(0, MAX_PER_RUN);
  let done = 0;
  // Small calls (4 entries × up to 6 languages) keep each answer well under the
  // CLI timeout. Up to 4 run at once; all merging happens here, in one process.
  const jobs = [];
  for (let i = 0; i < todo.length; i += 4) {
    const batch = todo.slice(i, i + 4);
    const langs = [...new Set(batch.flatMap(missing))];
    for (let j = 0; j < langs.length; j += 6) jobs.push({ batch, group: langs.slice(j, j + 6) });
  }
  const run = async ({ batch, group }) => {
    const payload = batch.map((r, n) => ({ n, ...Object.fromEntries(FIELDS.map((f) => [f, r[f] || ""])) }));
    const prompt = `把下面每個項目的 title、summary、target、metric 從繁體中文翻成 ${group.map((k) => `${k}（${TARGETS[k]}）`).join("、")}。
這些是逆向工程案例的介紹。專有名詞（產品名、人名、函式名、REA、Ghidra、IPC 等）保留原文；數字與單位保持不變；語氣簡潔自然，像該語言的技術編輯寫的。
只輸出 JSON：{"items":[{"n":0,"<語言代碼>":{"title":"","summary":"","target":"","metric":""}, ...每個語言一個}]}

${JSON.stringify(payload)}`;
    try {
      for (const out of (await askClaudeJSONAsync(prompt)).items || []) {
        const r = batch[out.n];
        if (!r) continue;
        const entry = cache[r.id]?.hash === hashOf(r) ? cache[r.id] : { hash: hashOf(r) };
        for (const lang of group) if (out[lang]) entry[lang] = Object.fromEntries(FIELDS.map((f) => [f, clean(out[lang][f], f === "summary" ? 700 : 200)]));
        cache[r.id] = entry;
      }
      done++;
    } catch (e) {
      console.error(`translation batch failed: ${e.message.slice(0, 160)}`);
    }
    await writeFile(I18N, JSON.stringify(cache, null, 2) + "\n");
  };
  const queue = [...jobs];
  await Promise.all(Array.from({ length: Number(process.env.TRANSLATE_CONCURRENCY || 4) }, async () => { while (queue.length) await run(queue.shift()); }));
  console.log(`translation calls: ${done} of ${jobs.length} succeeded for ${todo.length} entries`);
}

// Run only when executed directly, not when imported.
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
