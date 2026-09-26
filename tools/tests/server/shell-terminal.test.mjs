import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// The interactive half of shell-session.py, driven the way the API drives it inside a
// container: framed keystrokes on stdin, raw terminal output on stdout.
const helper = fileURLToPath(new URL('../../../server/runner/shell-session.py', import.meta.url))
const available = process.platform === 'linux' && spawnSync('python3', ['--version']).status === 0 && spawnSync('bash', ['--version']).status === 0
const frame = (kind, payload) => { const body = Buffer.from(payload); const head = Buffer.alloc(5); head[0] = kind.charCodeAt(0); head.writeUInt32BE(body.length, 1); return Buffer.concat([head, body]) }
const plain = text => text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\r/g, '')

async function fixture (t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nanaly-terminal-test-'))
  const workspace = path.join(root, 'work'), temporary = path.join(root, 'tmp')
  await fs.mkdir(workspace); await fs.mkdir(temporary)
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const args = ['--workspace', workspace, '--temporary', temporary]
  return {
    workspace,
    temporary,
    open (size = ['--cols', '100', '--rows', '30']) {
      // Trusted test input only; the fixture never inherits host credentials.
      const child = spawn('python3', [helper, 'terminal', ...args, ...size], { env: { PATH: '/usr/bin:/bin', HOME: workspace, LANG: 'C.UTF-8' }, stdio: ['pipe', 'pipe', 'pipe'] })
      let output = ''
      const waiters = new Set()
      child.stdout.on('data', chunk => { output += chunk.toString('utf8'); for (const waiter of waiters) waiter() })
      const exited = new Promise(resolve => child.on('close', code => resolve(code)))
      t.after(() => { if (child.exitCode === null) child.kill('SIGKILL') })
      return {
        child,
        exited,
        get text () { return plain(output) },
        type: text => child.stdin.write(frame('d', text)),
        resize: (cols, rows) => child.stdin.write(frame('r', `${cols} ${rows}`)),
        hangup: () => child.stdin.end(),
        until (pattern, from = 0, timeout = 8000) {
          return new Promise((resolve, reject) => {
            const check = () => { const match = plain(output).slice(from).match(pattern); if (match) { waiters.delete(check); clearTimeout(timer); resolve(match) } }
            const timer = setTimeout(() => { waiters.delete(check); reject(new Error(`timed out waiting for ${pattern}; got:\n${plain(output)}`)) }, timeout)
            waiters.add(check); check()
          })
        }
      }
    },
    result: async () => JSON.parse(await fs.readFile(path.join(temporary, 'nanaly-shell-result.json'), 'utf8')),
    persist () {
      const result = spawnSync('python3', [helper, 'persist', ...args], { encoding: 'utf8', timeout: 5000 })
      assert.equal(result.status, 0, result.stderr)
    }
  }
}

test('an interactive session keeps directory, exports, aliases, functions and history across a dropped connection', { skip: !available, timeout: 30000 }, async t => {
  const env = await fixture(t)
  const first = env.open()
  await first.until(/\$ $/)
  first.type('mkdir -p "lesson dir" && cd "lesson dir"\r')
  first.type('export TOPIC="terminal practice"; greet() { echo "hi $1"; }; alias hey="echo alias-ok"\r')
  first.type('echo "marker-$((6*7))"\r')
  await first.until(/marker-42\n/)
  await first.until(/\$ $/, first.text.indexOf('marker-42'))
  // The page closing is only an end of input; the last prompt's state must already be saved.
  first.hangup()
  await first.exited
  const saved = await env.result()
  assert.equal(saved.shellStateSaved, true, JSON.stringify(saved))
  assert.equal(saved.cwd, path.join(env.workspace, 'lesson dir'))
  env.persist()

  const second = env.open()
  await second.until(/\$ $/)
  second.type('pwd; echo "$TOPIC"; greet there; hey\r')
  await second.until(/lesson dir\nterminal practice\nhi there\nalias-ok\n/)
  await second.until(/\$ $/, second.text.indexOf('alias-ok'))
  // History from the first session is there for the arrow keys: one Up is this session's
  // command, the second is the last command typed before the connection dropped.
  const before = second.text.length
  second.type('\x1b[A\x1b[A')
  await second.until(/echo "marker-\$\(\(6\*7\)\)"/, before)
  second.type('\x15exit 3\r')
  assert.equal(await second.exited, 3)
  const again = await env.result()
  assert.equal(again.shellStateSaved, true)
})

test('terminal size reaches programs and changes on resize; typed input is not echoed twice', { skip: !available, timeout: 20000 }, async t => {
  const env = await fixture(t)
  const shell = env.open(['--cols', '91', '--rows', '27'])
  await shell.until(/\$ $/)
  shell.type('stty size\r')
  await shell.until(/^27 91$/m)
  shell.resize(120, 40)
  await new Promise(resolve => setTimeout(resolve, 100))
  shell.type('stty size\r')
  await shell.until(/^40 120$/m)
  assert.equal(shell.text.split('stty size').length - 1, 2)
  shell.hangup()
  await shell.exited
})

test('the saved state never lands in the work tree during a session, and history stays out of Git', { skip: !available, timeout: 20000 }, async t => {
  const env = await fixture(t)
  const shell = env.open()
  await shell.until(/\$ $/)
  shell.type('ls -A; echo end-of-list\r')
  await shell.until(/end-of-list\n/)
  shell.hangup(); await shell.exited
  env.persist()
  const reopened = env.open()
  await reopened.until(/\$ $/)
  const before = reopened.text.length
  reopened.type('ls -A; echo "files-done"\r')
  await reopened.until(/files-done\n/, before)
  assert.doesNotMatch(reopened.text.slice(before), /nanaly|bash_history/)
  reopened.hangup(); await reopened.exited
})

test('a program that ignores the hangup is stopped and the session still concludes', { skip: !available, timeout: 20000 }, async t => {
  const env = await fixture(t)
  const shell = env.open()
  await shell.until(/\$ $/)
  shell.type('trap "" HUP; echo ignoring; sleep 60\r')
  await shell.until(/ignoring\n/)
  const started = Date.now()
  shell.hangup()
  await shell.exited
  assert.ok(Date.now() - started < 8000)
  const result = await env.result()
  assert.equal(result.shellStateSaved, true)
})
