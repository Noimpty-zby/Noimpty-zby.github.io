import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkArticle, safeFetch, checkTarget, collectTargets, normalizeArticlePath, publishResult, SITE } from '../../nanaly/article-task.mjs'
import { patrolSummary } from '../../nanaly/patrol.mjs'
import { commitJournal, readJournal } from '../../nanaly/journal.mjs'

const path = '/2026/09/19/test/', requestId = '12345678-1234-1234-1234-123456789abc', sha = 'a'.repeat(40)
let passed = 0
const check = async (name, fn) => { await fn(); passed++; console.log('  ✓ ' + name) }
await check('only a published same-site article is accepted before any network request', async () => {
  for (const path of ['//localhost/', 'http://127.0.0.1/', '/2026/09/19/x/?token=x', '/2026/09/19/x%2fy/', '/2026/09/19/x/#a']) {
    assert.throws(() => normalizeArticlePath(path))
  }
  let calls = 0
  await assert.rejects(checkArticle({ path, requestId, paths: new Set(), fetchImpl: () => { calls++; throw new Error('network forbidden') } }), /清单/)
  assert.equal(calls, 0)
})
await check('external/private links and redirects are never fetched; extraction is capped and de-duplicated', async () => {
  const html = '<div id="article-container"><a href="/ok?a=1&amp;b=2">x</a><a href="/ok?a=1&amp;b=2">x</a>'
    + '<img src="https://127.0.0.1/x"><a href="https://external.test/">x</a>'
    + Array.from({ length: 30 }, (_, i) => `<a href="/item${i}">x</a>`).join('') + '</div><footer><a href="/not-part-of-article">footer</a></footer>'
  const found = collectTargets(html, SITE + path)
  assert.equal(found.targets.length, 24)
  assert.equal(found.skipped, 9)
  assert.equal(found.targets[0].url, SITE + '/ok?a=1&b=2')
  const nested = collectTargets('<div id="article-container"><div><a href="/inside">x</a></div></div><a href="/outside">y</a>', SITE + path)
  assert.deepEqual(nested.targets.map(row => row.url), [SITE + '/inside'])
  const calls = []
  await assert.rejects(safeFetch(SITE + '/go', { fetchImpl: async (url, init) => {
    calls.push({ url, init }); return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } })
  } }), /范围/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].init.redirect, 'manual')
  assert.equal(calls[0].init.headers, undefined)
})
await check('lazy images use their real URL and quoted markup cannot invent href attributes', async () => {
  const found = collectTargets('<div id="article-container"><img src="data:image/png,placeholder" data-src="/real-image">'
    + '<img title="not > a tag" src="/fallback" data-lazy-src="/lazy-image">'
    + '<img src="data:占位" data-lazy-src="/missing.png">'
    + '<img src="/fallback" data-lazy-src="/second" data-src="/first">'
    + '<a title="fake href=\"/fake\"" data-href="/not-an-anchor">x</a>'
    + '<a title="fake href=/fake" href="/real-link">x</a>'
    + '<a href="/' + 'x'.repeat(2050) + '">too long</a></div>', SITE + path)
  assert.deepEqual(found.targets.map(row => row.url), [SITE + '/real-image', SITE + '/lazy-image', SITE + '/missing.png', SITE + '/first', SITE + '/real-link'])
  assert.equal(found.skipped, 1)
})
await check('404 is rechecked, transient failures remain unknown, GET fallback is bounded', async () => {
  let calls = 0
  const fixed = await checkTarget({ url: SITE + '/fixed', kind: 'link' }, async () => new Response(null, { status: ++calls === 1 ? 404 : 200 }))
  assert.equal(fixed.state, 'ok')
  const bad = await checkTarget({ url: SITE + '/bad' }, async () => new Response(null, { status: 404 }))
  assert.equal(bad.state, 'broken')
  const limited = await checkTarget({ url: SITE + '/limited' }, async () => new Response(null, { status: 429 }))
  assert.equal(limited.state, 'unknown')
  const methods = []
  const fallback = await checkTarget({ url: SITE + '/head' }, async (_, init) => { methods.push(init.method); return new Response(null, { status: init.method === 'HEAD' ? 405 : 200 }) })
  assert.deepEqual(methods, ['HEAD', 'GET'])
  assert.equal(fallback.state, 'ok')
})
await check('real report carries request identity and exact counts without article text or tokens', async () => {
  const calls = []
  const result = await checkArticle({ path, requestId, paths: new Set([path]), sha, fetchImpl: async (url, init) => {
    calls.push(url)
    if (init.method === 'GET') return new Response('<div id="article-container"><a href="/ok">私密正文</a><img src="/missing"><a href="https://example.test/">x</a></div>')
    return new Response(null, { status: url.endsWith('/missing') ? 404 : 200 })
  } })
  assert.equal(result.checked, 2); assert.equal(result.broken, 1); assert.equal(result.unknown, 0); assert.equal(result.skipped, 1)
  assert.equal(result.requestId, requestId); assert.equal(result.sha, sha)
  assert.ok(!JSON.stringify(result).includes('私密正文'))
  assert.ok(calls.every(url => url.startsWith(SITE)))
  let posted
  await publishResult(result, { token: 'fixture-secret', repo: 'owner/repo', sha, runId: 42, fetchImpl: async (url, init) => {
    assert.equal(url, 'https://api.github.com/repos/owner/repo/check-runs')
    posted = JSON.parse(init.body); return Response.json({ id: 7 }, { status: 201 })
  } })
  assert.equal(posted.external_id, requestId)
  assert.equal(JSON.parse(posted.output.text).broken, 1)
  assert.ok(!JSON.stringify(posted).includes('fixture-secret'))
  await assert.rejects(publishResult(result, { token: 'x', repo: 'owner/repo', sha, runId: 42, fetchImpl: async () => new Response(null, { status: 403 }) }), /发布失败/)
})
await check('oversized article bodies fail without checking links', async () => {
  let calls = 0
  await assert.rejects(checkArticle({ path, requestId, paths: new Set([path]), fetchImpl: async () => { calls++; return new Response('x'.repeat(1024 * 1024 + 1)) } }), /过大/)
  assert.equal(calls, 1)
})
await check('failed patrol notifications cannot claim every issue was already reported', async () => {
  const message = patrolSummary({ checked: 3, broken: 3, reported: 1, alreadyReported: 1, failed: 1 })
  assert.match(message, /成功留言 1 条/); assert.match(message, /1 篇的问题此前已提醒/); assert.match(message, /1 篇的问题未能送达/)
  const failed = patrolSummary({ checked: 1, broken: 1, reported: 0, alreadyReported: 0, failed: 1 })
  assert.ok(!failed.includes('此前已提醒'))
})
await check('journal push failure rejects and malformed journal is never silently treated as empty', async () => {
  await assert.rejects(commitJournal({ run: (...args) => {
    if (args[0] === 'status') return ' M source/_data/nanaly-journal.json'
    if (args[0] === 'push' || args[0] === 'pull') throw new Error('fixture push failed')
    return ''
  } }), /行动日志提交失败/)
  const cwd = process.cwd(), dir = mkdtempSync(join(tmpdir(), 'nanaly-journal-'))
  try {
    mkdirSync(join(dir, 'source/_data'), { recursive: true }); process.chdir(dir)
    for (const value of ['broken', 'null', '3', '{"entries":{}}']) {
      writeFileSync('source/_data/nanaly-journal.json', value)
      assert.throws(() => readJournal(), /读取失败/)
      assert.equal(readFileSync('source/_data/nanaly-journal.json', 'utf8'), value)
    }
  } finally { process.chdir(cwd); rmSync(dir, { recursive: true, force: true }) }
})
console.log(`\n${passed} backend task cases passed`)
