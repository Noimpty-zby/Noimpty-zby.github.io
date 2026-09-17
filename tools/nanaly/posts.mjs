// 仓库里到底有哪些文章 —— 后端所有「数文章」的地方共用这一份。
//
// 之前这套解析在 news.mjs 里有一份（给 profile 附真实清单用），
// 日程的自动完成又要一份（判「某一栏多了一篇」）。两份各写各的，
// 下次只会有一份被修 —— 这个仓库里已经因为这种事栽过好几次了。
//
// 两条规矩必须和 Hexo 的收录规则一致，否则会出现
// 「站上说还没开始、娜娜莉说已有一篇」这种自相矛盾：
//   1. _config.yml 里 future: false —— 日期还没到的文章 Hexo 压根不生成
//   2. Hexo 忽略 _ 和 . 开头的文件（草稿的惯用写法）

import { readFileSync, readdirSync } from 'node:fs'

export const POSTS_DIR = 'source/_posts'

/* categories 有两种写法，语义不一样（Hexo 的规矩）：
 *   - [课外, AI Infra, Git]     一行 = 一条完整的层级路径，叶子是 Git
 *   - Life
 *     - 娜娜莉                   多行纯量 = 一条路径的各层，叶子是「娜娜莉」
 * 她自己的随笔用的是后一种（见 column.mjs 生成的 front-matter）。 */
export const leafOf = raw => {
  const block = String(raw).match(/^categories:\s*\n((?:[ \t]+-.*\n)+)/m)
  if (!block) return ''
  const items = block[1].split('\n').map(l => l.trim()).filter(Boolean)
  const first = items[0].match(/^-\s*\[(.+)\]\s*$/)
  return first
    ? (first[1].split(',').map(x => x.trim()).filter(Boolean).pop() || '')
    : items[items.length - 1].replace(/^-\s*/, '').trim()
}

const field = (raw, k) => {
  const m = String(raw).match(new RegExp(`^${k}:\\s*(.+)$`, 'm'))
  return m ? m[1].trim().replace(/^['"]|['"]$/g, '') : ''
}

/**
 * @param {string} dir 文章目录，默认 source/_posts
 * @param {number} now 用来判「日期到了没有」，测试可以钉死
 * @returns {{file,title,date,leaf,author}[]} 按日期升序
 */
export const listPosts = (dir = POSTS_DIR, now = Date.now()) => {
  let files = []
  try {
    files = readdirSync(dir).filter(f => f.endsWith('.md') && !/^[_.]/.test(f))
  } catch (_) { return [] }

  return files.map(f => {
    let raw
    try { raw = readFileSync(`${dir}/${f}`, 'utf8') } catch (_) { return null }
    const date = field(raw, 'date')
    return {
      file: `${dir}/${f}`,
      title: field(raw, 'title') || f.replace(/\.md$/, ''),
      date,                       // 原样的 YYYY-MM-DD HH:mm:ss（北京挂钟）
      day: date.slice(0, 10),     // 只要日期那一截，和日程的日期键同格式
      leaf: leafOf(raw),
      author: field(raw, 'author')
    }
  })
    .filter(Boolean)
    .filter(p => !p.date || Date.parse(p.date.replace(' ', 'T')) <= now)   // future: false
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
}

/** 按分类叶子统计：叶子名 → { n, latest } */
export const countByLeaf = (posts = listPosts()) => {
  const out = new Map()
  posts.forEach(p => {
    if (!p.leaf) return
    const cur = out.get(p.leaf) || { n: 0, latest: '' }
    out.set(p.leaf, { n: cur.n + 1, latest: p.day > cur.latest ? p.day : cur.latest })
  })
  return out
}
