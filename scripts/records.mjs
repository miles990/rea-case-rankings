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

const STATUS_WEIGHT = { tested: 3, shipped: 2, reported: 1 };
export const safeUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u : null);

export function rank(records) {
  return records.sort(
    (a, b) =>
      (b.wow ?? 0) - (a.wow ?? 0) ||
      (STATUS_WEIGHT[b.status] || 0) - (STATUS_WEIGHT[a.status] || 0) ||
      (b.source === "curated") - (a.source === "curated") ||
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
    }));

  for (const r of [...curated, ...auto]) {
    r.links = (r.links || []).filter((l) => safeUrl(l.url));
    if (!safeUrl(r.author_url)) r.author_url = "";
  }
  return rank([...curated, ...auto].filter((r) => r.links.length));
}
