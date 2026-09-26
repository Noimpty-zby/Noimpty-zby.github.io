import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { ApiError, invariant } from './errors.mjs';
import { processResult } from './process.mjs';
import { TerminalSession } from './terminal.mjs';
import { diagnostics, normalizeOutput, pythonTraceback } from './validation.mjs';

const LIMIT = 131072, SNAPSHOT_LIMIT = 32 * 1024 * 1024;
const ext = { c: 'c', cpp: 'cpp', go: 'go', python: 'py', git: 'sh', linux: 'sh', mysql: 'sql' };
const stringResult = result => ({ ...result, stdout: result.stdout.toString('utf8'), stderr: result.stderr.toString('utf8') });
const status = result => result.reason || (result.code === 0 ? 'accepted' : 'runtime_error');
const dockerEnv = () => Object.fromEntries(['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'XDG_RUNTIME_DIR'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
export class DockerRunner {
  constructor(store, { image = 'nanaly-runner:1', docker = 'docker', concurrency = 2, execute = processResult, spawnProcess = spawn, maxTerminals = 2, terminal = {} } = {}) {
    this.instanceId = createHash('sha256').update(store.directory).digest('hex').slice(0, 24);
    this.store = store; this.image = image; this.docker = docker; this.concurrency = concurrency; this.execute = execute;
    this.spawnProcess = spawnProcess; this.maxTerminals = maxTerminals; this.terminalOptions = terminal;
    this.active = new Map(); this.containers = new Set(); this.busy = new Set(); this.store.busy = this.busy; this.terminals = new Set();
    this.cache = null; this.lastHealth = 0;
    invariant(!store.directory.includes(','), 500, 'INVALID_PATH', '数据目录不能包含逗号。');
  }
  cli(args, options = {}) {
    invariant(!this.closing || args[0] !== 'create', 503, 'SERVER_CLOSING', '后端正在停止，请稍后重试。');
    return this.execute(this.docker, args, { ...options, env: dockerEnv() }); }
  environment() { return dockerEnv(); }
  containerArgs(name, directory, { seconds = 150, hostname = null } = {}) {
    return ['create', '--name', name, '--pull=never', '--label', 'nanaly.runner=1', '--label', 'nanaly.owner=' + this.instanceId,
      ...(hostname ? ['--hostname=' + hostname] : []),
      '--network=none', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges:true',
      '--user=10001:10001', '--pids-limit=96', '--cpus=1', '--memory=1024m', '--memory-swap=1024m',
      '--ulimit=nofile=256:256', '--ulimit=core=0:0', '--ulimit=fsize=67108864:67108864',
      '--tmpfs=/work:rw,exec,nosuid,nodev,size=256m,mode=0700,uid=10001,gid=10001',
      '--tmpfs=/tmp:rw,exec,nosuid,nodev,size=128m,mode=1777',
      '--mount', 'type=bind,src=' + directory + ',dst=/input,readonly',
      '--workdir=/work', '--env=HOME=/work', '--env=GOCACHE=/tmp/go-cache', '--env=GOPATH=/tmp/gopath',
      '--env=CGO_ENABLED=0', '--env=GOTOOLCHAIN=local', '--env=GOPROXY=off',
      this.image, 'sleep', String(seconds)];
  }
  terminalFor(workspaceId) { for (const session of this.terminals) if (session.workspace.workspaceId === workspaceId) return session; return null; }
  // One terminal per workspace: a newer window takes over after the older one has saved.
  async startTerminal({ language, workspaceId, cols = 80, rows = 24 }) {
    invariant(!this.closing, 503, 'SERVER_CLOSING', '后端正在停止，请稍后重试。');
    invariant((await this.health()).ready, 503, 'RUNNER_UNAVAILABLE', '隔离执行环境尚未就绪，请完成后端 Docker 配置。');
    let workspace = null;
    if (workspaceId) { try { workspace = this.store.getWorkspace(workspaceId); } catch (error) { if (error.code !== 'WORKSPACE_NOT_FOUND') throw error; } }
    workspace ||= this.store.listWorkspaces().find(item => item.language === language) || null;
    if (workspace) {
      invariant(workspace.language === language, 400, 'WORKSPACE_LANGUAGE', '工作区语言不匹配。');
      const holder = this.terminalFor(workspace.workspaceId);
      if (holder) await holder.end('replaced');
      workspace = this.store.getWorkspace(workspace.workspaceId);
      invariant(!this.busy.has(workspace.workspaceId), 409, 'WORKSPACE_BUSY', '这个工作区正在执行脚本，请等它结束后再打开终端。');
    }
    invariant(this.terminals.size < this.maxTerminals, 429, 'TERMINAL_LIMIT', '同时打开的终端已达上限，请先关闭其他窗口里的终端。');
    workspace ||= await this.store.resetWorkspace(null, language);
    invariant(!this.busy.has(workspace.workspaceId), 409, 'WORKSPACE_BUSY', '这个工作区正在执行脚本，请等它结束后再打开终端。');
    this.busy.add(workspace.workspaceId);
    const session = new TerminalSession(this, workspace, this.terminalOptions);
    this.terminals.add(session);
    session.starting = session.start(cols, rows);
    try { await session.starting; }
    catch (error) { await session.end('failed'); throw error; }
    return session;
  }
  async health(force = false) {
    if (this.pendingHealth) return this.pendingHealth;
    this.pendingHealth = this.probeHealth(force).finally(() => { this.pendingHealth = null; });
    return this.pendingHealth;
  }
  async probeHealth(force = false) {
    if (!force && this.cache && Date.now() - this.lastHealth < 10000) return this.cache;
    const result = await this.cli(['info', '--format', '{{json .}}'], { timeout: 5000, limit: 65536 });
    let info;
    try { info = JSON.parse(result.stdout.toString('utf8')); } catch {}
    let ready = result.code === 0 && info?.OSType === 'linux' && info?.CgroupVersion === '2' && info?.MemoryLimit && info?.PidsLimit && (info?.CpuCfsQuota === true || info?.CPUCfsQuota === true);
    if (ready) {
      const image = await this.cli(['image', 'inspect', this.image, '--format', '{{.Id}}'], { timeout: 5000 });
      ready = image.code === 0;
    }
    this.lastHealth = Date.now();
    this.cache = { ready: Boolean(ready), reason: ready ? null : '需要 Linux Docker、cgroup v2 资源限制和已构建的 nanaly-runner 镜像。' };
    return this.cache;
  }
  async cleanAbandoned() {
    const result = await this.cli(['ps', '-aq', '--filter', 'label=nanaly.runner=1', '--filter', 'label=nanaly.owner=' + this.instanceId], { timeout: 5000 });
    if (result.code !== 0) return;
    const ids = result.stdout.toString('utf8').trim().split(/\s+/).filter(id => /^[a-f0-9]{12,64}$/.test(id));
    for (const id of ids) await this.cli(['rm', '-f', id], { timeout: 10000 });
    // Jobs contain input only, never user-controlled path names.
    for (const name of await fs.readdir(path.join(this.store.directory, 'jobs'))) {
      if (/^[a-f0-9-]{36}$/.test(name)) await fs.rm(path.join(this.store.directory, 'jobs', name), { recursive: true, force: true });
    }
  }
  // Runs and checks share the slots. A run clicked right after a cancelled check waits for that
  // container's cleanup instead of failing with RUNNER_BUSY; callers set active synchronously after.
  async slot(notCancelled, wait = 20000) {
    const deadline = Date.now() + wait;
    while (this.active.size >= this.concurrency) {
      invariant(Date.now() < deadline, 429, 'RUNNER_BUSY', '执行队列已满，请稍后重试。');
      await new Promise(resolve => setTimeout(resolve, 200));
      notCancelled();
    }
  }
  async run(request, { signal } = {}) {
    const notCancelled = () => invariant(!signal?.aborted && !this.closing, 499, 'RUN_CANCELLED', '本次执行已取消。');
    notCancelled();
    if (request.language === 'mysql' && request.mode === 'check') return {
      runId: randomUUID(), revision: request.revision, status: 'unsupported_check', stdout: '', stderr: '', diagnostics: [], tests: [],
      warnings: ['MySQL 仅在明确点击运行后由真实数据库验证；即时检查不执行 SQL。']
    };
    invariant((await this.health()).ready, 503, 'RUNNER_UNAVAILABLE', '隔离执行环境尚未就绪，请完成后端 Docker 配置。');
    await this.slot(notCancelled);
    notCancelled();
    const runId = randomUUID(), name = 'nanaly-' + runId;
    const abort = () => {
      for (const container of this.containers) if (container === name || container.startsWith(name + '-case-')) void this.cli(['kill', container], { timeout: 5000 });
    };
    signal?.addEventListener('abort', abort, { once: true });
    this.active.set(runId, name);
    let workspace, directory, containerCreated = false, ownsWorkspace = false;
    try {
      if (['git', 'linux', 'mysql'].includes(request.language) && (request.mode === 'run' || request.workspaceId)) {
        workspace = request.workspaceId ? this.store.getWorkspace(request.workspaceId) : await this.store.resetWorkspace(null, request.language);
        invariant(workspace.language === request.language, 400, 'WORKSPACE_LANGUAGE', '工作区语言不匹配。');
        invariant(!this.terminalFor(workspace.workspaceId), 409, 'WORKSPACE_BUSY', '这个工作区正在终端里使用；关闭终端后才能执行脚本。');
        invariant(!this.busy.has(workspace.workspaceId), 409, 'WORKSPACE_BUSY', '工作区正在执行。');
        invariant(!request.workspaceId || request.workspaceRevision === workspace.revision, 409, 'WORKSPACE_CONFLICT', '工作区已被另一设备修改，请刷新。', { workspaceRevision: workspace.revision });
        this.busy.add(workspace.workspaceId); ownsWorkspace = true;
      }
      directory = path.join(this.store.directory, 'jobs', runId);
      await fs.mkdir(directory, { mode: 0o755 }); await fs.chmod(directory, 0o755);
      await fs.writeFile(path.join(directory, 'main.' + ext[request.language]), request.code, { mode: 0o444 });
      await fs.chmod(path.join(directory, 'main.' + ext[request.language]), 0o444);
      if (workspace?.revision) {
        await fs.copyFile(this.store.snapshotPath(workspace), path.join(directory, 'workspace.snapshot'));
        await fs.chmod(path.join(directory, 'workspace.snapshot'), 0o444);
      }
      const createArgs = this.containerArgs(name, directory);
      containerCreated = true; this.containers.add(name);
      const created = await this.cli(createArgs, { timeout: 10000 });
      notCancelled();
      invariant(created.code === 0, 503, 'RUNNER_CREATE_FAILED', '隔离容器创建失败，请检查后端运行环境。');
      containerCreated = true;
      invariant((await this.cli(['start', name], { timeout: 10000 })).code === 0, 503, 'RUNNER_START_FAILED', '隔离容器启动失败。');
      const exec = async (args, input, timeout = 5000, limit = LIMIT) => {
        notCancelled();
        return this.cli(['exec', '-i', name, ...args], { input, timeout, limit,
          onLimit: () => { void this.cli(['kill', name], { timeout: 5000 }); } });
      };
      // Refuse execution if Docker accepted flags but cgroups do not actually enforce limits.
      const guard = await exec(['python3', '/opt/nanaly/check-limits.py']);
      invariant(guard.code === 0, 503, 'LIMITS_UNAVAILABLE', '容器资源限制未生效，已拒绝执行。');
      if (workspace?.revision && request.language !== 'mysql') {
        const restored = await exec(['tar', '-xzf', '/input/workspace.snapshot', '--no-same-owner', '--same-permissions', '-C', '/work'], null, 10000);
        invariant(restored.code === 0, 500, 'WORKSPACE_RESTORE_FAILED', '工作区快照恢复失败，请重置工作区。');
      }
      if (request.language === 'git' && !workspace?.revision) {
        const init = await exec(['git', 'init', '-b', 'main', '/work']);
        invariant(init.code === 0, 500, 'WORKSPACE_INIT_FAILED', '练习仓库初始化失败。');
      }
      let workspaceSnapshotSafe = true;
      let result = { runId, revision: request.revision, status: 'checked', stdout: '', stderr: '', diagnostics: [], tests: [] };
      let compiled = { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
      if (request.language === 'c') compiled = await exec(['gcc', '-std=c17', '-Wall', '-Wextra', '-O0', '/input/main.c', '-o', '/work/program'], null, 30000);
      if (request.language === 'cpp') compiled = await exec(['g++', '-std=c++20', '-Wall', '-Wextra', '-O0', '/input/main.cpp', '-o', '/work/program'], null, 30000);
      if (request.language === 'go') {
        // Seed the writable cache from the image's warmed copy; a failed copy only means a slow, cold build.
        await exec(['cp', '-r', '/opt/go-cache', '/tmp/go-cache'], null, 10000);
        compiled = await exec(['go', 'build', '-o', '/work/program', '/input/main.go'], null, 45000);
      }
      if (request.language === 'python') compiled = await exec(['python3', '/opt/nanaly/py-check.py', '/input/main.py'], null, 10000);
      if (['git', 'linux'].includes(request.language)) compiled = await exec(['bash', '-n', '/input/main.sh']);
      result.stderr = compiled.stderr.toString('utf8'); result.diagnostics = diagnostics(result.stderr);
      if (compiled.code !== 0 || compiled.reason) {
        result.status = compiled.reason || 'compile_error';
      } else if (request.language === 'mysql') {
        const mysql = await this.mysql(exec, request, workspace);
        result = { ...result, ...mysql };
      } else if (request.mode === 'run') {
        if (['git', 'linux'].includes(request.language)) {
          const executed = stringResult(await exec(['python3', '/opt/nanaly/shell-session.py', 'run', '/input/main.sh'], request.stdin, 30000));
          result = { ...result, status: status(executed), exitCode: executed.code, stdout: executed.stdout, stderr: executed.stderr, diagnostics: diagnostics(executed.stderr) };
          if (!executed.reason) {
            const cleaned = await exec(['python3', '/opt/nanaly/cleanup.py']);
            workspaceSnapshotSafe = cleaned.code === 0 && !cleaned.reason;
            const metadata = await exec(['cat', '/tmp/nanaly-shell-result.json'], null, 2000, 16384);
            let session;
            try { if (metadata.code === 0 && !metadata.reason) session = JSON.parse(metadata.stdout.toString('utf8')); } catch {}
            const validCwd = typeof session?.cwd === 'string' && session.cwd.startsWith('/') && session.cwd.length <= 4096 && !session.cwd.includes('\0');
            workspaceSnapshotSafe = workspaceSnapshotSafe && validCwd && session?.shellStateSaved === true;
            result.cwd = validCwd ? session.cwd : '/work';
            if (Array.isArray(session?.warnings)) result.warnings = session.warnings.filter(value => typeof value === 'string').slice(0, 5).map(value => value.slice(0, 2000));
            const summary = await exec(request.language === 'git'
              ? ['git', '-C', result.cwd, '-c', 'core.fsmonitor=false', 'status', '--short', '--branch']
              : ['find', result.cwd, '-maxdepth', '2', '-not', '-path', '*/.git/*'], null, 2000, 8192);
            result.workspaceSummary = summary.stdout.toString('utf8');
            const finalClean = await exec(['python3', '/opt/nanaly/cleanup.py']);
            workspaceSnapshotSafe = workspaceSnapshotSafe && finalClean.code === 0 && !finalClean.reason;
            if (workspaceSnapshotSafe) {
              const saved = await exec(['python3', '/opt/nanaly/shell-session.py', 'persist']);
              workspaceSnapshotSafe = saved.code === 0 && !saved.reason;
            }
          }
        } else {
          const cases = request.tests.length ? request.tests : [{ input: request.stdin }];
          const python = request.language === 'python';
          // Export the compiler output as opaque bytes. Each case gets a fresh sandbox,
          // so one test cannot alter the next test's filesystem, processes or binary.
          // Python runs /input/main.py directly, which every case container already mounts.
          if (!python) {
            const binary = await exec(['cat', '/work/program'], null, 5000, 16 * 1024 * 1024);
            invariant(binary.code === 0 && !binary.reason, 500, 'COMPILE_OUTPUT_FAILED', '无法读取编译结果。');
            await fs.writeFile(path.join(directory, 'program'), binary.stdout, { mode: 0o555 });
            await fs.chmod(path.join(directory, 'program'), 0o555);
          }
          for (const [index, test] of cases.entries()) {
            notCancelled();
            const caseName = name + '-case-' + index;
            let executed;
            try {
              this.containers.add(caseName);
              const args = [...createArgs]; args[2] = caseName;
              invariant((await this.cli(args, { timeout: 10000 })).code === 0, 503, 'RUNNER_CREATE_FAILED', '测试容器创建失败。');
              notCancelled();
              invariant((await this.cli(['start', caseName], { timeout: 10000 })).code === 0, 503, 'RUNNER_START_FAILED', '测试容器启动失败。');
              notCancelled();
              const caseGuard = await this.cli(['exec', caseName, 'python3', '/opt/nanaly/check-limits.py'], { timeout: 5000 });
              notCancelled();
              invariant(caseGuard.code === 0, 503, 'LIMITS_UNAVAILABLE', '测试容器资源限制未生效。');
              // `import torch` alone takes a few seconds on one CPU, so Python gets a longer per-case limit.
              executed = stringResult(await this.cli(['exec', '-i', caseName, ...(python ? ['python3', '/input/main.py'] : ['/input/program'])], {
                input: test.input, timeout: python ? 15000 : 3000, limit: LIMIT,
                onLimit: () => { void this.cli(['kill', caseName], { timeout: 5000 }); }
              }));
            } finally { await this.cli(['rm', '-f', caseName], { timeout: 10000 }); this.containers.delete(caseName); }
            let verdict = status(executed);
            if (verdict === 'accepted' && test.expectedOutput !== undefined && normalizeOutput(executed.stdout) !== normalizeOutput(test.expectedOutput)) verdict = 'wrong_answer';
            result.tests.push({ status: verdict, input: test.input, stdout: executed.stdout, stderr: executed.stderr, ...(test.expectedOutput === undefined ? {} : { expectedOutput: test.expectedOutput }) });
            if (executed.reason) break;
          }
          const failed = result.tests.find(test => test.status !== 'accepted');
          result.status = failed?.status || 'accepted'; result.stdout = result.tests[0]?.stdout || '';
          result.stderr += result.tests[0]?.stderr || '';
          if (python && failed) result.diagnostics.push(...pythonTraceback(failed.stderr));
        }
      }
      notCancelled();
      if (workspace) {
        result.workspaceId = workspace.workspaceId; result.workspaceRevision = workspace.revision;
        if (request.mode === 'run' && !['timeout', 'output_limit', 'compile_error'].includes(result.status)) {
          let snapshot;
          if (request.language === 'mysql') snapshot = result.snapshot;
          else if (workspaceSnapshotSafe) {
            const archive = await exec(['tar', '-czf', '-', '-C', '/work', '.'], null, 10000, SNAPSHOT_LIMIT);
            if (archive.code === 0 && !archive.reason) snapshot = archive.stdout;
          }
          if (snapshot) {
            notCancelled();
            workspace = await this.store.commitWorkspace(workspace, snapshot, { signal });
            result.workspaceRevision = workspace.revision;
            result.workspaceCommitted = true;
          } else {
            result.workspaceCommitted = false;
            result.warnings = [...(result.warnings || []), '工作区快照未能保存；下次执行从上次已保存版本恢复。'];
          }
        } else result.workspaceCommitted = false;
      }
      delete result.snapshot;
      return result;
    } finally {
      signal?.removeEventListener('abort', abort);
      if (containerCreated) await this.cli(['rm', '-f', name], { timeout: 10000 });
      this.containers.delete(name); this.active.delete(runId);
      if (ownsWorkspace) this.busy.delete(workspace.workspaceId);
      if (directory) await fs.rm(directory, { recursive: true, force: true });
    }
  }
  async mysql(exec, request, workspace) {
    const initialized = await exec(['mysqld', '--no-defaults', '--initialize-insecure', '--datadir=/work/mysql', '--log-error=/tmp/mysql-init.log'], null, 45000);
    if (initialized.code !== 0) throw new ApiError(503, 'MYSQL_INIT_FAILED', '隔离 MySQL 初始化失败。');
    // The helper backgrounds only this fixed database command; user SQL never reaches a shell.
    const started = await exec(['python3', '/opt/nanaly/start-mysql.py'], null, 30000);
    if (started.code !== 0) throw new ApiError(503, 'MYSQL_START_FAILED', '隔离 MySQL 启动失败。');
    const base = ['mysql', '--no-defaults', '--protocol=SOCKET', '--socket=/tmp/mysql.sock', '--binary-mode', '--local-infile=0', '--default-character-set=utf8mb4', '--batch'];
    const setup = await exec([...base, '--user=root'], "CREATE DATABASE practice; CREATE USER 'learner'@'localhost'; GRANT ALL ON practice.* TO 'learner'@'localhost';", 5000);
    if (setup.code !== 0) throw new ApiError(503, 'MYSQL_SETUP_FAILED', '练习数据库初始化失败。');
    const client = [...base, '--user=learner', '--database=practice'];
    if (workspace?.revision) {
      const restore = await exec(['python3', '/opt/nanaly/restore-mysql.py'], null, 15000);
      invariant(restore.code === 0, 500, 'WORKSPACE_RESTORE_FAILED', 'SQL 快照恢复失败，请重置工作区。');
    }
    if (request.mode === 'check') {
      // Arbitrary SQL cannot be validated without possibly executing it. Do not fake validation.
      return { status: 'unsupported_check', stdout: '', stderr: '', diagnostics: [], warnings: ['MySQL 仅在明确点击运行后由真实数据库验证；即时检查不执行 SQL。'] };
    }
    const executed = stringResult(await exec(client, request.code, 8000));
    const result = { status: status(executed), stdout: executed.stdout, stderr: executed.stderr, diagnostics: [] };
    const line = executed.stderr.match(/at line (\d+)/);
    if (executed.code !== 0) result.diagnostics.push({ severity: 'error', message: executed.stderr.slice(0, 2000), ...(line ? { line: Number(line[1]) } : {}) });
    if (!executed.reason) {
      const dump = await exec(['mysqldump', '--no-defaults', '--protocol=SOCKET', '--socket=/tmp/mysql.sock', '--user=root', '--set-gtid-purged=OFF', '--no-tablespaces', '--skip-comments', '--skip-extended-insert', '--routines', '--events', 'practice'], null, 10000, SNAPSHOT_LIMIT);
      if (dump.code === 0 && !dump.reason) result.snapshot = dump.stdout;
    }
    return result;
  }
  async close() {
    this.closing = true;
    // Open terminals save their workspaces first; the stop budget in index.mjs bounds this.
    await Promise.all([...this.terminals].map(session => session.end('shutdown')));
    await Promise.all([...this.containers].map(name => this.cli(['rm', '-f', name], { timeout: 10000 })));
  }
}
