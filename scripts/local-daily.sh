#!/usr/bin/env bash
# Daily run on this machine, where Claude Code and the browser are already
# signed in, so no subscription credential ever has to live in GitHub.
# collect (all sources; X via Grok and Reddit via OpenCLI when installed) → score →
# translate → daily brief → push → ask GitHub Actions to deploy. Runs under Git Bash
# on Windows (Task Scheduler, see scripts/install-windows-schedule.ps1) or on a Mac
# (launchd). GitHub Actions has no schedule of its own.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.grok/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export GITHUB_TOKEN="$(gh auth token)" CLAUDE_MODEL=sonnet
# X (Grok) only runs where the grok CLI is installed and signed in.
command -v grok >/dev/null && export ENABLE_GROK=1 || true
echo "== $(date '+%F %T') start"
git pull --rebase --autostash --quiet
node scripts/collect.mjs all
node scripts/translate.mjs
node scripts/daily.mjs
rm -f data/.pending-context.json
node scripts/validate.mjs
git add data/
git diff --cached --quiet || { git commit -q -m "data: local daily run $(date +%F)"; git push -q; }
gh workflow run daily.yml -R miles990/rea-case-rankings -f skip_collect=true
# Personal radar (private repo next to this one): once a day, on the first run
# that day (normally 08:18; later only if the machine was off in the morning).
stamp="$HOME/.cache/rea-case-rankings/radar-last-run"
if [ "$(cat "$stamp" 2>/dev/null)" = "$(date +%F)" ]; then
  echo "radar already ran today"
elif [ -x ../radar/scripts/daily.sh ] && ../radar/scripts/daily.sh; then
  mkdir -p "$(dirname "$stamp")" && date +%F > "$stamp"
else
  echo "radar skipped"
fi
echo "== $(date '+%F %T') done"
