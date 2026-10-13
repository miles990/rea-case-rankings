// REA case explorer. One state object drives every view; any change re-renders
// only what depends on it, so filters, views and the detail pane stay in sync.
"use strict";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const safe = (u) => (/^https?:\/\//i.test(u || "") ? u : "#");
const LANGS = Object.keys(UI);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const isPages = !!DATA.pages;

// ---------- Language ----------
function pickLang() {
  if (PAGE_LANG) return PAGE_LANG;
  const saved = store.get("rea-lang");
  if (UI[saved]) return saved;
  for (const l of navigator.languages || [navigator.language || "en"]) {
    const x = l.toLowerCase();
    if (/^zh-(tw|hk|mo|hant)/.test(x)) return "zh-TW";
    if (x.startsWith("zh")) return "zh-CN";
    if (x.startsWith("pt")) return "pt-BR";
    const hit = LANGS.find((k) => x.split("-")[0] === k.toLowerCase());
    if (hit) return hit;
  }
  return "en";
}
let lang = pickLang();
const t = (k) => UI[lang][k] ?? (lang.startsWith("zh") ? UI["zh-TW"][k] : UI.en[k]) ?? UI["zh-TW"][k] ?? k;
const tm = (k) => (typeof t(k) === "object" ? t(k) : {});
const tx = (r, f) => (lang !== "zh-TW" && DATA.i18n[r.id]?.[lang]?.[f]) || r[f] || "";
const catName = (c) => tm("cat")[c] || c;
const typeName = (ty) => t("type." + ty);
let langNamer = null;
const langName = (code) => {
  try { langNamer ||= new Intl.DisplayNames([UI[lang]._html], { type: "language" }); return langNamer.of(code) || code; } catch { return code; }
};
const linkLabel = (l) => tm("link")[l] || l;
const fmt = (n) => { try { return Number(n).toLocaleString(UI[lang]._html); } catch { return String(n); } };

// ---------- Records & relations ----------
const records = DATA.records.map((r, i) => ({ ...r, rank: i + 1 }));
const byId = new Map(records.map((r) => [r.id, r]));
const latestDay = records.reduce((m, r) => ((r.added || "") > m ? r.added : m), "");
// Time ranges count back from the latest update day, not the viewer's clock, so
// "today" is never empty before the morning run. An entry's day is the later of
// when it was published and when the site found it.
const PERIODS = ["1", "7", "30", "all"];
const seenDay = (r) => ((r.date || "") > (r.added || "") ? r.date : r.added) || "";
const periodStart = (n) => { const d = new Date(latestDay + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - (n - 1)); return d.toISOString().slice(0, 10); };
const TYPE_COLOR = { case: "var(--s1)", app: "var(--s2)", learn: "var(--s3)", news: "var(--s3)" };

// Two entries are related when they share an author, a GitHub owner, or a named
// target (product words like "Wispr Flow" or "Obsidian" in the target field).
const STOP = new Set("rea ghidra claude code codex mcp app apps macos windows linux android ios javascript electron hopper ida cli api github rust python the and for with from agent agents opus sonnet grok chatgpt openai anthropic web json html css node npm sdk ai llm gpt dos pc x86 arm".split(" "));
const ownerOf = (u) => u.match(/^https:\/\/github\.com\/([\w.-]+)\//)?.[1]?.toLowerCase();
function relations() {
  const keys = new Map();
  const add = (k, r) => { if (!k) return; if (!keys.has(k)) keys.set(k, new Set()); keys.get(k).add(r.id); };
  for (const r of records) {
    add("a:" + (r.author || "").toLowerCase().replace(/^@/, "").replace(/\s*\(.*\)$/, "").trim(), r);
    for (const l of r.links) add("o:" + ownerOf(l.url + "/"), r);
    const words = `${r.target || ""} ${DATA.i18n[r.id]?.en?.target || ""}`.match(/[A-Za-z][A-Za-z0-9.+-]{2,}(?:\s[A-Z][A-Za-z0-9.+-]+)?/g) || [];
    for (const w of new Set(words.map((w) => w.toLowerCase()))) if (!STOP.has(w) && !STOP.has(w.split(" ")[0])) add("p:" + w, r);
  }
  const adj = new Map(records.map((r) => [r.id, new Map()]));
  for (const [k, ids] of keys) {
    if (ids.size < 2 || ids.size > 12 || k === "a:" || k === "o:undefined") continue;
    const list = [...ids];
    for (const a of list) for (const b of list) if (a !== b) adj.get(a).set(b, k.startsWith("p:") ? k.slice(2) : adj.get(a).get(b) || k.slice(2));
  }
  return adj;
}
const ADJ = relations();
const relatedOf = (r) => {
  const near = [...ADJ.get(r.id).keys()].map((id) => byId.get(id)).sort((a, b) => a.rank - b.rank);
  const fill = records.filter((x) => x.id !== r.id && x.category === r.category && !ADJ.get(r.id).has(x.id)).slice(0, 4 - Math.min(4, near.length));
  return [...near.slice(0, 4), ...fill].slice(0, 4).map((x) => ({ r: x, why: ADJ.get(r.id).get(x.id) }));
};

// ---------- Thumbnails ----------
const thumbSrc = (r) => (DATA.thumbs?.[r.id] ? DATA.thumbBase + DATA.thumbs[r.id] : null);
const phHTML = (r) => `<span class="thumb ph" aria-hidden="true"><span class="pt"><b>${esc(host(r.links[0].url).split(".").slice(-2, -1)[0] || "REA")}</b>${esc(catName(r.category))}</span></span>`;
const thumbHTML = (r, eager = false) => {
  const src = thumbSrc(r);
  return src ? `<span class="thumb" data-ph="${esc(r.id)}"><img src="${esc(src)}" alt="" loading="${eager ? "eager" : "lazy"}" decoding="async"></span>` : phHTML(r);
};
document.addEventListener("error", (e) => {
  const box = e.target.tagName === "IMG" && e.target.closest("[data-ph]");
  if (box) box.outerHTML = phHTML(byId.get(box.dataset.ph));
}, true);

// ---------- State (mirrored to the URL on GitHub Pages) ----------
const FACETS = ["cat", "via", "lang", "status", "source"];
const FIELD = { cat: "category", via: "via", lang: "lang", status: "status", source: "source" };
// min: lowest score shown. Default 2 hides one-line link shares and news;
// entries not scored yet always stay visible.
const DAYS = (DATA.history?.days || []).filter((d) => d.new?.length || d.text);
const dayIds = (date) => new Set(DAYS.find((d) => d.date === date)?.new || []);
const state = { day: null, period: "1", type: "all", q: "", sort: "rank", view: store.get("rea-view") || "list", id: null, tsort: null, min: 2, cat: null, via: null, lang: null, status: null, source: null };
if (!["list", "grid", "table", "timeline", "graph"].includes(state.view)) state.view = "list";
function readURL() {
  const p = new URLSearchParams(isPages ? location.search : "");
  for (const k of ["type", "q", "sort", "view", ...FACETS]) if (p.get(k)) state[k] = p.get(k);
  if (/^[1-5]$/.test(p.get("min") || "")) state.min = +p.get("min");
  if (/^\d{4}-\d{2}-\d{2}$/.test(p.get("day") || "")) state.day = p.get("day");
  if (PERIODS.includes(p.get("range"))) state.period = p.get("range");
  const h = location.hash.match(/^#r-([\w-]+)$/);
  state.id = (h && h[1]) || p.get("id") || null;
}
function writeURL() {
  const hash = state.id ? "#r-" + state.id : "";
  if (!isPages) { history.replaceState(null, "", location.pathname + location.search + hash); return; }
  const p = new URLSearchParams();
  for (const k of ["type", "q", "sort", "view", ...FACETS]) {
    const def = { type: "all", sort: "rank", view: "list" }[k];
    if (state[k] && state[k] !== def) p.set(k, state[k]);
  }
  if (state.min !== 2) p.set("min", state.min);
  if (state.day) p.set("day", state.day);
  if (state.period !== "1") p.set("range", state.period);
  const qs = p.toString();
  history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + hash);
}

const haystack = new Map();
const hay = (r) => {
  const k = r.id + lang;
  if (!haystack.has(k)) haystack.set(k, [tx(r, "title"), tx(r, "summary"), tx(r, "target"), tx(r, "metric"), r.title, r.target, r.original_title, r.author, catName(r.category), r.via].join(" \u0001 ").toLowerCase());
  return haystack.get(k);
};
let dayCache = [null, new Set()];
function matches(r, skip) {
  if (state.day) { if (dayCache[0] !== state.day) dayCache = [state.day, dayIds(state.day)]; if (!dayCache[1].has(r.id)) return false; }
  if (!state.day && skip !== "period" && state.period !== "all" && seenDay(r) < periodStart(+state.period)) return false;
  if (skip !== "min" && r.wow != null && r.wow < state.min) return false;
  if (skip !== "type" && state.type !== "all" && r.type !== state.type) return false;
  for (const f of FACETS) if (skip !== f && state[f] && r[FIELD[f]] !== state[f]) return false;
  const q = state.q.trim().toLowerCase();
  return !q || q.split(/\s+/).every((w) => hay(r).includes(w));
}
function filtered() {
  const list = records.filter((r) => matches(r));
  const by = state.sort;
  if (by === "new") list.sort((a, b) => (b.date || b.added || "").localeCompare(a.date || a.added || "") || a.rank - b.rank);
  if (by === "heat") list.sort((a, b) => (b.heat || 0) - (a.heat || 0) || a.rank - b.rank);
  if (state.view === "table" && state.tsort) {
    const [col, dir] = state.tsort;
    const val = { rank: (r) => r.rank, wow: (r) => -(r.wow ?? 0), heat: (r) => -(r.heat || 0), title: (r) => tx(r, "title"), type: (r) => typeName(r.type), via: (r) => r.via, lang: (r) => r.lang, date: (r) => r.date || r.added || "" }[col];
    list.sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : a.rank - b.rank) * dir; });
  }
  return list;
}

// ---------- Small renderers ----------
const wowBar = (w) => (w == null ? `<span class="tag">${esc(t("row.unscored"))}</span>`
  : `<span class="wow" title="${esc(t("score"))} ${w}/5" aria-label="${esc(t("score"))} ${w}/5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= w ? "f" : ""}"></i>`).join("")}<span>${w}/5</span></span>`);
const heatBar = (h) => `<span class="heat" title="${esc(t("heat.label"))} ${h}/100" aria-label="${esc(t("heat.label"))} ${h}/100"><span class="ht"><span class="hf" style="width:${h}%"></span></span>${h}</span>`;
const pill = (s) => (s ? `<span class="pill ${esc(s)}">${esc(t("status." + s))}</span>` : "");
const isNew = (r) => r.added === latestDay && r.source === "auto";

// ---------- Hero ----------
const ASM = [
  ["00401A30", "55", "push", "ebp", "", 0], ["00401A31", "8B EC", "mov", "ebp, esp", "", 0],
  ["00401A33", "8B 45 08", "mov", "eax, [ebp+8]", "; x", 2], ["00401A36", "69 C0 C8 00 00 00", "imul", "eax, eax, 200", "", 2],
  ["00401A3C", "99", "cdq", "", "", 2], ["00401A3D", "B9 7F 02 00 00", "mov", "ecx, 639", "", 2],
  ["00401A42", "F7 F9", "idiv", "ecx", "", 2], ["00401A44", "83 E8 64", "sub", "eax, 100", "", 2],
  ["00401A47", "5D", "pop", "ebp", "", 3], ["00401A48", "C3", "ret", "", "", 3],
];
$("#asm").innerHTML = ASM.map(([a, b, o, r, c]) => `<div><span class="a">${a}</span>  <span class="b">${b.padEnd(18)}</span><span class="o">${o.padEnd(6)}</span>${r.padEnd(14)}<span class="c">${c}</span></div>`).join("");
$("#csrc").innerHTML = [
  `<span class="k">int</span> pan_from_x(<span class="k">int</span> x)   <span class="c">// x: 0‥639</span>`, `{`,
  `    <span class="k">return</span> x * <span class="n">200</span> / <span class="n">639</span> - <span class="n">100</span>;  <span class="c">// -100‥100</span>`, `}`,
].map((l) => `<div>${l}</div>`).join("");
if (!reduceMotion) {
  const a = [...$("#asm").children], c = [...$("#csrc").children];
  let i = 0;
  setInterval(() => {
    if (document.hidden) return;
    a.forEach((el, j) => el.classList.toggle("on", j === i));
    c.forEach((el, j) => el.classList.toggle("on", j === ASM[i][5]));
    i = (i + 1) % ASM.length;
  }, 900);
}

// ---------- Facets (rail) ----------
const expanded = new Set();
function renderMin() {
  const n = (k) => records.filter((r) => matches(r, "min") && (r.wow == null || r.wow >= k)).length;
  return `<div class="facet"><h3><span>${esc(t("f.min"))}</span></h3><div class="minseg" role="group">${[1, 2, 3, 4, 5].map((k) => `<button type="button" data-min="${k}" aria-pressed="${state.min === k}" title="${n(k)}">${k}${k < 5 ? "+" : ""}<small>${n(k)}</small></button>`).join("")}</div></div>`;
}
function renderFacets() {
  const groups = [["cat", "f.cat", catName], ["via", "f.via", (v) => v], ["lang", "f.lang", langName], ["status", "f.status", (v) => t("status." + v)], ["source", "f.src", (v) => t("src." + v)]];
  $("#facets").innerHTML = renderMin() + groups.map(([key, label, name]) => {
    const m = new Map();
    records.filter((r) => matches(r, key)).forEach((r) => { const v = r[FIELD[key]]; if (v) m.set(v, (m.get(v) || 0) + 1); });
    if (state[key] && !m.has(state[key])) m.set(state[key], 0);
    const entries = [...m].sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...entries.map(([, n]) => n));
    const limit = expanded.has(key) ? 99 : 6;
    const shown = entries.slice(0, limit);
    if (state[key] && !shown.some(([v]) => v === state[key])) shown.push(entries.find(([v]) => v === state[key]));
    return `<div class="facet"><h3><span>${esc(t(label))}</span>${state[key] ? `<button type="button" data-clear="${key}">${esc(t("f.all"))}</button>` : ""}</h3>
      ${shown.map(([v, n]) => `<button class="fopt${n ? "" : " zero"}" type="button" data-k="${key}" data-v="${esc(v)}" aria-pressed="${state[key] === v}">
        <span class="fl">${key === "cat" ? `<span class="dot-type" style="background:${TYPE_COLOR[({ 工具鏈: "app", 教學: "learn", "報導 / 評論": "news" })[v] || "case"]}"></span>` : ""}${esc(name(v))}</span><span class="fn">${n}</span><span class="fb"><i style="width:${(n / max) * 100}%"></i></span></button>`).join("")}
      ${entries.length > 6 ? `<button class="fmore" type="button" data-more="${key}">${esc(t(expanded.has(key) ? "f.less" : "f.more"))}</button>` : ""}</div>`;
  }).join("");
}
$("#facets").addEventListener("click", (e) => {
  const mn = e.target.closest("[data-min]");
  if (mn) { state.min = +mn.dataset.min; update(); return; }
  const o = e.target.closest("[data-k]"), c = e.target.closest("[data-clear]"), m = e.target.closest("[data-more]");
  if (o) { state[o.dataset.k] = state[o.dataset.k] === o.dataset.v ? null : o.dataset.v; update(); }
  if (c) { state[c.dataset.clear] = null; update(); }
  if (m) { expanded.has(m.dataset.more) ? expanded.delete(m.dataset.more) : expanded.add(m.dataset.more); renderFacets(); }
});

function renderPeriods() {
  const n = (k) => records.filter((r) => matches(r, "period") && (k === "all" || seenDay(r) >= periodStart(+k))).length;
  $("#periods").innerHTML = PERIODS.map((k) => `<button class="tab" type="button" data-p="${k}" aria-pressed="${!state.day && state.period === k}" title="${k === "all" ? "" : esc(periodStart(+k) + " – " + latestDay)}">${esc(t("range." + k))}<span class="k">${n(k)}</span></button>`).join("");
}
$("#periods").addEventListener("click", (e) => { const b = e.target.closest("[data-p]"); if (b) { state.period = b.dataset.p; state.day = null; update(); } });

function renderTabs() {
  const counts = { all: 0 };
  records.filter((r) => matches(r, "type")).forEach((r) => { counts.all++; counts[r.type] = (counts[r.type] || 0) + 1; });
  $("#tabs").innerHTML = ["all", "case", "app", "learn", "news"].map((k) =>
    `<button class="tab" role="tab" type="button" data-t="${k}" aria-selected="${state.type === k}">${k !== "all" ? `<span class="dot-type" style="background:${TYPE_COLOR[k]}"></span>` : ""}${esc(typeName(k))}<span class="k">${counts[k] || 0}</span></button>`).join("");
}
$("#tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b) { state.type = b.dataset.t; update(); } });

function renderActive() {
  const chips = [];
  if (state.q) chips.push(["q", `“${state.q}”`]);
  const names = { cat: catName, via: (v) => v, lang: langName, status: (v) => t("status." + v), source: (v) => t("src." + v) };
  for (const f of FACETS) if (state[f]) chips.push([f, names[f](state[f])]);
  if (state.min !== 2) chips.push(["min", `${t("score")} ≥ ${state.min}`]);
  if (state.day) chips.push(["day", state.day]);
  $("#active").innerHTML = chips.length ? chips.map(([k, v]) => `<button class="afchip" type="button" data-rm="${k}">${esc(v)}<span aria-hidden="true">×</span></button>`).join("") + `<button class="afclear" type="button" data-rm="all">${esc(t("f.clear"))}</button>` : "";
}
$("#active").addEventListener("click", (e) => {
  const b = e.target.closest("[data-rm]"); if (!b) return;
  if (b.dataset.rm === "all") { for (const f of FACETS) state[f] = null; state.q = ""; state.type = "all"; state.min = 2; state.day = null; $("#q").value = ""; }
  else if (b.dataset.rm === "min") state.min = 2;
  else if (b.dataset.rm === "day") state.day = null;
  else if (b.dataset.rm === "q") { state.q = ""; $("#q").value = ""; }
  else state[b.dataset.rm] = null;
  update();
});

// ---------- Views ----------
let current = [];
function renderResults() {
  current = filtered();
  $("#count").innerHTML = `<bdi dir="ltr">${current.length} / ${records.length}</bdi>`;
  $$("#views button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === state.view)));
  const box = $("#results");
  if (!current.length) { box.innerHTML = `<p class="empty">${esc(t("empty"))}</p>`; return; }
  if (state.view === "grid") box.innerHTML = `<div class="gallery">${current.map((r) => `<button class="gcard" type="button" data-row="${esc(r.id)}" aria-current="${state.id === r.id}">
      ${thumbHTML(r)}<span class="gb"><span class="gm"><span class="grk">#${r.rank}</span>${wowBar(r.wow)}</span>
      <h3>${esc(tx(r, "title"))}</h3>
      <span class="gm"><span class="tags"><span class="dot-type" style="background:${TYPE_COLOR[r.type]}"></span><span class="tag">${esc(catName(r.category))}</span></span>${heatBar(r.heat || 0)}</span></span></button>`).join("")}</div>`;
  else if (state.view === "table") {
    const cols = [["rank", "#"], ["wow", t("score")], ["heat", t("heat.label")], ["title", t("new.th.title")], ["type", t("f.type")], ["via", t("f.via")], ["lang", t("f.lang")], ["date", t("d.date")]];
    const [sc, sd] = state.tsort || [];
    box.innerHTML = `<div class="dtable-wrap" data-scroll-x><table class="dtable"><thead><tr>${cols.map(([k, l]) => `<th${sc === k ? ` aria-sort="${sd > 0 ? "ascending" : "descending"}"` : ""}><button type="button" data-sort="${k}">${esc(l)}${sc === k ? (sd > 0 ? " ↑" : " ↓") : ""}</button></th>`).join("")}</tr></thead><tbody>
      ${current.map((r) => `<tr data-row="${esc(r.id)}" aria-current="${state.id === r.id}"><td class="n">${r.rank}</td><td class="n">${r.wow ?? "—"}</td><td class="n">${r.heat || 0}</td><td class="ti">${esc(tx(r, "title"))}${isNew(r) ? ` <span class="new">${esc(t("new.badge"))}</span>` : ""}</td><td class="n"><span class="dot-type" style="background:${TYPE_COLOR[r.type]}"></span> ${esc(typeName(r.type))}</td><td class="n">${esc(r.via)}</td><td class="n">${esc(r.lang)}</td><td class="n">${esc(r.date || r.added || "")}</td></tr>`).join("")}
      </tbody></table></div>`;
  } else if (state.view === "timeline") renderTimeline(box);
  else if (state.view === "graph") renderGraph(box);
  else box.innerHTML = `<ol class="rows">${current.map((r) => {
    const main = r.links[0], metric = tx(r, "metric"), summary = tx(r, "summary");
    return `<li class="row" data-row="${esc(r.id)}" aria-current="${state.id === r.id}">
      <div class="rk${r.rank <= 3 ? " top3" : ""}">${r.rank}${isNew(r) ? `<small><span class="new">${esc(t("new.badge"))}</span></small>` : ""}</div>
      ${thumbHTML(r)}
      <div class="main">
        <h3><span class="rkm mono">#${r.rank} · </span><a href="${esc(safe(main.url))}" target="_blank" rel="noopener noreferrer">${esc(tx(r, "title"))}</a> <span class="ext">${esc(host(main.url))} ↗</span></h3>
        ${metric ? `<div class="metric"><span class="sel">${esc(metric)}</span></div>` : ""}
        ${summary ? `<p class="sum">${esc(summary)}</p>` : ""}
        <div class="meta">${r.author ? `<span class="who">${esc(r.author)}</span>` : ""}${wowBar(r.wow)}${heatBar(r.heat || 0)}${pill(r.status)}<span class="tags"><span class="dot-type" style="background:${TYPE_COLOR[r.type]}"></span><span class="tag">${esc(catName(r.category))}</span><span class="tag lang">${esc(r.lang)}</span></span></div>
      </div></li>`;
  }).join("")}</ol>`;
}
$("#results").addEventListener("click", (e) => {
  const s = e.target.closest("[data-sort]");
  if (s) { const k = s.dataset.sort; state.tsort = state.tsort?.[0] === k ? [k, -state.tsort[1]] : [k, 1]; renderResults(); return; }
  if (e.target.closest("a")) return;
  const row = e.target.closest("[data-row]");
  if (row) select(row.dataset.row, true);
});
$("#views").addEventListener("click", (e) => {
  const b = e.target.closest("[data-view]"); if (!b) return;
  state.view = b.dataset.view; store.set("rea-view", state.view);
  renderResults(); writeURL();
});
$("#sort").addEventListener("change", (e) => { state.sort = e.target.value; state.tsort = null; renderResults(); writeURL(); });
let qTimer;
$("#q").addEventListener("input", (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = e.target.value; update(); }, 90); });

// ---------- Timeline (bubble) ----------
const svgEl = (w, h) => `<svg viewBox="0 0 ${w} ${h}" height="${h}" role="img">`;
const hash01 = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return ((h >>> 0) % 1000) / 1000; };
const R = (h) => 4 + Math.sqrt(h || 0) * 1.05;
function vizHead(title, extra = "") {
  return `<div class="viz-head"><b style="color:var(--ink)">${esc(title)}</b><div class="legend-row">${["case", "app"].map((k) => `<span><i class="dot-type" style="background:${TYPE_COLOR[k]}"></i>${esc(typeName(k))}</span>`).join("")}<span><i class="dot-type" style="background:var(--s3)"></i>${esc(typeName("learn"))} / ${esc(typeName("news"))}</span><span>${esc(t("viz.size"))}</span>${extra}</div></div>`;
}
function renderTimeline(box) {
  const W = Math.max(320, box.clientWidth - 26), H = W < 560 ? 320 : 440, m = { l: 30, r: 12, t: 12, b: 26 };
  const pts = current.filter((r) => r.wow != null && (r.date || r.added));
  const day = (r) => Date.parse(r.date || r.added);
  const xs = pts.map(day);
  const x0 = Math.min(...xs) - 432e5, x1 = Math.max(...xs) + 432e5;
  const X = (v) => m.l + ((v - x0) / Math.max(1, x1 - x0)) * (W - m.l - m.r);
  const lo = state.min, bands = 6 - lo, band = (H - m.t - m.b) / bands;
  let g = "";
  for (let w = lo; w <= 5; w++) { const y = m.t + (5 - w) * band + band / 2; g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" stroke="var(--grid)"/><text x="${m.l - 8}" y="${y + 3.5}" text-anchor="end">${w}</text>`; }
  const days = Math.round((x1 - x0) / 864e5), stepD = Math.max(1, Math.ceil(days / Math.max(2, Math.floor((W - m.l - m.r) / 58))));
  for (let d = Math.ceil(x0 / 864e5) * 864e5, i = 0; d <= x1; d += 864e5, i++) if (!(i % stepD)) g += `<text x="${X(d)}" y="${H - 6}" text-anchor="middle">${new Date(d).toISOString().slice(5, 10)}</text>`;
  g += `<line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}" stroke="var(--axis)"/>`;
  const dots = [...pts].sort((a, b) => (b.heat || 0) - (a.heat || 0)).map((r) => {
    const cx = X(day(r) + (hash01(r.id + "x") - 0.5) * 864e5 * 0.7), cy = m.t + (5 - r.wow) * band + band / 2 + (hash01(r.id) - 0.5) * band * 0.72;
    return `<g class="dot${state.id === r.id ? " cur" : ""}" data-row="${esc(r.id)}" tabindex="0" role="button" aria-label="${esc(tx(r, "title"))}"><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(R(r.heat) + 6).toFixed(1)}" fill="transparent"/><circle class="v" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${R(r.heat).toFixed(1)}" fill="${TYPE_COLOR[r.type]}" fill-opacity=".85"/></g>`;
  }).join("");
  box.innerHTML = `<div class="viz" id="timeline">${vizHead(t("viz.timeline"))}${svgEl(W, H)}${g}${dots}</svg><div class="viz-foot"><span>${esc(t("viz.axes"))}</span><span>${esc(t("viz.unscored").replace("{n}", current.length - pts.length))}</span></div></div>`;
}

// ---------- Node graph (d3-force) ----------
const layoutCache = new Map();
let zoomBehavior = null;
function renderGraph(box) {
  if (!window.d3) { box.innerHTML = `<p class="empty">${esc(t("viz.nod3"))}</p>`; return; }
  const W = Math.max(320, box.clientWidth - 26), H = W < 560 ? 480 : 640;
  const ids = new Set(current.map((r) => r.id));
  const cats = [...new Set(current.map((r) => r.category))];
  const key = W + "|" + [...ids].sort().join(",");
  let nodes, links;
  if (layoutCache.has(key)) ({ nodes, links } = layoutCache.get(key));
  else {
    nodes = [...cats.map((c) => ({ id: "hub:" + c, hub: true, label: c, r: 7 })), ...current.map((r) => ({ id: r.id, r: R(r.heat) * 0.9 }))];
    links = current.map((r) => ({ source: r.id, target: "hub:" + r.category, kind: "hub" }));
    const seen = new Set();
    for (const r of current) for (const [o, why] of ADJ.get(r.id)) {
      if (!ids.has(o)) continue;
      const k = [r.id, o].sort().join("|");
      if (seen.has(k)) continue;
      seen.add(k); links.push({ source: r.id, target: o, kind: "rel", why });
    }
    const sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id((d) => d.id).distance((l) => (l.kind === "hub" ? 46 : 34)).strength((l) => (l.kind === "hub" ? 0.5 : 0.25)))
      .force("charge", d3.forceManyBody().strength((d) => (d.hub ? -340 : -42)))
      .force("collide", d3.forceCollide((d) => d.r + 3))
      .force("x", d3.forceX(W / 2).strength(0.05)).force("y", d3.forceY(H / 2).strength(0.07))
      .stop();
    for (let i = 0; i < 320; i++) sim.tick();
    layoutCache.set(key, { nodes, links });
  }
  const ex = d3.extent(nodes, (d) => d.x), ey = d3.extent(nodes, (d) => d.y);
  const pad = 40, s = Math.min((W - pad * 2) / Math.max(1, ex[1] - ex[0]), (H - pad * 2) / Math.max(1, ey[1] - ey[0]), 1.6);
  const fit = d3.zoomIdentity.translate(W / 2 - s * (ex[0] + ex[1]) / 2, H / 2 - s * (ey[0] + ey[1]) / 2).scale(s);
  const labelled = new Set(current.slice(0, W < 560 ? 5 : 10).map((r) => r.id));
  const L = (l) => `<line class="e${l.kind === "rel" ? " rel" : ""}" data-a="${esc(l.source.id)}" data-b="${esc(l.target.id)}" x1="${l.source.x.toFixed(1)}" y1="${l.source.y.toFixed(1)}" x2="${l.target.x.toFixed(1)}" y2="${l.target.y.toFixed(1)}"/>`;
  const N = (d) => {
    if (d.hub) return `<g class="hub" transform="translate(${d.x.toFixed(1)},${d.y.toFixed(1)})"><circle r="7"/><text y="-12" text-anchor="middle">${esc(catName(d.label))}</text></g>`;
    const r = byId.get(d.id);
    const label = labelled.has(r.id) || state.id === r.id ? `<text y="${(d.r + 11).toFixed(1)}" text-anchor="middle">${esc(tx(r, "title").slice(0, 16))}${tx(r, "title").length > 16 ? "…" : ""}</text>` : "";
    return `<g class="node${state.id === r.id ? " cur" : ""}" data-row="${esc(r.id)}" tabindex="0" role="button" aria-label="${esc(tx(r, "title"))}" transform="translate(${d.x.toFixed(1)},${d.y.toFixed(1)})"><circle r="${d.r.toFixed(1)}" fill="${TYPE_COLOR[r.type]}" fill-opacity=".9"/>${label}</g>`;
  };
  const rels = links.filter((l) => l.kind === "rel").length;
  box.innerHTML = `<div class="viz" id="graph">${vizHead(t("viz.graph"), `<span><i style="width:16px;border-top:2px dashed var(--s2);display:inline-block"></i>${esc(t("viz.rel"))}</span>`)}
    ${svgEl(W, H)}<g class="zoomed" transform="${fit}">${links.map(L).join("")}${nodes.map(N).join("")}</g></svg>
    <div class="viz-foot"><span>${esc(t("viz.graphHint").replace("{n}", rels))}</span><span class="zoom"><button type="button" data-z="in" aria-label="Zoom in">+</button><button type="button" data-z="out" aria-label="Zoom out">−</button><button type="button" data-z="fit" aria-label="Fit">⤢</button></span></div></div>`;
  const svg = d3.select("#graph svg"), g = svg.select("g.zoomed");
  zoomBehavior = d3.zoom().scaleExtent([0.3, 6]).on("zoom", (ev) => g.attr("transform", ev.transform));
  svg.call(zoomBehavior).call(zoomBehavior.transform, fit).on("dblclick.zoom", null);
  $("#graph .zoom").onclick = (e) => {
    const z = e.target.closest("[data-z]")?.dataset.z; if (!z) return;
    if (z === "fit") svg.transition().duration(300).call(zoomBehavior.transform, fit);
    else svg.transition().duration(200).call(zoomBehavior.scaleBy, z === "in" ? 1.4 : 1 / 1.4);
  };
}
function focusNeighbors(id) {
  const g = $("#graph"); if (!g) return;
  if (!id) { $$(".node,.hub,line.e", g).forEach((el) => el.classList.remove("dim", "hot")); return; }
  const keep = new Set([id, ...(ADJ.get(id)?.keys() || []), "hub:" + byId.get(id).category]);
  $$(".node", g).forEach((el) => el.classList.toggle("dim", !keep.has(el.dataset.row)));
  $$("line.e", g).forEach((el) => { const on = el.dataset.a === id || el.dataset.b === id; el.classList.toggle("hot", on); el.classList.toggle("dim", !on); });
}

// Hover tooltips for both visualizations.
const tip = $("#tip");
function showTip(r, x, y) {
  tip.innerHTML = `${thumbHTML(r, true)}<div class="tb"><b>#${r.rank} · ${esc(tx(r, "title"))}</b><span class="tm">${esc(t("score"))} ${r.wow ?? "—"}/5 · ${esc(t("heat.label"))} ${r.heat || 0} · ${esc(r.via)}</span><span class="tm">${esc(r.author || "")}</span></div>`;
  const w = 270, h = tip.offsetHeight || 220;
  tip.style.left = Math.min(innerWidth - w - 12, Math.max(12, x + 16)) + "px";
  tip.style.top = (y + h + 24 > innerHeight ? Math.max(12, y - h - 12) : y + 16) + "px";
  tip.classList.add("on");
}
const hideTip = () => tip.classList.remove("on");
$("#results").addEventListener("pointermove", (e) => {
  if (e.pointerType === "touch") return;
  const d = e.target.closest(".dot,.node");
  if (!d) { hideTip(); if (state.view === "graph") focusNeighbors(null); return; }
  showTip(byId.get(d.dataset.row), e.clientX, e.clientY);
  if (state.view === "graph") focusNeighbors(d.dataset.row);
});
$("#results").addEventListener("pointerleave", () => { hideTip(); focusNeighbors(null); });
$("#results").addEventListener("keydown", (e) => { const d = e.target.closest(".dot,.node"); if (d && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); select(d.dataset.row, true); } });
let rz;
new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(() => { if (state.view === "timeline" || state.view === "graph") renderResults(); }, 150); }).observe($(".center"));

// ---------- Detail pane / drawer ----------
const narrow = () => matchMedia("(max-width: 1100px)").matches;
function popText(pop = {}) {
  return Object.entries(pop).filter(([, n]) => n).map(([k, n]) => t("pop." + k).replace("{n}", fmt(n))).join(" · ") || "—";
}
function renderDetail() {
  const r = byId.get(state.id) || current[0];
  if (!r) { $("#detail").innerHTML = `<p class="empty">${esc(t("empty"))}</p>`; return; }
  const idx = current.findIndex((x) => x.id === r.id);
  const summary = tx(r, "summary"), metric = tx(r, "metric"), target = tx(r, "target");
  $("#detail").innerHTML = `
    <div class="dt-nav">
      <button class="ibtn" type="button" data-step="-1" ${idx <= 0 ? "disabled" : ""} aria-label="${esc(t("d.prev"))}">↑ <kbd>K</kbd></button>
      <button class="ibtn" type="button" data-step="1" ${idx < 0 || idx >= current.length - 1 ? "disabled" : ""} aria-label="${esc(t("d.next"))}">↓ <kbd>J</kbd></button>
      <span class="sp"><bdi dir="ltr">${idx >= 0 ? `${idx + 1} / ${current.length}` : ""}</bdi></span>
      <button class="ibtn only-drawer" type="button" data-close aria-label="${esc(t("d.close"))}">✕</button>
    </div>
    ${thumbHTML(r, true)}
    <div class="dt-rank"><span class="big">#${r.rank}</span>${wowBar(r.wow)}${heatBar(r.heat || 0)}${pill(r.status)}</div>
    <h2>${esc(tx(r, "title"))}</h2>
    ${r.original_title && r.original_title !== r.title ? `<div class="orig">${esc(t("row.orig"))}: ${esc(r.original_title)}</div>` : ""}
    <div class="dt-links">${r.links.map((l, i) => `<a href="${esc(safe(l.url))}" target="_blank" rel="noopener noreferrer">${esc(i === 0 ? t("d.open") + " · " + linkLabel(l.label) : linkLabel(l.label))} ↗<span>${esc(host(l.url))}</span></a>`).join("")}</div>
    ${metric ? `<div class="dt-sec"><h4>${esc(t("d.metric"))}</h4><p><span class="sel mono" style="font-size:12.5px">${esc(metric)}</span></p></div>` : ""}
    ${summary ? `<div class="dt-sec"><h4>${esc(t("d.summary"))}</h4><p>${esc(summary)}</p></div>` : ""}
    <div class="dt-grid">
      ${target ? `<div><span class="k">${esc(t("row.target"))}</span><span class="v">${esc(target)}</span></div>` : ""}
      <div><span class="k">${esc(t("d.author"))}</span><span class="v">${r.author_url ? `<a href="${esc(safe(r.author_url))}" target="_blank" rel="noopener noreferrer">${esc(r.author || "—")}</a>` : esc(r.author || "—")}</span></div>
      <div><span class="k">${esc(t("f.type"))}</span><span class="v">${esc(typeName(r.type))} · ${esc(catName(r.category))}</span></div>
      <div><span class="k">${esc(t("d.date"))}</span><span class="v mono">${esc(r.date || "—")}</span></div>
      <div><span class="k">${esc(t("d.pop"))}</span><span class="v">${esc(popText(r.pop))}</span></div>
      <div><span class="k">${esc(t("f.src"))}</span><span class="v">${esc(t("src." + r.source))} · ${esc(r.via)} · ${esc(langName(r.lang))}</span></div>
    </div>
    <div class="dt-sec"><h4>${esc(t("d.related"))}</h4><div class="related">${relatedOf(r).map(({ r: x, why }) => `<button type="button" data-go="${esc(x.id)}">${thumbHTML(x)}<span><b>${esc(tx(x, "title"))}</b><small>#${x.rank}${why ? " · " + esc(why) : " · " + esc(catName(x.category))}</small></span></button>`).join("")}</div></div>`;
  $("#detail-wrap").scrollTop = 0;
}
$("#detail").addEventListener("click", (e) => {
  const s = e.target.closest("[data-step]"), g = e.target.closest("[data-go]");
  if (s) move(+s.dataset.step);
  if (g) select(g.dataset.go, true);
  if (e.target.closest("[data-close]")) closeDrawer();
});
function markCurrent() {
  $$("[data-row]").forEach((el) => {
    const on = el.dataset.row === state.id;
    if (el.matches(".dot,.node")) el.classList.toggle("cur", on); else el.setAttribute("aria-current", String(on));
  });
}
function select(id, fromUser) {
  if (!byId.has(id)) return;
  state.id = id;
  renderDetail(); markCurrent(); writeURL();
  if (fromUser && narrow()) openDrawer();
  if (fromUser) {
    const el = $(`.row[data-row="${CSS.escape(id)}"], .gcard[data-row="${CSS.escape(id)}"], tr[data-row="${CSS.escape(id)}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  }
}
function move(d) {
  const i = current.findIndex((x) => x.id === state.id);
  const n = current[Math.max(0, Math.min(current.length - 1, (i < 0 ? -1 : i) + d))];
  if (n) select(n.id, true);
}
function openDrawer() { $("#detail-wrap").classList.add("on"); $("#scrim").classList.add("on"); }
function closeDrawer() { $("#detail-wrap").classList.remove("on"); if (!$("#pal").classList.contains("on") && !$("#rail").classList.contains("on")) $("#scrim").classList.remove("on"); }

// ---------- Mobile filter sheet ----------
$("#open-rail").addEventListener("click", () => { $("#rail").classList.add("on"); $("#scrim").classList.add("on"); });
const closeRail = () => { $("#rail").classList.remove("on"); if (!$("#detail-wrap").classList.contains("on")) $("#scrim").classList.remove("on"); };
$("#rail-done").addEventListener("click", closeRail);
$("#scrim").addEventListener("click", () => { closeDrawer(); closeRail(); closePal(); });

// ---------- ⌘K palette ----------
let palSel = 0, palItems = [];
function openPal() { $("#pal").classList.add("on"); $("#scrim").classList.add("on"); $("#pal-q").value = ""; palSel = 0; renderPal(); $("#pal-q").focus(); }
function closePal() { if (!$("#pal").classList.contains("on")) return; $("#pal").classList.remove("on"); if (!$("#detail-wrap").classList.contains("on") && !$("#rail").classList.contains("on")) $("#scrim").classList.remove("on"); }
function renderPal() {
  const q = $("#pal-q").value.trim().toLowerCase();
  palItems = (q ? records.filter((r) => q.split(/\s+/).every((w) => hay(r).includes(w))) : records).slice(0, 9);
  palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
  $("#pal-list").innerHTML = palItems.map((r, i) => `<li role="option" data-i="${i}" aria-selected="${i === palSel}">${thumbHTML(r)}<span style="min-width:0"><b>${esc(tx(r, "title"))}</b><small>${esc(r.author || r.via)} · ${esc(catName(r.category))}</small></span><span class="pr">#${r.rank}</span></li>`).join("") || `<li style="display:block;color:var(--muted)">${esc(t("empty"))}</li>`;
}
const palGo = (r, openSource) => { closePal(); if (openSource) window.open(safe(r.links[0].url), "_blank", "noopener"); else { reveal(r.id); } };
function reveal(id) {
  if (!current.some((x) => x.id === id)) { for (const f of FACETS) state[f] = null; state.q = ""; state.type = "all"; if ((byId.get(id).wow ?? 5) < state.min) state.min = 1; $("#q").value = ""; update(); }
  select(id, true);
  if (!narrow()) $("#explore").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
}
$("#pal-q").addEventListener("input", () => { palSel = 0; renderPal(); });
$("#pal-list").addEventListener("click", (e) => { const li = e.target.closest("[data-i]"); if (li) palGo(palItems[+li.dataset.i], e.metaKey || e.ctrlKey); });
$("#pal").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); palSel = (palSel + (e.key === "ArrowDown" ? 1 : -1) + palItems.length) % Math.max(1, palItems.length); renderPal(); $("#pal-list [aria-selected=true]")?.scrollIntoView({ block: "nearest" }); }
  if (e.key === "Enter" && palItems[palSel]) { e.preventDefault(); palGo(palItems[palSel], e.metaKey || e.ctrlKey); }
});
$("#open-pal").addEventListener("click", openPal);

// ---------- Keyboard ----------
document.addEventListener("keydown", (e) => {
  const typing = /input|textarea|select/i.test(document.activeElement?.tagName || "");
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#pal").classList.contains("on") ? closePal() : openPal(); return; }
  if (e.key === "Escape") { if ($("#pal").classList.contains("on")) closePal(); else { closeDrawer(); closeRail(); } return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "/") { e.preventDefault(); if (narrow() && matchMedia("(max-width: 860px)").matches) $("#open-rail").click(); $("#q").focus(); return; }
  if (e.key === "j") { e.preventDefault(); move(1); }
  if (e.key === "k") { e.preventDefault(); move(-1); }
  if (e.key === "o" && state.id) window.open(safe(byId.get(state.id).links[0].url), "_blank", "noopener");
  const v = { 1: "list", 2: "grid", 3: "table", 4: "timeline", 5: "graph" }[e.key];
  if (v) { state.view = v; store.set("rea-view", v); renderResults(); writeURL(); }
});

// ---------- Highlights, latest, about ----------
function renderStatic() {
  const stars = DATA.repo?.stars;
  $("#stats").innerHTML = [
    [records.length, t("stat.ranked")],
    [records.filter((r) => r.wow === 5).length, t("stat.top")],
    [records.filter((r) => r.type === "app").length, t("stat.apps")],
    [new Set(records.map((r) => r.lang)).size, t("stat.langs")],
    [stars ? Math.round(stars / 1000) + "k" : "—", t("stat.stars")],
  ].map(([n, l]) => `<li><span class="n">${n}</span><span class="l">${esc(l)}</span></li>`).join("");
  $("#highlights").innerHTML = records.filter((r) => r.wow === 5).slice(0, 6).map((r, i) => `<button class="hcard" type="button" data-go="${esc(r.id)}">
    <span class="rkb">#${r.rank}</span>${thumbHTML(r, i < 3)}
    <span class="hb"><span class="eyebrow">${esc(catName(r.category))}</span><h3>${esc(tx(r, "title"))}</h3><span class="metric"><span class="sel">${esc(tx(r, "metric"))}</span></span></span></button>`).join("");
  renderDays();
  $("#scan").textContent = t("new.scan").replace("{d}", DATA.scanned || DATA.updated);
  $("#rubric").innerHTML = [5, 4, 3, 2, 1].map((n) => `<li>${wowBar(n)}<span>${esc(t("rubric." + n))}</span></li>`).join("");
  const base = DATA.site?.url || "https://miles990.github.io/rea-awesome/";
  $("#agent-code").textContent = `GET ${base}api/records.json\nGET ${base}llms.txt\nGET ${base}feed.xml\n${base}?q=firmware&type=case&view=graph#r-zwo-asiair`;
  $("#updated").textContent = DATA.updated;
  // On GitHub Pages the site root is wherever the Traditional Chinese page lives.
  $("#api-link").href = (isPages ? DATA.pages["zh-TW"] : base) + "api/records.json";
}
document.addEventListener("click", (e) => { const g = e.target.closest(".hcard[data-go], .lcard[data-go], .day-hl [data-go]"); if (g) reveal(g.dataset.go); });

// ---------- Daily context ----------
let daysShown = 7;
const dayText = (d) => d.text?.[lang] || d.text?.["zh-TW"] || null;
function sparkStars() {
  const pts = DAYS.filter((d) => d.stars).map((d) => [d.date, d.stars]);
  const svg = $("#spark-stars");
  if (pts.length < 2) { svg.innerHTML = ""; return; }
  const W = svg.clientWidth || 400, H = 96, m = { l: 6, r: 52, t: 14, b: 16 };
  const t0 = Date.parse(pts[0][0]), t1 = Date.parse(pts.at(-1)[0]), max = Math.max(...pts.map((p) => p[1]));
  const X = (d) => m.l + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (W - m.l - m.r), Y = (v) => H - m.b - (v / max) * (H - m.t - m.b);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = `<line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}" stroke="var(--axis)"/>
    <polyline fill="none" stroke="var(--bar)" stroke-width="2" stroke-linejoin="round" points="${pts.map(([d, v]) => `${X(d).toFixed(1)},${Y(v).toFixed(1)}`).join(" ")}"/>
    ${pts.map(([d, v]) => `<circle cx="${X(d).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="3" fill="var(--bar)"><title>${d} · ${fmt(v)}</title></circle>`).join("")}
    <text class="lbl" x="${X(pts.at(-1)[0]) + 6}" y="${Y(pts.at(-1)[1]) + 4}">${Math.round(pts.at(-1)[1] / 1000)}k</text>
    <text x="${m.l}" y="${H - 3}">${pts[0][0].slice(5)}</text><text x="${W - m.r}" y="${H - 3}" text-anchor="end">${pts.at(-1)[0].slice(5)}</text>`;
}
function sparkNew() {
  const svg = $("#spark-new");
  const days = DAYS.slice(-14);
  if (!days.length) { svg.innerHTML = ""; return; }
  const W = svg.clientWidth || 400, H = 96, m = { l: 6, r: 6, t: 14, b: 16 };
  const max = Math.max(1, ...days.map((d) => d.new.length)), bw = (W - m.l - m.r) / days.length;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = days.map((d, i) => {
    const h = (d.new.length / max) * (H - m.t - m.b), x = m.l + i * bw + 2;
    return `<g class="nb" data-day="${d.date}" style="cursor:pointer"><rect x="${x.toFixed(1)}" y="${(H - m.b - h).toFixed(1)}" width="${Math.max(2, bw - 4).toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="2" fill="var(--bar)"/><title>${d.date} · ${d.new.length}</title>${d.new.length ? `<text x="${(x + (bw - 4) / 2).toFixed(1)}" y="${(H - m.b - h - 3).toFixed(1)}" text-anchor="middle">${d.new.length}</text>` : ""}</g>`;
  }).join("") + `<line x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}" stroke="var(--axis)"/><text x="${m.l}" y="${H - 3}">${days[0].date.slice(5)}</text><text x="${W - m.r}" y="${H - 3}" text-anchor="end">${days.at(-1).date.slice(5)}</text>`;
}
function renderTrend() {
  const tr = DATA.history?.trend, txt = tr?.text?.[lang] || tr?.text?.["zh-TW"];
  $("#trend").hidden = !DAYS.length;
  if (txt) {
    $("#trend-range").textContent = `${t("trend.label")} · ${tr.from} → ${tr.to}`;
    $("#trend-h").textContent = txt.headline; $("#trend-s").textContent = txt.summary; $("#trend-w").textContent = txt.watch;
  }
  $(".trend-main").hidden = !txt;
  const days = DAYS.slice(-14), sig = tm("sig");
  const mark = (k) => (tr?.rising?.includes(k) ? ["up", "▲"] : tr?.fading?.includes(k) ? ["down", "▼"] : ["", ""]);
  $("#sig-grid").innerHTML = `<div class="sg" style="--n:${days.length}">
    <div class="sg-row sg-head"><span></span>${days.map((d) => `<span>${d.date.slice(8)}</span>`).join("")}<span></span></div>
    ${Object.keys(sig).map((k) => { const [cls, arrow] = mark(k); const n = days.filter((d) => d.signals?.includes(k)).length;
      return `<div class="sg-row"><span class="sl" title="${esc(sig[k])}"><b>${k}</b>${esc(sig[k])}</span>${days.map((d) => `<span class="sg-cell${d.signals?.includes(k) ? " on" : ""}" title="${d.date} · ${esc(sig[k])}"></span>`).join("")}<span class="st ${cls}">${n}${arrow ? " " + arrow : ""}</span></div>`; }).join("")}
  </div>`;
}
function renderDays() {
  renderTrend();
  const list = [...DAYS].reverse();
  const weekday = (d) => { try { return new Date(d + "T00:00:00Z").toLocaleDateString(UI[lang]._html, { weekday: "short", timeZone: "UTC" }); } catch { return ""; } };
  $("#days").innerHTML = list.slice(0, daysShown).map((d, i) => {
    const tx_ = dayText(d), hl = (d.highlights || []).map((id) => byId.get(id)).filter(Boolean);
    return `<li class="day${i === 0 ? " today" : ""}">
      <div class="day-date"><b>${d.date.slice(5).replace("-", "/")}</b><span>${esc(weekday(d.date))} · ${d.date.slice(0, 4)}</span>${d.stars ? `<span>★ ${fmt(d.stars)}${d.stars_delta ? ` <span class="delta">+${fmt(d.stars_delta)}</span>` : ""}</span>` : ""}</div>
      <div class="day-body">
        <h3>${esc(tx_?.headline || t("day.noBrief"))}</h3>
        ${tx_?.summary ? `<p>${esc(tx_.summary)}</p>` : ""}
        ${d.signals?.length ? `<div class="sigs">${d.signals.map((k) => `<span class="sigtag" title="${esc(tm("sig")[k] || k)}"><b>${esc(k)}</b>${esc(tm("sig")[k] || k)}</span>`).join("")}</div>` : ""}
        ${hl.length ? `<div class="day-hl">${hl.map((r) => `<button type="button" data-go="${esc(r.id)}">${thumbHTML(r)}<b>${esc(tx(r, "title"))}</b></button>`).join("")}</div>` : ""}
        ${d.new.length ? `<div class="day-act"><button type="button" data-day="${d.date}">${esc(t("day.showAll").replace("{n}", d.new.length))} →</button></div>` : ""}
      </div></li>`;
  }).join("") || `<li class="empty">${esc(t("empty"))}</li>`;
  $("#days-more").hidden = list.length <= daysShown;
  $("#days-more").textContent = t("f.more");
  sparkStars(); sparkNew();
}
$("#days-more").addEventListener("click", () => { daysShown += 14; renderDays(); });
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-day]"); if (!b) return;
  state.day = b.dataset.day; state.min = 1; state.type = "all";
  update();
  $("#explore").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
});

// ---------- Theme ----------
function applyTheme(mode) {
  if (mode === "light" || mode === "dark") document.documentElement.dataset.theme = mode; else delete document.documentElement.dataset.theme;
  $("#theme").textContent = { light: "☀", dark: "☾", system: "◐" }[mode] || "◐";
  $("#theme").title = t("theme." + mode);
}
if (isPages) {
  $("#theme").hidden = false;
  let mode = store.get("rea-theme") || "system";
  applyTheme(mode);
  $("#theme").addEventListener("click", () => { mode = { system: "light", light: "dark", dark: "system" }[mode]; store.set("rea-theme", mode); applyTheme(mode); });
}

// ---------- Language switch ----------
$("#lang").addEventListener("change", (e) => {
  const l = e.target.value;
  store.set("rea-lang", l);
  if (isPages) { location.href = DATA.pages[l] + location.search + location.hash; return; }
  lang = l; langNamer = null; renderAll();
});

function update() { renderPeriods(); renderTabs(); renderFacets(); renderActive(); renderResults(); if (!state.id || !current.some((r) => r.id === state.id)) state.id = current[0]?.id || state.id; renderDetail(); markCurrent(); writeURL(); }
function renderAll() {
  document.documentElement.lang = UI[lang]._html;
  document.documentElement.dir = UI[lang]._dir || "ltr";
  document.title = t("title");
  $$("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $$("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  $$("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  $("#h1br").hidden = !t("hero.h1b");
  $("#lang").innerHTML = LANGS.map((l) => `<option value="${l}"${l === lang ? " selected" : ""}>${esc(UI[l]._name)}</option>`).join("");
  $("#sort").value = state.sort;
  $("#q").value = state.q;
  if (DATA.site?.repo) $("#repo-link").href = DATA.site.repo;
  haystack.clear(); layoutCache.clear();
  renderStatic(); update();
}

readURL();
renderAll();
if (state.id && byId.has(state.id) && location.hash) setTimeout(() => select(state.id, false), 0);
