// Jev gate for scoring: a fast typed judgment (~250 ms, ~1k tokens) decides
// whether a new find is worth a full Claude scoring call. Questions and policy
// live in jev/score.questions.json and here; nothing else knows about the model.
// Fails open: no key, a timeout or a 429 sends the item to Claude as before.
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const API = "https://api.typesafe.ai/v1/systemone";
const MODEL = process.env.JEV_MODEL || "jev-1.13.0";
const QUESTIONS = JSON.parse(readFileSync(new URL("../jev/score.questions.json", import.meta.url), "utf8")).questions;
const REPO_QUESTIONS = JSON.parse(readFileSync(new URL("../jev/repo.questions.json", import.meta.url), "utf8")).questions;
const LOG = new URL("../jev/runs.jsonl", import.meta.url);

// Policy, measured on jev/score.cases.jsonl (49 hand-labelled items):
// P(score ≥ 2) ≥ 0.3 kept 37/37 items worth scoring and skipped 8/10 junk items.
// Repos found by code search (needsRepoKind): measured on jev/repo.cases.jsonl (42
// hand-labelled repos), dropping when P(copy + bundle + other) ≥ 0.6 removed 31/34
// copies and skill bundles and lost 2/8 real REA projects (both borderline).
export const POLICY = { worthMin: 0.3, irrelevantMax: 0.15, notProjectMin: 0.6 };

// Same lookup as the jev CLI: the environment, then ~/.config/jev/config.json
// (scheduled jobs don't load the shell profile). The key never leaves this machine.
const KEY = (() => {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY;
  try { return JSON.parse(readFileSync(join(homedir(), ".config/jev/config.json"), "utf8")).apiKey || ""; } catch { return ""; }
})();
export const jevAvailable = () => !!KEY && !process.env.SKIP_JEV;

export async function judge(item) {
  const host = (() => { try { return new URL(item.url).hostname; } catch { return ""; } })();
  const state = { title: item.title, source: item.source, author: item.author || "", link: host, text: (item.context || item.text || "").slice(0, 1500) };
  if (item.evidence) state.evidence = item.evidence;
  const questions = item.needsRepoKind ? { ...QUESTIONS, ...REPO_QUESTIONS } : QUESTIONS;
  const t0 = Date.now();
  const res = await fetch(API, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, state, questions }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`jev ${res.status}`);
  const j = await res.json();
  const a = j.answers;
  const pWorth = 1 - (a.wow.probabilities?.["0"] ?? 0);
  const rk = a.repo_kind?.probabilities;
  const notProject = rk ? (rk.copy || 0) + (rk.bundle || 0) + (rk.other || 0) : 0;
  const decision = (!item.trusted && a.relevant.noul < POLICY.irrelevantMax) || notProject >= POLICY.notProjectMin ? "irrelevant" : pWorth >= POLICY.worthMin ? "claude" : "low";
  try {
    mkdirSync(new URL("../jev/", import.meta.url), { recursive: true });
    appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), cmd: "gate", model: j.model, id: item.url, stateHash: createHash("sha256").update(JSON.stringify(state)).digest("hex").slice(0, 12), answers: a, decision, latencyMs: Date.now() - t0, inputTokens: j.usage?.input_tokens ?? null }) + "\n");
  } catch {}
  return { decision, answers: a, pWorth };
}
