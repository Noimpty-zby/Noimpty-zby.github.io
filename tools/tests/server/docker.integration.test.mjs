import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { PrivateStore } from '../../../server/lib/store.mjs';
import { DockerRunner } from '../../../server/lib/runner.mjs';
import { validateRun } from '../../../server/lib/validation.mjs';

test('real Docker execution, diagnostics, boundaries and persisted workspaces', { skip: process.env.NANALY_DOCKER_TESTS !== '1', timeout: 300000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nanaly-docker-'));
  const store = await new PrivateStore(directory).init();
  const runner = new DockerRunner(store, { image: process.env.NANALY_RUNNER_IMAGE || 'nanaly-runner:1' });
  t.after(async () => { await runner.close(); await store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  assert.equal((await runner.health()).ready, true, 'Build image and ensure cgroup v2 controllers first.');
  const run = value => runner.run(validateRun(value));
  const cpp = await run({ language: 'cpp', code: '#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}', tests: [{ input: '2 3', expectedOutput: '5' }, { input: '-1 2', expectedOutput: '1' }] });
  assert.equal(cpp.status, 'accepted'); assert.equal(cpp.tests.length, 2);
  const c = await run({ language: 'c', code: '#include <stdio.h>\nint main(){puts("C");}' });
  assert.equal(c.stdout.trim(), 'C');
  const go = await run({ language: 'go', code: 'package main\nimport "fmt"\nfunc main(){fmt.Println("Go")}' });
  assert.equal(go.stdout.trim(), 'Go');
  const broken = await run({ language: 'cpp', code: 'int main(){unknown;}' });
  assert.equal(broken.status, 'compile_error'); assert.ok(broken.diagnostics.some(item => item.line === 1));
  const timeout = await run({ language: 'c', code: 'int main(){for(;;){}}' });
  assert.equal(timeout.status, 'timeout');
  const limited = await run({ language: 'c', code: '#include <stdio.h>\nint main(){while(1)puts("too much output");}' });
  assert.equal(limited.status, 'output_limit');
  const linux = await run({ language: 'linux', code: 'printf hello > note.txt; id -u; test ! -e /var/run/docker.sock; test ! -w /etc/passwd' });
  assert.equal(linux.status, 'accepted'); assert.equal(linux.stdout.trim(), '10001'); assert.equal(linux.workspaceCommitted, true);
  const resumed = await run({ language: 'linux', code: 'cat note.txt', workspaceId: linux.workspaceId, workspaceRevision: linux.workspaceRevision });
  assert.equal(resumed.stdout, 'hello');
  const check = await run({ language: 'linux', code: 'touch should-not-exist', mode: 'check', workspaceId: linux.workspaceId, workspaceRevision: resumed.workspaceRevision });
  assert.equal(check.status, 'checked'); assert.equal(check.workspaceCommitted, false);
  const checked = await run({ language: 'linux', code: 'test ! -e should-not-exist', workspaceId: linux.workspaceId, workspaceRevision: resumed.workspaceRevision });
  assert.equal(checked.status, 'accepted');
  await t.test('Linux provides real calendar, text, archive, inspection and help commands', async () => {
    const tools = await run({ language: 'linux', code: [
      'set -e',
      'for tool in ncal cal grep sed awk less tree file zip unzip xz bzip2 jq bc diff patch ps findmnt curl wget ssh man; do command -v "$tool" >/dev/null; done',
      'ncal -b 9 2026',
      'printf "one\\ntwo\\n" | grep two | sed s/two/three/',
      "printf '%s\\n' '{\"name\":\"toolbox\"}' | jq -r .name",
      'printf "2+3\\n" | bc',
      'printf "tools-ok\\n"'
    ].join('\n') });
    assert.equal(tools.status, 'accepted', JSON.stringify(tools));
    assert.equal(tools.exitCode, 0);
    assert.match(tools.stdout, /2026/);
    assert.match(tools.stdout, /three\ntoolbox\n5\ntools-ok/);
  });
  await t.test('Linux resumes directory, exports, aliases, functions, umask and file permissions', async () => {
    const first = await run({ language: 'linux', code: [
      'set -e',
      'mkdir -p "lesson dir"',
      'cd "lesson dir"',
      "export LAB_TOPIC='linux practice'",
      'umask 027',
      'printf before > kept.txt',
      'chmod 764 kept.txt',
      'mkdir private-dir',
      'chmod 770 private-dir',
      'lab_greet() { printf "function-ok\\n"; }',
      "alias lab_alias='printf \"alias-ok\\n\"'",
      'pwd'
    ].join('\n') });
    assert.equal(first.status, 'accepted', JSON.stringify(first));
    assert.equal(first.workspaceCommitted, true);
    assert.match(first.cwd, /\/lesson dir$/);
    assert.equal(first.stdout.trim(), first.cwd);
    const second = await run({
      language: 'linux', workspaceId: first.workspaceId, workspaceRevision: first.workspaceRevision,
      code: [
        'pwd',
        'printf "%s\\n" "$LAB_TOPIC"',
        'touch created-after-resume.txt',
        'mkdir created-after-resume-dir',
        "stat -c '%a' kept.txt private-dir created-after-resume.txt created-after-resume-dir",
        'lab_greet',
        'lab_alias'
      ].join('\n')
    });
    assert.equal(second.status, 'accepted', JSON.stringify(second));
    assert.equal(second.cwd, first.cwd);
    assert.deepEqual(second.stdout.trim().split('\n'), [
      first.cwd, 'linux practice', '764', '770', '640', '750', 'function-ok', 'alias-ok'
    ]);
    assert.equal(second.workspaceCommitted, true);
  });
  for (const language of ['linux', 'git']) {
    await t.test(language + ' can commit in a newly created subrepository and resume its directory', async () => {
      const created = await run({ language, code: [
        'set -e',
        'mkdir project',
        'cd project',
        'git init -b main',
        'printf "first lesson\\n" > lesson.txt',
        'git add lesson.txt',
        'git commit -m "first lesson"',
        'git log -1 --format=%s'
      ].join('\n') });
      assert.equal(created.status, 'accepted', JSON.stringify(created));
      assert.equal(created.workspaceCommitted, true);
      assert.match(created.cwd, /\/project$/);
      assert.match(created.stdout, /first lesson/);
      const resumedRepo = await run({
        language, workspaceId: created.workspaceId, workspaceRevision: created.workspaceRevision,
        code: [
          'set -e',
          'printf "second lesson\\n" >> lesson.txt',
          'git add lesson.txt',
          'git commit -m "second lesson"',
          'git log -2 --format=%s',
          'test -z "$(git status --porcelain)"'
        ].join('\n')
      });
      assert.equal(resumedRepo.status, 'accepted', JSON.stringify(resumedRepo));
      assert.equal(resumedRepo.cwd, created.cwd);
      assert.match(resumedRepo.stdout, /second lesson\nfirst lesson/);
      assert.equal(resumedRepo.workspaceCommitted, true);
    });
  }
  await t.test('nonzero shell exits report the actual code and preserve completed workspace changes', async () => {
    const failed = await run({ language: 'linux', code: [
      'mkdir failed-step',
      'cd failed-step',
      'printf saved-before-error > note.txt',
      'exit 7'
    ].join('\n') });
    assert.equal(failed.status, 'runtime_error', JSON.stringify(failed));
    assert.equal(failed.exitCode, 7);
    assert.equal(failed.workspaceCommitted, true);
    assert.match(failed.cwd, /\/failed-step$/);
    const recovered = await run({
      language: 'linux', workspaceId: failed.workspaceId, workspaceRevision: failed.workspaceRevision,
      code: 'cat note.txt\nfalse\nprintf "\\ncontinued\\n"'
    });
    assert.equal(recovered.status, 'accepted', JSON.stringify(recovered));
    assert.equal(recovered.exitCode, 0);
    assert.equal(recovered.cwd, failed.cwd);
    assert.equal(recovered.stdout, 'saved-before-error\ncontinued\n', 'ordinary Bash continues after false unless the script enables errexit');
  });
  const git = await run({ language: 'git', code: 'echo lesson > lesson.txt; git add .; git commit -m lesson; git branch lesson' });
  assert.equal(git.status, 'accepted');
  const gitResume = await run({ language: 'git', code: 'git branch --list lesson', workspaceId: git.workspaceId, workspaceRevision: git.workspaceRevision });
  assert.match(gitResume.stdout, /lesson/);
  const sql = await run({ language: 'mysql', code: 'CREATE TABLE lesson (id INT PRIMARY KEY); INSERT INTO lesson VALUES (7); SELECT * FROM lesson;' });
  assert.equal(sql.status, 'accepted'); assert.match(sql.stdout, /7/); assert.equal(sql.workspaceCommitted, true);
  const definitions = await run({ language: 'mysql', code: 'CREATE PROCEDURE answer() SELECT 42; CREATE EVENT tomorrow ON SCHEDULE AT CURRENT_TIMESTAMP + INTERVAL 1 DAY DO INSERT INTO lesson VALUES (9);', workspaceId: sql.workspaceId, workspaceRevision: sql.workspaceRevision });
  assert.equal(definitions.status, 'accepted'); assert.equal(definitions.workspaceCommitted, true);
  const objects = await run({ language: 'mysql', code: "CALL answer(); SHOW EVENTS; SELECT ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA='practice';", workspaceId: sql.workspaceId, workspaceRevision: definitions.workspaceRevision });
  assert.equal(objects.status, 'accepted'); assert.match(objects.stdout, /42/); assert.match(objects.stdout, /tomorrow/); assert.match(objects.stdout, /answer/);
  const sqlResume = await run({ language: 'mysql', code: 'SELECT COUNT(*) FROM lesson;', workspaceId: sql.workspaceId, workspaceRevision: objects.workspaceRevision });
  assert.equal(sqlResume.status, 'accepted'); assert.match(sqlResume.stdout, /1/);
  const denied = await run({ language: 'mysql', code: 'SELECT * FROM mysql.user;', workspaceId: sql.workspaceId, workspaceRevision: sqlResume.workspaceRevision });
  assert.equal(denied.status, 'runtime_error');
  const unsafe = await run({ language: 'mysql', code: 'SELECT 1 INTO OUTFILE "/tmp/forbidden";', workspaceId: sql.workspaceId, workspaceRevision: denied.workspaceRevision });
  assert.equal(unsafe.status, 'runtime_error');
  const sandbox = { window: { addEventListener() {} }, document: { readyState: 'loading', addEventListener() {} } };
  const lessonFile = fileURLToPath(new URL('../../../source/js/learning-lab.js', import.meta.url));
  vm.runInNewContext(await fs.readFile(lessonFile, 'utf8'), sandbox);
  for (const lesson of sandbox.window.NOIMPTY_LEARNING.lessons) {
    await t.test('actual frontend reference lesson: ' + lesson.language, async () => {
      const result = await run({ language: lesson.language, code: lesson.code, stdin: lesson.stdin, tests: lesson.tests });
      assert.equal(result.status, 'accepted', JSON.stringify(result));
      if (lesson.tests.length) assert.equal(result.tests.length, lesson.tests.length);
      if (lesson.language === 'mysql') assert.match(result.stdout, /小周/);
    });
  }
});
