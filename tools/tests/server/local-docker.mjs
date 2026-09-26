// A stand-in for the Docker CLI that runs the real runner helpers (shell-session.py, tar, git)
// in local directories, so the terminal paths can be exercised end to end without Docker.
// It provides no isolation: only trusted test commands go through it. cleanup.py and the limit
// check are not run, because inside a container the first kills every process but its own.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { processResult } from '../../../server/lib/process.mjs';

const helpers = fileURLToPath(new URL('../../../server/runner/', import.meta.url));

export function localDocker(root, { log = [] } = {}) {
  const containers = new Map();
  // One pass over every argument, paths inside `sh -c` scripts included, so a mapped path that
  // itself starts with /tmp is not mapped again. Local paths reported back (a shell's cwd) stay.
  const mapPaths = (container, value) => value.startsWith(root) ? value : value.replace(/(?<![\w.-])(?:\/(work|tmp|input)(?=\/|\b)|\/opt\/nanaly\/)/g, (_, root) => root ? container[root] : helpers);
  // The image's /usr/local/bin helpers (`code`, `sudo`) come from the runner directory.
  const env = container => ({ PATH: helpers + ':/usr/bin:/bin', HOME: container.work, LANG: 'C.UTF-8' });
  const done = (code = 0, stdout = '', stderr = '') => ({ code, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) });
  // `exec [-i] [-w dir] [-u user] [-e K=V]… name command…`
  const parseExec = args => {
    let index = 1, cwd = null;
    while (args[index]?.startsWith('-')) {
      const flag = args[index++];
      if (flag === '-w') cwd = args[index++];
      else if (flag === '-u' || flag === '-e') index++;
    }
    const container = containers.get(args[index]);
    if (!container) return { container: null };
    const inner = args.slice(index + 1);
    const mapped = inner.map(value => mapPaths(container, value));
    if (inner[0] === 'python3' && inner[1] === '/opt/nanaly/shell-session.py' && inner[2] !== 'pty') mapped.push('--workspace', container.work, '--temporary', container.tmp);
    return { container, inner, mapped, cwd: cwd ? mapPaths(container, cwd) : container.work };
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
      // Like /work in a real container, a shell's path is the same every time, so a saved current
      // directory still exists in the next session. Shells therefore run one at a time.
      const work = name.startsWith('nanaly-task-') ? path.join(root, 'task-' + name) : path.join(root, 'work');
      const container = { name, input, work, tmp: path.join(root, 'tmp-' + name) };
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
      const { container, inner, mapped, cwd } = parseExec(args);
      if (!container) return done(1, '', 'no such container');
      if (inner[1] === '/opt/nanaly/check-limits.py' || inner[1] === '/opt/nanaly/cleanup.py') return done();
      return processResult('/bin/sh', ['-c', 'cd "$1" && shift && exec "$@"', 'sh', cwd, ...mapped], { ...options, env: env(container) });
    }
    return done(1, '', 'unsupported docker command ' + verb);
  };
  const spawnProcess = (_docker, args, options) => {
    log.push(args.join(' '));
    const { container, mapped, cwd } = parseExec(args);
    const [program, ...rest] = mapped;
    return spawn(program, rest, { ...options, cwd, env: env(container) });
  };
  return { execute, spawnProcess, containers };
}
