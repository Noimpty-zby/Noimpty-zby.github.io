import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const core = readFileSync('source/js/noimpty-ai.js', 'utf8')
const fixture = readFileSync('tools/tests/ai/nanaly-workspace.test.mjs', 'utf8')
const Element = vm.runInNewContext(fixture.slice(fixture.indexOf('class Element'), fixture.indexOf('\nconst boot =')) + '\nElement')
const document = { createElement: tag => new Element(tag, document) }
const el = (tag, className = '') => { const node = document.createElement(tag); node.className = className; return node }
const start = core.indexOf('  const renderSources =')
const end = core.indexOf('  const ROOT =', start)
assert.ok(start >= 0 && end > start)
const renderSources = vm.runInNewContext(core.slice(start, end) + '\nrenderSources', { el, URL, location: { origin: 'https://blog.test' } })
const source = { id: 'S1', title: '矩阵原文', url: '/matrix/', quote: '原文片段' }
let passed = 0
const check = (label, fn) => { fn(); passed++; console.log('  ✓ ' + label) }

check('unverified citations remain visible even when no sources were retrieved', () => {
  const node = el('div')
  renderSources(node, [], '结论见 [S7]，再次引用 [S7]。')
  const details = node.querySelector('.nanaly-sources')
  assert.ok(details, 'an invented citation must not silently appear verified')
  assert.equal(details.open, true)
  assert.match(details.querySelector('summary').textContent, /引用待核实/)
  assert.match(details.querySelector('p').textContent, /\[S7\].*未对应到检索材料/)
  assert.equal(details.querySelector('p').textContent.match(/\[S7\]/g).length, 1)
  assert.equal(details.querySelector('ol'), null)
})

check('filtered unsafe sources cannot suppress an unverified citation warning', () => {
  const node = el('div')
  renderSources(node, [{ ...source, url: 'javascript:alert(1)' }], '依据 [S1]')
  assert.ok(node.querySelector('.nanaly-sources'))
  assert.match(node.querySelector('p').textContent, /\[S1\].*未对应/)
  assert.equal(node.querySelector('a'), null)
})

check('valid and missing citations show both the real source and the warning', () => {
  const node = el('div')
  renderSources(node, [source], '依据 [S1] 和 [S99]')
  assert.equal(node.querySelector('a').href, source.url)
  assert.equal(node.querySelector('blockquote').textContent, source.quote)
  assert.match(node.querySelector('p').textContent, /\[S99\]/)
  assert.doesNotMatch(node.querySelector('p').textContent, /\[S1\]/)
  renderSources(node, [source], '依据 [S1] 和 [S99]')
  assert.equal(node.querySelectorAll('.nanaly-sources').length, 1)
})

check('answers without references remain uncluttered and valid sources stay collapsible', () => {
  const node = el('div')
  renderSources(node, [], '你好')
  assert.equal(node.children.length, 0)
  renderSources(node, [source], '依据 [S1]')
  assert.equal(node.querySelector('summary').textContent, '回答引用的资料 · 1')
  assert.notEqual(node.querySelector('.nanaly-sources').open, true)
  assert.equal(node.querySelector('p'), null)
})

console.log('\n' + passed + ' source rendering cases passed')
