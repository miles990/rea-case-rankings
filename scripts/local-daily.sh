#!/bin/zsh
# Daily run on this Mac, where Claude Code, Grok and the browser are already
# signed in, so no subscription credential ever has to live in GitHub.
# collect (all sources, X via Grok, Reddit via OpenCLI) → score → translate →
# daily brief → push → ask GitHub Actions to deploy. Actions' own 01:00 UTC
# run stays as a fallback for days this Mac is off.
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
# Personal radar (private repo next to this one), if present.
[ -x ../radar/scripts/run.sh ] && ../radar/scripts/run.sh || echo "radar skipped"
echo "== $(date '+%F %T') done"
