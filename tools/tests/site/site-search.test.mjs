/* 站内搜索（导航栏那个放大镜）。
 *
 * 它到 2026-09-17 为止是**死的**：主题的 local-search.js 直接
 *   DOMParser().parseFromString(res, 'text/xml').querySelectorAll('entry')
 * 而全站上锁之后 /search.xml 已经是密文信封。拿 JSON 当 XML 解析得到
 * parsererror 文档、entry 数为 0，于是搜什么都是「没有找到」——
 * 而且整条路径不抛异常，控制台干净，没人会发现。
 * 娜娜莉的 @@ACT{"do":"search"} 驱动的也是同一个框。
 *
 * 修法是在 noimpty-search.js 里接管那一次 fetch。这个文件跑真代码：
 * 用和构建侧一样的参数造一份真密文，喂给它，看它还回去的是什么。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import crypto from 'node:crypto'
import vm from 'node:vm'

let pass = 0
const check = async (name, fn) => {
  try { await fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

const SRC = readFileSync(join(process.cwd(), 'source/js/noimpty-search.js'), 'utf8')

// 和 scripts/noimpty-lockdown.js 完全一致的加密（那边改了这里会红，
// privacy-gate.test.mjs 另有一条专门盯这两个常量）
const SALT = 'noimpty-search-v1'
const ITER = 120000
const PASSPHRASE = '开门喵'
const REAL_XML = `<?xml version="1.0" encoding="utf-8"?>
<search>
  <entry><title>数据结构第二章</title><url>/2026/09/14/dsa/</url><content>递归的栈帧与跟踪树</content></entry>
  <entry><title>Linux 命令行第三章</title><url>/2026/09/05/linux3/</url><content>一棵树、两个符号</content></entry>
</search>`

const seal = (text, pw) => {
  const key = crypto.pbkdf2Sync(pw, SALT, ITER, 32, 'sha256')
  const iv = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([c.update(text, 'utf8'), c.final()])
  return Buffer.concat([iv, body, c.getAuthTag()]).toString('base64')
}
const envelope = JSON.stringify({ v: 1, alg: 'AES-GCM', kdf: `PBKDF2-SHA256/${ITER}`, data: seal(REAL_XML, PASSPHRASE) })

/* 把整个 noimpty-search.js 跑起来。
 * DOMParser 在 node 里没有，给个够用的替身（只认 entry/title/url/content）。 */
const boot = ({ body = envelope, passphrase = PASSPHRASE } = {}) => {
  const calls = []
  const nativeFetch = async url => {
    calls.push(String(url))
    return { ok: true, status: 200, text: async () => body }
  }
  const win = {
    GLOBAL_CONFIG_SITE: { root: '/' },
    NOIMPTY_GATE: { passphrase: () => passphrase },
    location: { origin: 'https://example.test' },
    fetch: nativeFetch
  }
  const ctx = vm.createContext({
    window: win, crypto, TextEncoder, TextDecoder, atob, URL, Response, console, AbortController, setTimeout, clearTimeout,
    DOMParser: class {
      parseFromString (str) {
        const entries = [...String(str).matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => {
          const g = k => (m[1].match(new RegExp(`<${k}>([\\s\\S]*?)</${k}>`)) || [])[1] || ''
          return { querySelector: k => ({ textContent: g(k) }) }
        })
        return { querySelectorAll: () => entries }
      }
    }
  })
  vm.runInContext(SRC, ctx)
  return { win, calls }
}

console.log('\n站内搜索 · 主题拿到的到底是什么')

await check('★★ 主题去 fetch /search.xml，拿回来的是**解密后的 XML**，不是密文', async () => {
  const { win } = boot()
  const res = await win.fetch('/search.xml')
  const text = await res.text()
  assert.ok(!text.startsWith('{'), '还给它的仍然是密文信封 —— 搜索照样是死的')
  assert.match(text, /<entry>/, '不是 XML')
  assert.match(text, /数据结构第二章/, '解出来的内容不对')
})

await check('★★ 解不开时给一份**合法但空**的 XML，而不是把密文塞过去', async () => {
  // 还没解锁（拿不到暗号）——把密文交给 DOMParser 才是原来那个 bug
  const { win } = boot({ passphrase: '' })
  const res = await win.fetch('/search.xml')
  const text = await res.text()
  assert.ok(!text.startsWith('{'), '把密文塞给主题了')
  assert.match(text, /^<\?xml/, '不是合法 XML 开头')
  assert.match(text, /<search><\/search>/, '应该是一份空索引')
})

await check('★★ 别的地址一律原样放行（娜娜莉调模型、日程调 GitHub 都走同一个 fetch）', async () => {
  const { win, calls } = boot()
  await win.fetch('https://api.deepseek.com/chat/completions')
  await win.fetch('https://api.github.com/repos/x/y/contents/z')
  assert.ok(calls.includes('https://api.deepseek.com/chat/completions'), 'DeepSeek 的请求被拦下了')
  assert.ok(calls.includes('https://api.github.com/repos/x/y/contents/z'), 'GitHub 的请求被拦下了')
})

await check('★★ 接管之后不许无限递归（解密自己也要 fetch 那个文件）', async () => {
  const { win, calls } = boot()
  await win.fetch('/search.xml')
  await win.fetch('/search.xml')
  const n = calls.filter(u => u.includes('search.xml')).length
  assert.equal(n, 1, `底层被请求了 ${n} 次 —— 要么递归了，要么没缓存`)
})

console.log('\n站内搜索 · 认地址')

await check('只认那一个地址', async () => {
  const { win } = boot()
  const is = win.NOIMPTY_SEARCH.isIndexUrl
  assert.equal(is('/search.xml'), true)
  assert.equal(is('https://example.test/search.xml'), true, '绝对地址也要认')
  assert.equal(is('/search.xml?v=1'), true, '带查询串也是同一个文件')
  assert.equal(is('/nanaly-journal.json'), false)
  assert.equal(is('https://api.tavily.com/search'), false, '差点把 Tavily 也拦了')
  assert.equal(is(''), false)
})

console.log('\n站内搜索 · loadCorpus 还是好的')

await check('★ loadCorpus 仍然给出解析好的文章数组', async () => {
  const { win } = boot()
  const posts = await win.NOIMPTY_SEARCH.loadCorpus()
  assert.equal(posts.length, 2)
  assert.equal(posts[0].title, '数据结构第二章')
  assert.equal(posts[0].url, '/2026/09/14/dsa/')
  assert.match(posts[0].text, /递归的栈帧/)
})

console.log(`\n${pass} 项通过`)
