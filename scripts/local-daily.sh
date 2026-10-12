#!/bin/zsh
# Daily run on this Mac, where Claude Code, Grok and the browser are already
# signed in, so no subscription credential ever has to live in GitHub.
# collect (all sources, X via Grok, Reddit via OpenCLI) → score → translate →
# daily brief → push → ask GitHub Actions to deploy. launchd runs it at 08:18 and
# 12:30; GitHub Actions has no schedule of its own.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.grok/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
export GITHUB_TOKEN="$(gh auth token)" CLAUDE_MODEL=sonnet ENABLE_GROK=1
echo "== $(date '+%F %T') start"
git pull --rebase --autostash --quiet
node scripts/collect.mjs all
node scripts/translate.mjs
node scripts/daily.mjs
rm -f data/.pending-context.json
node scripts/validate.mjs
git add data/
git diff --cached --quiet || { git commit -q -m "data: local daily run $(date +%F)"; git push -q; }
gh workflow run daily.yml -R miles990/rea-awesome -f skip_collect=true
# Personal radar (private repo next to this one): once a day, on the first run
# that day (normally 08:18; later only if the Mac slept through the morning).
stamp="$HOME/.cache/rea-awesome/radar-last-run"
if [ "$(cat "$stamp" 2>/dev/null)" = "$(date +%F)" ]; then
  echo "radar already ran today"
elif [ -x ../radar/scripts/daily.sh ] && ../radar/scripts/daily.sh; then
  mkdir -p "${stamp:h}" && date +%F > "$stamp"
else
  echo "radar skipped"
fi
echo "== $(date '+%F %T') done"
