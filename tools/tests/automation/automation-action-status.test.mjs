import test from 'node:test'
import assert from 'node:assert/strict'
import { privateFixture } from '../private-fixture.mjs'

process.env.GITHUB_TOKEN = 'offline-fixture'
process.env.NANALY_GITHUB_TOKEN = 'offline-fixture'
process.env.SITE_URL = 'https://example.invalid'
const { patrol, react } = await import('../../nanaly/patrol.mjs')
const { commitJournal } = await import('../../nanaly/journal.mjs')
const connection = nodes => ({ nodes, pageInfo: { hasNextPage: false, hasPreviousPage: false } })
const discussion = id => ({ id, title: `2026/09/20/${id}/`, comments: connection([]), reactions: connection([]) })

const withFetch = async (impl, fn) => {
  const previous = globalThis.fetch
  globalThis.fetch = impl
  try { return await fn() } finally { globalThis.fetch = previous }
}
const siteFetch = ({ issue = false, manifest = true } = {}) => async (url, init) => {
  if (url === 'https://example.invalid/') return new Response(null, { status: 200 })
  if (url.endsWith('/js/protected-manifest.js')) return manifest
    ? new Response('window.NOIMPTY_PRIVACY = Object.freeze(' + JSON.stringify({ entries: [{ path: '/2026/09/20/test/' }] }) + ');')
    : new Response('unavailable', { status: 503 })
  if (url === 'https://example.invalid/2026/09/20/test/') return new Response(`<div id="article-container">${issue ? '<span class="katex-error">bad formula</span>' : '<p>Article</p>'}</div>`)
  assert.equal(url, 'https://api.github.com/graphql')
  assert.doesNotMatch(JSON.parse(init.body).query, /mutation/)
  return Response.json({ message: 'Unavailable' }, { status: 503 })
}

await test('a missing site manifest is an incomplete patrol, not a successful empty scan', async () => {
  await withFetch(siteFetch({ manifest: false }), () => assert.rejects(patrol(), /锁清单.*未完成/))
})

await test('patrol issues cannot silently disappear when discussion lookup fails', async () => {
  await withFetch(siteFetch({ issue: true }), () => assert.rejects(patrol(), /无法读取讨论/))
})

await test('a completed healthy patrol records its result without requiring GitHub or a model', async () => {
  const fixture = await privateFixture()
  try {
    let githubCalls = 0
    const serve = siteFetch()
    const result = await withFetch(async (url, init) => {
      if (url === 'https://api.github.com/graphql') githubCalls++
      return serve(url, init)
    }, patrol)
    assert.equal(result.checked, 1)
    assert.equal(result.reported, 0)
    assert.equal(result.failed, 0)
    assert.equal(githubCalls, 0)
    await commitJournal()
    assert.match(fixture.read('journal').data.entries[0].what, /未发现本次检查范围内的问题/)
  } finally { fixture.close() }
})

await test('reaction lookup failures remain observable to the job entrypoint', async () => {
  await withFetch(async () => Response.json({ message: 'Unavailable' }, { status: 503 }),
    () => assert.rejects(react(), /HTTP 503/))
})

await test('one failed reaction does not prevent the next target, but still fails the run after recording successes', async () => {
  const fixture = await privateFixture()
  const mutated = []
  try {
    await withFetch(async (_url, init) => {
      const { query, variables } = JSON.parse(init.body)
      if (!/mutation/.test(query)) return Response.json({ data: { repository: { discussions: connection([discussion('bad'), discussion('good')]) } } })
      mutated.push(variables.s)
      if (variables.s === 'bad') return Response.json({ message: 'Unavailable' }, { status: 503 })
      return Response.json({ data: { addReaction: { reaction: { content: variables.c } } } })
    }, () => assert.rejects(react(), /1 篇文章贴表情失败.*已成功 1 篇/))
    assert.deepEqual(mutated, ['bad', 'good'])
    await commitJournal()
    assert.match(fixture.read('journal').data.entries[0].what, /给 1 篇文章贴了表情/)
  } finally { fixture.close() }
})
