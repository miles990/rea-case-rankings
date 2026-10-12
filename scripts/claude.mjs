// Runs Claude Code headless with no tools and a single turn, so text scraped from
// the web can only influence the JSON it returns, never run commands or reach the
// network. In GitHub Actions the CLI reads CLAUDE_CODE_OAUTH_TOKEN from the env.
import { execFileSync } from "node:child_process";

export function claudeAvailable() {
  if (process.env.SKIP_CLAUDE) return false;
  try {
    execFileSync("claude", ["--version"], { stdio: "ignore", timeout: 30000 });
    return true;
  } catch {
    return false;
  }
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
  const text = JSON.parse(raw).result || "";
  return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
}

// Model output is untrusted: keep plain strings only, trimmed to a sane length.
export function clean(value, max = 400) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";
}
