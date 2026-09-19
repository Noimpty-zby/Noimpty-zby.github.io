import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.GITHUB_TOKEN = 'offline-test-token'
process.env.SITE_URL = 'https://example.invalid'
process.env.REPORT_WINDOW_HOURS = 'Infinity'
const { CFG, WINDOW, getComments, getNewPosts } = await import('../daily-report/sources.mjs')
const { autoComplete } = await import('../daily-report/schedule-auto.mjs')
const { checkLeak, checkBuild } = await import('../daily-report/health.mjs')

const withFetch = async (stub, fn) => {
  const before = globalThis.fetch
  globalThis.fetch = stub
  try { return await fn() } finally { globalThis.fetch = before }
}
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date())

await test('invalid reporting windows fall back to one day', () => {
  assert.equal(CFG.windowHours, 24)
  assert.equal(WINDOW.end - WINDOW.start, 86400000)
})

await test('HTTP errors and malformed GitHub JSON cannot masquerade as zero comments', async () => {
  for (const response of [new Response('{}', { status: 500 }), new Response('{}'), new Response('null')]) {
    const result = await withFetch(async () => response, getComments)
    assert.equal(result.ok, false)
  }
})

await test('Chinese filenames survive Git output and future/draft posts stay out of daily reports', async () => {
  const repo = process.cwd(), dir = mkdtempSync(join(tmpdir(), 'blog-daily-'))
  try {
    mkdirSync(join(dir, 'source/_posts'), { recursive: true })
    mkdirSync(join(dir, 'source/_data'), { recursive: true })
    const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
    git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid')
    const current = new Date(Date.now() - 3600000).toISOString()
    writeFileSync(join(dir, 'source/_posts/中文笔记.md'), `---\ntitle: 中文笔记\ndate: ${current}\n---\n正文`)
    writeFileSync(join(dir, 'source/_posts/future.md'), '---\ntitle: Future\ndate: 2099-01-01 00:00:00\n---\n正文')
    writeFileSync(join(dir, 'source/_posts/_draft.md'), `---\ntitle: Draft\ndate: ${current}\n---\n正文`)
    git('add', '.'); git('commit', '-qm', 'test fixture')
    process.chdir(dir)
    const result = await getNewPosts()
    assert.equal(result.ok, true)
    assert.deepEqual(result.items.map(p => p.title), ['中文笔记'])
    const file = join(dir, 'source/_data/schedule.json')
    const raw = JSON.stringify({ days: { [today]: [
      { id: 'a', text: '已撤销的自动任务', done: false, autoAt: '2026-01-01', when: { type: 'edit', match: '中文笔记' } },
      { id: 'b', text: '正常任务', done: false, when: { type: 'edit', match: '中文笔记' } },
      { id: 'c', text: '坏类型', done: false, when: { type: 'constructor' } }
    ] } })
    writeFileSync(file, raw)
    const dry = await autoComplete({ dry: true })
    assert.equal(dry.changed, 1)
    assert.equal(readFileSync(file, 'utf8'), raw)
    const done = await autoComplete()
    assert.equal(done.changed, 1)
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).days[today][0].done, false)
  } finally { process.chdir(repo); rmSync(dir, { recursive: true, force: true }) }
})

await test('privacy health does not call failed HTTP checks or unknown HTML responses safe', async () => {
  const manifest = 'window.NOIMPTY_PRIVACY = Object.freeze({"entries":[{"path":"/private/"}],"publicPaths":["/"]});'
  const result = await withFetch(async url => {
    const path = new URL(url).pathname
    if (path.includes('protected-manifest')) return new Response(manifest)
    if (path === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n')
    if (path === '/search.xml') return new Response('<html>Proxy error</html>')
    return new Response('upstream unavailable', { status: 503 })
  }, () => checkLeak({ html: new Map(), targets: new Set(), pageCount: 0 }))
  assert.equal(result.level, 'warn')
  assert.ok(result.items.some(i => i.note.includes('503')))
  assert.ok(result.items.some(i => i.note.includes('格式不明')))
})

await test('queued and timed-out deployments never report all successful', async () => {
  for (const [status, conclusion, level] of [['in_progress', null, 'warn'], ['completed', 'timed_out', 'bad']]) {
    const result = await withFetch(async () => Response.json({ workflow_runs: [{ status, conclusion }] }), checkBuild)
    assert.equal(result.level, level)
    assert.doesNotMatch(result.detail, /全部成功/)
  }
})


await test('daily reports include recent replies beyond the first discussion page', async () => {
  let calls = 0
  const connection = nodes => ({ nodes, pageInfo: { hasPreviousPage: false, hasNextPage: false } })
  const now = new Date(WINDOW.end - 1000).toISOString()
  const old = new Date(Date.now() - 7 * 86400000).toISOString()
  const result = await withFetch(async (_url, init) => {
    calls++
    const { variables } = JSON.parse(init.body)
    const nodes = variables.after ? [{ id: 'discussion2', title: 'Old post', url: 'https://example.invalid/d/2',
      reactions: connection([]), comments: connection([{ id: 'comment', body: 'old', createdAt: old,
        author: { login: 'reader' }, replies: connection([{ id: 'reply', body: 'new reply', createdAt: now,
          url: 'https://example.invalid/reply', author: { login: 'owner', url: 'https://example.invalid/owner' } }]) }]) }] : []
    return Response.json({ data: { repository: { discussions: { nodes,
      pageInfo: { hasNextPage: !variables.after, endCursor: 'second-page' } } } } })
  }, getComments)
  assert.equal(calls, 2)
  assert.equal(result.ok, true)
  assert.deepEqual(result.items.map(c => c.body), ['new reply'])
  assert.equal(result.items[0].url, 'https://example.invalid/reply')
})
