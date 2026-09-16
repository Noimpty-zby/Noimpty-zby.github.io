/* 她和 GitHub 打交道的两件事：拉评论的窗口，和提交之后叫部署。
 *
 * 一、评论窗口。
 *   拉讨论时用的是 comments(first:50) —— 取的是**最旧**的 50 条。
 *   任何一篇文章的评论一过 50，新来的评论对回评和巡逻就彻底隐身：
 *   她不再接手任何新问题，同时她自己留的判重标记也被挤出视野，
 *   于是开始一遍遍重复念叨同一件事。
 *   同一个坑在 replies 那一层已经踩过一次并改成了 last，上一层当时漏了；
 *   日报那边 sources.mjs 用的一直是 last:30。
 *
 * 二、触发部署。
 *   用 GITHUB_TOKEN 推的提交不会触发 on:push，所以每次提交完都要显式派发一次。
 *   这一步以前失败了只打一行日志 —— 那等于「文件进了仓库、线上看不见」，
 *   而工作流全绿。pushWithRetry 当年就是为了同一个理由改成抛异常的。
 */
import assert from 'node:assert/strict'

let pass = 0
const check = async (name, fn) => {
  try { await fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

// REPO_TOKEN 是 import 时读的，得先放好
process.env.GITHUB_TOKEN = 'test-token'
process.env.GITHUB_REPOSITORY = 'Noimpty-zby/Noimpty-zby.github.io'
const { listDiscussions, triggerDeploy } = await import('../nanaly/github.mjs')

const realFetch = globalThis.fetch
let calls = []
const stub = fn => { calls = []; globalThis.fetch = async (url, init) => { calls.push({ url, init }); return fn(url, init) } }

console.log('\nGitHub · 拉评论的窗口')

await check('★★ 取最新的 50 条评论，不是最旧的 50 条', async () => {
  stub(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: { repository: { discussions: { nodes: [] } } } })
  }))
  await listDiscussions()
  const q = JSON.parse(calls[0].init.body).query
  assert.match(q, /comments\(last:\s*50\)/, 'comments 还是 first: —— 评论一过 50 条她就瞎了')
  assert.doesNotMatch(q, /comments\(first:/)
})

await check('回复那一层照旧是 last（这条以前修过，别又改回去）', async () => {
  stub(async () => ({ ok: true, status: 200, json: async () => ({ data: { repository: { discussions: { nodes: [] } } } }) }))
  await listDiscussions()
  assert.match(JSON.parse(calls[0].init.body).query, /replies\(last:\s*20\)/)
})

console.log('\nGitHub · 提交之后叫部署')

await check('派发成功（204）→ true', async () => {
  stub(async () => ({ status: 204, text: async () => '' }))
  assert.equal(await triggerDeploy(), true)
  assert.match(calls[0].url, /actions\/workflows\/pages\.yml\/dispatches$/)
})

await check('★★ 派发失败必须抛，不能只打一行日志然后返回 false', async () => {
  stub(async () => ({ status: 404, text: async () => 'Not Found' }))
  await assert.rejects(() => triggerDeploy(), e => {
    assert.match(e.message, /没能触发站点部署/)
    assert.match(e.message, /404/)
    assert.match(e.message, /pages\.yml/, '报错里没告诉人怎么补救')
    return true
  })
})

await check('网络直接抛也要变成同一种错误', async () => {
  stub(async () => { throw new Error('fetch failed') })
  await assert.rejects(() => triggerDeploy(), /没能触发站点部署/)
})

await check('★ 没有 GITHUB_TOKEN 时返回 false、不抛 —— 那是本地手跑，推送自己会触发部署', async () => {
  const saved = process.env.GITHUB_TOKEN
  delete process.env.GITHUB_TOKEN
  stub(async () => { throw new Error('不该发请求') })
  try {
    assert.equal(await triggerDeploy(), false)
    assert.equal(calls.length, 0)
  } finally { process.env.GITHUB_TOKEN = saved }
})

globalThis.fetch = realFetch
console.log(`\n${pass} 项通过`)
