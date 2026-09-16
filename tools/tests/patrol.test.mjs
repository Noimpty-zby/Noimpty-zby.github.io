/* 巡逻的两件事：发现问题之后怎么措辞，以及给谁贴表情。
 *
 * 一、措辞。判定一个地址是不是真坏了那四道关在 probe.mjs 里，日报的健康检查
 *   用的是同一份 —— 而 patrol.mjs 曾经把整套（hit / verdictOf / 两段式复核 /
 *   限流闸门）又抄了一遍。两份当时行为一致，但下次只会有一份被修，
 *   probe.mjs 开头那句「别再各写一套」就是为此写的。现在这边只剩措辞，
 *   而措辞值得单独守住：这段文字会原样出现在她公开发的评论里。
 *
 * 二、贴表情。老代码判的是「有没有人贴过表情」，不是「她贴过没有」——
 *   读者随手点一个 ❤️，她就永远不会再给那篇贴了。
 *   讨论的查询里本来就取了 user{login}，只是没用上。
 */
import assert from 'node:assert/strict'

process.env.SITE_URL = 'https://noimpty-zby.github.io'
const SITE = process.env.SITE_URL
const { issueOf, reactTargets } = await import('../nanaly/patrol.mjs')

let pass = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

console.log('\n巡逻 · 发现的问题怎么说')

check('站内链接坏了，只报路径不报整个域名', () => {
  const r = issueOf(`${SITE}/2026/09/14/x/`, 'link', true, { verdict: 'http', status: 404 })
  assert.equal(r.what, '链接 /2026/09/14/x/ 返回 404')
  assert.equal(r.kind, 'link')
})

check('首页坏了，路径显示成 /（不是空字符串）', () => {
  assert.match(issueOf(SITE, 'link', true, { verdict: 'http', status: 500 }).what, /^链接 \/ 返回 500$/)
})

check('站外链接说「已经失效了」，并且保留完整网址供核对', () => {
  const r = issueOf('https://example.com/gone', 'link', false, { verdict: 'http', status: 404 })
  assert.equal(r.what, '站外链接 https://example.com/gone 已经失效了（404）')
})

check('连不上的说「连续三次都连不上」—— 三次是复核过的次数，别改成一次就下结论', () => {
  assert.match(issueOf(`${SITE}/a/`, 'link', true, { verdict: 'unreachable', status: 0 }).what, /连续三次都连不上/)
})

check('图片和链接分开措辞', () => {
  assert.match(issueOf(`${SITE}/img/a.png`, 'img', true, { verdict: 'http', status: 404 }).what, /^图片 /)
})

check('★ 没查出问题就返回 null，不许造一条出来', () => {
  assert.equal(issueOf(`${SITE}/a/`, 'link', true, null), null)
})

console.log('\n巡逻 · 给谁贴表情')

const disc = (title, reactions = []) => ({
  id: title, title, reactions: { nodes: reactions.map(login => ({ content: 'HEART', user: { login } })) }
})

check('★★ 读者贴过表情，不代表她贴过 —— 她照样要贴', () => {
  const targets = reactTargets([disc('2026/09/14/x/', ['某位读者'])], 3, 'nanaly-bot')
  assert.equal(targets.length, 1, '有人点过 ❤️ 她就再也不贴了，这是老代码的毛病')
})

check('她自己贴过的就不再贴（大小写不敏感）', () => {
  assert.equal(reactTargets([disc('2026/09/14/x/', ['Nanaly-Bot'])], 3, 'nanaly-bot').length, 0)
})

check('★ 没配 NANALY_LOGIN 时分不清谁贴的 → 退回旧行为，有人贴过就不碰', () => {
  assert.equal(reactTargets([disc('2026/09/14/x/', ['某位读者'])], 3, '').length, 0)
  assert.equal(reactTargets([disc('2026/09/14/x/', [])], 3, '').length, 1)
})

check('只挑文章页，分类页和资讯页不贴', () => {
  const ds = [disc('2026/09/14/x/'), disc('news/2026-09-16/'), disc('categories/life/')]
  assert.deepEqual(reactTargets(ds, 9, 'nanaly-bot').map(d => d.title), ['2026/09/14/x/'])
})

check('尊重上限，也不会被空列表噎住', () => {
  const ds = [disc('2026/09/01/a/'), disc('2026/09/02/b/'), disc('2026/09/03/c/')]
  assert.equal(reactTargets(ds, 2, 'nanaly-bot').length, 2)
  assert.deepEqual(reactTargets(null, 3, 'nanaly-bot'), [])
})

console.log(`\n${pass} 项通过`)
