// Jev gate for scoring: a fast typed judgment (~250 ms, ~1k tokens) decides
// whether a new find is worth a full Claude scoring call. Questions and policy
// live in jev/score.questions.json and here; nothing else knows about the model.
// Fails open: no key, a timeout or a 429 sends the item to Claude as before.
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";

const API = "https://api.typesafe.ai/v1/systemone";
const MODEL = process.env.JEV_MODEL || "jev-1.13.0";
const QUESTIONS = JSON.parse(readFileSync(new URL("../jev/score.questions.json", import.meta.url), "utf8")).questions;
const LOG = new URL("../jev/runs.jsonl", import.meta.url);

// Policy, measured on jev/score.cases.jsonl (49 hand-labelled items):
// P(score ≥ 2) ≥ 0.3 kept 37/37 items worth scoring and skipped 8/10 junk items.
export const POLICY = { worthMin: 0.3, irrelevantMax: 0.15 };

export const jevAvailable = () => !!process.env.TYPESAFE_API_KEY && !process.env.SKIP_JEV;

export async function judge(item) {
  const host = (() => { try { return new URL(item.url).hostname; } catch { return ""; } })();
  const state = { title: item.title, source: item.source, author: item.author || "", link: host, text: (item.context || item.text || "").slice(0, 1500) };
  const t0 = Date.now();
  const res = await fetch(API, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, state, questions: QUESTIONS }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`jev ${res.status}`);
  const j = await res.json();
  const a = j.answers;
  const pWorth = 1 - (a.wow.probabilities?.["0"] ?? 0);
  const decision = !item.trusted && a.relevant.noul < POLICY.irrelevantMax ? "irrelevant" : pWorth >= POLICY.worthMin ? "claude" : "low";
  try {
    mkdirSync(new URL("../jev/", import.meta.url), { recursive: true });
    appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), cmd: "gate", model: j.model, id: item.url, stateHash: createHash("sha256").update(JSON.stringify(state)).digest("hex").slice(0, 12), answers: a, decision, latencyMs: Date.now() - t0, inputTokens: j.usage?.input_tokens ?? null }) + "\n");
  } catch {}
  return { decision, answers: a, pWorth };
}
