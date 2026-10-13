// Loads the built pages in Chromium and fails on anything a visitor would hit:
// script errors, horizontal overflow, raw i18n keys, broken views or controls.
// Screenshots land in dist/shots/ for a quick visual review.
import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, normalize } from "node:path";

const ROOT = new URL("..", import.meta.url);
const OUT = new URL("dist/shots/", ROOT);
await mkdir(OUT, { recursive: true });
// Served over HTTP like GitHub Pages, so the second data batch (data.json) really loads.
const DIST = new URL("dist/pages/", ROOT).pathname;
const MIME = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".xml": "application/xml", ".txt": "text/plain" };
const server = createServer(async (req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  if (p.endsWith("/")) p += "index.html";
  try { const body = await readFile(DIST + p.replace(/^\//, "")); res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const page = (p) => `http://127.0.0.1:${server.address().port}/${p.replace(/index\.html$/, "")}`;
const SHOTS = process.argv.includes("--shots");
const problems = [];
const fail = (m) => problems.push(m);

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const runs = [
  { name: "zh-desktop-light", url: page("index.html"), width: 1440, height: 900, scheme: "light", full: true },
  { name: "zh-desktop-dark", url: page("index.html"), width: 1440, height: 900, scheme: "dark" },
  { name: "en-tablet", url: page("en/index.html"), width: 820, height: 1100, scheme: "light" },
  { name: "cn-phone-dark", url: page("zh-cn/index.html"), width: 390, height: 844, scheme: "dark", mobile: true },
  { name: "en-phone-light", url: page("en/index.html"), width: 390, height: 844, scheme: "light", mobile: true },
];

for (const run of runs) {
  const ctx = await browser.newContext({ viewport: { width: run.width, height: run.height }, colorScheme: run.scheme, isMobile: !!run.mobile, hasTouch: !!run.mobile, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const tag = `[${run.name}]`;
  p.on("pageerror", (e) => fail(`${tag} page error: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !/fonts\.(googleapis|gstatic)|cdnjs|net::ERR/.test(m.text())) fail(`${tag} console: ${m.text()}`); });
  await p.goto(run.url, { waitUntil: "load" });
  await p.waitForTimeout(700);

  // The second batch must arrive and replace the first.
  await p.waitForFunction(() => document.documentElement.dataset.full, null, { timeout: 15000 }).catch(() => {});
  const full = await p.evaluate(() => ({ flag: document.documentElement.dataset.full, n: records.length, total: DATA.total }));
  if (full.flag !== "1") fail(`${tag} full data did not load (flag ${full.flag})`);
  else if (full.n !== full.total) fail(`${tag} loaded ${full.n} of ${full.total} entries`);
  const info = await p.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const over = [...document.querySelectorAll("body *")].filter((e) => {
      const r = e.getBoundingClientRect();
      if (!r.width || getComputedStyle(e).position === "fixed") return false;
      return (r.right > w + 1 || r.left < -1) && !e.closest("[data-scroll-x], .drawer, .pal, .tip, svg");
    }).slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join(".")}`);
    const text = document.body.innerText;
    const rawKeys = [...new Set(text.match(/\b(?:nav|hero|viz|rank|feat|new|how|rubric|foot|status|legend|row|sort|f|src|stat|panel|d|k|pal|type|view|heat|pop|ex|agent|about)\.[a-zA-Z0-9.]+\b/g) || [])].slice(0, 8);
    return { scrollW: document.documentElement.scrollWidth, w, over, rawKeys, rows: document.querySelectorAll("[data-row]").length, days: document.querySelectorAll("#days .day").length, hasHistory: typeof DATA !== "undefined" && !!DATA.history?.days?.length };
  });
  if (info.scrollW > info.w + 1) fail(`${tag} horizontal overflow ${info.scrollW}>${info.w}: ${info.over.join(", ")}`);
  if (info.rawKeys.length) fail(`${tag} untranslated keys on page: ${info.rawKeys.join(", ")}`);
  if (!info.rows) fail(`${tag} no result rows rendered`);
  if (info.hasHistory && !info.days) fail(`${tag} daily timeline rendered nothing`);
  // Masthead: today's headline, four numbers and at least one focus card.
  const mast = await p.evaluate(() => ({ h: document.querySelector("#mast-h")?.textContent.trim(), kpis: document.querySelectorAll("#kpis li").length, focus: document.querySelectorAll("#focus .fcard").length, covers: document.querySelectorAll(".cover").length }));
  if (!mast.h) fail(`${tag} masthead has no headline`);
  if (mast.kpis !== 4) fail(`${tag} masthead shows ${mast.kpis} numbers, expected 4`);
  if (!mast.focus) fail(`${tag} no focus cards`);
  if (!mast.covers) fail(`${tag} no generated covers rendered`);
  // Time ranges: counts never shrink as the range widens, and the default is today.
  const ranges = await p.evaluate(() => [...document.querySelectorAll("#periods [data-p]")].map((b) => [b.dataset.p, b.getAttribute("aria-pressed"), +b.querySelector(".k").textContent]));
  if (ranges.length !== 4 || ranges[0][1] !== "true") fail(`${tag} time ranges missing or today not default: ${JSON.stringify(ranges)}`);
  for (let i = 1; i < ranges.length; i++) if (ranges[i][2] < ranges[i - 1][2]) fail(`${tag} range ${ranges[i][0]} has fewer entries than ${ranges[i - 1][0]}`);
  // Every range is its own ranking: the first row is #1.
  for (const k of ["1", "7", "all"]) {
    await p.locator(`[data-p="${k}"]`).click();
    await p.waitForTimeout(120);
    const first = await p.evaluate(() => { const r = current[0]; return r ? POS.get(r.id) : null; });
    if (first !== null && first !== 1) fail(`${tag} range ${k} starts at #${first}, expected #1`);
  }

  // Interaction smoke test: every view renders, selection opens details, palette opens.
  for (const v of ["grid", "table", "timeline", "graph", "space", "list"]) {
    const btn = p.locator(`[data-view="${v}"]`).first();
    if (!(await btn.count())) { fail(`${tag} missing view button ${v}`); continue; }
    await btn.click();
    // Graph and 3D load their libraries on first use; wait past the loading placeholder.
    if (v === "graph") await p.waitForSelector("#graph .node, #results .empty:not(.loading)", { timeout: 30000 }).catch(() => {});
    if (v === "space") await p.waitForSelector("#space canvas, #results .empty:not(.loading)", { timeout: 30000 }).catch(() => {});
    await p.waitForTimeout(150);
    const ok = await p.evaluate((v) => {
      // Without WebGL the 3D view shows a fallback message instead; that is a pass.
      const sel = { grid: ".gcard", table: ".dtable tbody tr", timeline: "#timeline .dot", graph: "#graph .node", space: "#space canvas, #results .empty:not(.loading)", list: ".row" }[v];
      return document.querySelectorAll(sel).length;
    }, v);
    if (!ok) fail(`${tag} view "${v}" rendered nothing`);
    if (SHOTS && v !== "list" && run.name === "zh-desktop-light") await p.screenshot({ path: new URL(`${run.name}-${v}.png`, OUT).pathname });
  }
  await p.locator(".row").nth(2).click();
  await p.waitForTimeout(250);
  const detail = await p.evaluate(() => document.querySelector("#detail h2")?.textContent || "");
  if (!detail) fail(`${tag} selecting a row showed no details`);
  if (SHOTS) await p.screenshot({ path: new URL(`${run.name}.png`, OUT).pathname, fullPage: !!run.full });
  await p.keyboard.press("Escape");
  await p.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  await p.waitForTimeout(200);
  if (!(await p.locator("#pal.on").count())) fail(`${tag} ⌘K palette did not open`);
  await ctx.close();
}
// A deep link to an entry outside the first batch must open once the rest arrives.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(page("index.html"));
  const target = await p.evaluate(() => { const first = new Set(DATA.records.map((r) => r.id)); return fetch(DATA.full || "data.json").then((r) => r.json()).then((j) => (j.records.find((r) => !first.has(r.id)) || j.records.at(-1)).id); });
  await p.goto(page("index.html") + "?range=all#r-" + target);
  await p.waitForFunction(() => document.documentElement.dataset.full === "1", null, { timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(300);
  const shown = await p.evaluate(() => state.id);
  if (shown !== target) fail(`[deep-link] #r-${target} opened ${shown}`);
  await ctx.close();
}
await browser.close();
server.close();

for (const m of problems) console.log(`FAIL ${m}`);
console.log(`check: ${runs.length} page runs, ${problems.length} problems${SHOTS ? ", screenshots in dist/shots/" : ""}`);
if (problems.length) process.exit(1);
