// Merges curated cases and scored auto-discovered items into one ranked list.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const ROOT = new URL("..", import.meta.url);
const read = async (p, fallback) => {
  try {
    return JSON.parse(await readFile(new URL(p, ROOT), "utf8"));
  } catch {
    return fallback;
  }
};

// What an entry is: a use case, an REA-related app (plugin, port, GUI, package),
// a tutorial, or news and commentary.
const TYPE_OF = { 工具鏈: "app", 教學: "learn", "報導 / 評論": "news" };
const STATUS_WEIGHT = { tested: 3, shipped: 2, reported: 1 };
export const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);

// Popularity on one 0–100 scale. Signals differ by platform, so each is converted
// to "engagement equivalents" first: a star, an HN point or a like counts 1, a
// discussion upvote 3, and 100 video/post views count 1. log10 keeps a viral video
// from drowning everything; 5,000 equivalents or more is 100.
export function heatOf(pop = {}) {
  const eq = (pop.stars || 0) + (pop.points || 0) + (pop.likes || 0) + (pop.reactions || 0) + 3 * (pop.upvotes || 0) + (pop.views || 0) / 100;
  return eq > 0 ? Math.min(100, Math.round((100 * Math.log10(1 + eq)) / Math.log10(5001))) : 0;
}

// Same-source signal names for auto-discovered items, whose `score` field is raw.
const POP_FIELD = { GitHub: "stars", "Hacker News": "points", YouTube: "views", DEV: "reactions", Qiita: "likes", "GitHub Discussions": "upvotes", V2EX: "upvotes", Bluesky: "likes", Mastodon: "likes", X: "likes" };

// Ranking: score, then popularity, then strength of evidence, then recency.
export function rank(records) {
  return records.sort(
    (a, b) =>
      (b.wow ?? 0) - (a.wow ?? 0) ||
      (b.heat || 0) - (a.heat || 0) ||
      (STATUS_WEIGHT[b.status] || 0) - (STATUS_WEIGHT[a.status] || 0) ||
      (b.date || b.added || "").localeCompare(a.date || a.added || ""),
  );
}

export async function allRecords() {
  const cases = await read("data/cases.json", { cases: [] });
  const disc = await read("data/discovered.json", { items: [] });

  const curated = cases.cases.map((c) => ({ ...c, source: "curated", via: "人工整理" }));
  const auto = disc.items
    .filter((d) => d.relevant !== false && safeUrl(d.url))
    .map((d) => ({
      id: "d-" + createHash("sha1").update(d.url).digest("hex").slice(0, 10),
      title: d.title_zh || d.title,
      original_title: d.title,
      summary: d.summary || "",
      target: d.target || "",
      metric: d.metric || "",
      category: d.category || "待分類",
      status: d.status || null,
      wow: d.wow ?? null,
      lang: d.lang,
      author: d.author || "",
      author_url: d.source === "GitHub" && d.author ? `https://github.com/${d.author}` : "",
      date: d.date || null,
      added: d.found,
      links: [{ label: d.source, url: d.url }],
      source: "auto",
      via: d.source,
      kind: d.kind,
      pop: d.pop || (d.score != null ? { [POP_FIELD[d.source] || (d.source?.startsWith("Reddit") ? "upvotes" : "likes")]: d.score } : {}),
    }));

  for (const r of [...curated, ...auto]) {
    r.heat = heatOf(r.pop);
    r.type = TYPE_OF[r.category] || "case";
    r.links = (r.links || []).filter((l) => safeUrl(l.url));
    if (!safeUrl(r.author_url)) r.author_url = "";
  }
  return rank([...curated, ...auto].filter((r) => r.links.length));
}
