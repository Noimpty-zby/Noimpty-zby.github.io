import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PrivateStore } from '../../../server/lib/store.mjs';
import { DockerRunner } from '../../../server/lib/runner.mjs';
import { validateRun } from '../../../server/lib/validation.mjs';

test('real sandbox boundaries, testcase isolation, and cancellation during execution', { skip: process.env.NANALY_DOCKER_TESTS !== '1', timeout: 60000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nanaly-boundaries-'));
  const store = await new PrivateStore(directory).init();
  const runner = new DockerRunner(store, { concurrency: 1, image: process.env.NANALY_RUNNER_IMAGE || 'nanaly-runner:1' });
  t.after(async () => { await runner.close(); await store.close(); await fs.rm(directory, { recursive: true, force: true }); });
  assert.equal((await runner.health()).ready, true);
  const request = input => runner.run(validateRun(input));
  const cpp = await request({
    language: 'cpp',
    code: '#include <fstream>\n#include <iostream>\nint main(){std::ifstream old("marker");std::cout<<(old.good()?"shared":"fresh");std::ofstream next("marker");next<<"written";}',
    tests: [{ input: '', expectedOutput: 'fresh' }, { input: '', expectedOutput: 'fresh' }]
  });
  assert.equal(cpp.status, 'accepted', JSON.stringify(cpp));
  const boundaries = await request({
    language: 'linux',
    code: "python3 - <<'PY'\nimport os, pathlib\nassert os.getuid() == 10001\nassert set(p.name for p in pathlib.Path('/sys/class/net').iterdir()) == {'lo'}\nassert 'CapEff:\\t0000000000000000' in pathlib.Path('/proc/self/status').read_text()\nassert not pathlib.Path('/var/run/docker.sock').exists()\nassert not pathlib.Path('/home/zby/blog').exists()\nassert not any(key.startswith('NANALY_') for key in os.environ)\ntry:\n pathlib.Path('/etc/forbidden').write_text('blocked')\n raise AssertionError('root filesystem writable')\nexcept OSError:\n pass\npathlib.Path('/work/note.txt').write_text('saved')\nprint('isolated')\nPY\n"
  });
  assert.equal(boundaries.status, 'accepted', JSON.stringify(boundaries));
  assert.equal(boundaries.workspaceCommitted, true);
  const originalRevision = boundaries.workspaceRevision;
  const controller = new AbortController();
  const pending = runner.run(validateRun({ language: 'linux', code: 'echo changed > note.txt; touch cancelled.txt; sleep 30', workspaceId: boundaries.workspaceId, workspaceRevision: originalRevision }), { signal: controller.signal });
  // Attach the rejection handler immediately, then observe a real script side effect
  // before aborting so this checks cancellation during execution, not before startup.
  const cancelled = assert.rejects(pending, { code: 'RUN_CANCELLED' });
  let observed = false;
  for (let attempt = 0; attempt < 24 && !observed; attempt++) {
    await delay(200);
    const name = [...runner.containers][0];
    if (name) observed = (await runner.cli(['exec', name, 'test', '-f', '/work/cancelled.txt'], { timeout: 500 })).code === 0;
  }
  controller.abort(); await cancelled;
  assert.equal(observed, true, 'The learner script must have started before cancellation.');
  assert.equal(store.getWorkspace(boundaries.workspaceId).revision, originalRevision);
  assert.equal(runner.active.size, 0); assert.equal(runner.containers.size, 0);
  const resumed = await request({ language: 'linux', code: 'cat note.txt; test ! -e cancelled.txt', workspaceId: boundaries.workspaceId, workspaceRevision: originalRevision });
  assert.equal(resumed.status, 'accepted'); assert.equal(resumed.stdout, 'saved');
});
