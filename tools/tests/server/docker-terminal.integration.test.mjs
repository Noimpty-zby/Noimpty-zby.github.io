import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PrivateStore } from '../../../server/lib/store.mjs';
import { DockerRunner } from '../../../server/lib/runner.mjs';
import { SessionManager } from '../../../server/lib/sessions.mjs';
import { TerminalManager } from '../../../server/lib/terminal.mjs';
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
  await t.test('editor saves preserve UTF-8, mode and symlinks, and incomplete transfers keep the original file', async () => {
    const target = '/work/editor-target.sh', link = '/work/editor-link.sh';
    const prepared = await first.host.exec(['sh', '-c', 'printf "before\n" > /work/editor-target.sh && chmod 750 /work/editor-target.sh && ln -s editor-target.sh /work/editor-link.sh']);
    assert.equal(prepared.code, 0, prepared.stderr.toString('utf8'));
    const before = await first.host.exec(['cat', target]);
    assert.equal(before.code, 0);
    const terminals = new TerminalManager(sessions);
    const content = '#!/bin/sh\nprintf "你好，编辑器\n"\n';
    const interruptedHost = { exec: (args, options) => first.host.exec(args, { ...options, input: options.input.slice(0, 2) }) };
    const failed = await terminals.write(interruptedHost, { id: 1, path: link, content });
    assert.ok(failed.error, 'an incomplete Docker stdin transfer must report failure');
    const retained = await first.host.exec(['cat', target]);
    assert.equal(retained.code, 0);
    assert.deepEqual(retained.stdout, before.stdout, 'a failed save must preserve the original bytes');
    const written = await terminals.write(first.host, { id: 2, path: link, content });
    assert.equal(written.error, undefined, JSON.stringify(written));
    const [text, mode, symlink] = await Promise.all([
      first.host.exec(['cat', target]), first.host.exec(['stat', '-c', '%a', target]), first.host.exec(['readlink', link])
    ]);
    assert.equal(text.code, 0); assert.equal(text.stdout.toString('utf8'), content);
    assert.equal(mode.code, 0); assert.equal(mode.stdout.toString('utf8').trim(), '750');
    assert.equal(symlink.code, 0); assert.equal(symlink.stdout.toString('utf8').trim(), 'editor-target.sh');
  });
  await t.test('shared scripts cancel their descendants without ending the interactive shell', async () => {
    const run = (code, signal) => sessions.runInShell(first.host, validateRun({ language: 'linux', code, workspaceId, workspaceRevision: 0 }), { signal });
    const background = `python3 -c 'import os,sys,time; from pathlib import Path; pid=os.fork(); sys.exit(0) if pid else None; os.setsid(); Path("/tmp/shared-descendant.pid").write_text(str(os.getpid())); time.sleep(90)' &
while [ ! -s /tmp/shared-descendant.pid ]; do sleep 0.01; done
`;
    for (const outcome of ['cancel', 'exit', 'timeout']) {
      await first.host.exec(['rm', '-f', '/tmp/shared-descendant.pid']);
      const controller = new AbortController();
      const running = run(background + (outcome === 'exit' ? 'exit 7' : 'sleep 90'), controller.signal);
      // Attach the rejection handler before aborting, including on an assertion failure.
      const settled = running.then(value => ({ value }), error => ({ error }));
      let descendant;
      const deadline = Date.now() + 10000;
      while (!descendant && Date.now() < deadline) {
        const read = await first.host.exec(['cat', '/tmp/shared-descendant.pid']);
        if (read.code === 0) descendant = read.stdout.toString('utf8').trim();
        if (!descendant) await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.match(descendant || '', /^\d+$/);
      if (outcome === 'cancel') controller.abort();
      const { value, error } = await settled;
      if (outcome === 'cancel') assert.equal(error?.code, 'RUN_CANCELLED');
      else {
        assert.equal(error, undefined);
        assert.equal(value.exitCode, outcome === 'exit' ? 7 : 124);
        assert.equal(value.status, outcome === 'exit' ? 'runtime_error' : 'timeout');
      }
      const stopped = await first.host.exec(['test', '!', '-e', `/proc/${descendant}`]);
      assert.equal(stopped.code, 0, `${outcome} left its detached descendant running`);
      assert.equal(first.exited, null);
    }
    // Abort after CLI admission but before the Docker process starts. The source
    // stays absent, so a late container exec cannot resurrect the cancelled code.
    const execute = runner.execute, controller = new AbortController();
    let delayed = false;
    runner.execute = async (command, args, options) => {
      if (!delayed && args.includes('/opt/nanaly/run-in-shell.py')) {
        delayed = true; controller.abort();
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return execute(command, args, options);
    };
    try { await assert.rejects(run('touch /tmp/shared-must-not-run', controller.signal), { code: 'RUN_CANCELLED' }); }
    finally { runner.execute = execute; }
    assert.equal(delayed, true);
    assert.equal((await first.host.exec(['test', '!', '-e', '/tmp/shared-must-not-run'])).code, 0);
    const mark = shell.mark();
    shell.type('echo interactive-$((6*7))\r');
    await shell.until(/interactive-42\n/, mark);
    await shell.until(/learner@nanaly:~\/lesson\$ $/, mark);
  });
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
  await t.test('killing the shared script supervisor closes its container and restores saved files', async () => {
    const doomed = await sessions.shell({ language: 'linux', workspaceId });
    const live = drive(doomed);
    await live.until(/learner@nanaly:~\/lesson\$ $/);
    const result = await sessions.runInShell(doomed.host, validateRun({ language: 'linux', workspaceId, workspaceRevision: doomed.host.workspace.revision,
      code: 'printf recovered-after-supervisor-death > supervisor-before.txt; sleep 90 >/dev/null 2>&1 & kill -KILL "$PPID"; exit 0' }));
    assert.equal(result.exitCode, 137, JSON.stringify(result));
    assert.equal(result.status, 'runtime_error');
    assert.equal(result.workspaceCommitted, true, JSON.stringify(result));
    assert.equal(doomed.exited.reason, 'run_failed');
    assert.equal(sessions.shells.has(workspaceId), false);
    assert.equal(runner.containers.has(doomed.host.name), false);
    assert.equal((await runner.cli(['inspect', doomed.host.name])).code, 1, 'the entire sandbox, including any adopted descendants, is gone');
    const restored = await runner.run(validateRun({ language: 'linux', workspaceId, workspaceRevision: result.workspaceRevision, code: 'cat supervisor-before.txt' }));
    assert.equal(restored.status, 'accepted', JSON.stringify(restored));
    assert.equal(restored.stdout, 'recovered-after-supervisor-death');
  });
  assert.equal(sessions.tasks.size, 0); assert.equal(runner.containers.size, 0);
});
