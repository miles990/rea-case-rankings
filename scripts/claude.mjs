// Runs Claude Code headless with no tools and a single turn, so text scraped from
// the web can only influence the JSON it returns, never run commands or reach the
// network. In GitHub Actions the CLI reads CLAUDE_CODE_OAUTH_TOKEN from the env.
import { execFileSync, execFile } from "node:child_process";

export function claudeAvailable() {
  if (process.env.SKIP_CLAUDE) return false;
  try {
    execFileSync("claude", ["--version"], { stdio: "ignore", timeout: 30000 });
    return true;
  } catch {
    return false;
  }
}

// The first complete JSON object in the reply. The model sometimes adds a note or
// a second object after the answer, which a first-"{"-to-last-"}" slice can't parse.
export function firstJSON(text) {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("no JSON object in reply");
  let depth = 0, str = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (str) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') str = false; continue; }
    if (c === '"') str = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error("unterminated JSON object in reply");
}

export function askClaudeJSON(prompt) {
  const args = ["-p", "--output-format", "json", "--max-turns", "1", "--tools", ""];
  if (process.env.CLAUDE_MODEL) args.push("--model", process.env.CLAUDE_MODEL);
  const raw = execFileSync("claude", args, {
    input: prompt,
    encoding: "utf8",
    timeout: 300000,
    maxBuffer: 16 << 20,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return firstJSON(JSON.parse(raw).result || "");
}

export function askClaudeJSONAsync(prompt) {
  const args = ["-p", "--output-format", "json", "--max-turns", "1", "--tools", ""];
  if (process.env.CLAUDE_MODEL) args.push("--model", process.env.CLAUDE_MODEL);
  return new Promise((resolve, reject) => {
    const child = execFile("claude", args, { encoding: "utf8", timeout: 300000, maxBuffer: 16 << 20 }, (err, stdout) => {
      if (err) return reject(err);
      try {
        resolve(firstJSON(JSON.parse(stdout).result || ""));
      } catch (e) { reject(e); }
    });
    child.stdin.end(prompt);
  });
}

// Model output is untrusted: keep plain strings only, trimmed to a sane length.
export function clean(value, max = 400) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";
}
