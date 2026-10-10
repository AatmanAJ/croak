#!/bin/sh
# Push this folder (code and .env, not the database) to the Croak server, reinstall packages and
# restart the bot. Set CROAK_HOST=ubuntu@<server-ip> in .env; the SSH key defaults to
# ~/.ssh/croak-aws.pem (override with CROAK_KEY).
set -e
cd "$(dirname "$0")/.."
HOST=$(grep -E '^CROAK_HOST=' .env | cut -d= -f2-)
KEY=${CROAK_KEY:-$HOME/.ssh/croak-aws.pem}
[ -n "$HOST" ] || { echo "Add CROAK_HOST=ubuntu@<server-ip> to .env"; exit 1; }
rsync -az -e "ssh -i $KEY" --exclude node_modules --exclude .git --exclude data --exclude backups \
  --exclude results --exclude demo --exclude brand --exclude .DS_Store ./ "$HOST:croak/"
ssh -i "$KEY" "$HOST" 'cd croak && npm ci --no-audit --no-fund --silent && sudo systemctl restart croak && sleep 6 && journalctl -u croak -n 6 --no-pager -o cat'
