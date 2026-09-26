import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

// The server half of RFC 6455, enough for one browser terminal: masked client frames,
// fragmentation, ping/pong and the closing handshake. No extensions or subprotocols.
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
export const acceptKey = key => createHash('sha1').update(key + GUID).digest('base64');
const utf8 = new TextDecoder('utf-8', { fatal: true });

export function refuse(socket, status, text) {
  if (!socket.destroyed) socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}
export function upgrade(req, socket, head, options = {}) {
  const key = req.headers['sec-websocket-key'];
  const valid = req.method === 'GET' && /(^|,)\s*websocket\s*(,|$)/i.test(req.headers.upgrade || '') &&
    req.headers['sec-websocket-version'] === '13' && typeof key === 'string' && Buffer.from(key, 'base64').length === 16;
  if (!valid) { refuse(socket, 400, 'Bad Request'); return null; }
  socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Accept: ' + acceptKey(key), '', ''].join('\r\n'));
  return new WebSocketConnection(socket, head, options);
}

export class WebSocketConnection extends EventEmitter {
  constructor(socket, head, { maxMessage = 1 << 20, heartbeat = 25000 } = {}) {
    super();
    this.socket = socket; this.maxMessage = maxMessage;
    this.buffer = Buffer.alloc(0); this.fragments = []; this.fragmentSize = 0; this.fragmentOpcode = 0;
    this.closed = false; this.closeSent = false; this.closeCode = 1006; this.awaitingPong = false;
    socket.setNoDelay?.(true);
    socket.setTimeout?.(0);
    socket.on('data', chunk => this.receive(chunk));
    socket.on('drain', () => this.emit('drain'));
    socket.on('error', () => socket.destroy());
    socket.on('close', () => this.finish());
    // Proxies drop idle connections; a peer that stops answering pings is gone.
    this.heartbeat = heartbeat > 0 ? setInterval(() => {
      if (this.awaitingPong) { socket.destroy(); return; }
      this.awaitingPong = true; this.frame(9, Buffer.alloc(0));
    }, heartbeat) : null;
    this.heartbeat?.unref?.();
    if (head?.length) this.receive(head);
  }
  get buffered() { return this.socket.writableLength; }
  receive(chunk) {
    if (this.closed) return;
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    for (let frame; !this.closeSent && (frame = this.parse());) this.handle(frame);
  }
  parse() {
    const b = this.buffer;
    if (b.length < 2) return null;
    const fin = (b[0] & 0x80) !== 0, opcode = b[0] & 0x0f;
    let length = b[1] & 0x7f, offset = 2;
    if (b[0] & 0x70 || !(b[1] & 0x80)) return this.fail(1002, 'protocol error');
    if (length === 126) { if (b.length < 4) return null; length = b.readUInt16BE(2); offset = 4; }
    else if (length === 127) {
      if (b.length < 10) return null;
      if (b.readUInt32BE(2)) return this.fail(1009, 'message too large');
      length = b.readUInt32BE(6); offset = 10;
    }
    if (length > this.maxMessage) return this.fail(1009, 'message too large');
    if (b.length < offset + 4 + length) return null;
    const mask = b.subarray(offset, offset + 4);
    const payload = Buffer.from(b.subarray(offset + 4, offset + 4 + length));
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    this.buffer = b.subarray(offset + 4 + length);
    return { fin, opcode, payload };
  }
  handle({ fin, opcode, payload }) {
    if (opcode >= 8) {
      if (!fin || payload.length > 125) { this.fail(1002, 'protocol error'); return; }
      if (opcode === 8) {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        this.closeCode = code;
        this.close(code === 1005 ? 1000 : code);
        return;
      }
      if (opcode === 9) this.frame(10, payload);
      else if (opcode === 10) this.awaitingPong = false;
      else this.fail(1002, 'protocol error');
      return;
    }
    if (opcode === 0 ? !this.fragmentOpcode : opcode > 2 || this.fragmentOpcode) { this.fail(1002, 'protocol error'); return; }
    if (opcode) this.fragmentOpcode = opcode;
    this.fragmentSize += payload.length;
    if (this.fragmentSize > this.maxMessage) { this.fail(1009, 'message too large'); return; }
    this.fragments.push(payload);
    if (!fin) return;
    const data = Buffer.concat(this.fragments), binary = this.fragmentOpcode === 2;
    this.fragments = []; this.fragmentSize = 0; this.fragmentOpcode = 0;
    if (binary) { this.emit('message', data, true); return; }
    let text;
    try { text = utf8.decode(data); } catch { this.fail(1007, 'invalid text'); return; }
    this.emit('message', text, false);
  }
  frame(opcode, payload) {
    if (this.socket.destroyed || this.closeSent || !this.socket.writable) return false;
    const length = payload.length;
    const header = Buffer.alloc(length < 126 ? 2 : length < 65536 ? 4 : 10);
    header[0] = 0x80 | opcode;
    if (length < 126) header[1] = length;
    else if (length < 65536) { header[1] = 126; header.writeUInt16BE(length, 2); }
    else { header[1] = 127; header.writeBigUInt64BE(BigInt(length), 2); }
    if (opcode === 8) this.closeSent = true;
    this.socket.cork(); this.socket.write(header); const flushed = this.socket.write(payload); this.socket.uncork();
    return flushed;
  }
  send(data) { return typeof data === 'string' ? this.frame(1, Buffer.from(data, 'utf8')) : this.frame(2, data); }
  close(code = 1000, reason = '') {
    if (this.closeSent || this.socket.destroyed) return;
    const text = Buffer.from(String(reason).slice(0, 60), 'utf8');
    const payload = Buffer.alloc(2 + text.length);
    payload.writeUInt16BE(code); text.copy(payload, 2);
    if (this.closeCode === 1006) this.closeCode = code;
    this.frame(8, payload);
    this.socket.end();
    // A peer that never finishes the closing handshake must not hold the socket.
    setTimeout(() => this.socket.destroy(), 3000).unref?.();
  }
  fail(code, reason) { this.close(code, reason); return null; }
  finish() {
    if (this.closed) return;
    this.closed = true; clearInterval(this.heartbeat);
    this.emit('close', this.closeCode);
  }
}
