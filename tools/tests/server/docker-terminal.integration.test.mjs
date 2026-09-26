import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PrivateStore } from '../../../server/lib/store.mjs';
import { DockerRunner } from '../../../server/lib/runner.mjs';
import { SessionManager } from '../../../server/lib/sessions.mjs';
import { validateRun } from '../../../server/lib/validation.mjs';

// The interactive terminals in the real runner image: PTY, prompt, editors, manuals, completion,
// the sandbox limits, the hand-over of state between terminal and scripts, and program runs.
const plain = text => text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b[()][0-9A-B]|\x1b[=>]|\r/g, '');
function drive(session) {
  let output = '';
  const waiters = new Set();
  session.attach({ output: chunk => { output += chunk.toString('utf8'); for (const waiter of waiters) waiter(); } });
  return {
    get raw() { return output; },
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

test('real Docker terminal: interactive Bash with editors, manuals and completion, saved for the next terminal or script', { skip: process.env.NANALY_DOCKER_TESTS !== '1', timeout: 300000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nanaly-terminal-'));
  const store = await new PrivateStore(directory).init();
  const runner = new DockerRunner(store, { image: process.env.NANALY_RUNNER_IMAGE || 'nanaly-runner:1' });
  const sessions = new SessionManager(runner);
  t.after(async () => { await sessions.close(); await runner.close(); await store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  assert.equal((await runner.health()).ready, true);

  const first = await sessions.shell({ language: 'linux', cols: 97, rows: 31 });
  const shell = drive(first);
  await shell.until(/learner@nanaly:~\$ $/);
  assert.match(shell.raw, /\x1b\]0;learner@nanaly: ~\x07/, 'the prompt sets the window title the page shows');
  let mark = shell.mark();
  shell.type('printf "uid=%s term=%s tz=%s\\n" "$(id -u)" "$TERM" "$(date +%Z)"; tput cols; tput lines; command -v nano vim tmux; ls /sys/class/net\r');
  await shell.until(/uid=10001 term=xterm-256color tz=CST\n97\n31\n\/usr\/bin\/nano\n\/usr\/bin\/vim\n\/usr\/bin\/tmux\nlo\n/, mark);
  // Manuals are really there, including the index behind `man -k`.
  mark = shell.mark();
  shell.type('MANPAGER=cat man ls | head -4 | tr -s " "; man -k "^ls$" | head -1; man -w git-commit\r');
  await shell.until(/LS\(1\)[\s\S]*ls \(1\)[\s\S]*git-commit\.1/, mark);
  // No root, said plainly; `code` asks the page to open a file.
  mark = shell.mark();
  shell.type('sudo ls; echo "sudo=$?"; code notes.txt\r');
  await shell.until(/没有管理员（root）权限[\s\S]*sudo=1\n在网页编辑器中打开了 \/work\/notes\.txt\n/, mark);
  assert.match(shell.raw, /\x1b\]7337;open;L3dvcmsvbm90ZXMudHh0\x07/);
  // A full-screen editor: write a file with nano, save with Ctrl+O, leave with Ctrl+X.
  mark = shell.mark();
  shell.type('nano notes.txt\r');
  await shell.until(/GNU nano/, mark);
  shell.type('written in nano');
  shell.type('\x0f');
  await shell.until(/File Name to Write/, mark);
  shell.type('\r');
  await shell.until(/Wrote 1 line/, mark);
  // nano discards unread keys as it exits, so the next command waits for the prompt, as a person would.
  mark = shell.mark();
  shell.type('\x18');
  await shell.until(/learner@nanaly:~\$ $/, mark);
  mark = shell.mark();
  shell.type('mkdir -p lesson && cd lesson && export TOPIC=terminal && cat ../notes.txt; echo done-$((20+22))\r');
  await shell.until(/written in nano\n+done-42\n/, mark);
  await shell.until(/learner@nanaly:~\/lesson\$ $/, mark);
  // A script sent while the terminal is open runs inside it, in its directory.
  const workspaceId = first.host.workspace.workspaceId;
  const inside = await sessions.runInShell(first.host, validateRun({ language: 'linux', code: 'pwd; cat ../notes.txt; touch from-script', workspaceId, workspaceRevision: 0 }));
  assert.equal(inside.status, 'accepted', JSON.stringify(inside));
  assert.match(inside.stdout, /^\/work\/lesson\nwritten in nano\n/);
  const saved = await first.hangup('closed');
  assert.equal(saved.committed, true, JSON.stringify(saved));
  assert.equal(saved.cwd, '/work/lesson');
  assert.equal(runner.busy.size, 0); assert.equal(runner.containers.size, 0);

  // A script run continues where the terminal left off.
  const script = await runner.run(validateRun({ language: 'linux', code: 'pwd; echo "$TOPIC"; ls', workspaceId, workspaceRevision: saved.workspaceRevision }));
  assert.equal(script.status, 'accepted', JSON.stringify(script));
  assert.match(script.stdout, /^\/work\/lesson\nterminal\nfrom-script\n/);

  // The next terminal has the files, directory, variables and the earlier command history.
  const second = await sessions.shell({ language: 'linux', workspaceId });
  const again = drive(second);
  await again.until(/learner@nanaly:~\/lesson\$ $/);
  mark = again.mark();
  again.type('echo "$TOPIC"; history | grep -c "export TOPIC=terminal"\r');
  await again.until(/terminal\n[1-9]\d*\n/, mark);
  // A program still running when the shell is hung up is stopped; the workspace is still saved.
  again.type('sleep 300\r');
  await new Promise(resolve => setTimeout(resolve, 500));
  const interrupted = await second.hangup('idle');
  assert.equal(interrupted.committed, true, JSON.stringify(interrupted));

  // Git terminals start in an initialised repository and complete subcommands with Tab.
  const git = await sessions.shell({ language: 'git' });
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

  // Run for C, Go and Python: compiled and run on a terminal that takes the learner's input.
  for (const [language, code, input, expected] of [
    ['c', '#include <stdio.h>\nint main(void){int a,b;printf("a b: ");fflush(stdout);if(scanf("%d %d",&a,&b)!=2)return 1;printf("sum=%d\\n",a+b);return 0;}\n', '3 4\r', /gcc [^\n]*&& \.\/main\na b: 3 4\nsum=7\n/],
    ['go', 'package main\nimport "fmt"\nfunc main(){var n int;fmt.Print("n: ");fmt.Scan(&n);fmt.Println("double", n*2)}\n', '21\r', /go build -o main main\.go && \.\/main\nn: 21\ndouble 42\n/],
    ['python', 'name = input("名字: ")\nprint(f"你好，{name}")\n', '娜娜莉\r', /python3 main\.py\n名字: 娜娜莉\n你好，娜娜莉\n/]
  ]) {
    const task = await sessions.task({ language, code, cols: 90, rows: 20 });
    const run = drive(task);
    await run.until(/: $/, 0, 60000);
    run.type(input);
    await run.until(expected, 0, 30000);
    const exit = await task.done;
    assert.equal(exit.code, 0, `${language}: ${run.text}`);
  }
  assert.equal(sessions.tasks.size, 0); assert.equal(runner.containers.size, 0);
});
