/* 内页小角色（tools/kawaii-art.cjs + {% kawaii %} 标签）。
 *
 * 页面里写的角色名拼错了，Hexo 构建会直接报错，但那要到部署时才知道；
 * 这里提前拦住。另外盯三件看页面才会发现的事：
 *   - 同一页放好几个角色，描白边的滤镜 id 不能重复，否则后面的角色用的是前一个的滤镜；
 *   - 开心时的 ^ ^ 眼默认要藏起来（单独当图片用时没有样式表，全靠属性）；
 *   - 生成的 .svg 文件要能被浏览器当图片打开（带 xmlns）。
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { render, names } = require('../../kawaii-art.cjs')

let pass = 0
const check = (name, fn) => { fn(); pass++; console.log(`  ✓ ${name}`) }

const pages = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const path = join(dir, entry.name)
  if (entry.isDirectory()) return entry.name === '_posts' ? [] : pages(path)
  return entry.name.endsWith('.md') ? [path] : []
})

check('页面里用到的每个角色都画了', () => {
  const used = pages('source').flatMap(file =>
    [...readFileSync(file, 'utf8').matchAll(/\{%\s*kawaii\s+([^%]+?)\s*%\}/g)].map(m => [file, m[1]]))
  assert.ok(used.length >= 30, `只找到 ${used.length} 处 {% kawaii %}，页面结构是不是变了`)
  for (const [file, name] of used) assert.doesNotThrow(() => render(name), `${file}: {% kawaii ${name} %}`)
})

check('每个角色都能单独画，带 xmlns，^ ^ 眼默认藏着', () => {
  for (const name of names()) {
    const svg = render(name)
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, name)
    assert.doesNotMatch(svg, /undefined|NaN/, name)
    for (const joy of svg.match(/<path class="kw-joy"[^>]*>/g) || []) assert.match(joy, /opacity="0"/, name)
  }
})

check('同一页的两个角色，白边滤镜 id 不重复', () => {
  const id = svg => svg.match(/<filter id="([^"]+)"/)[1]
  const a = render('tree'); const b = render('tree')
  assert.notEqual(id(a), id(b))
  assert.ok(a.includes(`url(#${id(a)})`))
})

check('拼错的名字直接报错', () => {
  assert.throws(() => render('pengiun'), /没有/)
  assert.throws(() => render('tree huge'), /没有/)
})

console.log(`\n${pass} 项通过`)
