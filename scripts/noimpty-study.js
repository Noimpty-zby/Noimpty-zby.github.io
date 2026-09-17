'use strict'

/**
 * 学习总览的数据：每门课有哪些章节、写了几篇、最近一篇是什么时候。
 *
 * 为什么是**内联进页面**而不是生成一个 /schedule/study.json：
 * 这份数据里是一整串文章标题和课程清单，摊成一个可以直接 GET 的文件，
 * 就是又一个「不用打开页面就能知道这站上有什么」的口子 ——
 * 和当初把 /about/ 从白名单里收回去、以及娜娜莉的行动日志要加密，是同一条理由。
 * 内联在日程页里就没有这个问题：那一页本来就跟着全站一起上锁。
 *
 * 章节清单是从 track 页的「课程覆盖」那个列表里现解析的，不另外维护一份：
 *   <h3>课程覆盖</h3><ul><li><b>数组与切片</b> —— 两者的差别…</li>…
 * 解析不出来（哪天那一页换了写法）就当这门课没有章节清单 ——
 * 页面上只是少一个「共几章」的分母和「从课程铺任务」的按钮，不会坏。
 */

const fs = require('fs')
const path = require('path')

const toArray = c => {
  if (!c) return []
  if (Array.isArray(c)) return c
  if (typeof c.toArray === 'function') return c.toArray()
  if (Array.isArray(c.data)) return c.data
  return []
}

const webPath = v => {
  const root = hexo.config.root || '/'
  let p = `${root.endsWith('/') ? root : root + '/'}${String(v || '').replace(/^\/+/, '')}`
  p = p.replace(/index\.html$/, '').replace(/\.html$/, '/')
  if (!p.endsWith('/')) p += '/'
  return p.replace(/\/{2,}/g, '/')
}

/** 把一个 track 页的源码读出来。page.raw 拿不到就回落到文件系统。 */
const sourceOf = page => {
  if (page.raw) return page.raw
  try { return fs.readFileSync(path.join(hexo.source_dir, page.source), 'utf8') } catch (_) { return '' }
}

/* 章节清单：**按结构认，不按小标题认。**
 *
 * 这几页的小标题各写各的 —— 「课程覆盖」「Lab 清单（这门课的真正内容）」
 * 「预计会覆盖」。照标题去切的话，CSAPP 和 Docker 那两门永远解析出 0 章，
 * 而它们恰恰是最需要「从课程铺任务」的（一篇都还没写）。
 *
 * 结构是稳的：第一个由 <li><b>名字</b> 组成的 <ul>。 */
const chaptersOf = raw => {
  for (const m of String(raw).matchAll(/<ul>([\s\S]*?)<\/ul>/g)) {
    const items = [...m[1].matchAll(/<li>\s*<b>([^<]+)<\/b>/g)].map(x => x[1].trim()).filter(Boolean)
    if (items.length >= 3) return items      // 三条以下多半不是章节清单
  }
  return []
}

/** {% section_posts Go %} 里那个分类叶子名 */
const leafOf = raw => {
  const m = raw.match(/\{%\s*section_posts\s+(.+?)\s*%\}/)
  return m ? m[1].trim() : ''
}

const build = () => {
  const posts = toArray(hexo.locals.get('posts'))
    .map(p => ({
      title: String(p.title || '未命名'),
      url: webPath(p.path),
      day: p.date && typeof p.date.format === 'function' ? p.date.format('YYYY-MM-DD') : '',
      leaf: (() => {
        const names = toArray(p.categories).map(c => String(c.name || c))
        return names.length ? names[names.length - 1] : ''
      })()
    }))
    .filter(p => p.day)
    .sort((a, b) => a.day.localeCompare(b.day))

  const courses = toArray(hexo.locals.get('pages'))
    .filter(pg => String(pg.type || '') === 'noimpty-track')
    .map(pg => {
      const raw = sourceOf(pg)
      const leaf = leafOf(raw)
      if (!leaf) return null
      const mine = posts.filter(p => p.leaf === leaf)
      return {
        leaf,
        title: String(pg.title || leaf),
        url: webPath(pg.path),
        chapters: chaptersOf(raw),
        n: mine.length,
        latest: mine.length ? mine[mine.length - 1].day : '',
        posts: mine.map(p => ({ title: p.title, url: p.url, day: p.day }))
      }
    })
    .filter(Boolean)
    // 有文章的排前面，其次按章节数；一栏都没写的沉到后面
    .sort((a, b) => b.n - a.n || b.chapters.length - a.chapters.length)

  return { courses, posts: posts.map(p => ({ day: p.day, leaf: p.leaf, title: p.title, url: p.url })) }
}

hexo.extend.tag.register('study_data', () => {
  let json = '{"courses":[],"posts":[]}'
  try { json = JSON.stringify(build()) } catch (e) {
    hexo.log.warn('学习总览的数据没生成出来：' + e.message)
  }
  // </script> 只可能出现在文章标题里，但那一下就能把页面劈开
  return `<script>window.NOIMPTY_STUDY=${json.replace(/<\//g, '<\\/')}</script>`
})
