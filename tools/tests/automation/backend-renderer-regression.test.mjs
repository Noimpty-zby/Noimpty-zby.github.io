import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import Renderer from '../../markdown-renderer.cjs'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')
const projectConfig = yaml.load(readFileSync('_config.yml', 'utf8'))
const base = process.cwd()
const hexo = (markdown = projectConfig.markdown, other = {}) => ({
  base_dir: base + '/', source_dir: base + '/source/',
  config: { root: '/', url: 'https://example.test', relative_link: false, ...other, markdown },
  execFilterSync() {}, log: { warn() {} }
})
let passed = 0
const check = (label, fn) => { fn(); passed++; console.log('  ✓ ' + label) }

check('headings retain site permalink markup and collision numbering per article', () => {
  const renderer = new Renderer(hexo())
  const expected = '<h2 id="repeat"><a class="headerlink" href="#repeat"></a>repeat</h2>\n'
    + '<h2 id="repeat-2"><a class="headerlink" href="#repeat-2"></a>repeat</h2>\n'
  assert.equal(renderer.render({ text: '## repeat\n\n## repeat' }), expected)
  assert.equal(renderer.render({ text: '## repeat' }), expected.split('\n')[0] + '\n')
  const hostile = renderer.render({ text: '## __proto__\n\n## __proto__\n\n## constructor' })
  assert.match(hostile, /id="proto-2"/)
  assert.match(hostile, /id="constructor"/)
  const collision = renderer.render({ text: '## title\n\n## title-2\n\n## title' })
  assert.deepEqual([...collision.matchAll(/id="([^"]+)"/g)].map(match => match[1]), ['title', 'title-2', 'title-3'])
})

check('anchor level, side, symbol, case, separator and suffix remain configurable', () => {
  const renderer = new Renderer(hexo({ render: { typographer: false }, anchors: {
    level: 3, permalink: true, permalinkSide: 'right', permalinkSymbol: '§', permalinkClass: 'jump',
    case: 1, separator: '_', collisionSuffix: 'copy'
  } }))
  const html = renderer.render({ text: '## Heading Two\n\n### Three Words\n\n### Three Words' })
  assert.match(html, /<h2>Heading Two<\/h2>/)
  assert.match(html, /id="three_words"/)
  assert.match(html, /id="three_words-copy2"/)
  assert.match(html, /Three Words<a class="jump" href="#three_words">§<\/a>/)
})

check('math, task lists and escaped text still use the configured plugins', () => {
  const renderer = new Renderer(hexo())
  const html = renderer.render({ text: '$x^2$\n\n- [x] done\n- [ ] next\n\n`<script>` & < text' })
  assert.match(html, /class="katex"/)
  assert.equal((html.match(/type="checkbox"/g) || []).length, 2)
  assert.match(html, /disabled=""/)
  assert.match(html, /checked=""/)
  assert.match(html, /<code>&lt;script&gt;<\/code>/)
  assert.doesNotMatch(html, /<script>/)
})

check('inline rendering and the markdown-it:renderer filter remain supported', () => {
  const context = hexo({ render: { typographer: false }, anchors: false })
  let calls = 0
  context.execFilterSync = (name, parser, options) => {
    assert.equal(name, 'markdown-it:renderer')
    assert.ok(options.context instanceof Renderer)
    parser.renderer.rules.strong_open = () => '<b>'
    parser.renderer.rules.strong_close = () => '</b>'
    calls++
  }
  const renderer = new Renderer(context)
  assert.equal(renderer.render({ text: '**x**' }, { inline: true }), '<b>x</b>')
  assert.equal(renderer.render({ text: '**x**' }), '<p><b>x</b></p>\n')
  assert.equal(calls, 2)
})

check('enable/disable rules and HTML rendering options are respected', () => {
  const disabled = new Renderer(hexo({ render: { html: false, breaks: false }, disable_rules: ['emphasis'], anchors: false }))
  assert.equal(disabled.render({ text: '**x**\n<b>y</b>' }), '<p>**x**\n&lt;b&gt;y&lt;/b&gt;</p>\n')
  const enabled = new Renderer(hexo({ preset: 'zero', enable_rules: ['emphasis'], anchors: false }))
  assert.match(enabled.render({ text: '**x**' }), /<strong>x<\/strong>/)
})

check('image loading/root options preserve URLs and gracefully handle inline images', () => {
  const context = hexo({ images: { lazyload: true, prepend_root: true, post_asset: true }, anchors: false }, { root: '/blog/' })
  context.model = () => ({ findById: id => id === 'source/_posts/post/asset.png' ? { path: '2026/09/19/post/asset.png' } : null })
  const renderer = new Renderer(context)
  const html = renderer.render({ text: '![caption](asset.png)', path: base + '/source/_posts/post.md' })
  assert.match(html, /src="\/blog\/2026\/09\/19\/post\/asset.png"/)
  assert.match(html, /alt="caption" loading="lazy"/)
  assert.match(renderer.render({ text: '![a](/image.png)' }, { inline: true }), /src="\/blog\/image.png"/)
  assert.match(renderer.render({ text: '![a](https://remote.test/image.png)' }), /src="https:\/\/remote.test\/image.png"/)
  context.config.relative_link = true
  assert.match(renderer.render({ text: '![a](asset.png)', path: base + '/source/_posts/post.md' }), /src="asset.png"/)
})

check('registration covers every original extension and passes disableNunjucks to Hexo', () => {
  const context = hexo({ disableNunjucks: true, anchors: false })
  const registrations = []
  context.extend = { renderer: { register: (...args) => registrations.push(args) } }
  const localRequire = createRequire(resolve('scripts/noimpty-markdown.js'))
  vm.runInNewContext(readFileSync('scripts/noimpty-markdown.js', 'utf8'), { hexo: context, require: localRequire })
  assert.deepEqual(registrations.map(args => args[0]), ['md', 'markdown', 'mkd', 'mkdn', 'mdwn', 'mdtxt', 'mdtext'])
  for (const [, output, render, sync] of registrations) {
    assert.equal(output, 'html')
    assert.equal(sync, true)
    assert.equal(render.disableNunjucks, true)
    assert.equal(render({ text: '**ok**' }, { inline: true }), '<strong>ok</strong>')
  }
})

check('adversarial URL/quote runs finish in an isolated renderer with a timeout', () => {
  const rendererPath = resolve('tools/markdown-renderer.cjs')
  const script = `
    const Renderer = require(${JSON.stringify(rendererPath)});
    const renderer = new Renderer({ config: { markdown: { render: { linkify: true, typographer: true }, anchors: false } }, execFilterSync() {} });
    const url = 'https://example.test/' + '*'.repeat(120000) + 'x';
    renderer.render({ text: url });
    renderer.render({ text: '"'.repeat(160000) });
    process.stdout.write('ok');
  `
  assert.equal(execFileSync(process.execPath, ['-e', script], { timeout: 5000, encoding: 'utf8' }), 'ok')
})

console.log(`\n${passed} renderer regression groups passed`)
