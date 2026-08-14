/* 资讯板块的来源链接测试。
 *
 * 这个板块唯一的价值就是「每条都能点回原文核对」。上线后链接点不开，
 * 原因是让模型自己写 markdown 链接 —— 中文模型会用全角括号、会把句号吞进
 * URL、会把网址记岔。现在改成她只挑编号、链接由代码拼，这里证明它真的稳。
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

// news.mjs 顶层没有副作用，但它 import 了 narrate.mjs（会读环境变量），所以直接 import 即可
const mod = await import('file://' + join(process.cwd(), 'tools/nanaly/news.mjs'))

// attachSources 没有 export（它是内部函数），用源码里抠出来的方式测太脆弱，
// 所以这里改成从模块源文件里取出函数体在隔离作用域里求值 —— 测的仍然是真代码。
import vm from 'node:vm'
const src = readFileSync(join(process.cwd(), 'tools/nanaly/news.mjs'), 'utf8')
const start = src.indexOf('const attachSources =')
const end = src.indexOf('// 最近几期写过什么')
assert.ok(start > 0 && end > start, '没能从 news.mjs 里定位 attachSources')
const { sanitizeMd } = await import('file://' + join(process.cwd(), 'tools/nanaly/git.mjs'))
const ctx = vm.createContext({ sanitizeMd, encodeURI, String, Number, RegExp, console })
vm.runInContext(src.slice(start, end) + '\nglobalThis.__f = attachSources', ctx)
const attachSources = ctx.__f

const HITS = [
  { title: 'A 公司裁员', url: 'https://example.com/a?ref=1' },
  { title: 'B 引擎更新', url: 'https://example.org/b/' },
  { title: 'C 面试经验', url: 'https://example.net/c' }
]

let pass = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

console.log('\n资讯来源链接')

check('★ 正常情况：编号被换成真链接', () => {
  const out = attachSources('- [0] **A 公司裁员** —— 转述一句。窝觉得没意思。', HITS)
  assert.equal(out, '- **A 公司裁员** —— 转述一句。窝觉得没意思。 [来源](https://example.com/a?ref=1)')
})

check('★ 她自己写了全角括号的链接（线上就是这个毛病）→ 清掉，只留窝拼的', () => {
  const out = attachSources('- [1] **B 引擎更新** —— 说明。［来源］（https://wrong.example/x）', HITS)
  assert.ok(out.includes('[来源](https://example.org/b/)'), '没挂上正确链接')
  assert.ok(!out.includes('wrong.example'), '她写错的网址还留着')
  assert.ok(!out.includes('（'), '全角括号残留')
})

check('★ 她写了裸网址 → 清掉', () => {
  const out = attachSources('- [2] **C 面试经验** —— 看 https://spam.example/x 就行', HITS)
  assert.ok(!out.includes('spam.example'))
  assert.ok(out.includes('[来源](https://example.net/c)'))
})

check('★ 编号是编的（超出范围）→ 整条丢掉，不留半截无源条目', () => {
  const out = attachSources('- [0] **真的** —— x\n- [99] **编的** —— y', HITS)
  assert.ok(out.includes('真的'))
  assert.ok(!out.includes('编的'), '编造的条目被留下来了')
})

check('全角方括号的编号也认', () => {
  assert.ok(attachSources('- ［1］**B** —— x', HITS).includes('example.org'))
  assert.ok(attachSources('- 【2】**C** —— x', HITS).includes('example.net'))
})

check('一条都没挂上 → 返回空串（整段丢弃，不发一段没有来源的内容）', () => {
  assert.equal(attachSources('- 我就不写编号 —— 随便说说', HITS), '')
  assert.equal(attachSources('', HITS), '')
})

check('HTML 标签在条目文字里被钝化', () => {
  const out = attachSources('- [0] **A** —— <img src=x onerror=alert(1)> 说明', HITS)
  assert.ok(!/<img/i.test(out), '还留着 <img')
  assert.ok(out.includes('&lt;img'))
})

check('URL 里的空格等脏字符被编码，不会把 markdown 链接撑破', () => {
  const out = attachSources('- [0] **A** —— x', [{ title: 'A', url: 'https://e.com/a b(c)' }])
  assert.ok(!/\s/.test(out.split('](')[1] || ''), '链接里还有空格')
})

check('非 http 的 url（比如相对路径）不挂，条目丢掉', () => {
  assert.equal(attachSources('- [0] **A** —— x', [{ title: 'A', url: 'www.example.com/a' }]), '')
})

check('多条 + 中间的空行都能正常处理', () => {
  const out = attachSources('- [0] **A** —— x\n\n- [1] **B** —— y\n- [2] **C** —— z', HITS)
  assert.equal(out.split('[来源]').length - 1, 3)
})

console.log(`\n${pass} 项通过`)
