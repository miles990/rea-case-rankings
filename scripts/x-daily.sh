#!/bin/zsh
# Daily X search through Grok on this machine. Grok's subscription credentials
# stay local; only the found posts are pushed. GitHub Actions scores them at 01:00 UTC.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.grok/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
git pull --rebase --quiet
node scripts/collect.mjs x
git add data/discovered.json
git diff --cached --quiet || { git commit -q -m "data: X posts via Grok $(date +%F)"; git push -q; }
