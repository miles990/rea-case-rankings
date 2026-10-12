// Builds the site from data/*.json:
//   dist/artifact.html      one page with every language, switched in place
//   dist/pages/**/index.html one static page per language for GitHub Pages
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { allRecords } from "./records.mjs";

const ROOT = new URL("..", import.meta.url);
const read = (p) => readFile(new URL(p, ROOT), "utf8");
const SITE_URL = (process.env.SITE_URL || "https://miles990.github.io/rea-awesome/").replace(/\/?$/, "/");
const REPO_URL = process.env.REPO_URL || "https://github.com/miles990/rea-awesome";
// Language → path under the site root. Traditional Chinese is the root page.
const PATHS = { "zh-TW": "", en: "en/", "zh-CN": "zh-cn/", ja: "ja/", ko: "ko/" };

const template = await read("site/template.html");
const ui = JSON.parse(await read("site/ui.json"));
const cases = JSON.parse(await read("data/cases.json"));
const discovered = JSON.parse(await read("data/discovered.json").catch(() => '{"items":[]}'));
const i18nAll = JSON.parse(await read("data/i18n.json").catch(() => "{}"));
const records = await allRecords();

const i18n = {};
for (const r of records) if (i18nAll[r.id]) { const { hash, ...rest } = i18nAll[r.id]; i18n[r.id] = rest; }
const updated = [cases.updated, discovered.updated].filter(Boolean).sort().pop();
const base = { updated, scanned: discovered.updated, repo: cases.repo, log: cases.log, site: { repo: REPO_URL }, records, i18n };

// JSON inside <script>: escape "<" so no string can close the tag.
const js = (v) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16));
const fill = (data, lang) => template.replace("__DATA__", () => js(data)).replace("__UI__", () => js(ui)).replace("__LANG__", () => js(lang));

await mkdir(new URL("dist/pages/", ROOT), { recursive: true });
await writeFile(new URL("dist/artifact.html", ROOT), fill({ ...base, pages: null }, null));

const split = (html) => { const i = html.indexOf("</style>") + 8; return [html.slice(0, i), html.slice(i)]; };
for (const [lang, path] of Object.entries(PATHS)) {
  const up = path ? "../" : "./";
  const pages = Object.fromEntries(Object.entries(PATHS).map(([l, p]) => [l, up + p]));
  const [head, body] = split(fill({ ...base, pages }, lang));
  const t = ui[lang];
  const alternates = Object.entries(PATHS).map(([l, p]) => `<link rel="alternate" hreflang="${ui[l]._html}" href="${SITE_URL}${p}">`).join("\n");
  const desc = t["hero.lede"].replace(/<[^>]+>/g, "");
  const html = `<!doctype html>
<html lang="${t._html}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="canonical" href="${SITE_URL}${path}">
${alternates}
<link rel="alternate" hreflang="x-default" href="${SITE_URL}en/">
<meta property="og:type" content="website">
<meta property="og:title" content="${t.title}">
<meta property="og:description" content="${desc.replace(/"/g, "&quot;")}">
<meta property="og:url" content="${SITE_URL}${path}">
<meta name="twitter:card" content="summary">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,-apple-system,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
${head.replace(/<title>[^<]*<\/title>/, `<title>${t.title}</title>`).replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${desc.replace(/"/g, "&quot;")}">`)}
</head>
<body>${body}
</body>
</html>
`;
  await mkdir(new URL(`dist/pages/${path}`, ROOT), { recursive: true });
  await writeFile(new URL(`dist/pages/${path}index.html`, ROOT), html);
}
await writeFile(new URL("dist/pages/.nojekyll", ROOT), "");
console.log(`built ${records.length} records, ${Object.keys(i18n).length} translated, ${Object.keys(PATHS).length} language pages`);
