import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ApiError, invariant } from './lib/errors.mjs';
import { validateRun, languages } from './lib/validation.mjs';

const digest = text => createHash('sha256').update(text).digest();
export function createApp({ store, runner, token, origins = [], now = Date.now }) {
  invariant(typeof token === 'string' && token.length >= 24 && token.length <= 1024 && !token.startsWith('REPLACE_') && !/[\r\n]/.test(token), 500, 'TOKEN_REQUIRED', '请配置至少 24 字符的随机访问令牌。');
  const allowed = new Set(origins.map(origin => {
    const url = new URL(origin);
    invariant(['http:', 'https:'].includes(url.protocol) && url.origin === origin, 500, 'INVALID_ORIGIN', 'CORS 必须填写完整 Origin（不含路径或尾部斜杠）。');
    return origin;
  }));
  const expected = digest('Bearer ' + token), rates = new Map();
  const json = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(value));
  };
  const body = req => new Promise((resolve, reject) => {
    invariant((req.headers['content-type'] || '').split(';')[0].trim() === 'application/json', 415, 'JSON_REQUIRED', '请使用 application/json。');
    let size = 0, rejected = false; const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 1200000) { if (!rejected) { rejected = true; reject(new ApiError(413, 'BODY_TOO_LARGE', '请求内容过大。')); } }
      else if (!rejected) chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      if (rejected) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new ApiError(400, 'INVALID_JSON', 'JSON 格式无效。')); }
    });
  });
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Vary', 'Origin');
    try {
      const origin = req.headers.origin;
      invariant(!origin || allowed.has(origin), 403, 'ORIGIN_DENIED', '此站点未被后端允许。');
      if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        res.setHeader('Access-Control-Max-Age', '600'); res.writeHead(204); res.end(); return;
      }
      const key = req.socket.remoteAddress || 'local', stamp = now();
      let rate = rates.get(key);
      if (!rate || stamp - rate.since > 60000) { rate = { since: stamp, failed: 0, authenticated: 0, health: 0 }; rates.set(key, rate); }
      if (rates.size > 1000) for (const [ip, record] of rates) if (stamp - record.since > 60000) rates.delete(ip);
      // A reverse proxy shares one socket address across clients. Keep public probes,
      // failed authentication, and authenticated operations in separate budgets so
      // an unauthenticated caller cannot lock the owner out. Forwarded IPs are untrusted.
      if (req.method === 'GET' && url.pathname === '/api/health') {
        invariant(++rate.health <= 180, 429, 'RATE_LIMIT', '请求过于频繁，请稍后重试。');
        const runnerState = await runner.health();
        json(res, 200, { ok: true, version: 1, runner: runnerState, capabilities: { state: true, history: true, workspaces: true, languages, runnerReady: runnerState.ready }, recovered: store.recovered }); return;
      }
      if (!timingSafeEqual(expected, digest(req.headers.authorization || ''))) {
        invariant(++rate.failed <= 12, 429, 'RATE_LIMIT', '请求过于频繁，请稍后重试。');
        throw new ApiError(401, 'UNAUTHORIZED', '访问令牌无效。');
      }
      invariant(++rate.authenticated <= 180, 429, 'RATE_LIMIT', '请求过于频繁，请稍后重试。');
      if (url.pathname === '/api/state' && req.method === 'GET') { json(res, 200, store.getState()); return; }
      if (url.pathname === '/api/state' && req.method === 'PUT') {
        const request = await body(req); json(res, 200, await store.putState(request?.revision, request?.data)); return;
      }
      if (url.pathname === '/api/run' && req.method === 'POST') {
        const request = validateRun(await body(req));
        const controller = new AbortController();
        const abort = () => { if (!res.writableEnded) controller.abort(); };
        req.once('aborted', abort); res.once('close', abort);
        try {
          const result = await runner.run(request, { signal: controller.signal });
          invariant(!controller.signal.aborted, 499, 'RUN_CANCELLED', '本次执行已取消。');
          if (request.saveHistory !== false && request.mode !== 'check') {
            try { await store.saveRun({ ...result, language: request.language, code: request.code, stdin: request.stdin, mode: request.mode, testCases: request.tests, ...(request.practice ? { practice: request.practice } : {}), createdAt: new Date().toISOString() }); }
            catch { result.warnings = [...(result.warnings || []), '执行已完成，但历史记录保存失败。']; }
          }
          json(res, 200, result); return;
        } finally { req.off('aborted', abort); res.off('close', abort); }
      }
      if (url.pathname === '/api/runs' && req.method === 'GET') {
        const limit = Number(url.searchParams.get('limit') || 50);
        invariant(Number.isInteger(limit) && limit >= 1 && limit <= 50, 400, 'INVALID_LIMIT', '历史条数必须为 1–50。');
        json(res, 200, { runs: store.history.runs.slice(-limit).reverse() }); return;
      }
      if (url.pathname === '/api/runs' && req.method === 'DELETE') { await store.clearRuns(); json(res, 200, { deleted: true }); return; }
      if (url.pathname === '/api/workspaces/reset' && req.method === 'POST') {
        const request = await body(req);
        json(res, 200, await store.resetWorkspace(request?.workspaceId, request?.language)); return;
      }
      const match = url.pathname.match(/^\/api\/workspaces\/([a-f0-9-]{36})$/);
      if (match && req.method === 'GET') { const value = store.getWorkspace(match[1]); json(res, 200, { ...value, busy: runner.busy.has(match[1]) }); return; }
      if (match && req.method === 'DELETE') { json(res, 200, await store.deleteWorkspace(match[1])); return; }
      throw new ApiError(404, 'NOT_FOUND', '接口不存在。');
    } catch (error) {
      if (res.destroyed || res.writableEnded) return;
      if (error instanceof ApiError) json(res, error.status, { error: { code: error.code, message: error.message }, ...error.extra });
      else json(res, 500, { error: { code: 'INTERNAL_ERROR', message: '后端暂时无法完成请求；请稍后重试。' } });
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 100;
  return server;
}
