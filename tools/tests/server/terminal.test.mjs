import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { PrivateStore } from '../../../server/lib/store.mjs';
import { DockerRunner } from '../../../server/lib/runner.mjs';
import { TerminalManager } from '../../../server/lib/terminal.mjs';
import { SessionManager } from '../../../server/lib/sessions.mjs';
import { validateRun } from '../../../server/lib/validation.mjs';
import { upgrade } from '../../../server/lib/websocket.mjs';
import { createApp } from '../../../server/app.mjs';
import { localDocker } from './local-docker.mjs';

const token = 'test-only-0123456789-abcdef-abcdef';
const origin = 'https://blog.example';
const available = process.platform === 'linux' && ['python3', 'tar', 'git', 'bash'].every(command => spawnSync(command, ['--version']).status === 0);
const plain = text => text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\r/g, '');

// Raw client frames for the protocol tests: always masked, as a browser sends them.
const clientFrame = (opcode, payload, { fin = true, mask = true } = {}) => {
  const body = Buffer.from(payload), key = Buffer.from([1, 2, 3, 4]);
  const head = body.length < 126 ? Buffer.from([(fin ? 0x80 : 0) | opcode, (mask ? 0x80 : 0) | body.length])
    : Buffer.from([(fin ? 0x80 : 0) | opcode, (mask ? 0x80 : 0) | 126, body.length >> 8, body.length & 255]);
  const masked = Buffer.from(body); if (mask) for (let i = 0; i < masked.length; i++) masked[i] ^= key[i & 3];
  return Buffer.concat([head, mask ? key : Buffer.alloc(0), masked]);
};
const serverFrames = buffer => {
  const frames = [];
  for (let offset = 0; offset + 2 <= buffer.length;) {
    let length = buffer[offset + 1] & 0x7f, start = offset + 2;
    if (length === 126) { length = buffer.readUInt16BE(offset + 2); start += 2; }
    frames.push({ opcode: buffer[offset] & 0x0f, payload: buffer.subarray(start, start + length) });
    offset = start + length;
  }
  return frames;
};
async function rawSocket(t, onConnection, options) {
  const server = http.createServer();
  server.on('upgrade', (req, socket, head) => { const ws = upgrade(req, socket, head, options); if (ws) onConnection(ws); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }));
  const socket = net.connect(server.address().port, '127.0.0.1');
  await once(socket, 'connect');
  socket.write('GET / HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n');
  let received = Buffer.alloc(0);
  socket.on('data', chunk => { received = Buffer.concat([received, chunk]); });
  const settle = () => new Promise(resolve => setTimeout(resolve, 80));
  await settle();
  const header = received.indexOf('\r\n\r\n');
  assert.match(received.subarray(0, header).toString(), /^HTTP\/1\.1 101 [^]*Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=/);
  received = received.subarray(header + 4);
  return { socket, settle, frames: () => serverFrames(received) };
}

test('WebSocket frames: fragments reassemble, pings are answered, unmasked and oversized frames close the socket', async t => {
  const messages = [];
  const echo = await rawSocket(t, ws => ws.on('message', (data, binary) => { messages.push([data, binary]); ws.send(binary ? data : 'echo:' + data); }), { maxMessage: 64, heartbeat: 0 });
  echo.socket.write(Buffer.concat([clientFrame(1, 'hel', { fin: false }), clientFrame(9, 'p'), clientFrame(0, 'lo 你好')]));
  await echo.settle();
  assert.deepEqual(messages, [['hello 你好', false]]);
  assert.deepEqual(echo.frames().map(frame => [frame.opcode, frame.payload.toString()]), [[10, 'p'], [1, 'echo:hello 你好']]);
  echo.socket.write(clientFrame(1, 'x'.repeat(65)));
  await echo.settle();
  assert.equal(echo.frames().at(-1).opcode, 8); assert.equal(echo.frames().at(-1).payload.readUInt16BE(0), 1009);

  const unmasked = await rawSocket(t, () => {}, { heartbeat: 0 });
  unmasked.socket.write(clientFrame(1, 'hi', { mask: false }));
  await unmasked.settle();
  assert.equal(unmasked.frames()[0].payload.readUInt16BE(0), 1002);

  let closed;
  const polite = await rawSocket(t, ws => ws.on('close', code => { closed = code; }), { heartbeat: 0 });
  const payload = Buffer.alloc(2); payload.writeUInt16BE(1000);
  polite.socket.write(clientFrame(8, payload));
  await polite.settle();
  assert.equal(polite.frames()[0].opcode, 8);
  assert.equal(closed, 1000);
});

async function backend(t, sessionOptions = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nanaly-terminal-api-'));
  const store = await new PrivateStore(path.join(root, 'private')).init();
  const log = [];
  const docker = localDocker(path.join(root, 'containers'), { log });
  const runner = new DockerRunner(store, { execute: docker.execute, spawnProcess: docker.spawnProcess });
  const sessions = new SessionManager(runner, sessionOptions);
  const terminals = new TerminalManager(sessions);
  const server = createApp({ store, runner, sessions, terminals, token, origins: [origin] });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { terminals.close(); await sessions.close(); await runner.close(); server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); await store.close(); await fs.rm(root, { recursive: true, force: true }); });
  const api = async (pathname, body, method = 'POST') => {
    const response = await fetch(base + pathname, { method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  };
  const ticket = async (body, auth = token) => {
    const response = await fetch(base + '/api/terminal/ticket', { method: 'POST', headers: { Authorization: 'Bearer ' + auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const open = async (body = { language: 'linux', cols: 100, rows: 30 }) => {
    const issued = await ticket(body);
    assert.equal(issued.status, 200, JSON.stringify(issued.body));
    return connect(issued.body.ticket);
  };
  const connect = ticketValue => {
    const ws = new WebSocket(base.replace('http', 'ws') + '/api/terminal?ticket=' + ticketValue, { headers: { Origin: origin } });
    ws.binaryType = 'arraybuffer';
    const events = []; let output = '', bytes = 0; const waiters = new Set();
    const notify = () => { for (const waiter of waiters) waiter(); };
    ws.onmessage = event => {
      if (typeof event.data === 'string') events.push(JSON.parse(event.data));
      else { output += Buffer.from(event.data).toString('utf8'); bytes += event.data.byteLength; }
      notify();
    };
    const closed = new Promise(resolve => { ws.onclose = event => { events.push({ type: 'socket-closed', code: event.code }); notify(); resolve(event.code); }; });
    ws.onerror = () => {};
    const wait = (check, label, timeout = 8000) => new Promise((resolve, reject) => {
      const test = () => { const value = check(); if (value) { waiters.delete(test); clearTimeout(timer); resolve(value); } };
      const timer = setTimeout(() => { waiters.delete(test); reject(new Error(`timed out waiting for ${label}; events ${JSON.stringify(events)}; output:\n${plain(output)}`)); }, timeout);
      waiters.add(test); test();
    });
    return {
      ws, events, closed,
      get output () { return plain(output); },
      get bytes () { return bytes; },
      event: type => wait(() => events.find(item => item.type === type), type),
      until: (pattern, from = 0) => wait(() => plain(output).slice(from).match(pattern), String(pattern)),
      send: value => ws.send(JSON.stringify(value)),
      type: data => ws.send(JSON.stringify({ type: 'input', data }))
    };
  };
  return { base, store, runner, sessions, terminals, api, ticket, open, connect, log };
}
const prompt = /\$ $/;

test('terminal tickets need the owner token, are single use and only open from allowed origins', { skip: !available, timeout: 30000 }, async t => {
  const api = await backend(t);
  assert.equal((await api.ticket({ language: 'linux' }, 'wrong-token-0123456789-abcdef')).status, 401);
  assert.equal((await api.ticket({ language: 'mysql' })).status, 400);
  assert.equal((await api.ticket({ kind: 'task', language: 'python', code: '' })).status, 400);
  const issued = await api.ticket({ language: 'linux' });
  assert.match(issued.body.ticket, /^[a-f0-9]{48}$/); assert.equal(issued.body.expiresIn, 30);
  const upgradeStatus = (ticket, headers = {}) => new Promise(resolve => {
    const request = http.request(api.base + '/api/terminal?ticket=' + ticket, { headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', ...headers } });
    request.on('response', response => { resolve(response.statusCode); response.resume(); });
    request.on('upgrade', (response, socket) => { socket.destroy(); resolve(response.statusCode); });
    request.end();
  });
  assert.equal(await upgradeStatus(issued.body.ticket, { Origin: 'https://evil.example' }), 403);
  assert.equal(await upgradeStatus('f'.repeat(48)), 401);
  const shell = api.connect(issued.body.ticket);
  await shell.event('ready');
  assert.equal(await upgradeStatus(issued.body.ticket), 401, 'a ticket opens one socket only');
});

test('a shell outlives its page: reconnecting replays only what was missed, a new page gets the whole screen', { skip: !available, timeout: 30000 }, async t => {
  const api = await backend(t);
  const first = await api.open();
  const ready = await first.event('ready');
  assert.equal(ready.language, 'linux'); assert.equal(ready.reset, true); assert.equal(ready.offset, 0);
  await first.until(prompt);
  first.type('mkdir -p demo && cd demo && export LESSON=terminal && echo first-$((40+2))\r');
  await first.until(/first-42\n/);
  await first.until(prompt, first.output.indexOf('first-42'));
  const seen = first.bytes;
  first.ws.close(); await first.closed;
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(api.sessions.shells.size, 1, 'closing the page does not end the shell');
  // Output produced while nobody watches is kept.
  const again = await api.open({ language: 'linux', workspaceId: ready.workspaceId, sessionId: ready.sessionId, since: seen, cols: 100, rows: 30 });
  const resumed = await again.event('ready');
  assert.equal(resumed.sessionId, ready.sessionId); assert.equal(resumed.reset, false); assert.equal(resumed.offset, seen);
  again.type('pwd; echo "$LESSON"\r');
  await again.until(/\/work\/demo\nterminal\n/);
  assert.doesNotMatch(again.output, /first-42/, 'bytes the page already had are not sent again');
  const fresh = await api.open({ language: 'linux', cols: 100, rows: 30 });
  const whole = await fresh.event('ready');
  assert.equal(whole.sessionId, ready.sessionId); assert.equal(whole.reset, true);
  await fresh.until(/first-42[\s\S]*\/work\/demo\nterminal\n/);
  // Both pages see what either one types.
  fresh.type('echo shared-$((1+1))\r');
  await again.until(/shared-2\n/);
  again.type('exit\r');
  const exit = await fresh.event('exit');
  assert.equal(exit.code, 0); assert.equal(exit.committed, true); assert.equal(exit.workspaceRevision, 1);
  assert.equal((await again.event('exit')).workspaceRevision, 1);
  await fresh.closed;
  assert.equal(api.runner.busy.size, 0); assert.equal(api.sessions.shells.size, 0);
  // The next shell starts from the saved state.
  const next = await api.open({ language: 'linux', cols: 100, rows: 30 });
  assert.notEqual((await next.event('ready')).sessionId, ready.sessionId);
  await next.until(prompt);
  next.type('pwd; echo "$LESSON"; history | grep -c "export LESSON"\r');
  await next.until(/\/work\/demo\nterminal\n[1-9]/);
});

test('a script from the editor runs inside the open terminal, where the terminal is', { skip: !available, timeout: 30000 }, async t => {
  const api = await backend(t);
  const shell = await api.open();
  const ready = await shell.event('ready');
  await shell.until(prompt);
  shell.type('mkdir -p lab && cd lab && echo terminal-made > from-terminal.txt && echo made\r');
  await shell.until(/made\n/);
  await shell.until(prompt, shell.output.indexOf('made\n'));
  const listed = (await api.api('/api/workspaces', null, 'GET')).body.workspaces.find(item => item.workspaceId === ready.workspaceId);
  assert.equal(listed.terminal, true); assert.equal(listed.busy, false);
  const run = await api.api('/api/run', { language: 'linux', code: 'pwd; cat from-terminal.txt; echo script-made > from-script.txt', workspaceId: ready.workspaceId, workspaceRevision: 0 });
  assert.equal(run.status, 200, JSON.stringify(run.body));
  assert.match(run.body.stdout, /\/work\/lab\nterminal-made\n/);
  assert.equal(run.body.exitCode, 0); assert.match(run.body.workspaceSummary, /from-script\.txt/);
  shell.type('cat from-script.txt\r');
  await shell.until(/script-made\n/);
  // `code FILE` reads and saves through the same socket.
  shell.send({ type: 'write', id: 1, path: ready.workspaceId ? '/work/lab/note.md' : '', content: '# 标题\n' });
  assert.equal((await shell.event('written')).error, undefined);
  shell.send({ type: 'read', id: 2, path: '/work/lab/note.md' });
  const file = await shell.event('file');
  assert.equal(file.id, 2); assert.equal(file.content, '# 标题\n');
  // Resetting the environment ends the terminal first.
  const reset = await api.api('/api/workspaces/reset', { language: 'linux', workspaceId: ready.workspaceId });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.equal((await shell.event('exit')).message, '运行环境已重置。');
  assert.equal(api.sessions.shells.size, 0);
});

test('Run for a program: compile and run on its own terminal, reading what is typed', { skip: !available, timeout: 30000 }, async t => {
  const api = await backend(t);
  const run = await api.open({ kind: 'task', language: 'python', code: 'a, b = map(int, input("两个数: ").split())\nprint("和是", a + b)\n', cols: 90, rows: 20 });
  assert.equal((await run.event('ready')).language, 'python');
  await run.until(/learner@nanaly:~\$ python3 main\.py\n两个数: /);
  run.type('3 4\r');
  await run.until(/和是 7\n/);
  const exit = await run.event('exit');
  assert.equal(exit.code, 0); assert.equal(typeof exit.seconds, 'number');
  await run.closed;
  assert.equal(api.sessions.tasks.size, 0); assert.equal(api.runner.containers.size, 0);
  // Stop ends a program that would run forever; leaving the page ends one too.
  const loop = await api.open({ kind: 'task', language: 'python', code: 'while True:\n    input()\n' });
  await loop.event('ready');
  await loop.until(/python3 main\.py\n/);
  loop.send({ type: 'terminate' });
  assert.notEqual((await loop.event('exit')).code, 0);
  const left = await api.open({ kind: 'task', language: 'python', code: 'import time\ntime.sleep(60)\n' });
  await left.event('ready');
  left.ws.close();
  const deadline = Date.now() + 8000;
  while (api.sessions.tasks.size && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(api.sessions.tasks.size, 0);
});

test('an unwatched shell saves and closes after a while, and shutdown saves open shells', { skip: !available, timeout: 30000 }, async t => {
  const api = await backend(t, { detachedTimeout: 800 });
  const shell = await api.open({ language: 'git' });
  const ready = await shell.event('ready');
  await shell.until(prompt);
  shell.type('git status --short --branch\r');
  await shell.until(/## No commits yet on main/);
  shell.ws.close();
  const deadline = Date.now() + 8000;
  while (api.store.getWorkspace(ready.workspaceId).revision !== 1 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(api.store.getWorkspace(ready.workspaceId).revision, 1);
  const open = await api.open({ language: 'git' });
  await open.event('ready');
  await open.until(prompt);
  await api.sessions.close();
  assert.equal(api.store.getWorkspace(ready.workspaceId).revision, 2);
  assert.equal(api.runner.containers.size, 0);
});
