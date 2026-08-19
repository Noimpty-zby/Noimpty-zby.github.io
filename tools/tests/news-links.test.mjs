/* 资讯板块的来源链接测试。
 *
 * 这个板块唯一的价值就是「每条都能点回原文核对」。它坏过两次：
 *
 *   第一次：让模型自己写 markdown 链接 —— 中文模型会用全角括号、
 *           会把句号吞进 URL、会把网址记岔。改成「她只挑编号、链接由代码拼」。
 *   第二次：编号张冠李戴 —— 链接能点开、域名也真，但文不对题。
 *           加了内容校验：条目文字和它标的素材对不上就改挂或丢掉。
 *
 * 这个文件同时守住这两条。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

/* attachSources 没有 export（是内部函数）。从源文件里取出这一段在隔离作用域里求值 ——
 * 测的仍然是真代码，不是一份抄过来的副本。
 * 上下界这两个字符串是约定，改 news.mjs 时别把它们弄没了。 */
const src = readFileSync(join(process.cwd(), 'tools/nanaly/news.mjs'), 'utf8')
const start = src.indexOf('const attachSources =')
const end = src.indexOf('// 最近几期写过什么')
assert.ok(start > 0 && end > start, '没能从 news.mjs 里定位 attachSources')

const { sanitizeMd } = await import('file://' + join(process.cwd(), 'tools/nanaly/git.mjs'))
const ctx = vm.createContext({
  sanitizeMd, encodeURI, String, Number, RegExp, Set, URL,
  // 校验过程会打日志，测试里静音掉
  console: { log: () => {} }
})
vm.runInContext(src.slice(start, end) + '\nglobalThis.__f = attachSources', ctx)
const attachSources = ctx.__f

const HITS = [
  { title: 'A 公司裁员', url: 'https://example.com/a?ref=1', excerpt: 'A 公司宣布裁撤引擎组，涉及三百人' },
  { title: 'B 引擎更新', url: 'https://example.org/b/', excerpt: 'B 引擎发布 5.6 版本，重做了渲染管线' },
  { title: 'C 面试经验', url: 'https://example.net/c', excerpt: 'C 分享了游戏客户端面试的八股与真题' }
]

let pass = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

console.log('\n资讯来源链接')

check('★ 正常情况：编号被换成真链接，并带上域名', () => {
  const out = attachSources('- [0] **A 公司裁员** —— 裁撤引擎组，涉及三百人。窝觉得没意思。', HITS)
  assert.equal(out, '- **A 公司裁员** —— 裁撤引擎组，涉及三百人。窝觉得没意思。 [来源 · example.com](https://example.com/a?ref=1)')
})

check('★ 她自己写了全角括号的链接（线上就是这个毛病）→ 清掉，只留窝拼的', () => {
  const out = attachSources('- [1] **B 引擎更新** —— 发布 5.6 版本，重做了渲染管线。［来源］（https://wrong.example/x）', HITS)
  assert.ok(out.includes('](https://example.org/b/)'), '没挂上正确链接')
  assert.ok(!out.includes('wrong.example'), '她写错的网址还留着')
  assert.ok(!out.includes('（'), '全角括号残留')
})

check('★ 她写了裸网址 → 清掉', () => {
  const out = attachSources('- [2] **C 面试经验** —— 分享了游戏客户端面试的八股与真题，看 https://spam.example/x 就行', HITS)
  assert.ok(!out.includes('spam.example'))
  assert.ok(out.includes('](https://example.net/c)'))
})

check('★ 编号是编的（超出范围）→ 整条丢掉，不留半截无源条目', () => {
  const out = attachSources(
    '- [0] **A 公司裁员** —— 裁撤引擎组，涉及三百人\n- [99] **编的** —— 这条没有对应素材', HITS)
  assert.ok(out.includes('A 公司裁员'))
  assert.ok(!out.includes('编的'), '编造的条目被留下来了')
})

check('★★ 编号张冠李戴、但另一条明显对得上 → 改挂那一条', () => {
  // 内容讲的是面试（对应 [2]），却标了 [0]
  const out = attachSources(
    '- [0] **C 面试经验** —— 分享了游戏客户端面试的八股与真题，值得照着准备一轮', HITS)
  assert.ok(out.includes('](https://example.net/c)'), '没有改挂到真正对应的那条')
  assert.ok(!out.includes('example.com'), '还挂在她标错的那条上')
})

check('★★ 编号对不上、也没有任何素材对得上 → 整条丢掉', () => {
  const out = attachSources(
    '- [0] **完全无关** —— 这段话讲的是烘焙戚风蛋糕的配方与打发蛋白的技巧和烤箱温度', HITS)
  assert.equal(out, '', '文不对题的条目被留下来了')
})

check('太短的条目没法判断重合度 → 放行，交给编号兜着', () => {
  const out = attachSources('- [1] **B** —— x', HITS)
  assert.ok(out.includes('](https://example.org/b/)'), '短条目被误杀了')
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
  const out = attachSources('- [0] **A 公司裁员** —— 裁撤引擎组涉及三百人 <img src=x onerror=alert(1)>', HITS)
  assert.ok(!/<img/i.test(out), '还留着 <img')
  assert.ok(out.includes('&lt;img'))
})

check('URL 里的空格等脏字符被编码，不会把 markdown 链接撑破', () => {
  const out = attachSources('- [0] **A** —— x', [{ title: 'A', url: 'https://e.com/a b(c)' }])
  const url = (out.split('](')[1] || '').replace(/\)$/, '')
  assert.ok(!/\s/.test(url), '链接里还有空格')
})

check('非 http 的 url（比如相对路径）不挂，条目丢掉', () => {
  assert.equal(attachSources('- [0] **A** —— x', [{ title: 'A', url: 'www.example.com/a' }]), '')
})

check('多条 + 中间的空行都能正常处理', () => {
  const out = attachSources(
    '- [0] **A 公司裁员** —— 裁撤引擎组，涉及三百人\n\n' +
    '- [1] **B 引擎更新** —— 发布 5.6 版本，重做了渲染管线\n' +
    '- [2] **C 面试经验** —— 分享了游戏客户端面试的八股与真题', HITS)
  assert.equal(out.split('[来源').length - 1, 3)
})

console.log(`\n${pass} 项通过`)
