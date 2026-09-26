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
  "image inspect") grep -qx "$3" "$STUB/images" ;;
  "build -q") echo "$4" >> "$STUB/images" ;;
  "images --format") cat "$STUB/images" ;;
  "rmi "*) grep -vx "$2" "$STUB/images" > "$STUB/images.new"; mv "$STUB/images.new" "$STUB/images" ;;
esac`,
  node: 'echo "node $*" >> "$STUB/calls"; echo "ℹ pass 13"; exit "${NODE_EXIT:-0}"',
  systemctl: 'echo "systemctl $*" >> "$STUB/calls"',
  curl: '[ -n "$HEALTH_FAIL" ] && exit 7; printf \'{"ok":true,"build":"%s","runner":{"ready":true}}\' "$(cat "$NANALY_DEPLOY_ROOT/opt/blog/server/BUILD" 2>/dev/null)"',
  journalctl: 'echo "service log"',
  sleep: 'true'
}

const setup = ({ images = ['nanaly-runner:old', 'nanaly-runner:older'] } = {}) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'deploy-backend-'))
  const root = path.join(dir, 'root'), bin = path.join(dir, 'bin'), stub = path.join(dir, 'stub'), src = path.join(dir, 'src')
  for (const d of [bin, stub, path.join(root, 'opt/blog/server'), path.join(root, 'etc/systemd/system'), path.join(src, 'server/runner'), path.join(src, 'tools/tests/server')]) mkdirSync(d, { recursive: true })
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
  const archive = path.join(dir, 'a.tgz')
  execFileSync('tar', ['-czf', archive, '-C', src, 'server', 'tools'])
  const run = (args, env = {}) => spawnSync('bash', [script, archive, ...args], {
    encoding: 'utf8', env: { ...process.env, PATH: bin + ':' + process.env.PATH, STUB: stub, NANALY_DEPLOY_ROOT: root, HEALTH_FAIL: '', ...env }
  })
  const read = rel => readFileSync(path.join(root, rel), 'utf8')
  const calls = () => readFileSync(path.join(stub, 'calls'), 'utf8')
  const imageList = () => readFileSync(path.join(stub, 'images'), 'utf8').trim().split('\n').filter(Boolean).sort()
  return { dir, root, run, read, calls, imageList, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
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

test('an unchanged runner image skips the build and the slow integration tests unless --full', t => {
  const s = setup({ images: ['nanaly-runner:old'] }); t.after(s.cleanup)
  let result = s.run(['abc123def456', 'old'])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.doesNotMatch(s.calls(), /docker build|node --test/)
  assert.equal(s.read('opt/blog/server/BUILD').trim(), 'abc123def456')
  result = s.run(['abc123def457', 'old', 'full'])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.match(s.calls(), /node --test/)
  assert.doesNotMatch(s.calls(), /docker build/)
})

test('failing integration tests stop the deploy before the live directory, env or service are touched', t => {
  const s = setup(); t.after(s.cleanup)
  const result = s.run(['abc123def456', 'feed00000001'], { NODE_EXIT: '1' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /线上版本没有动/)
  assert.equal(s.read('opt/blog/server/app.mjs'), 'old')
  assert.match(s.read('etc/nanaly.env'), /^NANALY_RUNNER_IMAGE=nanaly-runner:old$/m)
  assert.doesNotMatch(s.calls(), /systemctl/)
})

test('a new version that fails its health check is rolled back with the previous env and restarted', t => {
  const s = setup({ images: ['nanaly-runner:old'] }); t.after(s.cleanup)
  const result = s.run(['abc123def456', 'feed00000001'], { HEALTH_FAIL: '1' })
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
