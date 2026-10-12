// Fast checks that run before every build, locally and in CI. Errors stop the
// build; warnings are printed so gaps (like missing translations) stay visible.
import { readFile, readdir } from "node:fs/promises";
import { allRecords } from "./records.mjs";
import { TARGETS } from "./translate.mjs";

const ROOT = new URL("..", import.meta.url);
const read = async (p) => JSON.parse(await readFile(new URL(p, ROOT), "utf8"));
const errors = [], warnings = [];
const err = (m) => errors.push(m), warn = (m) => warnings.push(m);

const CATEGORIES = new Set(["Native / 遊戲", "Native / macOS", "Native", "Native / 資安", "Electron", "Web / JS", "Web / 資安", "Android", "韌體 / 硬體", "IoT / 藍牙", "CTF", "工具鏈", "教學", "報導 / 評論", "待分類"]);
const STATUS = new Set(["tested", "shipped", "reported"]);
const isUrl = (u) => typeof u === "string" && /^https?:\/\/[^\s"<>]+$/.test(u);
const isDate = (d) => d == null || /^\d{4}-\d{2}-\d{2}$/.test(d);

const cases = await read("data/cases.json");
const ids = new Set();
for (const c of cases.cases) {
  const at = `cases.json ${c.id || "(no id)"}`;
  if (!/^[a-z0-9-]+$/.test(c.id || "")) err(`${at}: id must be lowercase-kebab`);
  if (ids.has(c.id)) err(`${at}: duplicate id`);
  ids.add(c.id);
  for (const f of ["title", "summary", "target", "metric", "author", "lang"]) if (!c[f]) err(`${at}: missing ${f}`);
  if (!CATEGORIES.has(c.category)) err(`${at}: unknown category "${c.category}"`);
  if (!STATUS.has(c.status)) err(`${at}: unknown status "${c.status}"`);
  if (!(c.wow >= 1 && c.wow <= 5)) err(`${at}: wow must be 1–5`);
  if (!isDate(c.date) || !isDate(c.added)) err(`${at}: bad date`);
  if (!c.links?.length) err(`${at}: needs at least one link`);
  for (const l of c.links || []) if (!isUrl(l.url) || !l.label) err(`${at}: bad link ${JSON.stringify(l)}`);
  if (c.author_url && !isUrl(c.author_url)) err(`${at}: bad author_url`);
}

const disc = await read("data/discovered.json");
for (const d of disc.items) {
  if (!isUrl(d.url)) err(`discovered.json: bad url ${d.url}`);
  if (!isDate(d.found)) err(`discovered.json ${d.url}: bad found date`);
  if (d.wow != null && !(d.wow >= 1 && d.wow <= 5)) err(`discovered.json ${d.url}: wow out of range`);
}

const records = await allRecords();
const primary = new Map();
for (const r of records) {
  const key = r.links[0].url.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
  if (primary.has(key)) warn(`same source in two entries: ${r.id} and ${primary.get(key)}`);
  primary.set(key, r.id);
}

// Translations: every ranked entry should exist in every target language.
const i18n = await read("data/i18n.json").catch(() => ({}));
const missingTr = records.filter((r) => (r.wow == null || r.wow >= 2) && Object.keys(TARGETS).some((l) => !i18n[r.id]?.[l]?.title));
if (missingTr.length) warn(`${missingTr.length} entries lack some translations (filled on the next translate run)`);

// UI strings: every key used by the page must exist in English and Traditional Chinese.
const ui = await read("site/ui.json");
const src = (await Promise.all((await readdir(new URL("site/", ROOT))).filter((f) => /\.(html|js)$/.test(f)).map((f) => readFile(new URL(`site/${f}`, ROOT), "utf8")))).join("\n");
const used = new Set([...src.matchAll(/data-i18n(?:-html|-ph)?="([^"]+)"/g)].map((m) => m[1]));
for (const m of src.matchAll(/\bt\("([a-zA-Z0-9_.]+)"\)/g)) used.add(m[1]);
for (const key of used) for (const l of ["en", "zh-TW"]) if (ui[l][key] == null) err(`ui.json ${l}: missing key "${key}"`);
for (const l of Object.keys(ui)) {
  const miss = [...used].filter((k) => ui[l][k] == null);
  if (miss.length && !["en", "zh-TW"].includes(l)) warn(`ui.json ${l}: ${miss.length} keys fall back (${miss.slice(0, 5).join(", ")}${miss.length > 5 ? "…" : ""})`);
}

for (const w of warnings) console.log(`warn  ${w}`);
for (const e of errors) console.log(`ERROR ${e}`);
console.log(`validate: ${records.length} entries, ${errors.length} errors, ${warnings.length} warnings`);
if (errors.length) process.exit(1);
