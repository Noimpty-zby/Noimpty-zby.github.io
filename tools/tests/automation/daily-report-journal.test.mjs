/* 日报要在行动日志里留一笔 —— 对话窗口里的她只读得到这本日志。
 *
 * 以前日报从不记，主人在聊天里问「昨晚日报说什么了」，她只能答不知道；
 * 日报炸了、邮件没发出去，她也照样以为一切正常。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { renderJournalLine } from '../../daily-report/render.mjs'
import { WHO } from '../../nanaly/journal.mjs'

const ok = { ok: true, items: [] }
const green = { worst: 'ok', checks: [{ name: '站点可用性', level: 'ok' }] }

test('the journal line states the outcome in one short sentence', () => {
  const line = renderJournalLine({
    traffic: { ok: true, pageviews: 12, visitors: null },
    comments: { ok: true, items: [{}, {}] },
    newPosts: { ok: true, items: [{}] },
    health: green
  })
  assert.match(line, /^发了 \d{1,2}\/\d{1,2} 的日报：12 次浏览，2 条新评论，1 篇新文章，健康检查全绿$/)
  assert.ok(line.length <= 160, '日志一条最多 160 字，超出会被截掉')
})

test('failed sources and flagged checks are named instead of looking like a quiet day', () => {
  const line = renderJournalLine({
    traffic: { ok: false, why: '404' },
    comments: { ok: false, why: 'x' },
    newPosts: { ok: false, why: 'y' },
    health: { worst: 'bad', checks: [{ name: '站点可用性', level: 'bad' }, { name: '依赖漏洞', level: 'ok' }, { name: '死链与坏图', level: 'warn' }] }
  })
  assert.match(line, /访问数据没取到，评论没取到，新文章没取到，健康检查要留意：站点可用性、死链与坏图$/)
  const quiet = renderJournalLine({ traffic: { ok: true, pageviews: 0, visitors: null }, comments: ok, newPosts: ok, health: { worst: 'ok', checks: [] } })
  assert.match(quiet, /：没有访问，健康检查全绿$/)
})

test('the chat window can label the daily report entries', () => {
  assert.equal(WHO.report, '日报')
})

test('a real offline run of the daily report leaves a report entry in the private journal', () => {
  const repo = resolve('.')
  const work = mkdtempSync(join(tmpdir(), 'daily-report-journal-'))
  const store = mkdtempSync(join(tmpdir(), 'daily-report-private-'))
  try {
    for (const [name, data] of Object.entries({
      schedule: { days: {} }, journal: { v: 1, entries: [] }, usage: { v: 1, runs: [] }, profile: 'Synthetic profile'
    })) writeFileSync(join(store, name + '.json'), JSON.stringify({ revision: 1, data }), { mode: 0o600 })
    // 一个带首个提交的空仓库：日报会用 git log 数新文章。
    execFileSync('git', ['init', '-q'], { cwd: work })
    execFileSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '--allow-empty', '-q', '-m', 'init'], { cwd: work })
    // 全程离线：任何 fetch 都立即失败，日报必须照样走完并记账。
    const offline = join(work, 'offline.mjs')
    writeFileSync(offline, "globalThis.fetch = async () => { throw new TypeError('offline test: network disabled') }\n")
    const env = {
      PATH: process.env.PATH, HOME: process.env.HOME, TZ: 'UTC',
      NANALY_PRIVATE_TEST_MODE: '1', NANALY_PRIVATE_TEST_DIR: store,
      SITE_URL: 'https://example.invalid', MISS_YOU_AFTER_DAYS: '0'
    }
    execFileSync(process.execPath, ['--import', offline, join(repo, 'tools/daily-report/run.mjs')], { cwd: work, env, stdio: 'pipe', timeout: 90_000 })
    const entries = JSON.parse(readFileSync(join(store, 'journal.json'), 'utf8')).data.entries
    const report = entries.filter(e => e.who === 'report')
    assert.equal(report.length, 1, JSON.stringify(entries))
    assert.match(report[0].what, /没有配置发信凭据，没发出去/)
  } finally {
    rmSync(work, { recursive: true, force: true })
    rmSync(store, { recursive: true, force: true })
  }
})
