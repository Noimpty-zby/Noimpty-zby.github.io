// One-time, idempotent import into the authenticated backend. No document contents
// or credential values are printed. Dry-run is the default; --apply is explicit.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PRIVATE_CONTENT_NAMES, emptyPrivateContent, validatePrivateContent } from '../server/lib/private-content.mjs';

export const FILES = Object.freeze({ schedule: 'schedule.json', journal: 'nanaly-journal.json', profile: 'noimpty-profile.md', usage: 'nanaly-usage.json' });
const stable = value => JSON.stringify(value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(item => JSON.parse(stable(item)))
    : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(stable(value[key]))])) : value);
export async function readSource(directory) {
  const data = {};
  for (const name of PRIVATE_CONTENT_NAMES) {
    const file = path.join(directory, FILES[name]);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('Migration source is not a bounded regular file: ' + name);
    const raw = await fs.readFile(file, 'utf8');
    try { data[name] = name === 'profile' ? raw : JSON.parse(raw); validatePrivateContent(name, data[name]); }
    catch { throw new Error('Invalid migration source: ' + name); }
  }
  return data;
}
function validateResponse(name, value, minimum = 0) {
  if (!Number.isSafeInteger(value?.revision) || value.revision < minimum) throw new Error('Invalid backend revision: ' + name);
  try { validatePrivateContent(name, value.data); }
  catch { throw new Error('Invalid backend data: ' + name); }
}
export async function migrate(data, request, { apply = false } = {}) {
  const plan = [];
  for (const name of PRIVATE_CONTENT_NAMES) {
    validatePrivateContent(name, data[name]);
    const current = await request(name);
    validateResponse(name, current);
    if (current.revision === 0 && stable(current.data) !== stable(emptyPrivateContent(name))) throw new Error('Backend revision zero contains data; refusing to overwrite: ' + name);
    if (current.revision > 0 && stable(current.data) !== stable(data[name])) throw new Error('Backend already has different data; refusing to overwrite: ' + name);
    plan.push({ name, revision: current.revision, action: current.revision > 0 ? 'already-migrated' : 'import' });
  }
  if (!apply) return plan;
  for (const item of plan) {
    if (item.action === 'import') {
      const result = await request(item.name, { revision: item.revision, data: data[item.name] });
      validateResponse(item.name, result, 1);
      if (result.revision !== item.revision + 1 || stable(result.data) !== stable(data[item.name])) throw new Error('Import response did not match source: ' + item.name);
    }
  }
  for (const name of PRIVATE_CONTENT_NAMES) {
    const checked = await request(name);
    validateResponse(name, checked, 1);
    if (stable(checked.data) !== stable(data[name])) throw new Error('Migration verification failed: ' + name);
  }
  return plan.map(item => ({ ...item, verified: true }));
}

export function client(origin, token, fetchImpl = fetch) {
  const url = new URL(origin);
  if (url.origin !== origin || url.username || url.password ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error('Use an HTTPS backend origin or loopback');
  if (typeof token !== 'string' || token.length < 24 || token.length > 1024 || /[\r\n]/.test(token)) throw new Error('Invalid token');
  return async (name, body) => {
    if (!PRIVATE_CONTENT_NAMES.includes(name)) throw new Error('Invalid content name');
    const response = await fetchImpl(origin + '/api/private-content/' + name, {
      method: body ? 'PUT' : 'GET', headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Backend refused migration request: ' + name + ' HTTP ' + response.status); }
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) throw new Error('Backend response exceeded limit');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('Backend returned invalid JSON'); }
  };
}

async function main() {
  const args = process.argv.slice(2), config = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--apply', '--validate-source'].includes(arg)) { config[arg] = true; continue; }
    if (!['--source', '--url', '--token-file'].includes(arg) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Use --source DIR [--validate-source | --url ORIGIN --token-file FILE [--apply]]');
    config[arg] = args[++i];
  }
  if (!config['--source'] || (config['--validate-source'] && config['--apply'])) throw new Error('Invalid migration arguments');
  const data = await readSource(path.resolve(config['--source']));
  if (config['--validate-source']) { console.log('Validated four migration records; no data changed.'); return; }
  if (!config['--url'] || !config['--token-file']) throw new Error('Backend URL and protected token file are required');
  const token = (await fs.readFile(config['--token-file'], 'utf8')).trim();
  const plan = await migrate(data, client(config['--url'], token), { apply: !!config['--apply'] });
  console.log(JSON.stringify({ applied: !!config['--apply'], records: plan }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.code ? 'Migration failed: ' + error.code : error.message); process.exitCode = 1; });
}
