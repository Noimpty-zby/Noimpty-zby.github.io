import assert from 'node:assert/strict'
import MarkdownIt from 'markdown-it'
import SiteRenderer from '../markdown-renderer.cjs'
import { sanitizeMd, stripOutboundLinks } from '../nanaly/git.mjs'
import { parseNotes, planNotes, buildNotes } from '../nanaly/notes.mjs'
import { isInternal } from '../nanaly/patrol.mjs'
import { hit } from '../nanaly/probe.mjs'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { wallClockMs } from '../nanaly/permalink.mjs'
import { collect } from '../nanaly/reply.mjs'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const md = new MarkdownIt({ html: true, linkify: true })
const siteRenderer = new SiteRenderer({ config: { markdown: { render: { html: true, linkify: true } } }, execFilterSync() {} })
const renderers = [md, siteRenderer.parser]
const site = 'https://noimpty-zby.github.io'
let passed = 0
const check = async (name, fn) => {
  await fn()
  console.log('  ✓ ' + name)
  passed++
}
const htmlTokens = text => renderers.flatMap(parser => parser.parse(text, {})).flatMap(token => [token, ...(token.children || [])])
  .filter(token => token.type === 'html_block' || token.type === 'html_inline')

await check('invalid fences and mismatched/escaped backticks cannot smuggle HTML', () => {
  for (const raw of [
    '```invalid`info\n<img src=x onerror=alert(1)>\n```',
    '`` <img src=x onerror=alert(1)> `',
    '\\` <img src=x onerror=alert(1)> `',
    '`start\n\n<img src=x onerror=alert(1)>\n\nend`',
    '<div data-x="`"> <img src=x onerror=alert(1)> `',
    '> ```invalid`info\n> <img src=x onerror=alert(1)>\n> ```'
  ]) assert.deepEqual(htmlTokens(sanitizeMd(raw)), [], raw)
})

await check('real fenced, indented and multiline inline code retains its text', () => {
  for (const raw of [
    '~~~~cpp\nTArray<int> xs;\n~~~~',
    '````cpp\nTArray<int> xs;\n```\n````',
    '    TArray<int> xs;',
    'Use ``TArray<int> ` value`` please',
    'Use `TArray<int>\nvalue` please',
    '> ```cpp\n> TArray<int> xs;\n> ```'
  ]) for (const parser of renderers) assert.equal(parser.render(sanitizeMd(raw)), parser.render(raw), raw)
})

await check('all outbound link syntaxes and tracking images become text', () => {
  for (const raw of [
    '[external](//evil.example/x)',
    '[external](https://noimpty-zby.github.io.evil.example/x)',
    '[external](https://noimpty-zby.github.io@evil.example/x)',
    '[external](https://evil.example/a_(b))',
    '[external][ref]\n\n[ref]: https://evil.example/x',
    '[external]\n\n[external]: //evil.example/x',
    '![tracking][ref]\n\n[ref]: /local.png',
    '<https://evil.example/x>',
    '<reader@evil.example>',
    '[external](ftp://evil.example/x)',
    '![tracking](/local.png)'
  ]) {
    for (const parser of renderers) {
      const rendered = parser.render(stripOutboundLinks(raw, site))
      assert.doesNotMatch(rendered, /<(?:a|img)\b/i, `${raw}\n${rendered}`)
    }
  }
})

await check('removing links preserves adjacent prose and nested labels exactly once', () => {
  assert.equal(stripOutboundLinks('before [outside](https://evil.example) after', site), 'before outside after')
  assert.equal(stripOutboundLinks('before ![image](/local.png) after', site), 'before image after')
})

await check('bare hostnames and email addresses do not become outbound autolinks', () => {
  for (const raw of ['go to www.example.com now', 'contact reader@example.com', 'see https://example.com/path']) {
    for (const parser of renderers) {
      assert.doesNotMatch(parser.render(stripOutboundLinks(raw, site)), /<a\b/, raw)
    }
  }
})

await check('outbound filtering preserves literal URLs in code and adjacent punctuation', () => {
  for (const raw of [
    'Use `curl https://example.com/api` for the request.',
    '```sh\ncurl https://example.com/api\n```',
    '    curl https://example.com/api\n',
    'Try ``https://example.com/with`backtick`` next.'
  ]) assert.equal(stripOutboundLinks(raw, site), raw)
  assert.equal(stripOutboundLinks('See https://example.com/test, next sentence.', site), 'See , next sentence.')
})

await check('same-origin absolute, relative, fragment and reference links survive', () => {
  for (const raw of [
    '[inside](/2026/09/19/post/)', '[inside](../other/)', '[inside](#heading)',
    '[inside](https://noimpty-zby.github.io/2026/09/19/post/)',
    '[inside][ref]\n\n[ref]: /2026/09/19/post/'
  ]) assert.match(md.render(stripOutboundLinks(raw, site)), /<a href=/, raw)
})

await check('link removal cannot turn previously safe code into raw HTML', () => {
  for (const raw of [
    '`https://evil.example <img src=x onerror=alert(1)>`',
    '`https://evil.example` <img src=x onerror=alert(1)>',
    '[`<img src=x>`](//evil.example)'
  ]) assert.deepEqual(htmlTokens(stripOutboundLinks(raw, site)), [], raw)
})

await check('malformed note JSON, duplicate indices and excessive notes are rejected', () => {
  const paragraphs = Array.from({ length: 45 }, (_, i) => `Paragraph number ${i}: enough prose for an unambiguous anchor.`)
  for (const value of [null, 7, [], {}, { notes: 'bad' }, { notes: {} }]) {
    assert.deepEqual(parseNotes(value, paragraphs), [])
  }
  const result = parseNotes({ notes: [null, { i: '0', text: 'wrong type' }, { i: -1, text: 'bad' },
    { i: 40, text: 'never shown to model' }, { i: 0, text: 'first' }, { i: 0, text: 'duplicate' },
    { i: 1, text: '喵'.repeat(100) }, { i: 2, text: 'third' }, { i: 3, text: 'fourth' } ] }, paragraphs)
  assert.equal(result.length, 3)
  assert.equal(result[0].text, 'first')
  assert.equal(result[1].text.length, 60)
})

await check('invalid calendar dates fail closed and quoted dates retain timezone semantics', () => {
  for (const value of ['2026-02-30', '2026-13-01', '2026-09-19 garbage', '2026-09-19 25:00:00',
    '2026-09-19 20:61', '2026-09-19 20:00:70', '2026-09-19T20:00:00+28:00']) {
    assert.equal(wallClockMs(value), null, value)
  }
  assert.equal(wallClockMs('"2026-09-19 07:00:00"'), Date.parse('2026-09-18T23:00:00Z'))
  assert.equal(wallClockMs('2024-02-29'), Date.parse('2024-02-29T00:00:00Z'))
  assert.equal(wallClockMs('2026-09-19T07:00:00.123+0800'), Date.parse('2026-09-18T23:00:00.123Z'))
})

await check('a comment with an invalid timestamp does not bypass the grace period', () => {
  assert.deepEqual(collect([{ title: '2026/09/19/post/', comments: { nodes: [
    { id: 'invalid', createdAt: 'unknown', body: 'question', author: { login: 'reader' } }
  ] } }]), [])
})

await check('news source URLs preserve existing escapes and cannot terminate Markdown links', () => {
  const src = readFileSync('tools/nanaly/news.mjs', 'utf8')
  const ctx = vm.createContext({ sanitizeMd, URL, encodeURI, console: { log() {} } })
  vm.runInContext(src.slice(src.indexOf('const attachSources ='), src.indexOf('// 最近几期写过什么')) + '\nglobalThis.attach = attachSources', ctx)
  const output = ctx.attach('- [0] **A** — x\n<img src=x onerror=alert(1)>', [{ title: 'A', url: 'https://example.com/a%20b(c)' }])
  assert.match(output, /a%20b%28c%29/)
  assert.doesNotMatch(output, /%2520/)
  assert.deepEqual(htmlTokens(output), [])
  for (const url of ['https://', 'https://user:password@example.com']) {
    assert.equal(ctx.attach('- [0] **A** — x', [{ title: 'A', url }]), '')
  }
})

await check('drafts and future articles keep their anchors without entering generation', () => {
  const raw = date => `---\ntitle: test\ndate: ${date}\n---\nbody`
  const result = planNotes([
    { file: 'source/_posts/_draft.md', raw: raw('2026-09-01 20:00:00') },
    { file: 'source/_posts/future.md', raw: raw('2027-09-01 20:00:00') },
    { file: 'source/_posts/live.md', raw: raw('2026-09-01 20:00:00') }
  ], {}, Date.parse('2026-09-19T00:00:00Z'))
  assert.equal(result.live.size, 3)
  assert.deepEqual(result.todo.map(item => item.file), ['source/_posts/live.md'])
})

await check('corrupt existing notes fail before any model request or overwrite', async () => {
  const cwd = process.cwd()
  const dir = mkdtempSync(join(tmpdir(), 'nanaly-notes-regression-'))
  const fetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('network must not be used') }
  try {
    process.chdir(dir)
    mkdirSync('source/_data', { recursive: true })
    for (const value of ['null', '[]', '{']) {
      writeFileSync('source/_data/nanaly-notes.json', value)
      await assert.rejects(buildNotes, /无法读取现有批注表/)
      assert.equal(readFileSync('source/_data/nanaly-notes.json', 'utf8'), value)
    }
  } finally {
    process.chdir(cwd)
    globalThis.fetch = fetch
    rmSync(dir, { recursive: true, force: true })
  }
})

await check('patrol uses the origin, and releases unused GET fallback bodies', async () => {
  assert.equal(isInternal('https://noimpty-zby.github.io/post/'), true)
  assert.equal(isInternal('https://noimpty-zby.github.io.evil.example/post/'), false)
  const fetch = globalThis.fetch
  let released = false
  globalThis.fetch = async (url, init) => init.method === 'HEAD'
    ? { status: 405 }
    : { status: 200, body: { async cancel() { released = true } } }
  try {
    assert.deepEqual(await hit('https://example.test', 1000), { status: 200, err: null })
    assert.equal(released, true)
  } finally { globalThis.fetch = fetch }
})

console.log(`\n${passed} backend regression groups passed`)
