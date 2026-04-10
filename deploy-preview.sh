#!/bin/bash
# 将本地代码部署到 Preview 环境 (:8766)
# 用法: cd /tmp/desktop-pet && ./deploy-preview.sh

set -e
SERVER=root@118.196.36.27
PASS="${DEPLOY_PASS:?Set DEPLOY_PASS env var}"
REMOTE=/root/desktop-pet-preview

echo "[Deploy] Syncing backend to preview..."
sshpass -p "$PASS" rsync -avz --delete \
  --exclude 'node_modules' --exclude 'data/*.json' --exclude 'pets/' \
  -e "ssh -o StrictHostKeyChecking=no" \
  backend-ts/ $SERVER:$REMOTE/backend-ts/

echo "[Deploy] Syncing frontend to preview..."
sshpass -p "$PASS" rsync -avz --delete \
  --exclude 'node_modules' --exclude 'dist/' --exclude 'dist-electron/' \
  -e "ssh -o StrictHostKeyChecking=no" \
  src/ $SERVER:$REMOTE/src/

echo "[Deploy] Building frontend..."
sshpass -p "$PASS" ssh -o StrictHostKeyChecking=no $SERVER "cd $REMOTE && npx vite build"

echo "[Deploy] Restarting preview server..."
sshpass -p "$PASS" ssh -o StrictHostKeyChecking=no $SERVER "bash /root/preview.sh"

echo ""
echo "Preview deployed: http://118.196.36.27:8766"
