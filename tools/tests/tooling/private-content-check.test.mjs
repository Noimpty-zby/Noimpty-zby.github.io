import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkPrivateContent } from '../../checks/private-content-check.mjs';

const script = fileURLToPath(new URL('../../checks/private-content-check.mjs', import.meta.url));
const legacy = ['schedule.json', 'nanaly-journal.json', 'noimpty-profile.md', 'nanaly-usage.json'];
const marker = 'SYNTHETIC_PRIVATE_CONTENT_DO_NOT_PRINT';
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'private-content-check-'));
  await fs.mkdir(path.join(root, 'source/_data'), { recursive: true });
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = name => path.join(root, 'source/_data', name);
  const run = () => spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', timeout: 10000 });
  return { root, file, run };
}

for (const name of legacy) test(`publication refuses ${name} independently and never prints its contents`, async t => {
  const target = await fixture(t);
  const content = name.endsWith('.md') ? '# ' + marker + '\n' : JSON.stringify({ synthetic: marker });
  await fs.writeFile(target.file(name), content);
  assert.throws(() => checkPrivateContent(target.root), error => {
    assert.ok(error.message.includes('source/_data/' + name));
    assert.equal(error.message.includes(marker), false);
    return true;
  });
  const result = target.run();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.ok(result.stderr.includes('source/_data/' + name));
  assert.equal((result.stdout + result.stderr).includes(marker), false);
  assert.equal(result.stdout.includes('passed'), false);
  assert.equal(await fs.readFile(target.file(name), 'utf8'), content, 'a refused build must not delete or rewrite the source');
});

test('a clean publication source passes even when ordinary public assets have related names', async t => {
  const target = await fixture(t);
  await fs.mkdir(path.join(target.root, 'source/js'), { recursive: true });
  await fs.mkdir(path.join(target.root, 'source/css'), { recursive: true });
  await fs.writeFile(path.join(target.root, 'source/js/schedule.js'), '// public schedule client');
  await fs.writeFile(path.join(target.root, 'source/css/schedule.css'), '/* public styles */');
  await fs.writeFile(target.file('navigation.yml'), 'title: Synthetic public navigation\n');
  assert.equal(checkPrivateContent(target.root), true);
  const result = target.run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stderr, ''); assert.match(result.stdout, /publication guard passed/);
});

test('the guard reports all old private sources in one failure and inspects the requested root only', async t => {
  const blocked = await fixture(t), clean = await fixture(t);
  for (const name of legacy) await fs.writeFile(blocked.file(name), marker);
  const result = blocked.run();
  assert.equal(result.status, 1);
  for (const name of legacy) assert.ok(result.stderr.includes('source/_data/' + name));
  assert.equal(result.stderr.includes(marker), false);
  assert.equal(checkPrivateContent(clean.root), true);
  assert.equal(clean.run().status, 0);
});

test('empty placeholders at each forbidden source path are rejected before they can be repopulated', async t => {
  const target = await fixture(t);
  for (const name of legacy) {
    await fs.writeFile(target.file(name), '');
    assert.throws(() => checkPrivateContent(target.root), /Private source data must stay outside/);
    await fs.rm(target.file(name));
  }
  assert.equal(checkPrivateContent(target.root), true);
});

test('directories and live symbolic links at forbidden source paths cannot bypass publication checks', { skip: process.platform === 'win32' }, async t => {
  const target = await fixture(t);
  const external = path.join(target.root, 'outside-source.json');
  await fs.writeFile(external, marker);
  for (const name of legacy) {
    await fs.mkdir(target.file(name));
    assert.throws(() => checkPrivateContent(target.root), /Private source data must stay outside/);
    await fs.rmdir(target.file(name));
    await fs.symlink(external, target.file(name));
    assert.throws(() => checkPrivateContent(target.root), /Private source data must stay outside/);
    await fs.unlink(target.file(name));
  }
  assert.equal(await fs.readFile(external, 'utf8'), marker);
  assert.equal(checkPrivateContent(target.root), true);
});
