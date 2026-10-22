import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'

// 第三方文件本地化（scripts/noimpty-local-assets.js）：按主题配置里的 vendor 列表从 node_modules 复制。
// 2026-10 换成自己的主题以前，这里测的是 Butterfly 的 plugins.yml 选择逻辑。
const require = createRequire(import.meta.url)
const yaml = require('js-yaml')
const base = fileURLToPath(new URL('../../../', import.meta.url))
const source = readFileSync(path.join(base, 'scripts/noimpty-local-assets.js'), 'utf8')
const theme = {
  ...yaml.load(readFileSync(path.join(base, 'themes/noimpty/_config.yml'), 'utf8')),
  ...yaml.load(readFileSync(path.join(base, '_config.noimpty.yml'), 'utf8'))
}
const clone = value => JSON.parse(JSON.stringify(value))
const boot = (vendor = theme.vendor) => {
  let generate
  vm.runInNewContext(source, {
    require,
    hexo: {
      base_dir: base,
      theme: { config: { ...theme, vendor } },
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

check('vendor 列表里的每个文件都原样复制，且没有重复路由', () => {
  for (const item of theme.vendor) {
    if (!item.file) continue
    const route = 'pluginsSrc/' + item.name + '/' + item.file
    assert.ok(byPath.has(route), 'Missing: ' + route)
    assert.deepEqual(byPath.get(route), readFileSync(path.join(base, 'node_modules', item.name, item.file)))
  }
  assert.equal(new Set(routes.map(route => route.path)).size, routes.length)
})

check('页面直接引用的几个文件都在（顶栏图标、公式、换页、看大图）', () => {
  for (const file of [
    'pluginsSrc/@fortawesome/fontawesome-free/css/all.min.css',
    'pluginsSrc/katex/dist/katex.min.css',
    'pluginsSrc/pjax/pjax.min.js',
    'pluginsSrc/@fancyapps/ui/dist/fancybox/fancybox.umd.js',
    'pluginsSrc/@fancyapps/ui/dist/fancybox/fancybox.css'
  ]) assert.ok(byPath.has(file), 'Missing: ' + file)
  const layouts = ['head.pug', 'scripts.pug'].map(f => readFileSync(path.join(base, 'themes/noimpty/layout/includes', f), 'utf8')).join('\n')
  for (const match of layouts.matchAll(/url_for\('(\/pluginsSrc\/[^']+)'\)/g)) {
    assert.ok(byPath.has(match[1].slice(1)), '模板引用了没有复制的文件: ' + match[1])
  }
})

check('CSS 引用的字体文件全部存在且路径保持原样', () => {
  let references = 0
  for (const [file, buffer] of byPath) {
    if (!file.endsWith('.css')) continue
    for (const match of buffer.toString().matchAll(/url\(([^)]+)\)/g)) {
      const target = match[1].trim().replace(/^['"]|['"]$/g, '')
      if (/^(?:data:|https?:|\/\/|#)/.test(target)) continue
      const normalized = path.posix.normalize(path.posix.join(path.posix.dirname(file), target.split(/[?#]/)[0]))
      assert.ok(byPath.has(normalized), 'Missing CSS asset: ' + normalized)
      references++
    }
  }
  assert.ok(references > 20, '应该数到 KaTeX 和 Font Awesome 的字体引用，只数到 ' + references)
})

check('路由保持 POSIX 分隔符，不依赖构建系统的本机路径分隔符', () => {
  assert.ok(routes.every(route => route.path.startsWith('pluginsSrc/') && !route.path.includes('\\') && !route.path.includes('..')))
})

check('从列表里去掉一项，它的文件和字体目录一起消失', () => {
  const vendor = clone(theme.vendor).filter(item => item.name !== 'katex')
  const result = boot(vendor)()
  assert.ok(!result.some(route => route.path.startsWith('pluginsSrc/katex/')))
  assert.ok(result.some(route => route.path.startsWith('pluginsSrc/@fortawesome/')))
  assert.equal(boot([])().length, 0)
})

check('包名非法、文件缺失和目录穿越导致清晰的构建错误', () => {
  assert.throws(boot([{ name: '../evil', file: 'x.js' }]), /Invalid package name/)
  assert.throws(boot([{ name: 'pjax', file: 'does-not-exist.js' }]), /Install it as a direct dependency/)
  assert.throws(boot([{ name: 'pjax', file: '../../outside.txt' }]), /Invalid asset path/)
  assert.throws(boot([{ name: 'katex', dirs: ['dist/no-such-dir'] }]), /Missing asset directory/)
  assert.throws(boot([{ file: 'x.js' }]), /needs a package name/)
})

check('Fancybox 独立 UMD 不需要动态加载的模块或 worker', () => {
  const js = byPath.get('pluginsSrc/@fancyapps/ui/dist/fancybox/fancybox.umd.js').toString()
  assert.ok(!/\bimport\s*\(/.test(js), 'fancybox now needs dynamic chunks; extend the asset rules')
  assert.ok(!/new\s+Worker\s*\(/.test(js), 'fancybox now needs worker assets; extend the asset rules')
})

console.log('\n' + passed + ' local asset generator checks passed; ' + routes.length + ' files, ' +
  (routes.reduce((total, route) => total + route.data.length, 0) / 1024 / 1024).toFixed(2) + ' MiB')
