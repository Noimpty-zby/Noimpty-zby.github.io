import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PrivateStore } from '../../../server/lib/store.mjs';
import { DockerRunner } from '../../../server/lib/runner.mjs';
import { validateRun } from '../../../server/lib/validation.mjs';

// The interactive terminal in the real runner image: PTY, prompt, editors, completion,
// the sandbox limits, and the hand-over of state between terminal and script runs.
const plain = text => text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][0-9A-B]|\x1b[=>]|\r/g, '');
function drive(session) {
  let output = '';
  const waiters = new Set();
  session.onOutput(chunk => { output += chunk.toString('utf8'); for (const waiter of waiters) waiter(); });
  return {
    get text() { return plain(output); },
    type: data => session.write(data),
    mark: () => plain(output).length,
    until(pattern, from = 0, timeout = 20000) {
      return new Promise((resolve, reject) => {
        const check = () => { const match = plain(output).slice(from).match(pattern); if (match) { waiters.delete(check); clearTimeout(timer); resolve(match); } };
        const timer = setTimeout(() => { waiters.delete(check); reject(new Error(`timed out waiting for ${pattern}; got:\n${plain(output).slice(-3000)}`)); }, timeout);
        waiters.add(check); check();
      });
    }
  };
}

test('real Docker terminal: interactive Bash with editors and completion, saved for the next terminal or script', { skip: process.env.NANALY_DOCKER_TESTS !== '1', timeout: 240000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nanaly-terminal-'));
  const store = await new PrivateStore(directory).init();
  const runner = new DockerRunner(store, { image: process.env.NANALY_RUNNER_IMAGE || 'nanaly-runner:1' });
  t.after(async () => { await runner.close(); await store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  assert.equal((await runner.health()).ready, true);

  const first = await runner.startTerminal({ language: 'linux', cols: 97, rows: 31 });
  const shell = drive(first);
  await shell.until(/learner@nanaly:~\$ $/);
  let mark = shell.mark();
  shell.type('printf "uid=%s term=%s\\n" "$(id -u)" "$TERM"; tput cols; tput lines; command -v nano vim; ls /sys/class/net\r');
  await shell.until(/uid=10001 term=xterm-256color\n97\n31\n\/usr\/bin\/nano\n\/usr\/bin\/vim\nlo\n/, mark);
  // A full-screen editor: write a file with nano, save with Ctrl+O, leave with Ctrl+X.
  mark = shell.mark();
  shell.type('nano notes.txt\r');
  await shell.until(/GNU nano/, mark);
  shell.type('written in nano');
  shell.type('\x0f');
  await shell.until(/File Name to Write/, mark);
  shell.type('\r');
  await shell.until(/Wrote 1 line/, mark);
  shell.type('\x18');
  mark = shell.mark();
  shell.type('mkdir -p lesson && cd lesson && export TOPIC=terminal && cat ../notes.txt; echo done-$((20+22))\r');
  await shell.until(/written in nano\n+done-42\n/, mark);
  await shell.until(/learner@nanaly:~\/lesson\$ $/, mark);
  const saved = await first.end('closed');
  assert.equal(saved.committed, true, JSON.stringify(saved));
  assert.equal(saved.cwd, '/work/lesson');
  assert.equal(runner.busy.size, 0); assert.equal(runner.containers.size, 0);

  // A script run continues where the terminal left off.
  const script = await runner.run(validateRun({ language: 'linux', code: 'pwd; echo "$TOPIC"; cat ../notes.txt', workspaceId: saved.workspaceId, workspaceRevision: saved.workspaceRevision }));
  assert.equal(script.status, 'accepted', JSON.stringify(script));
  assert.match(script.stdout, /^\/work\/lesson\nterminal\nwritten in nano\n?$/);

  // The next terminal has the files, directory, variables and the earlier command history.
  const second = await runner.startTerminal({ language: 'linux', workspaceId: saved.workspaceId });
  const again = drive(second);
  await again.until(/learner@nanaly:~\/lesson\$ $/);
  mark = again.mark();
  again.type('echo "$TOPIC"; history | grep -c "export TOPIC=terminal"\r');
  await again.until(/terminal\n[1-9]\d*\n/, mark);
  // A program still running when the page goes away is stopped; the workspace is still saved.
  again.type('sleep 300\r');
  await new Promise(resolve => setTimeout(resolve, 500));
  const interrupted = await second.end('disconnected');
  assert.equal(interrupted.committed, true, JSON.stringify(interrupted));

  // Git terminals start in an initialised repository and complete subcommands with Tab.
  const git = await runner.startTerminal({ language: 'git' });
  const repo = drive(git);
  await repo.until(/learner@nanaly:~\$ $/);
  mark = repo.mark();
  repo.type('less --version >/dev/null; git status --short --branch\r');
  await repo.until(/## No commits yet on main\n/, mark);
  mark = repo.mark();
  repo.type('git swi\t');
  await repo.until(/git switch $/, mark, 10000);
  repo.type('\x15exit\r');
  const done = await git.done;
  assert.equal(done.reason, 'exit'); assert.equal(done.committed, true);
});
