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
# Two SSH sessions must not share or remove each other's staging/backup directories.
exec 9>"$root/opt/.nanaly-deploy.lock"
if ! flock -n 9; then
  echo 'Another backend deployment is running; no files were changed.' >&2
  exit 1
fi
uid=$(id -u nanaly)
as_nanaly() { runuser -u nanaly -- env DOCKER_HOST="unix:///run/user/$uid/docker.sock" XDG_RUNTIME_DIR="/run/user/$uid" "$@"; }
image=nanaly-runner:$tag
old_build=$(cat "$live/server/BUILD" 2>/dev/null || true)
old_image=$(sed -n 's/^NANALY_RUNNER_IMAGE=//p' "$env_file")
# Older installations use the server default when this setting is absent/empty.
old_image=${old_image:-nanaly-runner:1}

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

if as_nanaly docker image inspect "$image" > /dev/null 2>&1; then
  echo "  执行镜像 $image 已有，不重建"
else
  echo "▸ 构建执行镜像 $image（第一次要几分钟）"
  as_nanaly docker build -q -t "$image" "$next/server/runner" > /dev/null
fi
# 镜像存在不代表验收过。只复用当前线上成功版本的验收，且镜像实体和测试输入都必须相同。
# BUILD 只标记提交；无关页面更新不应让相同后端重复跑慢测试。
image_id=$(as_nanaly docker image inspect --format '{{.Id}}' "$image")
inputs=$(cd "$next" && find server tools/tests/server source/js/learning-lab.js tools/deploy/backend-remote.sh tools/schedule-data.cjs tools/migrate-private-content.mjs \
  -type f ! -path server/BUILD -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -d ' ' -f 1)
check_key=$(printf '%s\n%s\n' "$image_id" "$inputs" | sha256sum | cut -d ' ' -f 1)
verified=$(cat "$live/.backend-tested" 2>/dev/null || true)
if [ -n "$full" ] || [ "$verified" != "$check_key" ]; then
  # --full 对同一组输入重新验收；若这次失败，下次不能继续信任旧的成功记录。
  if [ "$verified" = "$check_key" ]; then rm -f "$live/.backend-tested"; fi
  echo '▸ 用新版本跑真实 Docker 集成测试（两分钟左右）'
  log=$(mktemp)
  if ! (cd "$next" && as_nanaly env NANALY_RUNNER_IMAGE="$image" NANALY_DOCKER_TESTS=1 node --test tools/tests/server/docker*.integration.test.mjs) > "$log" 2>&1; then
    tail -40 "$log"
    rm -f "$log"
    echo '✗ 集成测试没过。线上运行代码、配置和服务没有动。' >&2
    exit 1
  fi
  { grep -E '^ℹ (pass|fail|skipped)' "$log" || true; } | tr '\n' ' '; echo
  rm -f "$log"
else
  echo '  镜像与后端测试输入和已验收的线上版本相同，跳过集成测试（--full 可强制重测）'
fi

healthy() {
  local expected_build=$1 out
  for _ in $(seq 40); do
    if out=$(curl -fsS -m 3 http://127.0.0.1:4318/api/health 2> /dev/null) &&
      echo "$out" | grep -q '"ready":true' &&
      { [ -z "$expected_build" ] || echo "$out" | grep -q "\"build\":\"$expected_build\""; }; then
      return 0
    fi
    sleep 1
  done
  return 1
}

echo "▸ 切换到 $build 并重启服务"
cp -p "$env_file" "$env_file.prev"
rm -rf "$prev"
# Once the config can change, every failure must restore it, including a failed
# directory rename or an interrupted SSH session before systemctl is reached.
rollback() {
  local status=$? restored=1
  trap - EXIT INT TERM
  set +e
  echo '✗ 新版本切换、重启或健康检查失败，退回上一版。最近的服务日志：' >&2
  journalctl -u nanaly -n 20 --no-pager >&2
  if [ -d "$prev" ]; then
    if [ -e "$live" ]; then
      rm -rf "$failed" && mv "$live" "$failed" || restored=0
    fi
    if [ "$restored" = 1 ]; then mv "$prev" "$live" || restored=0; fi
  fi
  cp -p "$env_file.prev" "$env_file" || restored=0
  if [ "$restored" = 1 ] && systemctl restart nanaly && healthy "$old_build"; then
    echo "  已退回且旧版健康检查通过。失败版本或暂存目录保留，方便查看。" >&2
  else
    echo "  目录与配置恢复或旧版重启或健康检查仍失败，需要检查 nanaly.service。失败版本在 $failed。" >&2
  fi
  [ "$status" -ne 0 ] || status=1
  exit "$status"
}
trap rollback EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if grep -q '^NANALY_RUNNER_IMAGE=' "$env_file"; then
  sed -i "s|^NANALY_RUNNER_IMAGE=.*|NANALY_RUNNER_IMAGE=$image|" "$env_file"
else
  # sed alone succeeds without changing anything when upgrading an old env file.
  # Include a newline even if the previous last setting had none.
  printf '\nNANALY_RUNNER_IMAGE=%s\n' "$image" >> "$env_file"
fi
mv "$live" "$prev"
mv "$next" "$live"
systemctl restart nanaly
healthy "$build"
trap - EXIT INT TERM
# 只有测试通过并且新版实际启动成功，后续部署才可以复用这次验收。
printf '%s\n' "$check_key" > "$live/.backend-tested"
echo "✓ 服务器上已是 $build"

# 只留当前和上一版镜像：上一版给回退用，再往前的占地方（每个 1.3 GB 左右）。
as_nanaly docker images --format '{{.Repository}}:{{.Tag}}' nanaly-runner | while read -r ref; do
  [ "$ref" = "$image" ] || [ "$ref" = "$old_image" ] || as_nanaly docker rmi "$ref" > /dev/null || true
done
