// Fills UI strings that exist in English but are missing in another language.
// Run after adding keys to site/ui.json (en + zh-TW are written by hand).
import { readFileSync, writeFileSync } from "node:fs";
import { askClaudeJSON } from "./claude.mjs";

const p = new URL("../site/ui.json", import.meta.url);
const ui = JSON.parse(readFileSync(p, "utf8"));
const missingFor = (l) => Object.fromEntries(Object.entries(ui.en).filter(([k, v]) => !k.startsWith("_") && (ui[l][k] == null || (typeof v === "object" && Object.keys(v).some((x) => ui[l][k]?.[x] == null)))));
for (const l of Object.keys(ui).filter((l) => !["en", "zh-TW"].includes(l))) {
  const miss = missingFor(l);
  if (!Object.keys(miss).length) continue;
  const out = askClaudeJSON(`Translate these website UI strings from English into ${ui[l]._name} (${l}). Keep keys exactly, keep {n} {a} {b} {d} placeholders and <b> tags, keep product names (REA, GitHub, JSON, RSS, llms.txt, HN, Claude, Bluesky, YouTube, X) unchanged. Natural, concise UI copy.${l === "zh-CN" ? " Use Simplified Chinese; Traditional reference: " + JSON.stringify(Object.fromEntries(Object.keys(miss).map((k) => [k, ui["zh-TW"][k]]))) : ""}
Return ONLY JSON with the same keys.
${JSON.stringify(miss)}`);
  for (const [k, v] of Object.entries(out)) if (k in miss) ui[l][k] = typeof miss[k] === "object" ? { ...(ui[l][k] || {}), ...v } : v;
  writeFileSync(p, JSON.stringify(ui, null, 2) + "\n");
  console.log("filled", l, Object.keys(miss).length);
}
