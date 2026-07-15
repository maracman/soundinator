#!/usr/bin/env bash
# Update the deployed Soundinator to the latest commit and restart the service.
#
# Runs ON the VPS as the `resona` user (see docs/HOSTINGER_DEPLOY.md §9):
#
#     ssh resona@<vps> 'resona-app/scripts/vps_update.sh'
#
# Fast-forwards to origin/main only (a diverged server checkout aborts rather
# than merging), reinstalls requirements (no-op when unchanged), restarts the
# systemd unit, and verifies /api/health before declaring success. Prints the
# exact rollback command if the health check fails.
#
# Requires one sudoers line so the app user may restart its own service:
#     resona ALL=(root) NOPASSWD: /usr/bin/systemctl restart resona
set -euo pipefail

cd "$(dirname "$0")/.."

BRANCH="${1:-main}"
OLD=$(git rev-parse HEAD)

git fetch origin "$BRANCH"
NEW=$(git rev-parse "origin/$BRANCH")

if [ "$OLD" = "$NEW" ]; then
    echo "Already up to date ($(git rev-parse --short HEAD)) — nothing to do."
    exit 0
fi

echo "Updating $(git rev-parse --short "$OLD") → $(git rev-parse --short "$NEW"):"
git log --oneline "$OLD..$NEW" | sed 's/^/    /'

git merge --ff-only "origin/$BRANCH"
.venv/bin/pip install -q -r requirements.txt

sudo systemctl restart resona

# The server can take >2s to come up — poll rather than one fixed sleep, so a
# healthy-but-slow start doesn't read as a failed deploy (false alarm on the
# 2026-07-15 deploy).
healthy=0
for _ in $(seq 1 15); do
    sleep 2
    if curl -fsS localhost:8765/api/health > /dev/null 2>&1; then healthy=1; break; fi
done

if [ "$healthy" = 1 ]; then
    echo "OK — $(git rev-parse --short HEAD) is live and healthy."
else
    echo "!! Health check FAILED on $(git rev-parse --short HEAD)."
    echo "   Roll back with:"
    echo "     git reset --hard $OLD && sudo systemctl restart resona"
    echo "   Then check: journalctl -u resona -n 50"
    exit 1
fi
