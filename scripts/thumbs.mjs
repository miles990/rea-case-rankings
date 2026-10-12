// Downloads a preview image for each ranked entry (YouTube still, GitHub social
// card, or the page's og:image) and stores a small JPEG in site/thumbs/.
// Viewers then load images from this site only: no third-party requests, no
// broken hotlinks, and the Artifact build can inline them.
import { pathToFileURL } from "node:url";
import { readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allRecords } from "./records.mjs";

const ROOT = new URL("..", import.meta.url);
const MANIFEST = new URL("data/thumbs.json", ROOT);
const DIR = new URL("site/thumbs/", ROOT);
const UA = "Mozilla/5.0 (compatible; rea-awesome-thumbs/1.0)";
const TODAY = new Date().toISOString().slice(0, 10);
const MAX_BYTES = 5 << 20;
const RETRY_DAYS = 7;

const MAGIC = [
  [[0xff, 0xd8, 0xff], "jpg"],
  [[0x89, 0x50, 0x4e, 0x47], "png"],
  [[0x47, 0x49, 0x46, 0x38], "gif"],
  [[0x52, 0x49, 0x46, 0x46], "webp"],
];
const kindOf = (buf) => MAGIC.find(([sig]) => sig.every((b, i) => buf[i] === b))?.[1];

async function get(url, accept) {
  const res = await fetch(url, { headers: { "user-agent": UA, accept }, redirect: "follow", signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`${res.status}`);
  const len = Number(res.headers.get("content-length") || 0);
  if (len > MAX_BYTES) throw new Error("too large");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error("too large");
  return { buf, type: res.headers.get("content-type") || "" };
}

// Preview candidates for a link, best first: platform stills, og:image, then the
// first figures in the page (used when the og:image is a site-wide default).
async function imageCandidates(link) {
  const u = new URL(link);
  const yt = u.hostname.endsWith("youtu.be") ? u.pathname.slice(1) : u.hostname.endsWith("youtube.com") ? u.searchParams.get("v") : null;
  if (yt && /^[\w-]{6,20}$/.test(yt)) return [`https://i.ytimg.com/vi/${yt}/hqdefault.jpg`];
  const gh = u.hostname === "github.com" && u.pathname.match(/^\/([\w.-]+)\/([\w.-]+)\/?$/);
  if (gh) return [`https://opengraph.githubassets.com/1/${gh[1]}/${gh[2]}`];
  if (/(^|\.)(x|twitter|bsky)\.(com|app)$/.test(u.hostname)) return []; // rendered by JavaScript; no static preview
  const { buf, type } = await get(link, "text/html");
  if (!type.includes("html")) return [];
  const html = buf.toString("utf8", 0, Math.min(buf.length, 800000));
  const out = [];
  const m = html.match(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*>/i);
  const og = m?.[0].match(/content=["']([^"']+)["']/i)?.[1];
  if (og) out.push(og);
  for (const im of html.matchAll(/<img[^>]+src=["']([^"']+\.(?:png|jpe?g|webp|svg))["']/gi)) if (!/favicon|logo|avatar|icon/i.test(im[1])) out.push(im[1]);
  return [...new Set(out.map((c) => { try { const a = new URL(c.replace(/&amp;/g, "&"), link); return /^https?:$/.test(a.protocol) ? a.href : null; } catch { return null; } }).filter(Boolean))].slice(0, 4);
}

// SVG is kept only when it cannot run anything if opened directly on this site.
const safeSvg = (buf) => {
  const s = buf.toString("utf8");
  return buf.length < 1.5e6 && /<svg[\s>]/i.test(s) && !/<script|\son\w+\s*=|javascript:|<foreignObject|<iframe|<embed|<object|xlink:href=["']https?:|href=["']https?:/i.test(s);
};

function resize(input, kind, output) {
  // 480×252 keeps the 1.91:1 social-card shape; quality 72 lands near 15–30 KB.
  const im = [`${kind}:${input}`, "-auto-orient", "-thumbnail", "480x252^", "-gravity", "center", "-extent", "480x252", "-strip", "-quality", "72", `jpg:${output}`];
  for (const [bin, args] of [["magick", im], ["convert", im], ["sips", ["-s", "format", "jpeg", "-s", "formatOptions", "72", "-Z", "480", input, "--out", output]]]) {
    try {
      execFileSync(bin, args, { stdio: "ignore", timeout: 30000 });
      if (existsSync(output) && statSync(output).size > 1000) return true;
    } catch {}
  }
  return false;
}

async function main() {
  let manifest = {};
  try {
    manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  } catch {}
  await mkdir(DIR, { recursive: true });
  const records = await allRecords();
  const stale = (m) => !m || (!m.file && (Date.parse(TODAY) - Date.parse(m.tried)) / 864e5 >= RETRY_DAYS);
  const todo = records.filter((r) => stale(manifest[r.id])).slice(0, Number(process.env.MAX_THUMBS_PER_RUN || 120));
  let ok = 0;
  async function fetchThumb(r, skip = new Set()) {
    for (const l of r.links) {
      let cands = [];
      try { cands = await imageCandidates(l.url); } catch { continue; }
      for (const src of cands) {
        if (skip.has(src)) continue;
        try {
          const { buf, type } = await get(src, "image/*");
          if (/svg/.test(type) || /\.svg($|\?)/i.test(src)) {
            if (!safeSvg(buf)) continue;
            const file = `${r.id}.svg`;
            await writeFile(new URL(file, DIR), buf);
            return { file, src };
          }
          const kind = kindOf(buf);
          if (!kind) continue;
          const tmp = join(tmpdir(), `thumb-${r.id}.${kind}`);
          await writeFile(tmp, buf);
          const file = `${r.id}.jpg`;
          const done = resize(tmp, kind, new URL(file, DIR).pathname);
          await rm(tmp, { force: true });
          if (done) return { file, src };
        } catch {}
      }
    }
    return {};
  }
  for (const r of todo) {
    manifest[r.id] = { tried: TODAY, ...(await fetchThumb(r)) };
    if (manifest[r.id].file) ok++;
  }
  // A site-wide default card is not a preview: retry those with the next candidate.
  const count = () => { const u = new Map(); for (const m of Object.values(manifest)) if (m.src) u.set(m.src, (u.get(m.src) || 0) + 1); return u; };
  const generic = new Set([...count()].filter(([, n]) => n >= 3).map(([s]) => s));
  for (const r of records) {
    const m = manifest[r.id];
    if (!m?.src || !generic.has(m.src)) continue;
    const next = await fetchThumb(r, generic);
    manifest[r.id] = next.file ? { tried: TODAY, ...next } : { ...m, generic: true };
  }

  // Drop image files nothing points to any more.
  const keep = new Set(Object.values(manifest).map((m) => m.file).filter(Boolean));
  for (const f of await readdir(DIR)) if (!keep.has(f)) await rm(new URL(f, DIR));
  await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`thumbnails: ${ok} new of ${todo.length} tried`);
}

// Run only when executed directly, not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
