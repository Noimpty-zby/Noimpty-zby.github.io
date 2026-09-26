import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrivateStore } from './lib/store.mjs';
import { DockerRunner } from './lib/runner.mjs';
import { createApp } from './app.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let store, runner, server;
async function main() {
  const token = process.env.NANALY_TOKEN_FILE ? (await fs.readFile(process.env.NANALY_TOKEN_FILE, 'utf8')).trim() : process.env.NANALY_TOKEN;
  // Optional second token for GitHub Actions; a configured but unreadable file stops startup.
  const automationToken = process.env.NANALY_AUTOMATION_TOKEN_FILE ? (await fs.readFile(process.env.NANALY_AUTOMATION_TOKEN_FILE, 'utf8')).trim() : null;
  const port = Number(process.env.PORT || 4318);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid port');
  store = new PrivateStore(process.env.NANALY_DATA_DIR, { repoRoot });
  await store.init();
  runner = new DockerRunner(store, { image: process.env.NANALY_RUNNER_IMAGE || 'nanaly-runner:1', concurrency: 1 });
  // Written by tools/deploy/backend.sh so /api/health shows which commit is running.
  const build = (await fs.readFile(path.join(repoRoot, 'server', 'BUILD'), 'utf8').catch(() => '')).trim();
  server = createApp({ store, runner, token, automationToken, build: /^[0-9a-f]{7,40}$/.test(build) ? build : null, origins: (process.env.NANALY_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean) });
  await runner.cleanAbandoned();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, process.env.HOST || '127.0.0.1', resolve); });
  console.log('娜娜莉私有后端已启动，端口 ' + port + '。访问令牌及私有数据不会写入日志。');
}
let closing = false;
async function close() {
  if (closing) return; closing = true;
  const timer = setTimeout(() => process.exit(1), 15000); timer.unref();
  // Stop accepting requests, abort containers, then let handlers release locks before
  // releasing the storage lock. Never permit a second process to race an active save.
  const requestsDone = server ? new Promise(resolve => server.close(resolve)) : Promise.resolve();
  await runner?.close(); await requestsDone; await store?.close();
  clearTimeout(timer); process.exit(0);
}
process.on('SIGINT', close); process.on('SIGTERM', close);
main().catch(async error => {
  console.error(error?.code ? '后端启动失败：' + error.code : '后端启动失败，请检查令牌、数据目录及端口配置。');
  await store?.close(); process.exitCode = 1;
});
