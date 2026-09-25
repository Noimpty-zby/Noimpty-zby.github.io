/* 暗号门。整站的锁最后落在这个文件上。
 *
 * 在这之前它只有一条「能不能被解析」的语法检查（js-syntax.test.mjs）——
 * 而 leakcheck 和 pages.yml 的上锁自检管的都是**构建产物**，
 * 浏览器里那一半（哪些路径要锁、路径怎么归一化、清单拿不到时怎么办）
 * 一条测试都没有。而 normalizePath 那种函数正是最容易出边界 bug 的地方，
 * 出了 bug 的表现是「某个路径没弹暗号框」—— 没人会发现。
 *
 * 这里守三件事：
 *   1. 默认拒绝：白名单之外一律锁，新板块不配置也自动被锁
 *   2. 路径归一化的边界，以及**出错时要倒向「锁」那一侧**
 *   3. 两组跨文件常量不许各改各的（走散了是指不到原因的故障）
 *
 * 这是浏览器脚本，没法 import，所以按字符串边界切一段出来在隔离作用域里求值
 * （和 nanaly-chat.test.mjs 同一个办法，测的仍是真代码）。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

let pass = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

const read = p => readFileSync(join(process.cwd(), p), 'utf8')
const GATE = read('source/js/privacy-gate.js')
const LOCKDOWN = read('scripts/noimpty-lockdown.js')
const CRYPTO = read('tools/site-crypto.cjs')
const SEARCH = read('source/js/noimpty-search.js')

/* 切出「判哪些路径要锁」那一段：从读清单开始，到 unlocked() 为止。
 * 这一段只碰 window.NOIMPTY_PRIVACY，不碰 document，所以喂个空壳就能跑。 */
const cut = (src, from, to) => {
  const a = src.indexOf(from)
  const b = src.indexOf(to, a)
  assert.ok(a > 0 && b > a, `切不出这一段：${from.slice(0, 30)}`)
  return src.slice(a, b)
}
const SEG = cut(GATE, '  const privacy = window.NOIMPTY_PRIVACY', '  const unlocked = ')

/** 用一份指定的锁清单，把那段逻辑跑起来 */
const gateWith = manifest => {
  const ctx = vm.createContext({ window: manifest === undefined ? {} : { NOIMPTY_PRIVACY: manifest } })
  vm.runInContext(SEG + '\nglobalThis.__g = { normalizePath, isPublic, isLocked, sectionOf, expectedHash, publicPaths }', ctx)
  return ctx.__g
}

// 线上那份长这样（见 scripts/noimpty-lockdown.js 发出的 protected-manifest.js）
const REAL = {
  entries: [
    { path: '/in-class/', section: '课内' },
    { path: '/2026/09/14/dsa-chapter-two/', section: '内部' }
  ],
  publicPaths: ['/'],
  lockAllExceptPublic: true,
  passHash: 'a'.repeat(64)
}

console.log('\n暗号门 · 默认拒绝')

check('★★ 白名单之外一律锁', () => {
  const g = gateWith(REAL)
  ;['/in-class/', '/extra/ai-infra/', '/life/', '/news/', '/schedule/',
    '/about/', '/archives/', '/2026/09/14/dsa-chapter-two/'].forEach(p => {
    assert.equal(g.isLocked(p), true, `${p} 居然没锁`)
  })
})

check('★★ 明天新加一个板块，不配置也自动被锁（默认拒绝的全部意义）', () => {
  const g = gateWith(REAL)
  assert.equal(g.isLocked('/quantum/'), true, '没出现在清单里的新板块被放行了')
  assert.equal(g.isLocked('/extra/ai-infra/rust/'), true)
})

check('★ 首页和 404 是仅有的两个公开页', () => {
  const g = gateWith(REAL)
  assert.equal(g.isPublic('/'), true, '首页被锁了')
  assert.equal(g.isPublic('/404/'), true, '404 被锁了 —— 打错字的自己也会被挡在外面')
  assert.equal(g.publicPaths.size, 1, `publicPaths 里有 ${g.publicPaths.size} 条，只该有首页`)
})

check('★★ 锁清单整个拿不到时要更严，不是放行', () => {
  // 构建坏了 / manifest 没加载 → window.NOIMPTY_PRIVACY 是 undefined
  const g = gateWith(undefined)
  assert.equal(g.isPublic('/'), true, '连首页都进不去就太过了')
  assert.equal(g.isLocked('/in-class/'), true, '清单拿不到时放行了 —— 这时候全站都是公开的')
  assert.equal(g.isLocked('/2026/09/14/x/'), true)
  assert.equal(g.expectedHash.length, 64, '没有兜底哈希，门会永远打不开')
})

console.log('\n暗号门 · 路径归一化')

check('★★ 同一个页面的各种写法都归到一处', () => {
  const { normalizePath: n } = gateWith(REAL)
  assert.equal(n('/'), '/')
  assert.equal(n('/index.html'), '/', '首页写成文件名就进不去了')
  assert.equal(n('/in-class/index.html'), '/in-class/')
  assert.equal(n('/about.html'), '/about/')
  assert.equal(n('in-class'), '/in-class/', '少了开头的斜杠')
  assert.equal(n('/in-class'), '/in-class/', '少了结尾的斜杠')
  assert.equal(n('//in-class//'), '/in-class/', '双斜杠没合并')
  assert.equal(n(''), '/')
  assert.equal(n(undefined), '/')
})

check('★★ 百分号编码要解开 —— 不解的话中文路径会被当成另一个地址', () => {
  const { normalizePath: n } = gateWith(REAL)
  assert.equal(n('/%E8%AF%BE%E5%86%85/'), '/课内/')
})

check('★★ 编码坏掉时不许抛，而且必须落在「锁」这一侧', () => {
  const g = gateWith(REAL)
  let out
  assert.doesNotThrow(() => { out = g.normalizePath('/%E4%') }, 'decodeURI 抛出来没被接住')
  assert.equal(g.isLocked(out), true, '坏编码被放行了')
})

check('★★ 大小写变形绕不过去（倒向锁，不是倒向放行）', () => {
  const g = gateWith(REAL)
  assert.equal(g.isLocked(g.normalizePath('/IN-CLASS/')), true)
  // /INDEX.HTML 不会被当成首页 —— 锁住是安全的方向
  assert.equal(g.isLocked(g.normalizePath('/INDEX.HTML')), true)
})

check('★ 上锁页面的任何写法都锁得住，不会有哪一种归一化成首页', () => {
  const g = gateWith(REAL)
  ;['/in-class/index.html', '/in-class', 'in-class/', '//in-class//',
    '/in-class/./', '/in-class/%20/'].forEach(p => {
    assert.equal(g.isLocked(g.normalizePath(p)), true, `${p} 被归一化成公开页了`)
  })
})

console.log('\n暗号门 · 解锁框上显示哪个板块')

check('清单里写了的用清单，没写的按路径猜', () => {
  const g = gateWith(REAL)
  assert.equal(g.sectionOf('/in-class/'), '课内', '清单里的没生效')
  assert.equal(g.sectionOf('/extra/ai-infra/go/'), '课外')
  assert.equal(g.sectionOf('/life/'), 'Life')
  assert.equal(g.sectionOf('/news/2026-09-16/'), '资讯')
  assert.equal(g.sectionOf('/schedule/'), '日程')
  assert.equal(g.sectionOf('/quantum/'), '内部', '猜不出来时该给个中性的词')
})

console.log('\n暗号门 · 跨文件的常量不许各改各的')

check('★★ 兜底哈希：privacy-gate 和 lockdown 必须是同一个', () => {
  /* 暗号有两个用途：开门，和解密 search.xml。两处兜底值走散了，
   * 症状是「门能开、但搜索永远解不开」，而且指不到原因。 */
  const a = (GATE.match(/'([0-9a-f]{64})'/) || [])[1]
  const b = (LOCKDOWN.match(/FALLBACK_HASH = '([0-9a-f]{64})'/) || [])[1]
  assert.ok(a, 'privacy-gate.js 里找不到兜底哈希')
  assert.ok(b, 'noimpty-lockdown.js 里找不到 FALLBACK_HASH')
  assert.equal(a, b, '两处兜底哈希已经不一样了 —— 换暗号时只改了一边')
})

check('★★ PBKDF2 的参数：lockdown（加密侧）和 noimpty-search（解密侧）必须一字不差', () => {
  /* 这两处是一对密钥派生参数。改了一边，线上的 search.xml 和行动日志
   * 就再也解不开了，而构建和测试全绿 —— 只有打开网站搜一下才会发现。 */
  const pick = (src, name) => (src.match(new RegExp(`const ${name} = ([^\\n]+)`)) || [])[1]
  ;['SALT', 'ITER'].forEach(k => {
    const a = pick(CRYPTO, k)
    const b = pick(SEARCH, k)
    assert.ok(a && b, `找不到 ${k}`)
    assert.equal(a.trim(), b.trim(), `${k} 两边对不上：加密用 ${a}，解密用 ${b}`)
  })
})

console.log('\n暗号门 · 对外只暴露该暴露的')

check('★ NOIMPTY_GATE 只给出 unlocked 和 passphrase，而且是冻结的', () => {
  assert.match(GATE, /window\.NOIMPTY_GATE = Object\.freeze\(\{/, '没冻结，别的脚本能改掉它')
  const api = cut(GATE, 'window.NOIMPTY_GATE = Object.freeze({', '})')
  const keys = [...api.matchAll(/^\s{4}(\w+)[,:]/gm)].map(m => m[1])
  assert.deepEqual(keys.sort(), ['passphrase', 'unlocked'], `对外暴露的变成了 ${keys}`)
})

check('★ 暗号只进 sessionStorage，不许进 localStorage（关掉标签页就该没了）', () => {
  assert.ok(!/localStorage/.test(GATE), 'privacy-gate 里出现了 localStorage —— 暗号会留在这台机器上')
  assert.match(GATE, /sessionStorage\.setItem\(SESSION_PASS/, '没把暗号存下来，站内搜索会解不开索引')
})

console.log(`\n${pass} 项通过`)
