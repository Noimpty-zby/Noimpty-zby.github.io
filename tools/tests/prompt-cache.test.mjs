/* 提示词的「可缓存前缀」。
 *
 * DeepSeek 按**前缀**命中缓存：两次请求从第一个不同的字符起，后面全部按
 * 未命中计费。所以提示词里固定的部分必须排在变量前面 —— 这条听着像常识，
 * 但四处提示词都踩了同一个坑：把标题、挂了几小时、主题名写在第一行。
 *
 * 2026-09-16 实测（拦下 fetch、用真实仓库数据跑一轮量出来的）：
 *
 *   资讯   每次 4,811 token，两次调用的公共前缀 54 token —— 可缓存 1%
 *          断在「你在给主人整理一份「岗位与行业动态」的简报」，
 *          而它后面紧跟着 865 token 的 profile，四个主题一模一样
 *   回评   每次 4,089 token，公共前缀 154 —— 可缓存 4%
 *          断在「已经 26 小时没人回了」那个数字上，
 *          后面是 3,950 token 的文章正文，同一篇下的每条评论都重发一遍
 *   批注   每次约 1,000 token，公共前缀 77 —— 可缓存 8%，断在文章标题
 *
 * 这个文件守住「变量排最后」。断言写的是公共前缀的下界，
 * 谁把变量挪回前面，这里立刻变红。
 */
import assert from 'node:assert/strict'
import { reviewPrompt, draftPrompt } from '../daily-report/narrate.mjs'
import { notePrompt } from '../nanaly/notes.mjs'
import { replyPrompt } from '../nanaly/reply.mjs'
import { patrolPrompt } from '../nanaly/patrol.mjs'
import { newsSystem, newsPrompt, TOPICS } from '../nanaly/news.mjs'

let pass = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

const prefix = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i }
const where = (a, n) => JSON.stringify(a.slice(Math.max(0, n - 20), n + 30)).slice(1, -1)

console.log('\n提示词 · 可缓存前缀')

check('★★ 资讯：四个主题共用一份系统提示，profile 不许被主题名踩脏', () => {
  const profile = '（这里是主人的情况，实际约 1,800 字）'.repeat(20)
  const sys = newsSystem(profile)
  assert.ok(sys.includes(profile), 'profile 不在系统提示里了')
  TOPICS.forEach(t => assert.ok(!sys.includes(t.title),
    `系统提示里出现了主题名「${t.title}」—— 它排在 profile 前面就会把整份 profile 踩脏`))
  // 两个不同主题的完整请求，公共前缀必须整个覆盖系统提示
  const a = sys + '\n' + newsPrompt(TOPICS[0], '素材 A')
  const b = sys + '\n' + newsPrompt(TOPICS[1], '素材 B')
  assert.ok(prefix(a, b) >= sys.length,
    `公共前缀只有 ${prefix(a, b)} 字符，没覆盖住 ${sys.length} 字符的系统提示 —— 断在：${where(a, prefix(a, b))}`)
})

check('★★ 回评：同一篇文章下的两条评论，公共前缀必须盖住整篇正文', () => {
  const article = '（正文）'.repeat(2000)
  const base = { title: '2026/09/14/x/', article }
  const a = replyPrompt({ ...base, ageHours: 26, who: '读者甲', body: '这一段没懂' })
  const b = replyPrompt({ ...base, ageHours: 9, who: '读者乙', body: '第三节是不是写反了' })
  assert.ok(prefix(a, b) > article.length,
    `公共前缀 ${prefix(a, b)} 字符，还没盖住 ${article.length} 字符的正文 —— 断在：${where(a, prefix(a, b))}`)
})

check('★ 批注：两篇文章之间，整块格式要求都要落在公共前缀里', () => {
  const a = notePrompt('第一篇的标题', '[0] 段落甲')
  const b = notePrompt('第二篇的标题', '[0] 段落乙')
  assert.ok(prefix(a, b) >= 300, `公共前缀只有 ${prefix(a, b)} 字符 —— 断在：${where(a, prefix(a, b))}`)
  assert.ok(a.includes('第一篇的标题'), '标题不见了')
})

check('★ 读后反馈：两篇文章之间，要求那一段要落在公共前缀里', () => {
  const p = (title, body) => reviewPrompt({ title, series: '某系列', body })
  assert.ok(prefix(p('甲', '正文一'), p('乙', '正文二')) >= 150)
})

check('巡逻：两篇之间，硬性约束那一整段要落在公共前缀里', () => {
  const a = patrolPrompt('甲文', '- 链接 /a/ 返回 404')
  const b = patrolPrompt('乙文', '- 图片 /b.png 返回 404')
  assert.ok(prefix(a, b) >= 250, `公共前缀只有 ${prefix(a, b)} 字符 —— 断在：${where(a, prefix(a, b))}`)
  assert.ok(a.includes('下面清单'), '约束里还写着「上面清单」，但清单已经挪到下面了')
})

check('回评草稿：两条留言之间，要求那一段要落在公共前缀里', () => {
  const p = (on, body) => draftPrompt({ on, who: '读者', body })
  assert.ok(prefix(p('2026/09/14/a/', '问题一'), p('2026/09/13/b/', '问题二')) >= 200)
})

console.log('\n提示词 · 内容没在搬家时搬丢')

check('每个提示词都还带着它该带的东西', () => {
  assert.match(notePrompt('标题X', '段落Y'), /标题X[\s\S]*段落Y/)
  assert.match(replyPrompt({ title: 'T', ageHours: 5, who: 'W', body: 'B', article: 'A' }), /A[\s\S]*T[\s\S]*W[\s\S]*B/)
  assert.match(patrolPrompt('标题X', '- 坏了'), /标题X[\s\S]*- 坏了/)
  assert.match(newsPrompt(TOPICS[0], '素材Z'), /素材Z/)
  assert.ok(newsPrompt(TOPICS[0], 'x').includes(TOPICS[0].title), '主题名整个丢了')
})

check('★ 正文没取到时，回评仍然给出那句「只能就事论事」的兜底', () => {
  assert.match(replyPrompt({ title: 'T', ageHours: 5, who: 'W', body: 'B', article: '' }), /正文没取到/)
})

console.log(`\n${pass} 项通过`)
