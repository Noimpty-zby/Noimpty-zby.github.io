import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import postcss from 'postcss'

const read = path => readFileSync(new URL('../../../' + path, import.meta.url), 'utf8')
let passed = 0
const check = (name, fn) => {
  try { fn(); passed++; console.log('  ✓ ' + name) }
  catch (error) { process.exitCode = 1; console.error('  ✗ ' + name, error) }
}

const bootAnalytics = last => {
  const values = new Map([['noimpty-owner', '1'], ['noimpty-last-beat', String(last)]])
  const reports = [], scripts = [], listeners = []
  const now = 2000000000000
  const win = {
    NOIMPTY_GC_CODE: 'fixture',
    goatcounter: { count: event => reports.push(event) },
    addEventListener: (...args) => listeners.push(args)
  }
  const ctx = vm.createContext({
    window: win,
    localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    location: { hash: '', pathname: '/', search: '' },
    Date: { now: () => now },
    setTimeout: fn => fn(),
    document: {
      title: 'Test',
      head: { appendChild: node => scripts.push(node) },
      createElement: () => ({ setAttribute() {}, addEventListener(event, fn) { this[event] = fn } })
    }
  })
  const src = read('source/js/analytics.js')
  vm.runInContext(src, ctx)
  return { reports, scripts, listeners, replay: () => vm.runInContext(src, ctx), now }
}

check('统计脚本重复执行不重复插入 SDK 或订阅 PJAX', () => {
  const b = bootAnalytics(0)
  b.replay()
  assert.equal(b.scripts.length, 1)
  assert.equal(b.listeners.length, 1)
  b.scripts[0].load()
  assert.equal(b.reports.length, 1)
})

check('未来与无限大缓存时间戳不永久抑制主人心跳', () => {
  for (const last of [2000000000000 + 86400000, Infinity, 'broken']) {
    const b = bootAnalytics(last)
    b.scripts[0].load()
    assert.equal(b.reports.length, 1)
    assert.equal(b.reports[0].path, '/owner-heartbeat')
  }
})

check('正常的一小时心跳节流仍然生效', () => {
  const b = bootAnalytics(2000000000000 - 1000)
  b.scripts[0].load()
  assert.equal(b.reports.length, 0)
})

const sectionHtml = (cover, root = '/') => {
  const tags = new Map()
  const post = { title: 'Test', path: '2026/test/index.html', cover, categories: [{ name: 'Demo' }] }
  vm.runInNewContext(read('scripts/noimpty-sections.js'), {
    hexo: {
      config: { root },
      locals: { get: () => [post] },
      extend: { tag: { register: (name, fn) => tags.set(name, fn) } }
    }
  })
  return tags.get('section_posts')(['Demo'])
}

check('分区卡片保留 HTTPS 和协议相对 CDN 封面地址', () => {
  assert.ok(sectionHtml('https://cdn.example.test/image.png').includes("url('https://cdn.example.test/image.png')"))
  assert.ok(sectionHtml('//cdn.example.test/image.png').includes("url('//cdn.example.test/image.png')"))
})

check('本地封面和默认封面遵守子路径配置', () => {
  assert.ok(sectionHtml('/img/local.png', '/blog/').includes("url('/blog/img/local.png')"))
  assert.ok(sectionHtml(undefined, '/blog/').includes("url('/blog/img/cover-blue.svg')"))
  assert.ok(sectionHtml(undefined, '/blog/').includes('href="/blog/2026/test/"'))
})

check('封面路径里的单引号和换行先转义 CSS 字符串再转义 HTML', () => {
  const html = sectionHtml("/img/it's\ncover.png")
  assert.ok(html.includes('it\\&#39;s\\a cover.png'))
  assert.ok(!html.includes("it's\ncover"))
})

// Resolve the actual stylesheet cascade for the course grid at several widths.
// PostCSS is already included by the Hexo CSS renderer.
// 课程网格在 2026-09-26 内页改版时从 sections.css 搬到了 interior.css
const css = postcss.parse(read('source/css/interior.css'))
const gridAt = width => {
  const classes = new Set(['noimpty-track-grid', 'noimpty-track-grid--seven'])
  let result, specificity = -1
  css.walkRules(rule => {
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type !== 'atrule' || parent.name !== 'media') continue
      const max = parent.params.match(/max-width:\s*(\d+)px/)
      const min = parent.params.match(/min-width:\s*(\d+)px/)
      if (max && width > Number(max[1])) return
      if (min && width < Number(min[1])) return
      if (!max && !min) return
    }
    const matches = rule.selectors.filter(selector => /^\.[\w-]+(?:\.[\w-]+)*$/.test(selector) &&
      selector.slice(1).split('.').every(name => classes.has(name)))
    if (!matches.length) return
    const weight = Math.max(...matches.map(selector => selector.split('.').length - 1))
    rule.walkDecls('grid-template-columns', declaration => {
      if (weight >= specificity) { specificity = weight; result = declaration.value }
    })
  })
  return result
}

check('七门课程网格在桌面四列、平板两列、手机一列', () => {
  assert.equal(gridAt(1200), 'repeat(4, minmax(0, 1fr))')
  assert.equal(gridAt(850), 'repeat(2, minmax(0, 1fr))')
  assert.equal(gridAt(375), 'minmax(0, 1fr)')
})

console.log('\n' + passed + ' additional frontend checks passed')
