import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { setImmediate as nextTurn } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const Hexo = require('hexo')
const MarkdownIt = require('markdown-it')
const script = new URL('../../../scripts/noimpty-timeline.js', import.meta.url)
const scriptSource = readFileSync(script, 'utf8')
const markdown = new MarkdownIt({ html: true })
const post = (title, date = '2020-01-01 08:00:00') =>
  `---\ntitle: ${title}\ndate: ${date}\nseries: Linux\nlayout: false\n---\n正文\n`

const fixture = () => {
  const dir = mkdtempSync(join(tmpdir(), 'blog-timeline-lifecycle-'))
  mkdirSync(join(dir, 'source/_posts'), { recursive: true })
  mkdirSync(join(dir, 'source/timeline'), { recursive: true })
  mkdirSync(join(dir, 'source/about'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'timeline-fixture', version: '1.0.0', hexo: { version: '8.1.2' } }))
  writeFileSync(join(dir, '_config.yml'), 'title: Fixture\nurl: https://example.invalid\ntimezone: Asia/Shanghai\ntheme: null\nfuture: false\npermalink: :title/\n')
  writeFileSync(join(dir, 'source/timeline/index.md'), '---\ntitle: Timeline\ndate: 2020-01-01\nlayout: false\n---\n{% study_timeline %}\n')
  writeFileSync(join(dir, 'source/about/index.md'), '---\ntitle: About\ndate: 2020-01-01\nlayout: false\n---\n普通页面\n')
  writeFileSync(join(dir, 'source/_posts/base.md'), post('BASE'))
  return dir
}

const boot = async dir => {
  const hexo = new Hexo(dir, { silent: true })
  await hexo.init()
  hexo.extend.renderer.register('md', 'html', ({ text }) => markdown.render(text), true)
  new Function('hexo', 'require', scriptSource)(hexo, createRequire(script))
  const renders = new Map()
  hexo.extend.filter.register('before_post_render', data => {
    renders.set(data.source, (renders.get(data.source) || 0) + 1)
    return data
  })
  return { hexo, renders }
}

const timeline = async hexo => {
  let html = ''
  for await (const chunk of hexo.route.get('timeline/index.html')) html += chunk.toString()
  return html
}

const assertFresh = async (hexo, count, included, excluded) => {
  const html = await timeline(hexo)
  assert.match(html, new RegExp(`一共 ${count} 篇`))
  for (const text of included) assert.ok(html.includes(text), `timeline should contain ${text}`)
  for (const text of excluded) assert.ok(!html.includes(text), `timeline should not contain ${text}`)
}

await test('real Hexo incremental generations refresh added, renamed and deleted posts without rendering unrelated content', async () => {
  const dir = fixture()
  let hexo
  try {
    const instance = await boot(dir)
    hexo = instance.hexo
    const { renders } = instance
    await hexo.load()
    await assertFresh(hexo, 1, ['BASE'], ['SECOND'])

    const added = join(dir, 'source/_posts/second.md')
    writeFileSync(added, post('SECOND', '2020-02-02 08:00:00'))
    await hexo.load()
    await assertFresh(hexo, 2, ['BASE', 'SECOND', '2020-02-02'], [])

    writeFileSync(added, post('RENAMED', '2020-03-03 08:00:00'))
    await hexo.load()
    await assertFresh(hexo, 2, ['RENAMED', '2020-03-03'], ['SECOND', '2020-02-02'])

    rmSync(added)
    await hexo.load()
    await assertFresh(hexo, 1, ['BASE'], ['RENAMED', '/second/'])
    assert.equal(renders.get('_posts/base.md'), 1, 'unchanged articles retain their render cache')
    assert.equal(renders.get('about/index.md'), 1, 'ordinary pages retain their render cache')
  } finally {
    if (hexo) await hexo.exit()
    rmSync(dir, { recursive: true, force: true })
  }
})

await test('real Hexo regenerates timeline after restoring its cached body from db.json', async () => {
  const dir = fixture()
  let hexo
  try {
    ;({ hexo } = await boot(dir))
    await hexo.load()
    await assertFresh(hexo, 1, ['BASE'], [])
    await hexo.exit()
    hexo = undefined
    assert.ok(existsSync(join(dir, 'db.json')))

    writeFileSync(join(dir, 'source/_posts/second.md'), post('AFTER RESTART'))
    const instance = await boot(dir)
    hexo = instance.hexo
    await hexo.load()
    await assertFresh(hexo, 2, ['BASE', 'AFTER RESTART'], [])
    assert.equal(instance.renders.get('_posts/base.md'), undefined)
    assert.equal(instance.renders.get('about/index.md'), undefined)
  } finally {
    if (hexo) await hexo.exit()
    rmSync(dir, { recursive: true, force: true })
  }
})

// Await the real source watcher and generation pipeline, with a bounded failure
// timeout rather than sleeping and assuming the change has been processed.
const watchChange = (hexo, change) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    hexo.removeListener('generateAfter', done)
    reject(new Error('Hexo did not regenerate after a source change'))
  }, 5000)
  function done() {
    clearTimeout(timer)
    nextTurn().then(resolve, reject)
  }
  hexo.once('generateAfter', done)
  try { change() } catch (error) {
    clearTimeout(timer)
    hexo.removeListener('generateAfter', done)
    reject(error)
  }
})

await test('real Hexo watch keeps timeline current after additions, renames and deletions', async () => {
  const dir = fixture()
  let hexo
  try {
    const instance = await boot(dir)
    hexo = instance.hexo
    await hexo.watch()
    await assertFresh(hexo, 1, ['BASE'], [])
    const added = join(dir, 'source/_posts/watched.md')
    await watchChange(hexo, () => writeFileSync(added, post('WATCH ADDED')))
    await assertFresh(hexo, 2, ['WATCH ADDED'], [])
    await watchChange(hexo, () => writeFileSync(added, post('WATCH RENAMED')))
    await assertFresh(hexo, 2, ['WATCH RENAMED'], ['WATCH ADDED'])
    await watchChange(hexo, () => rmSync(added))
    await assertFresh(hexo, 1, ['BASE'], ['WATCH RENAMED', '/watched/'])
    assert.equal(instance.renders.get('_posts/base.md'), 1)
    assert.equal(instance.renders.get('about/index.md'), 1)
  } finally {
    if (hexo) { hexo.unwatch(); await hexo.exit() }
    rmSync(dir, { recursive: true, force: true })
  }
})
