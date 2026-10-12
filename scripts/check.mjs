// Loads the built pages in Chromium and fails on anything a visitor would hit:
// script errors, horizontal overflow, raw i18n keys, broken views or controls.
// Screenshots land in dist/shots/ for a quick visual review.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const ROOT = new URL("..", import.meta.url);
const OUT = new URL("dist/shots/", ROOT);
await mkdir(OUT, { recursive: true });
const page = (p) => pathToFileURL(new URL(`dist/pages/${p}`, ROOT).pathname).href;
const SHOTS = process.argv.includes("--shots");
const problems = [];
const fail = (m) => problems.push(m);

const browser = await chromium.launch();
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

  // Interaction smoke test: every view renders, selection opens details, palette opens.
  for (const v of ["grid", "table", "timeline", "graph", "list"]) {
    const btn = p.locator(`[data-view="${v}"]`).first();
    if (!(await btn.count())) { fail(`${tag} missing view button ${v}`); continue; }
    await btn.click();
    await p.waitForTimeout(v === "graph" ? 900 : 150);
    const ok = await p.evaluate((v) => {
      const sel = { grid: ".gcard", table: ".dtable tbody tr", timeline: "#timeline .dot", graph: "#graph .node", list: ".row" }[v];
      return document.querySelectorAll(sel).length;
    }, v);
    if (!ok) fail(`${tag} view "${v}" rendered nothing`);
    if (SHOTS && v !== "list" && run.name === "zh-desktop-light") await p.screenshot({ path: new URL(`${run.name}-${v}.png`, OUT).pathname });
  }
  await p.locator("[data-row]").nth(2).click();
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
await browser.close();

for (const m of problems) console.log(`FAIL ${m}`);
console.log(`check: ${runs.length} page runs, ${problems.length} problems${SHOTS ? ", screenshots in dist/shots/" : ""}`);
if (problems.length) process.exit(1);
