#!/usr/bin/env bash
# 一条命令更新私有后端：npm run deploy:backend（加 -- --full 强制跑一遍真实 Docker 集成测试）
#
# 只部署已提交的代码 —— 部署完 /api/health 的 build 字段就是这个提交号，线上跑的是哪版一查便知。
# 执行镜像按 server/runner/ 的内容命名，没变就不重建；新镜像先跑真实集成测试，过了才切换。
# 服务器上的步骤（切换、重启、失败自动退回上一版）见 backend-remote.sh。
set -euo pipefail
cd "$(dirname "$0")/../.."

host=${NANALY_DEPLOY_HOST:-ubuntu@43.156.15.56}
key=${NANALY_DEPLOY_KEY:-$HOME/.ssh/nanaly_deploy_ed25519}
known=${NANALY_DEPLOY_KNOWN_HOSTS:-$HOME/.ssh/known_hosts_nanaly}
api=${NANALY_DEPLOY_API:-https://api.noimpty-zby.cn}
full=''
[ "${1:-}" = '--full' ] && full=full
paths=(server tools/tests/server tools/deploy/backend-remote.sh source/js/learning-lab.js)

if ! git diff --quiet HEAD -- "${paths[@]}" || [ -n "$(git ls-files --others --exclude-standard -- "${paths[@]}")" ]; then
  echo '后端相关文件有没提交的改动。先提交再部署，这样服务器上跑的正好是某一个提交。' >&2
  exit 1
fi
build=$(git rev-parse --short=12 HEAD)
tag=$(git rev-parse --short=12 HEAD:server/runner)
git merge-base --is-ancestor HEAD origin/main 2>/dev/null || echo "提醒：$build 还没推到 GitHub，照样部署。"

echo "▸ 本地后端测试"
if ! log=$(node --test tools/tests/server/*.test.mjs 2>&1); then
  echo "$log" | tail -40
  echo '本地后端测试没过，没有上传。' >&2
  exit 1
fi

echo "▸ 上传提交 $build（执行镜像 nanaly-runner:$tag）；更新时正在执行的代码会被中断"
remote="set -e; d=\$(mktemp -d); trap 'rm -rf \"\$d\"' EXIT; cat > \"\$d/a.tgz\";"
remote+=" tar -xzf \"\$d/a.tgz\" -C \"\$d\" tools/deploy/backend-remote.sh;"
remote+=" sudo -n bash \"\$d/tools/deploy/backend-remote.sh\" \"\$d/a.tgz\" $build $tag $full < /dev/null"
git archive --format=tar.gz HEAD "${paths[@]}" |
  ssh -i "$key" -o IdentitiesOnly=yes -o BatchMode=yes -o UserKnownHostsFile="$known" -o StrictHostKeyChecking=yes "$host" "$remote"

echo "▸ 从公网复查 $api"
health=$(curl -fsS -m 20 "$api/api/health")
if echo "$health" | grep -q "\"build\":\"$build\"" && echo "$health" | grep -q '"ready":true'; then
  echo "✓ 部署完成：线上是 $build，执行环境就绪。"
else
  echo "✗ 服务器那边报告成功，但公网健康检查对不上：$health" >&2
  exit 1
fi
