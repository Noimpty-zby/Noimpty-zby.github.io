import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const project = resolve(fileURLToPath(new URL('../../../', import.meta.url)))
const require = createRequire(new URL('../../../package.json', import.meta.url))
const Hexo = require('hexo')
const { Pattern } = require('hexo-util')
const source = readFileSync(new URL('../../../scripts/noimpty-theme-views.js', import.meta.url), 'utf8')
const install = theme => {
  const filters = []
  vm.runInNewContext(source, { require, hexo: { theme, extend: { filter: { register: (name, callback) => filters.push({ name, callback }) } } } })
  assert.equal(filters.length, 1); assert.equal(filters[0].name, 'after_init')
  filters[0].callback()
}

const hexo = new Hexo(project, { silent: true })
hexo.theme.base = dirname(require.resolve('hexo-theme-butterfly/package.json')) + '/'
const theme = hexo.theme
install(theme)
const view = theme.processors.find(processor => processor.pattern.match('layout/post.pug')?.path === 'post.pug')
assert.ok(view, 'the real Hexo theme view processor is still present')
assert.equal(view.pattern.match('source/css/_layout/post.styl'), undefined)
assert.equal(view.pattern.match('another/layout/post.pug'), undefined)
assert.equal(view.pattern.match('layout/includes/layout.pug').path, 'includes/layout.pug')
const wrapped = view.pattern
install(theme)
assert.equal(view.pattern, wrapped, 'installation is idempotent')

// Exercise the actual asynchronous theme file pipeline, including both files
// that previously raced to occupy the post view. No mock renderer is involved.
await Promise.all([
  theme._processFile('create', 'source/css/_layout/post.styl'),
  theme._processFile('create', 'layout/post.pug'),
  theme._processFile('create', 'source/css/index.styl')
])
assert.deepEqual(Object.keys(theme.views.post), ['.pug'])
assert.equal(theme.getView('post').path, 'post.pug')
assert.ok(hexo.model('Asset').findById('node_modules/hexo-theme-butterfly/source/css/index.styl'), 'the theme stylesheet remains a normal asset')
console.log('  ✓ actual Hexo pipeline never registers stylesheet files as layouts')

const anchored = { pattern: new Pattern(path => path.startsWith('layout/') ? { path: path.slice(7) } : undefined) }
const unrelated = { pattern: new Pattern(path => path.startsWith('source/') ? { path: path.slice(7) } : undefined) }
const untouched = anchored.pattern; const sourcePattern = unrelated.pattern
install({ processors: [anchored, unrelated] })
assert.equal(anchored.pattern, untouched, 'fixed upstream behavior requires no patch')
assert.equal(unrelated.pattern, sourcePattern, 'unrelated processors are unchanged')
console.log('  ✓ fixed upstream matchers and unrelated processors remain untouched')
