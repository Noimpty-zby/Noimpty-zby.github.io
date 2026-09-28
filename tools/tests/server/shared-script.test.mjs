import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('../../../server/runner/run-in-shell.py', import.meta.url));
const available = process.platform === 'linux' && spawnSync('python3', ['--version']).status === 0;
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nanaly-shared-script-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return {
    directory,
    async start(code, seconds = 30) {
      const script = path.join(directory, 'run.sh');
      await fs.writeFile(script, code);
      return this.launch(script, seconds);
    },
    launch(script, seconds = 30) {
      const child = spawn('python3', [helper, script, '--seconds', String(seconds)], { cwd: directory, env: { PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
      const done = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr })));
      t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
      return { child, done, script };
    }
  };
}
async function untilFile(file) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const contents = await fs.readFile(file, 'utf8').catch(() => '');
    if (contents.trim()) return contents.trim();
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('timed out waiting for ' + file);
}
const background = `python3 -c 'import os,sys,time; from pathlib import Path; pid=os.fork(); sys.exit(0) if pid else None; os.setsid(); Path("descendant.pid").write_text(str(os.getpid())); time.sleep(60)' &
while [ ! -s descendant.pid ]; do sleep 0.01; done
`;

for (const outcome of ['cancel', 'timeout', 'exit']) test(`shared scripts reap detached double-forked descendants after ${outcome}`, { skip: !available, timeout: 10000 }, async t => {
  const api = await fixture(t);
  // This independent process must survive cleanup of the script's own descendants.
  const unrelated = spawn('sleep', ['60'], { stdio: 'ignore' });
  t.after(() => unrelated.kill('SIGKILL'));
  const running = await api.start(background + (outcome === 'exit' ? 'exit 7\n' : 'sleep 60\n'), outcome === 'timeout' ? 0.4 : 30);
  const descendant = Number(await untilFile(path.join(api.directory, 'descendant.pid')));
  t.after(() => { try { process.kill(descendant, 'SIGKILL'); } catch {} });
  if (outcome === 'cancel') await fs.rm(running.script);
  const result = await running.done;
  assert.equal(result.code, outcome === 'cancel' ? 126 : outcome === 'timeout' ? 124 : 7, result.stderr);
  assert.throws(() => process.kill(descendant, 0), { code: 'ESRCH' }, 'a detached descendant must be reaped before reporting completion');
  assert.doesNotThrow(() => process.kill(unrelated.pid, 0));
});

test('a shared script cancelled before Docker starts never executes learner code', { skip: !available, timeout: 10000 }, async t => {
  const api = await fixture(t), script = path.join(api.directory, 'cancelled.sh');
  await fs.writeFile(script, 'touch must-not-run'); await fs.rm(script);
  assert.equal((await api.launch(script).done).code, 126);
  await assert.rejects(fs.access(path.join(api.directory, 'must-not-run')), { code: 'ENOENT' });
});

test('shared scripts preserve stdin, output and signal exit codes', { skip: !available, timeout: 10000 }, async t => {
  const api = await fixture(t);
  const running = await api.start('read -r name; printf "hello %s\\n" "$name"; printf error >&2; kill -TERM $$');
  running.child.stdin.end('learner\n');
  assert.deepEqual(await running.done, { code: 143, signal: null, stdout: 'hello learner\n', stderr: 'error' });
});
