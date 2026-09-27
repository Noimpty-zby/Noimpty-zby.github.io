import { invariant } from './errors.mjs';
import { validateScheduleData } from '../../tools/schedule-data.cjs';

// Fixed record names also define the API's entire private-content surface. No
// request path or user field is ever interpolated into a storage filename.
export const PRIVATE_CONTENT_NAMES = Object.freeze(['schedule', 'journal', 'profile', 'usage']);
const LIMITS = Object.freeze({ schedule: 1024 * 1024, journal: 512 * 1024, profile: 128 * 1024, usage: 1024 * 1024 });
const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const text = (value, limit) => typeof value === 'string' && Buffer.byteLength(value) <= limit;
const valid = condition => invariant(condition, 400, 'INVALID_PRIVATE_CONTENT', '私密资料结构无效，原资料未被修改。');

export function privateContentName(name) {
  invariant(PRIVATE_CONTENT_NAMES.includes(name), 404, 'PRIVATE_CONTENT_NOT_FOUND', '私密资料类型不存在。');
  return name;
}

export function emptyPrivateContent(name) {
  privateContentName(name);
  if (name === 'schedule') return { days: {} };
  if (name === 'journal') return { v: 1, entries: [] };
  if (name === 'usage') return { v: 1, runs: [] };
  return '';
}

export function validatePrivateContent(name, data) {
  privateContentName(name);
  // Validate depth before JSON.stringify, including for callers outside HTTP.
  // Preserve extension fields, but reject prototype keys and non-JSON numbers.
  const pending = [[data, 0]];
  let count = 0;
  while (pending.length) {
    const [value, depth] = pending.pop();
    valid(depth < 25 && ++count <= 100000);
    if (value === null || typeof value === 'boolean' || typeof value === 'string') continue;
    if (typeof value === 'number') { valid(Number.isFinite(value)); continue; }
    valid(typeof value === 'object');
    for (const [key, child] of Object.entries(value)) {
      valid(!['__proto__', 'constructor', 'prototype'].includes(key));
      pending.push([child, depth + 1]);
    }
  }
  const encoded = JSON.stringify(data);
  invariant(Buffer.byteLength(encoded) <= LIMITS[name], 413, 'PRIVATE_CONTENT_TOO_LARGE', '私密资料超过此类型的大小上限。');
  if (name === 'profile') { valid(typeof data === 'string' && !data.includes('\0')); return; }
  if (name === 'schedule') {
    // Same schema as the browser/build/automation; do not drop unknown fields.
    try { validateScheduleData(data); } catch { valid(false); }
    return;
  }
  valid(Array.isArray(data) || (record(data) && (data.v === undefined || data.v === 1)));
  const rows = Array.isArray(data) ? data : data[name === 'journal' ? 'entries' : 'runs'];
  valid(Array.isArray(rows) && rows.length <= (name === 'journal' ? 1000 : 2000));
  for (const row of rows) {
    valid(record(row) && integer(row.ts) && (row.at === undefined || text(row.at, 80)));
    if (name === 'journal') {
      valid(text(row.who, 80) && row.who.trim() && text(row.what, 4000) && row.what.trim());
    } else {
      valid(text(row.job, 160) && row.job.trim() && record(row.tasks) && Object.keys(row.tasks).length <= 100);
      for (const [key, usage] of Object.entries(row.tasks)) {
        valid(key.length > 0 && Buffer.byteLength(key) <= 160 && record(usage));
        for (const metric of ['calls', 'hit', 'miss', 'out']) valid(integer(usage[metric]));
      }
    }
  }
}
