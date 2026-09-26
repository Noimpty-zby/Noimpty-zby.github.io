// A stand-in for the Docker CLI that runs the real runner helpers (shell-session.py, tar, git)
// in local directories, so the terminal path can be exercised end to end without Docker.
// It provides no isolation: only trusted test commands go through it. cleanup.py is not run,
// because inside a container it kills every process but its own.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { processResult } from '../../../server/lib/process.mjs';

const helpers = fileURLToPath(new URL('../../../server/runner/', import.meta.url));

export function localDocker(root, { log = [] } = {}) {
  const containers = new Map();
  // One pass, so a mapped path that itself starts with /tmp is not mapped again.
  const mapPath = (container, value) => value.replace(/^(?:\/(work|tmp|input)(?=\/|$)|\/opt\/nanaly\/)/, (_, root) => root ? container[root] : helpers);
  const env = container => ({ PATH: '/usr/bin:/bin', HOME: container.work, LANG: 'C.UTF-8' });
  const done = (code = 0, stdout = '', stderr = '') => ({ code, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) });
  const command = (container, args) => {
    const mapped = args.map(value => mapPath(container, value));
    if (args[0] === 'python3' && args[1] === '/opt/nanaly/shell-session.py') mapped.push('--workspace', container.work, '--temporary', container.tmp);
    return mapped;
  };
  const execute = async (_docker, args, options = {}) => {
    log.push(args.join(' '));
    const [verb] = args;
    if (verb === 'info') return done(0, JSON.stringify({ OSType: 'linux', CgroupVersion: '2', MemoryLimit: true, PidsLimit: true, CpuCfsQuota: true }));
    if (verb === 'image') return done(0, 'sha256:local');
    if (verb === 'ps') return done(0, '');
    if (verb === 'create') {
      const name = args[args.indexOf('--name') + 1];
      const input = args[args.indexOf('--mount') + 1].match(/src=([^,]+)/)[1];
      // Like /work in a real container, the path is the same every time, so a saved current
      // directory still exists in the next session. Containers therefore run one at a time.
      const container = { name, input, work: path.join(root, 'work'), tmp: path.join(root, 'tmp-' + name) };
      await fs.rm(container.work, { recursive: true, force: true });
      await fs.mkdir(container.work, { recursive: true }); await fs.mkdir(container.tmp, { recursive: true });
      containers.set(name, container);
      return done();
    }
    if (verb === 'start') return done(containers.has(args[1]) ? 0 : 1);
    if (verb === 'rm' || verb === 'kill') {
      const container = containers.get(args.at(-1));
      containers.delete(args.at(-1));
      if (container) { await fs.rm(container.work, { recursive: true, force: true }); await fs.rm(container.tmp, { recursive: true, force: true }); }
      return done();
    }
    if (verb === 'exec') {
      const container = containers.get(args[2]);
      if (!container) return done(1, '', 'no such container');
      const inner = args.slice(3);
      if (inner[1] === '/opt/nanaly/check-limits.py' || inner[1] === '/opt/nanaly/cleanup.py') return done();
      const [program, ...rest] = command(container, inner);
      return processResult(program, rest, { ...options, env: env(container) });
    }
    return done(1, '', 'unsupported docker command ' + verb);
  };
  const spawnProcess = (_docker, args, options) => {
    log.push(args.join(' '));
    const container = containers.get(args[2]);
    const [program, ...rest] = command(container, args.slice(3));
    return spawn(program, rest, { ...options, env: env(container) });
  };
  return { execute, spawnProcess, containers };
}
