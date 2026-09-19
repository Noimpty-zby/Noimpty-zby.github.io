/* 「哪一栏有几篇」必须是数出来的，不许手写。
 *
 * 这个数字以前在四个地方各写了一遍：hub 卡片的 stat 行、track 页的「进度」、
 * noimpty-ai.js 的 PERSONA、noimpty-profile.md。发一篇文章要记得同步四处，
 * 漏了**不报错、构建全绿、测试也全过** —— 只有人去看页面才会发现。
 *
 * 真出过事：2026-08-28 发 DSA 开篇那次，首页卡片还写着「还没开始」，
 * 而娜娜莉的人设里硬编码着「AI Infra 一栏一篇都没有」，她当面否认了刚发布的
 * 文章，Linux 第一章也被否认了好几周。
 *
 * 所以这个文件盯的是：**页面里不许再出现写死的篇数**。
 * 语义那半（「递归」「第三章已完成」「告一段落」）照旧手写，不在管辖范围内。
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { postCounts, postSummary } from '../nanaly/news.mjs'

let pass = 0
const check = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++ }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + (e.message || e)); process.exitCode = 1 }
}

const walk = dir => {
  let out = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out = out.concat(walk(p))
    else if (e === 'index.md') out.push(p)
  }
  return out
}
const pages = [...walk('source/in-class'), ...walk('source/extra')]
  .map(f => ({ f, raw: readFileSync(f, 'utf8') }))

console.log('\n栏目篇数 · 页面里不许写死')

check('★★ hub 卡片上那一行篇数，全部来自 {% section_stat %}', () => {
  const bad = []
  for (const { f, raw } of pages) {
    for (const m of raw.matchAll(/<span class="noimpty-track-card__stat">(.*?)<\/span>/g)) {
      if (!m[1].includes('{% section_stat')) bad.push(`${f} → ${m[1]}`)
    }
  }
  assert.deepEqual(bad, [], '这几张卡片的篇数还是手写的：\n      ' + bad.join('\n      '))
})

check('★★ track 页「进度」里的篇数，全部来自 {% section_progress %}', () => {
  const bad = []
  for (const { f, raw } of pages) {
    for (const m of raw.matchAll(/<b>进度<\/b><span>(.*?)<\/span>/g)) {
      if (!m[1].includes('{% section_progress')) bad.push(`${f} → ${m[1]}`)
    }
  }
  assert.deepEqual(bad, [], '这几页的进度还是手写的：\n      ' + bad.join('\n      '))
})

check('★ 每个 track 页都有进度那一格（别整个删掉来糊弄上面两条）', () => {
  const tracks = pages.filter(p => /^type:\s*noimpty-track/m.test(p.raw))
  assert.ok(tracks.length >= 10, `只找到 ${tracks.length} 个 track 页，是不是路径变了`)
  const missing = tracks.filter(p => !/<b>进度<\/b>/.test(p.raw)).map(p => p.f)
  assert.deepEqual(missing, [])
})

console.log('\n栏目篇数 · 数得对不对')

check('★★ 数出来的和仓库里真实的文章数一致', () => {
  const counts = postCounts()
  const total = [...counts.values()].reduce((s, v) => s + v.n, 0)
  const files = readdirSync('source/_posts').filter(f => f.endsWith('.md')).length
  assert.equal(total, files, `数出 ${total} 篇，但 source/_posts 里有 ${files} 个 md`)
})

check('★★ 两种 categories 写法都要认，而且叶子取对', () => {
  // 一行数组 = 一条完整路径，叶子是最后一个
  // 多行纯量 = 一条路径的各层，叶子是最后一行（她的随笔就是这种）
  const counts = postCounts()
  assert.ok(counts.has('DSA'), '没认出 `- [课内, DSA]` 这种写法')
  assert.ok(counts.has('娜娜莉'),
    '没认出 `- Life` + `- 娜娜莉` 这种写法 —— 她那几篇随笔会被错算进 Life')
  assert.ok(!counts.has('课内') && !counts.has('课外'), '把中间层当成叶子了')
})

check('★ 摘要里要写明「和手写那段冲突时以这份为准」', () => {
  const s = postSummary()
  assert.match(s, /以这一份为准/, 'profile 手写那段过期时，没有东西告诉她该信哪个')
  assert.match(s, /一共 \d+ 篇/)
})

check('★★ 跟 Hexo 收录规则保持一致：未来日期的、下划线开头的都不算', () => {
  /* 两条都是实测撞出来的（2026-09-17 塞临时文章验证时）：
   *   _config.yml 里 future: false —— 日期没到的文章 Hexo 压根不生成
   *   Hexo 忽略 _ 和 . 开头的文件 —— 那是草稿的惯用写法
   * 不跟着这两条走的话，会出现「站上写着『Go 还没开始』，
   * 娜娜莉却说『Go 已有 1 篇』」，而且只在他提前写好排了未来日期时才出现。 */
  const dir = 'tools/tests/fixtures/posts-edge'
  const counts = postCounts(dir)
  assert.ok(!counts.has('未来'), '日期还没到的文章被算进去了')
  assert.ok(!counts.has('草稿'), '下划线开头的文件被算进去了')
  assert.equal(counts.get('正常')?.n, 1, '正常的那篇反而没数到')
})

check('★★ 「日期到了没有」按北京挂钟算，不按跑测试那台机器的时区', () => {
  /* 2026-09-19 就是栽在这一条上：本地（UTC+8）全绿，CI（UTC）红。
   * 当天 14:46 发的文章，在 UTC 机器上被 Date.parse 读成 14:46Z，
   * 而那会儿 CI 的钟是 07:05Z —— 于是这篇被当成「未来」滤掉，
   * 数出来比 source/_posts 里少一篇，上面那条断言直接炸。
   * Hexo 自己按 _config.yml 的 timezone: 'Asia/Shanghai' 算，它是照常生成的。 */
  const dir = 'tools/tests/fixtures/posts-tz'          // 里面那篇是 2026-09-19 14:46:00
  const 北京十五点 = Date.parse('2026-09-19T07:00:00Z')
  const 北京十四点 = Date.parse('2026-09-19T06:00:00Z')

  /* 把测试自己搬到 CI 的时区上跑 —— 否则这条在 UTC+8 的开发机上永远是绿的，
   * 而它要拦的恰恰是「只在 UTC 上红」。Node 支持运行时改 TZ。 */
  const tz = process.env.TZ
  try {
    for (const z of ['UTC', 'Asia/Shanghai', 'America/New_York']) {
      process.env.TZ = z
      assert.equal(postCounts(dir, 北京十五点).get('时区')?.n, 1,
        `TZ=${z} 时，当天下午发的文章被当成未来滤掉了 —— 多半是哪里又用回了 Date.parse`)
      assert.equal(postCounts(dir, 北京十四点).size, 0,
        `TZ=${z} 时，时间真没到的文章反而算进去了`)
    }
  } finally {
    if (tz == null) delete process.env.TZ; else process.env.TZ = tz
  }
})

check('空的也不炸', () => {
  const c = postCounts('source/_data')   // 里面没有 md
  assert.equal(c.size, 0)
  assert.equal(postSummary(c), '')
})

console.log('\n栏目篇数 · 娜娜莉的人设里也不许写死')

check('★★ PERSONA 不再硬编码篇数和「哪几栏是空的」', () => {
  const src = readFileSync('source/js/noimpty-ai.js', 'utf8')
  const p = src.slice(src.indexOf('const PERSONA = `'), src.indexOf('【被夸奖时】'))

  assert.ok(!/一共\s*[一二三四五六七八九十\d]+\s*篇/.test(p), 'PERSONA 里又写死了总篇数')
  assert.ok(!/确实一篇都没有/.test(p), 'PERSONA 里又写死了「哪几栏一篇都没有」')

  /* 真正会过期的是「把空栏目一个个点名」那种写法：
   *   其余栏目（CSAPP、Linux 深入、Go、MySQL、Docker、Transformer 推理机制、Python）…
   * 所以判据是「同一行里点了三门以上课的名字」，而不是某个词。
   * 上面那句「清单里一篇都没有的栏目就说还没开始写」是**规则**，不点名，不该被拦。 */
  const NAMES = ['CSAPP', 'Go', 'MySQL', 'Docker', 'Python', 'Linux 深入', 'Transformer 推理机制']
  const bad = p.split('\n').filter(line => NAMES.filter(n => line.includes(n)).length >= 3)
  assert.deepEqual(bad, [], '这几行在挨个点名空栏目，发一篇就得回来改：\n      ' + bad.join('\n      '))

  assert.match(p, /完整清单/, '没告诉她清单在哪')
  assert.match(p, /凭记忆说/, '少了那条「不许凭记忆说他没写过」的硬规矩')
})

console.log(`\n${pass} 项通过`)
