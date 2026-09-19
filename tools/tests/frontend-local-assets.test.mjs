import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')
const base = fileURLToPath(new URL('../../', import.meta.url))
const source = readFileSync(path.join(base, 'scripts/noimpty-local-assets.js'), 'utf8')
const manifest = yaml.load(readFileSync(path.join(base, 'node_modules/hexo-theme-butterfly/plugins.yml'), 'utf8'))
const theme = yaml.load(readFileSync(path.join(base, '_config.butterfly.yml'), 'utf8'))
const config = yaml.load(readFileSync(path.join(base, '_config.yml'), 'utf8'))
const clone = value => JSON.parse(JSON.stringify(value))
const boot = ({ selected = theme, plugins = manifest } = {}) => {
  let generate
  vm.runInNewContext(source, {
    require,
    hexo: {
      base_dir: base,
      theme_dir: path.join(base, 'node_modules/hexo-theme-butterfly'),
      theme: { config: selected }, config,
      render: { renderSync: () => plugins },
      extend: { generator: { register: (name, fn) => { assert.equal(name, 'noimpty-local-assets'); generate = fn } } }
    }
  })
  return generate
}
let passed = 0
const check = (name, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + name) }
  catch (error) { process.exitCode = 1; console.error('  ✗ ' + name, error) }
}

const routes = boot()()
const byPath = new Map(routes.map(route => [route.path, route.data]))
const expectedKeys = [
  'fontawesome', 'egjs_infinitegrid', 'fancybox', 'fancybox_css',
  'pjax', 'instantpage', 'sharejs', 'sharejs_css',
  'katex', 'katex_copytex', 'mermaid'
]
check('当前配置保留全部 11 个 HTML 与动态加载资产，同时仅输出 78 个必要文件', () => {
  for (const key of expectedKeys) {
    const plugin = manifest[key]
    const route = 'pluginsSrc/' + plugin.name + '/' + plugin.file
    assert.ok(byPath.has(route), 'Missing: ' + route)
    assert.deepEqual(byPath.get(route), readFileSync(path.join(base, 'node_modules', plugin.name, plugin.file)))
  }
  assert.equal(routes.length, 78)
  assert.equal(new Set(routes.map(route => route.path)).size, routes.length)
})

check('没有输出停用的打字动画、Gitalk、Valine、MathJax 或其他评论系统', () => {
  const banned = /\/(?:typed\.js|gitalk|valine|mathjax|twikoo|artalk|disqusjs|@waline|@docsearch|algoliasearch)\//
  assert.ok(!routes.some(route => banned.test(route.path)))
})

check('CSS 引用的字体文件全部存在且路径保持原样', () => {
  const references = new Set()
  for (const [file, buffer] of byPath) {
    if (!file.endsWith('.css')) continue
    for (const match of buffer.toString().matchAll(/url\(([^)]+)\)/g)) {
      const target = match[1].trim().replace(/^['"]|['"]$/g, '')
      if (/^(?:data:|https?:|\/\/|#)/.test(target)) continue
      const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(file), target.split(/[?#]/)[0]))
      assert.ok(byPath.has(normalized), 'Missing CSS asset: ' + normalized)
      references.add(normalized)
    }
  }
  assert.equal(references.size, 67)
})

check('路由保持 POSIX 分隔符，不依赖构建系统的本机路径分隔符', () => {
  assert.ok(routes.every(route => route.path.startsWith('pluginsSrc/') && !route.path.includes('\\') && !route.path.includes('..')))
})

check('关闭功能会移除其 JS/CSS 和字体，而画廊与图标仍可用', () => {
  const selected = clone(theme)
  Object.assign(selected, {
    lightbox: '', pjax: { enable: false }, instantpage: false,
    subtitle: { enable: false }, share: { use: '' }, math: { use: '' },
    mermaid: { enable: false }
  })
  const result = boot({ selected })()
  assert.equal(result.length, 6) // InfiniteGrid + Font Awesome CSS + four fonts
  assert.ok(result.every(route => /\/(?:@egjs\/infinitegrid|@fortawesome\/fontawesome-free)\//.test(route.path)))
})

check('外部 CDN 和单项自定义地址不重复生成本地文件', () => {
  const selected = clone(theme)
  selected.CDN.third_party_provider = 'jsdelivr'
  assert.equal(boot({ selected })().length, 0)
  selected.CDN.third_party_provider = 'local'
  selected.CDN.option = { fontawesome: 'https://assets.example/font.css' }
  const result = boot({ selected })()
  assert.ok(!result.some(route => route.path.includes('fontawesome-free')))
})

check('主题映射缺失、文件缺失和目录穿越导致清晰的构建错误', () => {
  const missing = clone(manifest)
  delete missing.fontawesome
  assert.throws(boot({ plugins: missing }), /Theme plugins.yml is missing: fontawesome/)
  const file = clone(manifest)
  file.fontawesome.file = 'does-not-exist.css'
  assert.throws(boot({ plugins: file }), /Install this enabled plugin as a direct dependency/)
  file.fontawesome.file = '../../outside.txt'
  assert.throws(boot({ plugins: file }), /Invalid asset path/)
})

check('未实现完整动态数据目录的 MathJax 不会被静默生成成半成品', () => {
  const selected = clone(theme)
  selected.math.use = 'mathjax'
  assert.throws(boot({ selected }), /MathJax requires its dynamic font\/data bundles/)
})

check('当前 Mermaid/Fancybox 独立 UMD 不遗漏 import() 动态模块', () => {
  for (const key of ['mermaid', 'fancybox']) {
    const plugin = manifest[key]
    const js = byPath.get('pluginsSrc/' + plugin.name + '/' + plugin.file).toString()
    assert.ok(!/\bimport\s*\(/.test(js), key + ' now needs dynamic chunks; extend the asset rules')
    assert.ok(!/new\s+Worker\s*\(/.test(js), key + ' now needs worker assets; extend the asset rules')
  }
})

console.log('\n' + passed + ' local asset generator checks passed; ' + routes.length + ' files, ' +
  (routes.reduce((total, route) => total + route.data.length, 0) / 1024 / 1024).toFixed(2) + ' MiB')
