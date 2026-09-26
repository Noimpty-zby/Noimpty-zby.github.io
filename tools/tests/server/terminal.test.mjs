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
import { validateRun } from '../../../server/lib/validation.mjs';
import { upgrade } from '../../../server/lib/websocket.mjs';
import { createApp } from '../../../server/app.mjs';
import { localDocker } from './local-docker.mjs';

const token = 'test-only-0123456789-abcdef-abcdef';
const origin = 'https://blog.example';
const available = process.platform === 'linux' && spawnSync('python3', ['--version']).status === 0 && spawnSync('tar', ['--version']).status === 0;
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

async function backend(t, runnerOptions = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nanaly-terminal-api-'));
  const store = await new PrivateStore(path.join(root, 'private')).init();
  const log = [];
  const docker = localDocker(path.join(root, 'containers'), { log });
  const runner = new DockerRunner(store, { execute: docker.execute, spawnProcess: docker.spawnProcess, ...runnerOptions });
  const terminals = new TerminalManager(runner);
  const server = createApp({ store, runner, terminals, token, origins: [origin] });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await runner.close(); terminals.close(); server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); await store.close(); await fs.rm(root, { recursive: true, force: true }); });
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
    const events = []; let output = ''; const waiters = new Set();
    const notify = () => { for (const waiter of waiters) waiter(); };
    ws.onmessage = event => {
      if (typeof event.data === 'string') events.push(JSON.parse(event.data));
      else output += Buffer.from(event.data).toString('utf8');
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
      event: type => wait(() => events.find(item => item.type === type), type),
      until: (pattern, from = 0) => wait(() => plain(output).slice(from).match(pattern), String(pattern)),
      type: data => ws.send(JSON.stringify({ type: 'input', data })),
      close: () => ws.send(JSON.stringify({ type: 'close' }))
    };
  };
  return { base, store, runner, terminals, ticket, open, connect, log };
}

test('terminal tickets need the owner token, are single use and only open from allowed origins', { skip: !available, timeout: 30000 }, async t => {
  const api = await backend(t);
  assert.equal((await api.ticket({ language: 'linux' }, 'wrong-token-0123456789-abcdef')).status, 401);
  assert.equal((await api.ticket({ language: 'mysql' })).status, 400);
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
  shell.close();
  await shell.event('saved');
});

test('a terminal session runs real Bash, saves the workspace on close, and resumes directory and variables', { skip: !available, timeout: 30000 }, async t => {
  const api = await backend(t);
  const first = await api.open();
  const ready = await first.event('ready');
  assert.equal(ready.language, 'linux'); assert.equal(ready.workspaceRevision, 0);
  await first.until(/\$ $/);
  first.type('mkdir -p demo && cd demo && printf "kept\\n" > note.txt && export LESSON=terminal && echo made-$((40+2))\r');
  await first.until(/made-42\n/);
  await first.until(/\$ $/, first.output.indexOf('made-42'));
  first.close();
  const saved = await first.event('saved');
  assert.equal(saved.committed, true, JSON.stringify(saved));
  assert.equal(saved.workspaceId, ready.workspaceId); assert.equal(saved.workspaceRevision, 1);
  assert.match(saved.cwd, /\/work\/demo$/);
  assert.equal(await first.closed, 1000);
  assert.equal(api.runner.busy.size, 0); assert.equal(api.runner.terminals.size, 0);

  const second = await api.open({ language: 'linux', workspaceId: ready.workspaceId, cols: 90, rows: 20 });
  assert.equal((await second.event('ready')).workspaceRevision, 1);
  await second.until(/\$ $/);
  second.type('pwd; cat note.txt; echo "lesson=$LESSON"\r');
  await second.until(/\/work\/demo\nkept\nlesson=terminal\n/);
  // A dropped connection saves just like an explicit close.
  second.ws.close();
  await second.closed;
  const deadline = Date.now() + 8000;
  while (api.store.getWorkspace(ready.workspaceId).revision !== 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(api.store.getWorkspace(ready.workspaceId).revision, 2);
});

test('one terminal per workspace: a new window takes over, scripts wait, typing exit ends and saves', { skip: !available, timeout: 30000 }, async t => {
  const api = await backend(t);
  const first = await api.open({ language: 'git' });
  const ready = await first.event('ready');
  await first.until(/\$ $/);
  first.type('git status --short --branch\r');
  await first.until(/## No commits yet on main/);
  await assert.rejects(api.runner.run(validateRun({ language: 'git', code: 'git status', workspaceId: ready.workspaceId, workspaceRevision: 0 })), error => error.code === 'WORKSPACE_BUSY' && /终端/.test(error.message));
  const second = await api.open({ language: 'git', workspaceId: ready.workspaceId });
  const replaced = await first.event('saved');
  assert.equal(replaced.reason, 'replaced'); assert.match(replaced.message, /另一个窗口/);
  assert.equal((await second.event('ready')).workspaceRevision, 1);
  await second.until(/\$ $/);
  second.type('exit 4\r');
  assert.equal((await second.event('exit')).code, 4);
  const saved = await second.event('saved');
  assert.equal(saved.reason, 'exit'); assert.equal(saved.committed, true); assert.equal(saved.workspaceRevision, 2);
  await second.closed;
  assert.equal(api.runner.busy.size, 0);
});

test('an idle terminal saves and closes itself, and server shutdown saves open terminals', { skip: !available, timeout: 30000 }, async t => {
  const api = await backend(t, { terminal: { idle: 1500 } });
  const idle = await api.open();
  await idle.event('ready');
  await idle.until(/\$ $/);
  const saved = await idle.event('saved');
  assert.equal(saved.reason, 'idle'); assert.equal(saved.committed, true);
  const open = await api.open();
  await open.event('ready');
  await open.until(/\$ $/);
  await api.runner.close();
  const shutdown = await open.event('saved');
  assert.equal(shutdown.reason, 'shutdown'); assert.equal(shutdown.committed, true);
  assert.equal(api.runner.containers.size, 0);
});
