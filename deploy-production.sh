#!/bin/bash
# 将 Preview 环境的代码上线到正式环境 (:8765)
# 用法: cd /tmp/desktop-pet && ./deploy-production.sh

set -e
PASS="${DEPLOY_PASS:?Set DEPLOY_PASS env var}"

echo "[Promote] Pushing preview code to production..."
sshpass -p "$PASS" ssh -o StrictHostKeyChecking=no root@118.196.36.27 "bash /root/promote.sh"

echo ""
echo "Production updated: http://118.196.36.27:8765"
