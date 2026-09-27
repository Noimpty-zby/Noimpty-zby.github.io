// Drives tools/deploy/backend-remote.sh inside a temporary root with stubbed docker/systemctl/curl,
// so the swap and rollback paths are exercised without touching a real server.
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const script = path.resolve('tools/deploy/backend-remote.sh')
const unitExample = '# Replace @NANALY_UID@ before installing.\n[Service]\nRequires=user@@NANALY_UID@.service\n'

const stubs = {
  id: 'echo 1002',
  runuser: 'while [ "$1" != "--" ]; do shift; done; shift; exec "$@"',
  docker: `echo "docker $*" >> "$STUB/calls"
case "$1 $2" in
  "image inspect")
    if [ "$3" = '--format' ]; then
      grep -qx "$5" "$STUB/images" && printf 'sha256:%s:%s\\n' "$5" "\${IMAGE_REVISION:-1}"
    else grep -qx "$3" "$STUB/images"; fi ;;
  "build -q") echo "$4" >> "$STUB/images" ;;
  "images --format") cat "$STUB/images" ;;
  "rmi "*) grep -vx "$2" "$STUB/images" > "$STUB/images.new"; mv "$STUB/images.new" "$STUB/images" ;;
esac`,
  node: 'echo "node $*" >> "$STUB/calls"; echo "ℹ pass 13"; exit "${NODE_EXIT:-0}"',
  systemctl: `echo "systemctl $*" >> "$STUB/calls"
if [ "$RESTART_FAIL_ALL" = 1 ] || { [ -n "$RESTART_FAIL_BUILD" ] && [ "$RESTART_FAIL_BUILD" = "$(cat "$NANALY_DEPLOY_ROOT/opt/blog/server/BUILD" 2>/dev/null)" ]; }; then exit 1; fi`,
  curl: `build=$(cat "$NANALY_DEPLOY_ROOT/opt/blog/server/BUILD" 2>/dev/null)
echo "curl $build" >> "$STUB/calls"
if [ -n "$HEALTH_FAIL" ] || { [ -n "$HEALTH_FAIL_BUILD" ] && [ "$HEALTH_FAIL_BUILD" = "$build" ]; }; then exit 7; fi
printf '{"ok":true,"build":"%s","runner":{"ready":true}}' "$build"`,
  journalctl: 'echo "service log"',
  sleep: 'true'
}

const setup = ({ images = ['nanaly-runner:old', 'nanaly-runner:older'] } = {}) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'deploy-backend-'))
  const root = path.join(dir, 'root'), bin = path.join(dir, 'bin'), stub = path.join(dir, 'stub'), src = path.join(dir, 'src')
  for (const d of [bin, stub, path.join(root, 'opt/blog/server'), path.join(root, 'etc/systemd/system'), path.join(src, 'server/runner'), path.join(src, 'tools/tests/server'), path.join(src, 'tools/deploy'), path.join(src, 'source/js')]) mkdirSync(d, { recursive: true })
  for (const [name, body] of Object.entries(stubs)) { writeFileSync(path.join(bin, name), '#!/usr/bin/env bash\n' + body + '\n'); chmodSync(path.join(bin, name), 0o755) }
  writeFileSync(path.join(stub, 'images'), images.map(i => i + '\n').join(''))
  writeFileSync(path.join(stub, 'calls'), '')
  writeFileSync(path.join(root, 'opt/blog/server/app.mjs'), 'old')
  writeFileSync(path.join(root, 'etc/nanaly.env'), 'NANALY_DATA_DIR=/srv/nanaly-private\nNANALY_RUNNER_IMAGE=nanaly-runner:old\nPORT=4318\n')
  // Installed copy without the template's comment line, as on the real server.
  writeFileSync(path.join(root, 'etc/systemd/system/nanaly.service'), '[Service]\nRequires=user@1002.service\n')
  writeFileSync(path.join(src, 'server/app.mjs'), 'new')
  writeFileSync(path.join(src, 'server/nanaly.service.example'), unitExample)
  writeFileSync(path.join(src, 'server/runner/Dockerfile'), 'FROM scratch\n')
  writeFileSync(path.join(src, 'source/js/learning-lab.js'), 'reference code')
  writeFileSync(path.join(src, 'tools/deploy/backend-remote.sh'), readFileSync(script))
  writeFileSync(path.join(src, 'tools/tests/server/docker.integration.test.mjs'), 'integration tests')
  const archive = path.join(dir, 'a.tgz')
  const repack = (files = {}) => {
    for (const [rel, contents] of Object.entries(files)) writeFileSync(path.join(src, rel), contents)
    execFileSync('tar', ['-czf', archive, '-C', src, 'server', 'tools', 'source'])
  }
  repack()
  const run = (args, env = {}) => spawnSync('bash', [script, archive, ...args], {
    encoding: 'utf8', env: { ...process.env, PATH: bin + ':' + process.env.PATH, STUB: stub, NANALY_DEPLOY_ROOT: root, HEALTH_FAIL: '', HEALTH_FAIL_BUILD: '', RESTART_FAIL_ALL: '', RESTART_FAIL_BUILD: '', IMAGE_REVISION: '1', ...env }
  })
  const read = rel => readFileSync(path.join(root, rel), 'utf8')
  const calls = () => readFileSync(path.join(stub, 'calls'), 'utf8')
  const imageList = () => readFileSync(path.join(stub, 'images'), 'utf8').trim().split('\n').filter(Boolean).sort()
  return { dir, root, run, read, calls, imageList, repack, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test('new runner image is built and integration-tested before the swap; old images beyond one are pruned', t => {
  const s = setup(); t.after(s.cleanup)
  const result = s.run(['abc123def456', 'feed00000001'])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(s.read('opt/blog/server/app.mjs'), 'new')
  assert.equal(s.read('opt/blog/server/BUILD').trim(), 'abc123def456')
  assert.equal(s.read('opt/blog.prev/server/app.mjs'), 'old')
  assert.match(s.read('etc/nanaly.env'), /^NANALY_RUNNER_IMAGE=nanaly-runner:feed00000001$/m)
  assert.match(s.read('etc/nanaly.env'), /^NANALY_DATA_DIR=\/srv\/nanaly-private$/m)
  const calls = s.calls()
  assert.ok(calls.indexOf('docker build') < calls.indexOf('node --test') && calls.indexOf('node --test') < calls.indexOf('systemctl restart'), calls)
  assert.deepEqual(s.imageList(), ['nanaly-runner:feed00000001', 'nanaly-runner:old'])
  assert.doesNotMatch(result.stdout, /不一样/)
})

test('only an already verified image and identical backend inputs skip tests; --full always retests', t => {
  const s = setup({ images: ['nanaly-runner:old'] }); t.after(s.cleanup)
  let result = s.run(['abc123def456', 'old'])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(s.calls(), /node --test/)
  assert.doesNotMatch(s.calls(), /docker build/)
  let previousCalls = s.calls()
  result = s.run(['abc123def457', 'old'])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.doesNotMatch(s.calls().slice(previousCalls.length), /docker build|node --test/)
  assert.equal(s.read('opt/blog/server/BUILD').trim(), 'abc123def457')
  previousCalls = s.calls()
  result = s.run(['abc123def458', 'old', 'full'])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(s.calls().slice(previousCalls.length), /node --test/)
  assert.doesNotMatch(s.calls(), /docker build/)
})

test('failing integration tests stop the deploy before the live directory, env or service are touched', t => {
  const s = setup(); t.after(s.cleanup)
  const result = s.run(['abc123def456', 'feed00000001'], { NODE_EXIT: '1' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /线上运行代码、配置和服务没有动/)
  assert.equal(s.read('opt/blog/server/app.mjs'), 'old')
  assert.match(s.read('etc/nanaly.env'), /^NANALY_RUNNER_IMAGE=nanaly-runner:old$/m)
  assert.doesNotMatch(s.calls(), /systemctl/)
})

test('a new version that fails its health check is rolled back with the previous env and restarted', t => {
  const s = setup({ images: ['nanaly-runner:old'] }); t.after(s.cleanup)
  const result = s.run(['abc123def456', 'feed00000001'], { HEALTH_FAIL_BUILD: 'abc123def456' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /退回上一版/)
  assert.equal(s.read('opt/blog/server/app.mjs'), 'old')
  assert.equal(existsSync(path.join(s.root, 'opt/blog/server/BUILD')), false)
  assert.equal(s.read('opt/blog.failed/server/app.mjs'), 'new')
  assert.match(s.read('etc/nanaly.env'), /^NANALY_RUNNER_IMAGE=nanaly-runner:old$/m)
  assert.equal(s.calls().match(/systemctl restart nanaly/g).length, 2)
  assert.deepEqual(s.imageList(), ['nanaly-runner:feed00000001', 'nanaly-runner:old'])
})

test('a changed service unit is reported but never installed automatically', t => {
  const s = setup({ images: ['nanaly-runner:old'] }); t.after(s.cleanup)
  writeFileSync(path.join(s.root, 'etc/systemd/system/nanaly.service'), '[Service]\nold\n')
  const result = s.run(['abc123def456', 'old'])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(result.stdout, /服务文件不一样/)
  assert.equal(s.read('etc/systemd/system/nanaly.service'), '[Service]\nold\n')
})


test('retrying a failed integration test retests the cached image and leaves production unchanged', t => {
  const s = setup(); t.after(s.cleanup)
  for (let attempt = 0; attempt < 2; attempt++) {
    const previousCalls = s.calls()
    const result = s.run(['abc123def456', 'feed00000001'], { NODE_EXIT: '1' })
    assert.notEqual(result.status, 0)
    assert.match(s.calls().slice(previousCalls.length), /node --test/)
    assert.equal(s.read('opt/blog/server/app.mjs'), 'old')
    assert.match(s.read('etc/nanaly.env'), /^NANALY_RUNNER_IMAGE=nanaly-runner:old$/m)
    assert.doesNotMatch(s.calls(), /systemctl/)
  }
  assert.equal(s.calls().match(/docker build/g).length, 1)
})

test('changed backend, test, reference or deploy inputs require testing even with the same image', t => {
  for (const file of ['server/app.mjs', 'tools/tests/server/docker.integration.test.mjs', 'source/js/learning-lab.js', 'tools/deploy/backend-remote.sh']) {
    const s = setup({ images: ['nanaly-runner:old'] }); t.after(s.cleanup)
    const first = s.run(['abc123def456', 'old'])
    assert.equal(first.status, 0, first.stdout + first.stderr)
    const previousCalls = s.calls()
    s.repack({ [file]: 'changed input' })
    const result = s.run(['abc123def457', 'old'], { NODE_EXIT: '1' })
    assert.notEqual(result.status, 0, file)
    assert.match(s.calls().slice(previousCalls.length), /node --test/, file)
    assert.doesNotMatch(s.calls().slice(previousCalls.length), /docker build|systemctl/, file)
    assert.equal(s.read('opt/blog/server/BUILD').trim(), 'abc123def456', file)
  }
})

test('replacing the image behind an unchanged tag invalidates the previous verification', t => {
  const s = setup({ images: ['nanaly-runner:old'] }); t.after(s.cleanup)
  assert.equal(s.run(['abc123def456', 'old']).status, 0)
  const previousCalls = s.calls()
  const result = s.run(['abc123def457', 'old'], { IMAGE_REVISION: '2', NODE_EXIT: '1' })
  assert.notEqual(result.status, 0)
  assert.match(s.calls().slice(previousCalls.length), /node --test/)
  assert.doesNotMatch(s.calls().slice(previousCalls.length), /systemctl/)
})

test('a failing --full invalidates the old success so a normal retry must test again', t => {
  const s = setup({ images: ['nanaly-runner:old'] }); t.after(s.cleanup)
  assert.equal(s.run(['abc123def456', 'old']).status, 0)
  const failed = s.run(['abc123def457', 'old', 'full'], { NODE_EXIT: '1' })
  assert.notEqual(failed.status, 0)
  const previousCalls = s.calls()
  const retry = s.run(['abc123def457', 'old'], { NODE_EXIT: '1' })
  assert.notEqual(retry.status, 0)
  assert.match(s.calls().slice(previousCalls.length), /node --test/)
  assert.doesNotMatch(s.calls().slice(previousCalls.length), /systemctl/)
  assert.equal(s.read('opt/blog/server/BUILD').trim(), 'abc123def456')
})

test('a restart command failure rolls back code and config and verifies the previous build', t => {
  const s = setup(); t.after(s.cleanup)
  assert.equal(s.run(['abc123def455', 'old']).status, 0)
  const previousCalls = s.calls()
  s.repack({ 'server/app.mjs': 'failing new version' })
  const result = s.run(['abc123def456', 'feed00000001'], { RESTART_FAIL_BUILD: 'abc123def456' })
  assert.notEqual(result.status, 0)
  assert.equal(s.read('opt/blog/server/BUILD').trim(), 'abc123def455')
  assert.equal(s.read('opt/blog/server/app.mjs'), 'new')
  assert.equal(s.read('opt/blog.failed/server/app.mjs'), 'failing new version')
  assert.match(s.read('etc/nanaly.env'), /^NANALY_RUNNER_IMAGE=nanaly-runner:old$/m)
  const calls = s.calls().slice(previousCalls.length)
  assert.equal(calls.match(/systemctl restart nanaly/g).length, 2)
  assert.match(calls, /curl abc123def455/)
  assert.match(result.stderr, /旧版健康检查通过/)
})

test('rollback restart or health failures are reported without claiming recovery succeeded', t => {
  for (const env of [{ RESTART_FAIL_ALL: '1' }, { HEALTH_FAIL: '1' }]) {
    const s = setup(); t.after(s.cleanup)
    const result = s.run(['abc123def456', 'feed00000001'], env)
    assert.notEqual(result.status, 0)
    assert.equal(s.read('opt/blog/server/app.mjs'), 'old')
    assert.match(s.read('etc/nanaly.env'), /^NANALY_RUNNER_IMAGE=nanaly-runner:old$/m)
    assert.equal(s.calls().match(/systemctl restart nanaly/g).length, 2)
    assert.match(result.stderr, /旧版重启或健康检查仍失败/)
    assert.doesNotMatch(result.stderr, /已退回且旧版健康检查通过/)
  }
})
