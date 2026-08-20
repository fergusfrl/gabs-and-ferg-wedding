#!/usr/bin/env bash
# Wrapper so the sandbox's dev-server launcher (.claude/launch.json) picks up
# the Node version pinned in .nvmrc (Astro 7 requires >=22.12, this machine's
# default `node` on PATH is older).
set -euo pipefail
cd "$(dirname "$0")/.."
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck source=/dev/null
source "$NVM_DIR/nvm.sh"
nvm use >/dev/null
exec pnpm run dev
