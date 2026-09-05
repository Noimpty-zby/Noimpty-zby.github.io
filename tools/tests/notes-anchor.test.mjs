/* 批注锚点必须和渲染出来的正文对得上。
 *
 * 为什么需要它：`anchorOf` 原来把 `_` 和 `*` `` ` `` `~` 一起当成 markdown
 * 强调符号剥掉，于是 `ACTIONROGUELIKE_API` 变成了 `ACTIONROGUELIKEAPI` ——
 * 而页面上那个下划线好好地留着。锚点从此对不上，
 * scripts/noimpty-nanaly-notes.js 按「宁可少一条也不贴错」的原则默默跳过，
 * 那条批注就永远不出现了。
 *
 * 全绿：模型正常返回、批注正常写进 nanaly-notes.json、正常提交、构建成功，
 * 只有那一条在页面上不见了。60 条里丢了 1 条，没人会发现。
 *
 * 判据是 CommonMark 本来的规则：词内下划线不是强调，`snake_case` 是字面量。
 * 这个博客里有两百多个带下划线的标识符，却一处都没用过 `_斜体_`。
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { anchorOf } from '../nanaly/notes.mjs'

let pass = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

console.log('\n锚点提取 · 该剥的和不该剥的')

check('★★ 标识符里的下划线要留着', () => {
  assert.ok(anchorOf('`ACTIONROGUELIKE_API` 是 UBT 自动生成的宏').includes('ACTIONROGUELIKE_API'),
    '下划线被剥掉了 —— 页面上它还在，锚点会对不上')
  assert.ok(anchorOf('**BP_PlayerCharacter** 挂在关卡里').includes('BP_PlayerCharacter'))
  assert.ok(anchorOf('UE_KINDA_SMALL_NUMBER 的默认容差').includes('UE_KINDA_SMALL_NUMBER'))
})

check('★★ 反引号、星号、波浪号照旧要剥', () => {
  assert.equal(anchorOf('`man -k` 是按关键词搜'), 'man -k 是按关键词搜')
  assert.equal(anchorOf('**加粗**的一段话'), '加粗的一段话')
  assert.equal(anchorOf('~~划掉~~的一段话'), '划掉的一段话')
})

check('链接只留可见的文字', () => {
  assert.equal(anchorOf('见 [第一章](/2026/08/25/x/) 那张图'), '见 第一章 那张图')
})

check('最多截 30 个字符', () => {
  assert.ok(anchorOf('啊'.repeat(100)).length <= 30)
})

console.log('\n已存的批注 · 锚点都还能在原文里找到落点')

/* 数据层的兜底：库里每一条锚点，都必须是它那篇文章里某个段落的开头。
 * 这条不依赖构建产物，所以能在 npm test 里跑（部署时 test 在 build 之前）。 */
const store = JSON.parse(readFileSync('source/_data/nanaly-notes.json', 'utf8'))
const bySlug = new Map()
for (const f of readdirSync('source/_posts').filter(f => f.endsWith('.md'))) {
  bySlug.set(f.replace(/\.md$/, ''), readFileSync(`source/_posts/${f}`, 'utf8'))
}

/* 两边都要化到同一种形态才能比：锚点是「剥过记号」的，正文还没剥。
 * 所以对正文做和 anchorOf 一样的处理 —— 注意同样不能碰下划线。 */
const norm = s => String(s)
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/[*`~]/g, '')
  .replace(/\s+/g, ' ')
  .trim()

let checked = 0
const orphan = []
for (const [path, entry] of Object.entries(store)) {
  const slug = path.replace(/\/$/, '').split('/').pop()
  const raw = bySlug.get(slug)
  if (!raw) continue          // 文章没了，交给 pruneOrphans 管，不是这里的事
  const body = norm(raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, ''))
  for (const n of entry.notes || []) {
    checked++
    const a = norm(n.anchor)
    if (a.length >= 6 && !body.includes(a)) orphan.push(`${slug}: ${a.slice(0, 30)}`)
  }
}

check(`★★ ${checked} 条锚点都能在正文里找到`, () => {
  assert.deepEqual(orphan, [], '这些锚点在原文里找不到落点，页面上那条批注不会出现：\n      ' + orphan.join('\n      '))
})

console.log(`\n${pass} 项通过`)
