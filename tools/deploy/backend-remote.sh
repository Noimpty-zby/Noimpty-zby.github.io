#!/usr/bin/env bash
# 服务器端的部署步骤，由 tools/deploy/backend.sh 经 ssh 以 root 执行。
# 参数：打包文件 提交号 执行镜像标签 [full]
#
# 顺序：解到 /opt/blog.next → 需要时构建镜像并跑真实集成测试 → 换环境里的镜像名 →
# 目录对调、重启 → 本机健康检查必须报出新提交号且执行环境就绪，否则把目录和环境配置都换回去再重启。
# 线上目录在「测试通过」之前一直没动过。
set -euo pipefail
archive=$1 build=$2 tag=$3 full=${4:-}
root=${NANALY_DEPLOY_ROOT:-}  # 只给测试用：把整套路径挪进临时目录
live=$root/opt/blog next=$root/opt/blog.next prev=$root/opt/blog.prev failed=$root/opt/blog.failed
env_file=$root/etc/nanaly.env unit=$root/etc/systemd/system/nanaly.service
uid=$(id -u nanaly)
as_nanaly() { runuser -u nanaly -- env DOCKER_HOST="unix:///run/user/$uid/docker.sock" XDG_RUNTIME_DIR="/run/user/$uid" "$@"; }
image=nanaly-runner:$tag
old_image=$(sed -n 's/^NANALY_RUNNER_IMAGE=//p' "$env_file")

echo "▸ 解包到 $next"
rm -rf "$next"
install -d -m 0755 "$next"
tar -xzf "$archive" -C "$next" --no-same-owner
chmod -R u=rwX,go=rX "$next"
echo "$build" > "$next/server/BUILD"

# 只比有效行：安装时删掉模板开头的注释很常见，那不算不一样。
expected_unit=$(sed "s/@NANALY_UID@/$uid/g" "$next/server/nanaly.service.example" | grep -v '^#' || true)
[ "$expected_unit" = "$(grep -v '^#' "$unit" 2> /dev/null || true)" ] ||
  echo '  注意：server/nanaly.service.example 和已安装的服务文件不一样，这次没有自动替换。'

needs_tests=''
if as_nanaly docker image inspect "$image" > /dev/null 2>&1; then
  echo "  执行镜像 $image 已有，不重建"
else
  echo "▸ 构建执行镜像 $image（第一次要几分钟）"
  as_nanaly docker build -q -t "$image" "$next/server/runner" > /dev/null
  needs_tests=yes
fi
if [ -n "$needs_tests$full" ]; then
  echo '▸ 用新版本跑真实 Docker 集成测试（两分钟左右）'
  log=$(mktemp)
  if ! (cd "$next" && as_nanaly env NANALY_RUNNER_IMAGE="$image" NANALY_DOCKER_TESTS=1 node --test tools/tests/server/docker*.integration.test.mjs) > "$log" 2>&1; then
    tail -40 "$log"
    echo '✗ 集成测试没过。线上版本没有动。' >&2
    exit 1
  fi
  { grep -E '^ℹ (pass|fail|skipped)' "$log" || true; } | tr '\n' ' '; echo
  rm -f "$log"
fi

healthy() {
  local out
  for _ in $(seq 40); do
    if out=$(curl -fsS -m 3 http://127.0.0.1:4318/api/health 2> /dev/null) &&
      echo "$out" | grep -q "\"build\":\"$build\"" && echo "$out" | grep -q '"ready":true'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

echo "▸ 切换到 $build 并重启服务"
cp -p "$env_file" "$env_file.prev"
sed -i "s|^NANALY_RUNNER_IMAGE=.*|NANALY_RUNNER_IMAGE=$image|" "$env_file"
rm -rf "$prev"
mv "$live" "$prev"
mv "$next" "$live"
systemctl restart nanaly

if ! healthy; then
  echo '✗ 新版本启动后健康检查不过，退回上一版。最近的服务日志：' >&2
  journalctl -u nanaly -n 20 --no-pager >&2 || true
  rm -rf "$failed"
  mv "$live" "$failed"
  mv "$prev" "$live"
  cp -p "$env_file.prev" "$env_file"
  systemctl restart nanaly
  echo "  已退回。失败的版本留在 $failed 方便查看。" >&2
  exit 1
fi
echo "✓ 服务器上已是 $build"

# 只留当前和上一版镜像：上一版给回退用，再往前的占地方（每个 1.3 GB 左右）。
as_nanaly docker images --format '{{.Repository}}:{{.Tag}}' nanaly-runner | while read -r ref; do
  [ "$ref" = "$image" ] || [ "$ref" = "$old_image" ] || as_nanaly docker rmi "$ref" > /dev/null || true
done
