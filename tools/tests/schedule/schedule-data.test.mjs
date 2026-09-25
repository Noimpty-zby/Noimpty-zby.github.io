import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pbkdf2Sync, createDecipheriv } from 'node:crypto'
import { validateScheduleData, isCalendarDay } from '../../schedule-data.cjs'
import { SALT, ITER } from '../../site-crypto.cjs'
import { WINDOW, getSchedule } from '../../daily-report/sources.mjs'

const repo = process.cwd()
const task = (id = 'a', extra = {}) => ({ id, text: 'task', done: false, ...extra })
const valid = { days: { '2026-09-19': [task()] } }
const badValues = [null, [], 0, { days: null }, { days: [] }, { days: 'bad' },
  { days: { '2026-02-30': [] } }, { days: { '2025-02-29': [] } }, { days: { '2026-09-18oops': [] } },
  { days: { '2026-09-19': null } }, { days: { '2026-09-19': [null] } },
  { days: { '2026-09-19': [task('', {})] } }, { days: { '2026-09-19': [{ text: 'no id', done: false }] } },
  { days: { '2026-09-19': [task('a', { text: 5 })] } }, { days: { '2026-09-19': [task('a', { done: 'false' })] } },
  { days: { '2026-09-19': [task()], '2026-09-20': [task()] } }]
const withFixture = async fn => {
  const dir = mkdtempSync(join(tmpdir(), 'schedule-shape-'))
  mkdirSync(join(dir, 'source/_data'), { recursive: true })
  try { return await fn(dir, join(dir, 'source/_data/schedule.json')) }
  finally { process.chdir(repo); rmSync(dir, { recursive: true, force: true }) }
}

await test('calendar keys reject overflow and malformed dates while keeping leap days', () => {
  assert.equal(isCalendarDay('2024-02-29'), true)
  assert.equal(isCalendarDay('2025-02-29'), false)
  assert.equal(isCalendarDay('2026-04-31'), false)
  assert.equal(isCalendarDay('2026-13-01'), false)
  assert.equal(isCalendarDay('2026-09-19oops'), false)
  for (const value of badValues) assert.throws(() => validateScheduleData(value))
  assert.equal(validateScheduleData(valid), valid)
  assert.doesNotThrow(() => validateScheduleData({ days: {} }))
})

await test('generator rejects the same malformed schedules as daily reports without rewriting data', async () => {
  await withFixture(async (dir, file) => {
    let generate
    const warnings = []
    const hexo = { source_dir: join(dir, 'source'), log: { warn: message => warnings.push(message) },
      extend: { generator: { register: (_, fn) => { generate = fn } } } }
    const script = resolve(repo, 'scripts/noimpty-schedule.js')
    new Function('hexo', 'require', readFileSync(script, 'utf8'))(hexo, createRequire(script))
    const old = process.env.NOIMPTY_PASSPHRASE
    process.env.NOIMPTY_PASSPHRASE = 'offline-schema-test'
    process.chdir(dir)
    try {
      for (const value of badValues) {
        const raw = JSON.stringify(value)
        writeFileSync(file, raw)
        warnings.length = 0
        assert.deepEqual(generate(), [])
        assert.ok(warnings.some(message => message.includes('日程数据无效')))
        const report = await getSchedule()
        assert.equal(report.ok, false, raw)
        assert.ok(report.why)
        assert.equal(readFileSync(file, 'utf8'), raw)
      }
    } finally { old === undefined ? delete process.env.NOIMPTY_PASSPHRASE : process.env.NOIMPTY_PASSPHRASE = old }
  })
})

await test('encrypted populated schedules preserve automatic completion metadata and extension fields', async () => {
  await withFixture(async (dir, file) => {
    const data = { updatedAt: '', custom: 'keep', days: { '2024-02-29': [task('a', {
      when: { type: 'post', match: 'keyword' }, autoAt: '2024-02-29T00:00:00Z', autoWhy: 'evidence', extra: { keep: true }
    })] } }
    const raw = JSON.stringify(data, null, 2) + '\n'
    assert.equal(validateScheduleData(data), data)
    writeFileSync(file, raw)
    let generate
    const hexo = { source_dir: join(dir, 'source'), log: { warn() {} }, extend: { generator: { register: (_, fn) => { generate = fn } } } }
    const script = resolve(repo, 'scripts/noimpty-schedule.js')
    new Function('hexo', 'require', readFileSync(script, 'utf8'))(hexo, createRequire(script))
    const old = process.env.NOIMPTY_PASSPHRASE
    process.env.NOIMPTY_PASSPHRASE = 'offline-preservation-test'
    try {
      const route = generate()
      assert.equal(route.path, 'schedule/data.json')
      const wrapped = JSON.parse(route.data), bytes = Buffer.from(wrapped.data, 'base64')
      const key = pbkdf2Sync(process.env.NOIMPTY_PASSPHRASE, SALT, ITER, 32, 'sha256')
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      decipher.setAuthTag(bytes.subarray(-16))
      const plain = Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString('utf8')
      assert.equal(plain, raw)
      assert.equal(readFileSync(file, 'utf8'), raw)
    } finally { old === undefined ? delete process.env.NOIMPTY_PASSPHRASE : process.env.NOIMPTY_PASSPHRASE = old }
  })
})

await test('daily schedule keeps the two-week overdue boundary and future tasks out of overdue', async () => {
  await withFixture(async (dir, file) => {
    const key = offset => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date(WINDOW.end + offset * 86400000))
    const days = Object.fromEntries([-15, -14, -1, 0, 1, 2].map(offset => [key(offset), [task(String(offset))]]))
    days[key(-1)].push(task('already-done', { done: true }))
    writeFileSync(file, JSON.stringify({ days }))
    process.chdir(dir)
    const report = await getSchedule()
    assert.equal(report.ok, true)
    assert.deepEqual(report.today.map(t => t.id), ['0'])
    assert.deepEqual(report.tomorrow.map(t => t.id), ['1'])
    assert.deepEqual(report.overdue.map(t => t.id), ['-14', '-1'])
  })
})
