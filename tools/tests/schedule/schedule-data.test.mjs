import { privateFixture } from '../private-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { validateScheduleData, isCalendarDay } from '../../schedule-data.cjs'
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

await test('static builds remove sensitive schedule routes and never read source data', () => {
  const removed = [], script = resolve(repo, 'scripts/noimpty-schedule.js')
  let after
  const hexo = { extend: { filter: { register: (name, callback) => { assert.equal(name, 'after_generate'); after = callback } } }, route: { remove: name => removed.push(name) } }
  new Function('hexo', 'require', readFileSync(script, 'utf8'))(hexo, () => { throw new Error('static schedule must not read private data') })
  after()
  assert.deepEqual(removed, ['schedule/data.json'])
})

await test('private schedules preserve automatic metadata and arbitrary extension fields', async () => {
  const data = { updatedAt: '', custom: 'keep', days: { '2024-02-29': [task('a', {
    when: { type: 'post', match: 'keyword' }, autoAt: '2024-02-29T00:00:00Z', autoWhy: 'evidence', extra: { keep: true }
  })] } }
  const fixture = await privateFixture({ schedule: data })
  try { assert.deepEqual(fixture.read('schedule').data, data); assert.equal((await getSchedule()).ok, true) }
  finally { fixture.close() }
})

await test('daily schedule keeps the two-week overdue boundary and future tasks out of overdue', async () => {
  const key = offset => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date(WINDOW.end + offset * 86400000))
  const days = Object.fromEntries([-15, -14, -1, 0, 1, 2].map(offset => [key(offset), [task(String(offset))]]))
  days[key(-1)].push(task('already-done', { done: true }))
  const fixture = await privateFixture({ schedule: { days } })
  try {
    const report = await getSchedule()
    assert.equal(report.ok, true)
    assert.deepEqual(report.today.map(t => t.id), ['0'])
    assert.deepEqual(report.tomorrow.map(t => t.id), ['1'])
    assert.deepEqual(report.overdue.map(t => t.id), ['-14', '-1'])
  } finally { fixture.close() }
})
