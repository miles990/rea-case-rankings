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
// The page starts with the first batch (top entries and the last week) and swaps in
// the full set from data.json once it arrives; see loadFull().
let records = DATA.records.map((r, i) => ({ ...r, rank: r.rank ?? i + 1 }));
let byId = new Map(records.map((r) => [r.id, r]));
const total = () => (DATA.partial ? DATA.total : records.length);
const latestDay = records.reduce((m, r) => ((r.added || "") > m ? r.added : m), "");
// Time ranges count back from the latest update day, not the viewer's clock, so
// "today" is never empty before the morning run. An entry's day is the later of
// when it was published and when the site found it.
const PERIODS = ["1", "7", "30", "all"];
const seenDay = (r) => ((r.date || "") > (r.added || "") ? r.date : r.added) || "";
const periodStart = (n, back = 0) => { const d = new Date(latestDay + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - (n - 1) - back); return d.toISOString().slice(0, 10); };
const TYPE_COLOR = { case: "var(--s1)", app: "var(--s2)", learn: "var(--s3)", news: "var(--s4)" };
const TYPE_HUE = { case: 218, app: 18, learn: 158, news: 262 };

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
let ADJ = relations();
const relatedOf = (r) => {
  const near = [...ADJ.get(r.id).keys()].map((id) => byId.get(id)).sort((a, b) => a.rank - b.rank);
  const fill = records.filter((x) => x.id !== r.id && x.category === r.category && !ADJ.get(r.id).has(x.id)).slice(0, 4 - Math.min(4, near.length));
  return [...near.slice(0, 4), ...fill].slice(0, 4).map((x) => ({ r: x, why: ADJ.get(r.id).get(x.id) }));
};

// ---------- Thumbnails and generated covers ----------
// Entries without a usable image get a cover built from their own data: the target
// name, the platform, and a fake hex dump seeded by the id, so no two look alike.
const thumbSrc = (r) => (DATA.thumbs?.[r.id] ? DATA.thumbBase + DATA.thumbs[r.id] : null);
const VIA_ICON = {
  X: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.8 2h3.4l-7.4 8.5L22.5 22h-6.8l-5.3-7-6.1 7H.9l7.9-9L.5 2h7l4.8 6.4L17.8 2Zm-1.2 18h1.9L6.5 3.9h-2L16.6 20Z"/></svg>',
  GitHub: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.4-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"/></svg>',
  YouTube: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12 31 31 0 0 0 1 16.8a3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1c.4-1.6.5-3.2.5-4.8s-.1-3.2-.5-4.8ZM9.7 15.1V8.9l5.8 3.1-5.8 3.1Z"/></svg>',
  Bluesky: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5.2 3.3C7.9 5.4 10.9 9.5 12 11.8c1.1-2.3 4.1-6.4 6.8-8.5 2-1.5 5.2-2.6 5.2 1 0 .7-.4 6-.7 6.9-.9 3.1-4.1 3.9-6.9 3.4 4.9.8 6.2 3.6 3.5 6.4-5.1 5.2-7.3-1.3-7.9-3l-.1-.3-.1.3c-.6 1.7-2.8 8.2-7.9 3-2.7-2.8-1.4-5.6 3.5-6.4-2.8.5-6-.3-6.9-3.4C.4 10.3 0 5 0 4.3c0-3.6 3.2-2.5 5.2-1Z"/></svg>',
  Reddit: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="14" r="7.5"/><circle cx="18.5" cy="6" r="2" /><path d="M12 6.5 13.5 2l4.5 1" stroke="currentColor" fill="none" stroke-width="1.5"/></svg>',
};
const viaKey = (v) => (/^Reddit/.test(v || "") ? "Reddit" : v);
const coverWord = (r) => {
  const t = (tx(r, "target") || "").split(/[、,，;；/|（(]/)[0].trim();
  return (t && t.length <= 28 ? t : t.slice(0, 26) + (t ? "…" : "")) || (r.via === "人工整理" ? "REA" : r.via);
};
const hexOf = (id, lines = 9) => {
  let h = 2166136261; for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const rnd = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
  let out = "";
  for (let l = 0; l < lines; l++) { out += (0x401000 + l * 16 + Math.floor(rnd() * 4096) * 16).toString(16).toUpperCase().padStart(8, "0") + "  "; for (let b = 0; b < 12; b++) out += Math.floor(rnd() * 256).toString(16).toUpperCase().padStart(2, "0") + " "; out += "\n"; }
  return out;
};
const coverHTML = (r, mini = false) => {
  const v = viaKey(r.via), icon = VIA_ICON[v];
  return `<span class="thumb cover${mini ? " mini-cover" : ""}" style="--h:${TYPE_HUE[r.type] ?? 220}" aria-hidden="true">${mini ? "" : `<span class="cv-hex">${hexOf(r.id)}</span>`}<span class="cv-scan"></span>${mini ? "" : `<span class="cv-v" title="${esc(r.via)}">${icon || esc((v || "?").slice(0, 1))}</span>`}<span class="cv-t">${esc(coverWord(r))}</span>${mini ? "" : `<span class="cv-c">${esc(catName(r.category))}</span>`}</span>`;
};
const thumbHTML = (r, eager = false, mini = false) => {
  const src = thumbSrc(r);
  return src ? `<span class="thumb" data-ph="${esc(r.id)}"${mini ? ' data-mini="1"' : ""}><img src="${esc(src)}" alt="" loading="${eager ? "eager" : "lazy"}" decoding="async"></span>` : coverHTML(r, mini);
};
document.addEventListener("error", (e) => {
  const box = e.target.tagName === "IMG" && e.target.closest("[data-ph]");
  if (box) box.outerHTML = coverHTML(byId.get(box.dataset.ph), !!box.dataset.mini);
}, true);

// ---------- State (mirrored to the URL on GitHub Pages) ----------
const FACETS = ["cat", "via", "lang", "status", "source"];
const FIELD = { cat: "category", via: "via", lang: "lang", status: "status", source: "source" };
// min: lowest score shown. Default 2 hides one-line link shares and news;
// entries not scored yet always stay visible.
let DAYS = (DATA.history?.days || []).filter((d) => d.new?.length || d.text);
const dayIds = (date) => new Set(DAYS.find((d) => d.date === date)?.new || []);
const state = { day: null, period: "1", type: "all", q: "", sort: "rank", view: store.get("rea-view") || "list", id: null, tsort: null, min: 2, cat: null, via: null, lang: null, status: null, source: null };
const VIEWS = ["list", "grid", "table", "timeline", "graph", "space"];
if (!VIEWS.includes(state.view)) state.view = "list";
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
function matches(r, skip, yesterday = false) {
  if (yesterday && (r.prev == null || (!state.day && state.period !== "all" && seenDay(r) < periodStart(+state.period, 1)))) return false;
  if (state.day) { if (dayCache[0] !== state.day) dayCache = [state.day, dayIds(state.day)]; if (!dayCache[1].has(r.id)) return false; }
  if (!yesterday && !state.day && skip !== "period" && state.period !== "all" && seenDay(r) < periodStart(+state.period)) return false;
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
    const mv = (r) => (PREV.has(r.id) ? PREV.get(r.id) - posOf(r) : 1e6);
    const val = { rank: (r) => r.rank, overall: (r) => r.rank, move: (r) => -mv(r), wow: (r) => -(r.wow ?? 0), heat: (r) => -(r.heat || 0), title: (r) => tx(r, "title"), type: (r) => typeName(r.type), via: (r) => r.via, lang: (r) => r.lang, date: (r) => r.date || r.added || "" }[col];
    list.sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : a.rank - b.rank) * dir; });
  }
  return list;
}

// ---------- Positions within the current ranking ----------
// Every range is its own ranking that starts at 1. Movement compares an entry's place
// with its place in the same ranking yesterday (same filters, window one day earlier).
let POS = new Map(), PREV = new Map();
function computePositions(list) {
  POS = new Map([...list].sort((a, b) => a.rank - b.rank).map((r, i) => [r.id, i + 1]));
  PREV = new Map();
  if (state.day) return;
  records.filter((r) => matches(r, null, true)).sort((a, b) => a.prev - b.prev).forEach((r, i) => PREV.set(r.id, i + 1));
}
const posOf = (r) => POS.get(r.id) ?? r.rank;
function moveHTML(r) {
  if (state.day || !POS.has(r.id)) return "";
  const was = PREV.get(r.id), now = POS.get(r.id);
  if (was == null) return `<span class="new" title="${esc(t("mv.newT"))}">${esc(t("new.badge"))}</span>`;
  const d = was - now;
  if (!d) return `<span class="mv flat" title="${esc(t("mv.flat"))}">—</span>`;
  return `<span class="mv ${d > 0 ? "up" : "down"}" title="${esc(t(d > 0 ? "mv.up" : "mv.down").replace("{n}", Math.abs(d)))}">${d > 0 ? "▲" : "▼"}${Math.abs(d)}</span>`;
}
const overall = (r) => (POS.has(r.id) && POS.get(r.id) !== r.rank ? `<span class="gr" title="${esc(t("rank.overall"))}">${esc(t("rank.overallShort"))} #${r.rank}</span>` : "");

// ---------- Small renderers ----------
const wowBar = (w) => (w == null ? `<span class="tag">${esc(t("row.unscored"))}</span>`
  : `<span class="wow${w === 5 ? " w5" : ""}" title="${esc(t("score"))} ${w}/5" aria-label="${esc(t("score"))} ${w}/5">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= w ? "f" : ""}"></i>`).join("")}<span>${w}/5</span></span>`);
const heatBar = (h) => `<span class="heat" title="${esc(t("heat.label"))} ${h}/100" aria-label="${esc(t("heat.label"))} ${h}/100"><span class="ht"><span class="hf" style="width:${h}%"></span></span>${h}</span>`;
const pill = (s) => (s ? `<span class="pill ${esc(s)}">${esc(t("status." + s))}</span>` : "");
const isNew = (r) => r.added === latestDay && r.source === "auto";

// ---------- Facets (rail) ----------
// Each facet is a collapsible group; the open/closed choice survives re-renders.
const expanded = new Set();
const openFacets = new Set((store.get("rea-facets") || "min,cat").split(",").filter(Boolean));
const CAT_TYPE = { 工具鏈: "app", 教學: "learn", "報導 / 評論": "news" };
const facetBox = (key, label, cur, body) => `<details class="facet" data-f="${key}"${openFacets.has(key) || cur ? " open" : ""}><summary><span>${esc(label)}</span>${cur ? `<span class="cur">${esc(cur)}</span>` : ""}</summary>${body}</details>`;
function renderMin() {
  const n = (k) => records.filter((r) => matches(r, "min") && (r.wow == null || r.wow >= k)).length;
  return facetBox("min", t("f.min"), state.min !== 2 ? `≥ ${state.min}` : "", `<div class="minseg" role="group">${[1, 2, 3, 4, 5].map((k) => `<button type="button" data-min="${k}" aria-pressed="${state.min === k}" title="${n(k)}">${k}${k < 5 ? "+" : ""}<small>${n(k)}</small></button>`).join("")}</div><p class="minhint">${esc(t("f.minhint"))}</p>`);
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
    return facetBox(key, t(label), state[key] ? name(state[key]) : "", `
      ${shown.map(([v, n]) => `<button class="fopt${n ? "" : " zero"}" type="button" data-k="${key}" data-v="${esc(v)}" aria-pressed="${state[key] === v}">
        <span class="fl">${key === "cat" ? `<span class="dot-type" style="background:${TYPE_COLOR[CAT_TYPE[v] || "case"]}"></span>` : ""}${esc(name(v))}</span><span class="fn">${n}</span><span class="fb"><i style="width:${(n / max) * 100}%"></i></span></button>`).join("")}
      ${state[key] ? `<button class="fmore" type="button" data-clear="${key}">${esc(t("f.all"))}</button>` : ""}
      ${entries.length > 6 ? `<button class="fmore" type="button" data-more="${key}">${esc(t(expanded.has(key) ? "f.less" : "f.more"))}</button>` : ""}`);
  }).join("");
}
$("#facets").addEventListener("toggle", (e) => {
  const d = e.target.closest?.("details[data-f]"); if (!d) return;
  d.open ? openFacets.add(d.dataset.f) : openFacets.delete(d.dataset.f);
  store.set("rea-facets", [...openFacets].join(","));
}, true);
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
  const pending = (k) => DATA.partial && (k === "30" || k === "all");
  $("#periods").innerHTML = PERIODS.map((k) => `<button class="tab" type="button" data-p="${k}" aria-pressed="${!state.day && state.period === k}" title="${k === "all" ? "" : esc(periodStart(+k) + " – " + latestDay)}">${esc(t("range." + k))}<span class="k">${pending(k) ? "…" : n(k)}</span></button>`).join("");
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
  const nb = $("#nfilters"); nb.hidden = !chips.length; nb.textContent = chips.length;
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
  computePositions(current);
  $("#res-h").textContent = state.day ? t("res.day").replace("{d}", state.day) : t("res." + state.period);
  $("#count").innerHTML = `<bdi dir="ltr">${current.length} / ${total()}</bdi>${DATA.partial ? ` <span class="loading-dot" title="${esc(t("viz.loading"))}"></span>` : ""}`;
  $$("#views button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === state.view)));
  const box = $("#results");
  if (state.view !== "space") disposeSpace();
  if (!current.length) {
    const wider = !state.day && state.period !== "all" ? PERIODS[PERIODS.indexOf(state.period) + 1] : null;
    box.innerHTML = `<div class="empty"><b>${esc(t("empty.h"))}</b>${esc(t("empty"))}<br>${wider ? `<button class="btn" type="button" data-widen="${wider}">${esc(t("empty.widen").replace("{r}", t("range." + wider)))}</button>` : ""}</div>`;
    return;
  }
  if (state.view === "grid") box.innerHTML = `<div class="gallery">${current.map((r) => `<button class="gcard" type="button" data-row="${esc(r.id)}" aria-current="${state.id === r.id}">
      ${thumbHTML(r)}<span class="gb"><span class="gm"><span class="grk">#${posOf(r)} ${moveHTML(r)}</span>${wowBar(r.wow)}</span>
      <h3>${esc(tx(r, "title"))}</h3>
      <span class="gm"><span class="tags"><span class="dot-type" style="background:${TYPE_COLOR[r.type]}"></span><span class="tag">${esc(catName(r.category))}</span></span>${heatBar(r.heat || 0)}</span></span></button>`).join("")}</div>`;
  else if (state.view === "table") {
    const cols = [["rank", "#"], ["move", t("mv.col")], ["overall", t("rank.overallShort")], ["wow", t("score")], ["heat", t("heat.label")], ["title", t("new.th.title")], ["type", t("f.type")], ["via", t("f.via")], ["lang", t("f.lang")], ["date", t("d.date")]];
    const [sc, sd] = state.tsort || [];
    box.innerHTML = `<div class="dtable-wrap" data-scroll-x><table class="dtable"><thead><tr>${cols.map(([k, l]) => `<th${sc === k ? ` aria-sort="${sd > 0 ? "ascending" : "descending"}"` : ""}><button type="button" data-sort="${k}">${esc(l)}${sc === k ? (sd > 0 ? " ↑" : " ↓") : ""}</button></th>`).join("")}</tr></thead><tbody>
      ${current.map((r) => `<tr data-row="${esc(r.id)}" aria-current="${state.id === r.id}"><td class="n">${posOf(r)}</td><td class="n">${moveHTML(r)}</td><td class="n">${r.rank}</td><td class="n">${r.wow ?? "—"}</td><td class="n">${r.heat || 0}</td><td class="ti">${esc(tx(r, "title"))}</td><td class="n"><span class="dot-type" style="background:${TYPE_COLOR[r.type]}"></span> ${esc(typeName(r.type))}</td><td class="n">${esc(r.via)}</td><td class="n">${esc(r.lang)}</td><td class="n">${esc(r.date || r.added || "")}</td></tr>`).join("")}
      </tbody></table></div>`;
  } else if (state.view === "timeline") renderTimeline(box);
  else if (state.view === "graph") renderGraph(box);
  else if (state.view === "space") renderSpace(box);
  else box.innerHTML = `<ol class="rows">${current.map((r) => {
    const main = r.links[0], metric = tx(r, "metric"), summary = tx(r, "summary");
    return `<li class="row" data-row="${esc(r.id)}" aria-current="${state.id === r.id}">
      <div class="rk${posOf(r) <= 3 ? " top3" : ""}">${posOf(r)}<small>${moveHTML(r)}</small></div>
      ${thumbHTML(r)}
      <div class="main">
        <h3><span class="rkm mono">#${posOf(r)} ${moveHTML(r)} · </span><a href="${esc(safe(main.url))}" target="_blank" rel="noopener noreferrer">${esc(tx(r, "title"))}</a> <span class="ext">${esc(host(main.url))} ↗</span></h3>
        ${metric ? `<div class="metric"><span class="sel">${esc(metric)}</span></div>` : ""}
        ${summary ? `<p class="sum">${esc(summary)}</p>` : ""}
        <div class="meta">${overall(r)}${r.author ? `<span class="who">${esc(r.author)}</span>` : ""}${wowBar(r.wow)}${heatBar(r.heat || 0)}${pill(r.status)}<span class="tags"><span class="dot-type" style="background:${TYPE_COLOR[r.type]}"></span><span class="tag">${esc(catName(r.category))}</span><span class="tag lang">${esc(r.lang)}</span></span></div>
      </div></li>`;
  }).join("")}</ol>`;
}
$("#results").addEventListener("click", (e) => {
  const w = e.target.closest("[data-widen]");
  if (w) { state.period = w.dataset.widen; update(); return; }
  const s = e.target.closest("[data-sort]");
  if (s) { const k = s.dataset.sort; state.tsort = state.tsort?.[0] === k ? [k, -state.tsort[1]] : [k, 1]; renderResults(); return; }
  if (e.target.closest("a")) return;
  const row = e.target.closest("[data-row]");
  if (row) select(row.dataset.row, true);
});
function setView(v) { if (!VIEWS.includes(v)) return; state.view = v; store.set("rea-view", v); renderResults(); markCurrent(); writeURL(); }
$("#views").addEventListener("click", (e) => { const b = e.target.closest("[data-view]"); if (b) setView(b.dataset.view); });
$("#sort").addEventListener("change", (e) => { state.sort = e.target.value; state.tsort = null; renderResults(); writeURL(); });
let qTimer;
$("#q").addEventListener("input", (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = e.target.value; update(); }, 90); });

// ---------- Timeline (bubble) ----------
const svgEl = (w, h) => `<svg viewBox="0 0 ${w} ${h}" height="${h}" role="img">`;
const hash01 = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return ((h >>> 0) % 1000) / 1000; };
const R = (h) => 4 + Math.sqrt(h || 0) * 1.05;
function vizHead(title, extra = "") {
  return `<div class="viz-head"><b style="color:var(--ink)">${esc(title)}</b><div class="legend-row">${["case", "app", "learn", "news"].map((k) => `<span><i class="dot-type" style="background:${TYPE_COLOR[k]}"></i>${esc(typeName(k))}</span>`).join("")}<span>${esc(t("viz.size"))}</span>${extra}</div></div>`;
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
// Libraries for the node graph and 3D space load only when those views open.
const scripts = new Map();
const loadScript = (src) => {
  if (!scripts.has(src)) scripts.set(src, new Promise((ok, no) => { const el = document.createElement("script"); el.src = src; el.async = true; el.crossOrigin = "anonymous"; el.onload = ok; el.onerror = () => { scripts.delete(src); no(new Error(src)); }; document.head.append(el); }));
  return scripts.get(src);
};
const D3 = "https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js";
const FG3D = "https://cdn.jsdelivr.net/npm/3d-force-graph@1.80.1/dist/3d-force-graph.min.js";
const vizLoading = (box) => { box.innerHTML = `<div class="viz"><p class="empty loading">${esc(t("viz.loading"))}</p></div>`; };
function renderGraph(box) {
  if (!window.d3) {
    vizLoading(box);
    loadScript(D3).then(() => { if (state.view === "graph") renderResults(); }).catch(() => { if (state.view === "graph") box.innerHTML = `<p class="empty">${esc(t("viz.nod3"))}</p>`; });
    return;
  }
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


// ---------- 3D space (3d-force-graph, loaded on demand) ----------
// Same nodes and links as the 2D graph, in a slowly turning 3D field. Category hubs
// and the top entries carry HTML labels that follow the camera.
let space = null;
const SPACE_COLOR = { case: "#5b93ff", app: "#ff7d45", learn: "#2fd096", news: "#a98bff" };
function disposeSpace() {
  if (!space) return;
  cancelAnimationFrame(space.raf); space.ro.disconnect();
  try { space.g.pauseAnimation(); space.g._destructor?.(); } catch {}
  space = null;
}
const hasWebGL = () => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; } };
function renderSpace(box) {
  if (!hasWebGL()) { box.innerHTML = `<p class="empty">${esc(t("viz.nowebgl"))}</p>`; return; }
  if (!window.ForceGraph3D) {
    vizLoading(box);
    loadScript(FG3D).then(() => { if (state.view === "space") renderResults(); }).catch(() => { if (state.view === "space") box.innerHTML = `<p class="empty">${esc(t("viz.nod3"))}</p>`; });
    return;
  }
  const key = current.map((r) => r.id).join(",");
  if (space && space.key === key && box.contains(space.el)) { space.focus(state.id, false); return; }
  disposeSpace();
  const cats = [...new Set(current.map((r) => r.category))];
  const nodes = [...cats.map((c) => ({ id: "hub:" + c, hub: true, label: c })), ...current.map((r) => ({ id: r.id, type: r.type, heat: r.heat || 0, wow: r.wow || 1 }))];
  const ids = new Set(current.map((r) => r.id)), seen = new Set();
  const links = current.map((r) => ({ source: r.id, target: "hub:" + r.category, kind: "hub" }));
  for (const r of current) for (const [o] of ADJ.get(r.id)) { if (!ids.has(o)) continue; const k = [r.id, o].sort().join("|"); if (!seen.has(k)) { seen.add(k); links.push({ source: r.id, target: o, kind: "rel" }); } }
  box.innerHTML = `<div class="viz space" id="space">${vizHead(t("viz.space"))}<div class="space-wrap"><div class="space-stage" id="space-stage"></div><div class="space-labels" id="space-labels"></div></div>
    <div class="viz-foot"><span>${esc(t("viz.spaceHint"))}</span><span class="zoom"><button type="button" data-z="spin" aria-label="Rotate" aria-pressed="true">⟳</button><button type="button" data-z="fit" aria-label="Fit">⤢</button></span></div></div>`;
  const stage = $("#space-stage"), labelBox = $("#space-labels");
  const named = new Set(current.slice(0, 5).map((r) => r.id));
  const g = ForceGraph3D({ controlType: "orbit" })(stage)
    .width(stage.clientWidth).height(stage.clientHeight)
    .backgroundColor("rgba(0,0,0,0)").showNavInfo(false)
    .graphData({ nodes, links })
    .nodeVal((d) => (d.hub ? 9 : 0.6 + d.wow * 0.9 + d.heat / 14))
    .nodeColor((d) => (d.hub ? "#e9edf5" : d.id === state.id ? "#ffe08a" : SPACE_COLOR[d.type]))
    .nodeOpacity(0.95).nodeResolution(18)
    .nodeLabel((d) => { if (d.hub) return `<div class="scene-tip"><b>${esc(catName(d.label))}</b></div>`; const r = byId.get(d.id); return `<div class="scene-tip"><b>#${r.rank} · ${esc(tx(r, "title"))}</b><small>${esc(t("score"))} ${r.wow ?? "—"}/5 · ${esc(t("heat.label"))} ${r.heat || 0} · ${esc(r.via)}</small></div>`; })
    .linkColor((l) => (l.kind === "rel" ? "rgba(255,138,80,0.85)" : "rgba(150,170,215,0.16)"))
    .linkWidth((l) => (l.kind === "rel" ? 0.7 : 0))
    .linkDirectionalParticles((l) => (l.kind === "rel" ? 2 : 0)).linkDirectionalParticleWidth(1.4).linkDirectionalParticleSpeed(0.005)
    .enableNodeDrag(false).cooldownTicks(140)
    .onNodeClick((d) => { if (d.hub) { state.cat = d.label; update(); return; } select(d.id, true); })
    .onEngineStop(() => { if (!space?.fitted) { space.fitted = true; g.zoomToFit(700, 70); } });
  const ctrl = g.controls(); ctrl.autoRotate = !reduceMotion; ctrl.autoRotateSpeed = 0.55;
  const stop = () => { ctrl.autoRotate = false; $("#space [data-z=spin]")?.setAttribute("aria-pressed", "false"); };
  stage.addEventListener("pointerdown", stop);
  stage.addEventListener("wheel", stop, { passive: true });
  const labelled = nodes.filter((n) => n.hub || named.has(n.id));
  labelBox.innerHTML = labelled.map((n) => `<span class="sl ${n.hub ? "sl-hub" : "sl-node"}" data-l="${esc(n.id)}">${esc(n.hub ? catName(n.label) : tx(byId.get(n.id), "title").slice(0, 18) + (tx(byId.get(n.id), "title").length > 18 ? "…" : ""))}</span>`).join("");
  const els = new Map($$("[data-l]", labelBox).map((el) => [el.dataset.l, el]));
  const tick = () => {
    for (const n of labelled) { const el = els.get(n.id); if (n.x == null) continue; const p = g.graph2ScreenCoords(n.x, n.y, n.z); el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`; }
    space.raf = requestAnimationFrame(tick);
  };
  const ro = new ResizeObserver(() => g.width(stage.clientWidth).height(stage.clientHeight));
  ro.observe(stage);
  space = { g, key, el: box.firstElementChild, ro, raf: 0, fitted: false,
    focus(id, fly) {
      g.nodeColor(g.nodeColor());
      const n = nodes.find((x) => x.id === id);
      if (fly && n && n.x != null) { stop(); const k = 1 + 70 / Math.max(1, Math.hypot(n.x, n.y, n.z)); g.cameraPosition({ x: n.x * k, y: n.y * k, z: n.z * k }, n, 1100); }
    } };
  space.raf = requestAnimationFrame(tick);
  $("#space .zoom").onclick = (e) => {
    const z = e.target.closest("[data-z]")?.dataset.z;
    if (z === "fit") g.zoomToFit(700, 30);
    if (z === "spin") { ctrl.autoRotate = !ctrl.autoRotate; e.target.setAttribute("aria-pressed", String(ctrl.autoRotate)); }
  };
}

// Hover tooltips for both visualizations.
const tip = $("#tip");
function showTip(r, x, y) {
  tip.innerHTML = `${thumbHTML(r, true)}<div class="tb"><b>#${posOf(r)} · ${esc(tx(r, "title"))}</b><span class="tm">${esc(t("score"))} ${r.wow ?? "—"}/5 · ${esc(t("heat.label"))} ${r.heat || 0} · ${esc(r.via)}</span><span class="tm">${esc(r.author || "")}</span></div>`;
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
// A small node view of one entry and its neighbours (same author, owner or target),
// filled up with same-category entries. Click a node to move the detail pane there.
function egoSVG(r) {
  const near = [...ADJ.get(r.id)].map(([id, why]) => ({ x: byId.get(id), why })).sort((a, b) => a.x.rank - b.x.rank).slice(0, 7);
  const fill = records.filter((x) => x.id !== r.id && x.category === r.category && !ADJ.get(r.id).has(x.id)).slice(0, Math.max(0, 5 - near.length)).map((x) => ({ x, why: null }));
  const ns = [...near, ...fill];
  if (!ns.length) return "";
  const W = 396, H = 236, cx = W / 2, cy = H / 2 + 4, rad = Math.min(96, 54 + ns.length * 7);
  const pos = ns.map((n, i) => { const a = -Math.PI / 2 + (i / ns.length) * Math.PI * 2; return { ...n, px: cx + Math.cos(a) * rad * 1.45, py: cy + Math.sin(a) * rad * 0.82 }; });
  const rr = (x) => 5 + Math.sqrt(x.heat || 0) * 0.75;
  const short = (x, n) => { const s = tx(x, "title"); return s.length > n ? s.slice(0, n) + "…" : s; };
  return `<div class="ego"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t("d.graph"))}">
    ${pos.map((n) => `<line class="${n.why ? "why" : ""}" x1="${cx}" y1="${cy}" x2="${n.px.toFixed(1)}" y2="${n.py.toFixed(1)}"/>`).join("")}
    ${pos.filter((n) => n.why).map((n) => `<text class="lbl" x="${((cx + n.px) / 2).toFixed(1)}" y="${((cy + n.py) / 2 - 3).toFixed(1)}" text-anchor="middle">${esc(n.why.slice(0, 16))}</text>`).join("")}
    ${pos.map((n) => `<g class="n" data-go="${esc(n.x.id)}" tabindex="0" role="button" aria-label="${esc(tx(n.x, "title"))}"><circle cx="${n.px.toFixed(1)}" cy="${n.py.toFixed(1)}" r="${rr(n.x).toFixed(1)}" fill="${TYPE_COLOR[n.x.type]}" stroke="var(--panel)" stroke-width="1.5"/><text x="${n.px.toFixed(1)}" y="${(n.py + rr(n.x) + 12).toFixed(1)}" text-anchor="middle">${esc(short(n.x, 11))}</text></g>`).join("")}
    <g class="c"><circle cx="${cx}" cy="${cy}" r="${(rr(r) + 5).toFixed(1)}" fill="${TYPE_COLOR[r.type]}" stroke="var(--ink)" stroke-width="2.5"/><text x="${cx}" y="${(cy + rr(r) + 19).toFixed(1)}" text-anchor="middle">${esc(short(r, 14))}</text></g>
  </svg></div>`;
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
    <div class="dt-rank"><span class="big">#${posOf(r)}</span>${moveHTML(r)}${overall(r)}${wowBar(r.wow)}${heatBar(r.heat || 0)}${pill(r.status)}</div>
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
    <div class="dt-acts"><button class="ibtn" type="button" data-copy>${esc(t("d.copy"))}</button>${isPages ? "" : ""}<button class="ibtn" type="button" data-similar>${esc(t("d.similar"))}</button></div>
    ${egoSVG(r) ? `<div class="dt-sec"><h4><span>${esc(t("d.graph"))}</span><span>${esc(t("d.graphKey"))}</span></h4>${egoSVG(r)}</div>` : ""}
    <div class="dt-sec"><h4>${esc(t("d.related"))}</h4><div class="related">${relatedOf(r).map(({ r: x, why }) => `<button type="button" data-go="${esc(x.id)}">${thumbHTML(x, false, true)}<span><b>${esc(tx(x, "title"))}</b><small>#${x.rank}${why ? " · " + esc(why) : " · " + esc(catName(x.category))}</small></span></button>`).join("")}</div></div>`;
  $("#detail-wrap").scrollTop = 0;
}
$("#detail").addEventListener("click", (e) => {
  const s = e.target.closest("[data-step]"), g = e.target.closest("[data-go]");
  if (s) move(+s.dataset.step);
  if (g) select(g.dataset.go, true);
  if (e.target.closest("[data-close]")) closeDrawer();
  if (e.target.closest("[data-copy]")) { const u = location.href; (navigator.clipboard?.writeText(u) || Promise.reject()).then(() => toast(t("d.copied")), () => toast(u)); }
  if (e.target.closest("[data-similar]")) { const r = byId.get(state.id); if (r) { for (const f of FACETS) state[f] = null; state.q = ""; state.cat = r.category; state.period = "all"; state.day = null; $("#q").value = ""; update(); toast(catName(r.category)); } }
});
$("#detail").addEventListener("keydown", (e) => { const g = e.target.closest("[data-go]"); if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); select(g.dataset.go, true); } });
let toastT;
function toast(msg) { const el = $("#toast"); el.textContent = msg; el.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("on"), 1800); }
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
  if (state.view === "space" && space) space.focus(id, fromUser);
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
  $("#pal-list").innerHTML = palItems.map((r, i) => `<li role="option" data-i="${i}" aria-selected="${i === palSel}">${thumbHTML(r, false, true)}<span style="min-width:0"><b>${esc(tx(r, "title"))}</b><small>${esc(r.author || r.via)} · ${esc(catName(r.category))}</small></span><span class="pr">#${r.rank}</span></li>`).join("") || `<li style="display:block;color:var(--muted)">${esc(t("empty"))}</li>`;
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
  const v = VIEWS[+e.key - 1];
  if (v && /^[1-6]$/.test(e.key)) setView(v);
});

// ---------- Highlights, latest, about ----------
// ---------- Masthead: today first ----------
const fmtK = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, "") + "k" : String(n));
const inPeriod = (r, k) => (k === "all" || seenDay(r) >= periodStart(+k)) && (r.wow == null || r.wow >= 2);
function countUp(el, to, fmtFn = fmt) {
  if (reduceMotion || !Number.isFinite(to)) { el.textContent = fmtFn(to); return; }
  const t0 = performance.now(), d = 900;
  const step = (now) => { const p = Math.min(1, (now - t0) / d), e = 1 - Math.pow(1 - p, 3); el.textContent = fmtFn(Math.round(to * e)); if (p < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function sparkPath(vals, w = 64, h = 22) {
  if (vals.length < 2) return "";
  const max = Math.max(...vals), min = Math.min(...vals);
  const pts = vals.map((v, i) => `${((i / (vals.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / Math.max(1, max - min)) * (h - 4)).toFixed(1)}`);
  return `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts.join(" ")}" fill="none" stroke="var(--ok)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
function renderMast() {
  const last = DAYS.at(-1), txt = last ? dayText(last) : null;
  let wd = ""; try { wd = new Date(latestDay + "T00:00:00Z").toLocaleDateString(UI[lang]._html, { weekday: "short", timeZone: "UTC" }); } catch {}
  $("#mast-date").textContent = `${latestDay} ${wd}`;
  $("#mast-h").textContent = txt?.headline || t("title");
  const sum = $("#mast-sum"); sum.textContent = txt?.summary || ""; sum.classList.remove("open");
  sum.nextElementSibling?.classList.contains("more") && sum.nextElementSibling.remove();
  requestAnimationFrame(() => { if (sum.scrollHeight > sum.clientHeight + 4) sum.insertAdjacentHTML("afterend", `<button class="more" type="button" id="sum-more">${esc(t("mast.more"))}</button>`); });
  $("#mast-sigs").innerHTML = (last?.signals || []).map((k) => `<span class="sigtag" title="${esc(tm("sig")[k] || k)}"><b>${esc(k)}</b>${esc(tm("sig")[k] || k)}</span>`).join("");
  const today = records.filter((r) => inPeriod(r, "1")), week = records.filter((r) => inPeriod(r, "7"));
  const allToday = records.filter((r) => seenDay(r) >= latestDay).length;
  const stars = DATA.repo?.stars, starDays = DAYS.filter((d) => d.stars).map((d) => d.stars);
  const kp = [
    ["1", today.length, t("kpi.today"), t("kpi.todayD").replace("{n}", allToday), ""],
    ["7", week.length, t("kpi.week"), t("kpi.weekD"), ""],
    ["all", total(), t("kpi.total"), t("kpi.totalD").replace("{n}", records.filter((r) => r.wow === 5).length), ""],
    [null, stars || 0, t("kpi.stars"), last?.stars_delta ? `+${fmtK(last.stars_delta)} ${t("kpi.starsD")}` : "", sparkPath(starDays.slice(-10))],
  ];
  $("#kpis").innerHTML = kp.map(([p, , l, d, svg], i) => `<li>${p ? `<button type="button" data-kp="${p}" aria-label="${esc(l)}"></button>` : ""}<span class="l">${esc(l)}</span><span class="n" data-n="${i}">0</span><span class="d${d && !d.startsWith("+") ? " muted" : ""}">${esc(d)}</span>${svg}</li>`).join("");
  kp.forEach(([, n], i) => countUp($(`#kpis [data-n="${i}"]`), n, i === 3 ? fmtK : fmt));
  let focus = today.slice(0, 3);
  if (focus.length < 3) focus = [...focus, ...week.filter((r) => !focus.includes(r)).slice(0, 3 - focus.length)];
  $("#focus-n").textContent = today.length ? `${today.length} · ${t("range.1")}` : t("range.7");
  $("#focus").innerHTML = focus.map((r) => `<button class="fcard" type="button" data-go="${esc(r.id)}"><span class="rkb">#${today.includes(r) ? today.indexOf(r) + 1 : r.rank}</span>${thumbHTML(r, true)}
    <span class="fb"><span class="fm"><span class="dot-type" style="background:${TYPE_COLOR[r.type]}"></span>${esc(catName(r.category))}${isNew(r) ? `<span class="new">${esc(t("new.badge"))}</span>` : ""}</span><h3>${esc(tx(r, "title"))}</h3>${tx(r, "metric") ? `<span class="metric"><span class="sel">${esc(tx(r, "metric"))}</span></span>` : ""}<span class="fm">${wowBar(r.wow)}${heatBar(r.heat || 0)}</span></span></button>`).join("") || `<div class="focus-empty">${esc(t("empty"))}</div>`;
}
document.addEventListener("click", (e) => {
  const k = e.target.closest("[data-kp]");
  if (k) { state.period = k.dataset.kp; state.day = null; update(); $("#explore").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" }); return; }
  if (e.target.id === "sum-more") { const s = $("#mast-sum"); s.classList.toggle("open"); e.target.textContent = t(s.classList.contains("open") ? "mast.less" : "mast.more"); }
});

// Background of the masthead: every entry as a star, placed by date (x) and score (y),
// sized by heat and linked to its relatives. Today's entries glow. Drawn on a canvas,
// paused when off screen, still when the visitor prefers less motion.
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function mastCanvas() {
  const c = $("#mast-canvas"); if (!c?.getContext) return;
  const ctx = c.getContext("2d");
  let W = 0, H = 0, pts = [], edges = [], col = {}, raf = 0, on = true, last = 0;
  const days = records.map(seenDay).filter(Boolean).sort();
  const d0 = Date.parse(days[0] || latestDay), d1 = Date.parse(days.at(-1) || latestDay);
  const layout = () => {
    const b = c.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    W = b.width; H = b.height; c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    col = { case: cssVar("--s1"), app: cssVar("--s2"), learn: cssVar("--s3"), news: cssVar("--s4"), line: cssVar("--axis"), glow: cssVar("--select") };
    const idx = new Map();
    pts = records.map((r, i) => {
      const tt = (Date.parse(seenDay(r) || latestDay) - d0) / Math.max(1, d1 - d0);
      idx.set(r.id, i);
      return { r, x: W * 0.03 + tt * W * 0.94 + (hash01(r.id + "x") - 0.5) * W * 0.06, y: H * 0.08 + (1 - ((r.wow ?? 1) - 1) / 4) * H * 0.62 + (hash01(r.id) - 0.5) * H * 0.14, ph: hash01(r.id + "p") * 6.283, s: 0.9 + Math.sqrt(r.heat || 0) * 0.3, today: seenDay(r) >= latestDay };
    });
    edges = [];
    for (const [a, m] of ADJ) for (const b of m.keys()) if (a < b && idx.has(a) && idx.has(b)) edges.push([idx.get(a), idx.get(b)]);
  };
  const draw = (time) => {
    ctx.clearRect(0, 0, W, H);
    const y = (p) => p.y + Math.sin(time * 0.00035 + p.ph) * 4;
    ctx.globalAlpha = 0.22; ctx.strokeStyle = col.line; ctx.lineWidth = 0.7; ctx.beginPath();
    for (const [a, b] of edges) { ctx.moveTo(pts[a].x, y(pts[a])); ctx.lineTo(pts[b].x, y(pts[b])); }
    ctx.stroke();
    for (const p of pts) {
      ctx.globalAlpha = p.today ? 0.9 : 0.35;
      if (p.today) { ctx.fillStyle = col.glow; ctx.beginPath(); ctx.arc(p.x, y(p), p.s + 4 + Math.sin(time * 0.002 + p.ph) * 1.5, 0, 6.283); ctx.globalAlpha = 0.18; ctx.fill(); ctx.globalAlpha = 0.95; }
      ctx.fillStyle = col[p.r.type] || col.case; ctx.beginPath(); ctx.arc(p.x, y(p), p.s, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
  };
  const loop = (time) => { raf = requestAnimationFrame(loop); if (!on || document.hidden || time - last < 33) return; last = time; draw(time); };
  layout(); draw(0);
  if (!reduceMotion) raf = requestAnimationFrame(loop);
  new IntersectionObserver(([e]) => { on = e.isIntersecting; }).observe(c);
  let rt; new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(() => { layout(); draw(performance.now()); }, 120); }).observe(c);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { layout(); draw(performance.now()); });
  mastCanvas.redraw = () => { layout(); draw(performance.now()); };
}

function renderStatic() {
  renderMast();
  renderDays();
  $("#scan").textContent = t("new.scan").replace("{d}", DATA.scanned || DATA.updated);
  $("#rubric").innerHTML = [5, 4, 3, 2, 1].map((n) => `<li>${wowBar(n)}<span>${esc(t("rubric." + n))}</span></li>`).join("");
  const base = DATA.site?.url || "https://miles990.github.io/rea-awesome/";
  $("#agent-code").textContent = `GET ${base}api/records.json\nGET ${base}api/daily.json\nGET ${base}llms.txt\nGET ${base}feed.xml\n${base}?range=7&q=firmware&type=case&view=graph#r-zwo-asiair`;
  $("#updated").textContent = DATA.updated;
  // On GitHub Pages the site root is wherever the Traditional Chinese page lives.
  $("#api-link").href = (isPages ? DATA.pages["zh-TW"] : base) + "api/records.json";
}
document.addEventListener("click", (e) => { const g = e.target.closest(".fcard[data-go], .day-hl [data-go]"); if (g) reveal(g.dataset.go); });

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
        ${hl.length ? `<div class="day-hl">${hl.map((r) => `<button type="button" data-go="${esc(r.id)}">${thumbHTML(r, false, true)}<b>${esc(tx(r, "title"))}</b></button>`).join("")}</div>` : ""}
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
  mastCanvas.redraw?.();
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
  $("#lang").innerHTML = LANGS.map((l) => `<option value="${l}"${l === lang ? " selected" : ""}>${esc(UI[l]._name)}</option>`).join("");
  $("#sort").value = state.sort;
  $("#q").value = state.q;
  if (DATA.site?.repo) $("#repo-link").href = DATA.site.repo;
  haystack.clear(); layoutCache.clear();
  renderStatic(); update();
}

// Second batch: everything else, fetched after first paint. Relations, search text and
// layouts are rebuilt from the full set; a deep link to an older entry opens once it lands.
function loadFull() {
  if (!DATA.partial || !DATA.full) return;
  fetch(DATA.full, { credentials: "omit" }).then((r) => (r.ok ? r.json() : Promise.reject(r.status))).then((j) => {
    Object.assign(DATA, { i18n: j.i18n, thumbs: j.thumbs, history: j.history, partial: false });
    records = j.records.map((r, i) => ({ ...r, rank: r.rank ?? i + 1 }));
    byId = new Map(records.map((r) => [r.id, r]));
    ADJ = relations();
    DAYS = (DATA.history?.days || []).filter((d) => d.new?.length || d.text);
    haystack.clear(); layoutCache.clear(); dayCache = [null, new Set()];
    const want = wantedId;
    update(); renderDays(); mastCanvas.redraw?.();
    if (want && byId.has(want)) select(want, false);
    document.documentElement.dataset.full = "1";
  }).catch(() => { DATA.partial = false; DATA.total = records.length; update(); document.documentElement.dataset.full = "0"; });
}
readURL();
const wantedId = state.id && !byId.has(state.id) ? state.id : null;
renderAll();
mastCanvas();
if (DATA.partial) (window.requestIdleCallback || setTimeout)(loadFull, { timeout: 800 }); else document.documentElement.dataset.full = "1";
// Sticky panes sit under the command bar, whose height changes when it wraps.
new ResizeObserver(([e]) => document.documentElement.style.setProperty("--cmd-h", getComputedStyle($("#cmd")).position === "sticky" ? Math.round(e.borderBoxSize?.[0]?.blockSize || $("#cmd").offsetHeight) + "px" : "0px")).observe($("#cmd"));
if (state.id && byId.has(state.id) && location.hash) setTimeout(() => select(state.id, false), 0);
