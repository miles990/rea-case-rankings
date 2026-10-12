// Builds everything the site serves from data/*.json and site/*:
//   dist/pages/<lang>/index.html  one static page per language (GitHub Pages)
//   dist/pages/api/records.json   the full ranking with every translation
//   dist/pages/llms.txt, feed.xml, sitemap.xml, thumbs/
import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { allRecords } from "./records.mjs";

const ROOT = new URL("..", import.meta.url);
const read = (p) => readFile(new URL(p, ROOT), "utf8");
const out = (p) => new URL(`dist/${p}`, ROOT);
const SITE_URL = (process.env.SITE_URL || "https://miles990.github.io/rea-awesome/").replace(/\/?$/, "/");
const REPO_URL = process.env.REPO_URL || "https://github.com/miles990/rea-awesome";

const [html, css, js] = await Promise.all([read("site/index.html"), read("site/app.css"), read("site/app.js")]);
const ui = JSON.parse(await read("site/ui.json"));
const cases = JSON.parse(await read("data/cases.json"));
const discovered = JSON.parse(await read("data/discovered.json").catch(() => '{"items":[]}'));
const i18nAll = JSON.parse(await read("data/i18n.json").catch(() => "{}"));
const thumbsManifest = JSON.parse(await read("data/thumbs.json").catch(() => "{}"));
const records = await allRecords();
const historyAll = JSON.parse(await read("data/history.json").catch(() => '{"days":[]}'));

// Language → path under the site root. Traditional Chinese is the root page.
const PATHS = Object.fromEntries(Object.keys(ui).map((l) => [l, l === "zh-TW" ? "" : l.toLowerCase() + "/"]));
const thumbs = {};
for (const r of records) {
  const m = thumbsManifest[r.id];
  if (m?.file && !m.generic && existsSync(new URL(`site/thumbs/${m.file}`, ROOT))) thumbs[r.id] = m.file;
}
const i18n = {};
for (const r of records) if (i18nAll[r.id]) { const { hash, ...rest } = i18nAll[r.id]; i18n[r.id] = rest; }
const updated = [cases.updated, discovered.updated].filter(Boolean).sort().pop();
const base = { updated, scanned: discovered.updated, repo: cases.repo, site: { repo: REPO_URL, url: SITE_URL }, records, thumbs };

// JSON inside <script>: escape "<" and line separators so no string can end the tag.
const js_ = (v) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, (c) => "\\u" + c.charCodeAt(0).toString(16));
const assemble = (data, lang, headExtra = "") =>
  html.replace("/*__CSS__*/", () => css).replace("<!--__HEAD_EXTRA__-->", () => headExtra)
    .replace("/*__DATA__*/null", () => js_(data)).replace("/*__UI__*/null", () => js_(ui)).replace("/*__LANG__*/null", () => js_(lang))
    .replace("/*__JS__*/", () => js);
const split = (page) => page.split("<!--SPLIT-->");

await rm(out(""), { recursive: true, force: true });
await mkdir(out("pages/api"), { recursive: true });
if (existsSync(new URL("site/thumbs/", ROOT))) {
  await cp(new URL("site/thumbs/", ROOT), out("pages/thumbs/"), { recursive: true });
}

// ---- GitHub Pages: one page per language, only that language's translations inline.
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
for (const [lang, path] of Object.entries(PATHS)) {
  const up = path ? "../" : "./";
  const pages = Object.fromEntries(Object.entries(PATHS).map(([l, p]) => [l, up + p]));
  const own = Object.fromEntries(Object.entries(i18n).map(([id, v]) => [id, v[lang] ? { [lang]: v[lang] } : {}]));
  const t = (k) => ui[lang][k] ?? ui.en[k];
  const desc = t("hero.lede").replace(/<[^>]+>/g, "");
  const top = records.slice(0, 20);
  const jsonld = { "@context": "https://schema.org", "@type": "ItemList", name: t("title"), url: SITE_URL + path, numberOfItems: records.length,
    itemListElement: top.map((r, i) => ({ "@type": "ListItem", position: i + 1, name: i18n[r.id]?.[lang]?.title || r.title, url: r.links[0].url })) };
  const head = `<link rel="canonical" href="${SITE_URL}${path}">
${Object.entries(PATHS).map(([l, p]) => `<link rel="alternate" hreflang="${ui[l]._html}" href="${SITE_URL}${p}">`).join("\n")}
<link rel="alternate" hreflang="x-default" href="${SITE_URL}en/">
<link rel="alternate" type="application/rss+xml" title="REA cases" href="${up}feed.xml">
<link rel="alternate" type="application/json" title="REA cases (JSON)" href="${up}api/records.json">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(t("title"))}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${SITE_URL}${path}">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">${js_(jsonld)}</script>`;
  const pick = (o) => (o?.text ? { ...o, text: { [lang]: o.text[lang] || o.text["zh-TW"] } } : o);
  const history = { days: historyAll.days.map(pick), trend: pick(historyAll.trend) };
  const page = assemble({ ...base, i18n: own, pages, thumbBase: up + "thumbs/", history }, lang, head);
  const [h, b] = split(page);
  const doc = `<!doctype html>
<html lang="${ui[lang]._html}" dir="${ui[lang]._dir || "ltr"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
${h.replace(/<title>[^<]*<\/title>/, `<title>${esc(t("title"))}</title>`).replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(desc)}">`)}
</head>
<body>${b}</body>
</html>
`;
  await mkdir(out(`pages/${path}`), { recursive: true });
  await writeFile(out(`pages/${path}index.html`), doc);
}

// ---- Machine-readable outputs for agents and feed readers.
const api = {
  name: "REA case rankings", description: "What people built, rebuilt and found with REA (github.com/morluto/rea), scored 1–5 and ranked.",
  updated, site: SITE_URL, source: REPO_URL, languages: Object.keys(ui),
  ranking: "score desc, heat desc, evidence (tested > shipped > reported), date desc",
  fields: { rank: "1 = best", wow: "score 1–5 (null = not scored yet)", heat: "popularity 0–100, log-scaled engagement", status: "tested | shipped | reported", type: "case | app | learn | news", source: "curated (human-scored) | auto (AI-scored)", i18n: "translations of title/summary/target/metric by language" },
  records: records.map((r, i) => ({ rank: i + 1, id: r.id, title: r.title, summary: r.summary, target: r.target, metric: r.metric, wow: r.wow, heat: r.heat, status: r.status, type: r.type, category: r.category, lang: r.lang, author: r.author, author_url: r.author_url || null, date: r.date || null, added: r.added || null, via: r.via, source: r.source, pop: r.pop || {}, links: r.links, thumbnail: thumbs[r.id] ? SITE_URL + "thumbs/" + thumbs[r.id] : null, page: `${SITE_URL}#r-${r.id}`, i18n: i18n[r.id] || {} })),
};
await writeFile(out("pages/api/records.json"), JSON.stringify(api));
await writeFile(out("pages/api/daily.json"), JSON.stringify({ description: "One entry per day: REA stars, entries added (ids into records.json), and a short brief in zh-TW/en/zh-CN naming which long-term signals the day supports.", signals: historyAll.signals || {}, days: historyAll.days }));

await writeFile(out("pages/llms.txt"), `# REA case rankings

> Every public case, app, tutorial and article about REA (Reverse Engineer Anything, github.com/morluto/rea), scored on one 1–5 rubric, ranked, and updated daily, in Chinese and English.

## Data
- [All entries as JSON](${SITE_URL}api/records.json): rank, score (wow 1–5), heat (0–100), status, type, category, source links, popularity signals and translations.
- [Daily context as JSON](${SITE_URL}api/daily.json): per-day stars, new entry ids and a brief naming which long-term signals (A–G) the day supports.
- [RSS feed of the newest entries](${SITE_URL}feed.xml)

## Page URLs carry state
- ${SITE_URL}?q=<text>&type=case|app|learn|news&cat=<category>&via=<platform>&lang=<code>&status=tested|shipped|reported&sort=rank|heat|new&view=list|grid|table|timeline|graph
- Select an entry with #r-<id>, e.g. ${SITE_URL}#r-zwo-asiair
- Languages: ${Object.entries(PATHS).map(([l, p]) => `${l} → ${SITE_URL}${p}`).join(", ")}

## Scoring
- 5: major verifiable result (playable or usable rebuild, large test suites matching the original, significant hardware or firmware finding)
- 4: usable result or important finding on a specific target, with some evidence
- 3: hands-on test or analysis of a specific target with clear conclusions
- 2: tools, integrations, tutorials, small experiments
- 1: news, rewrites, commentary, or only mentions REA
- Ties: heat (log-scaled stars, points, likes, upvotes ×3, views ÷100), then evidence, then date.

## Source
- [Repository and data files](${REPO_URL})
`);

const xmlEsc = (s) => String(s ?? "").replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
const newest = [...records].sort((a, b) => (b.added || "").localeCompare(a.added || "") || (b.date || "").localeCompare(a.date || "")).slice(0, 50);
await writeFile(out("pages/feed.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>REA case rankings</title><link>${SITE_URL}</link><description>New REA cases, apps and articles, scored and ranked daily.</description><lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${newest.map((r) => `<item><title>${xmlEsc(`#${records.indexOf(r) + 1} · ${i18n[r.id]?.en?.title || r.title}`)}</title><link>${xmlEsc(r.links[0].url)}</link><guid isPermaLink="false">${xmlEsc(r.id)}</guid><description>${xmlEsc(`${r.wow ?? "?"}/5 · ${i18n[r.id]?.en?.summary || r.summary || ""}`)}</description>${r.added ? `<pubDate>${new Date(r.added + "T00:00:00Z").toUTCString()}</pubDate>` : ""}</item>`).join("\n")}
</channel></rss>
`);
await writeFile(out("pages/sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${Object.values(PATHS).map((p) => `<url><loc>${SITE_URL}${p}</loc><lastmod>${updated}</lastmod><changefreq>daily</changefreq></url>`).join("\n")}
</urlset>
`);
await writeFile(out("pages/robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}sitemap.xml\n`);
await writeFile(out("pages/.nojekyll"), "");
console.log(`built ${records.length} records · ${Object.keys(PATHS).length} language pages · ${Object.keys(thumbs).length} thumbnails`);
