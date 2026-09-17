'use strict'

/**
 * 板块文章列表标签：{% section_posts 分类名 %}
 *
 * 按分类名筛文章、渲染成卡片网格。分类用的是层级写法
 * （front-matter 里 `- [课外, GAMES101]`），Hexo 会把「课外」和「GAMES101」
 * 都算进这篇文章的分类，所以这里按叶子名精确匹配就够了。
 *
 * 上锁相关的逻辑全部搬去了 scripts/noimpty-lockdown.js，这个文件只管排版。
 */

const toArray = collection => {
  if (!collection) return []
  if (Array.isArray(collection)) return collection
  if (typeof collection.toArray === 'function') return collection.toArray()
  if (Array.isArray(collection.data)) return collection.data
  return []
}

const taxonomyNames = collection => toArray(collection).map(item => String(item.name || item))

const escapeHtml = value => String(value == null ? '' : value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')

const withRoot = value => {
  const root = hexo.config.root || '/'
  const base = root.endsWith('/') ? root : `${root}/`
  return `${base}${String(value || '').replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/')
}

const normalizeWebPath = value => {
  let path = withRoot(value)
  path = path.replace(/index\.html$/, '').replace(/\.html$/, '/')
  if (!path.endsWith('/')) path += '/'
  return path.replace(/\/{2,}/g, '/')
}

/* 空状态的措辞：说清楚这一栏收什么、什么时候会有第一篇，
 * 而不是一句「暂无内容」。有意为之的留白不减分，看起来没做完的页面才减分。
 * 课内那两门都还没开始学，所以它们的空状态是常态，得写得像回事。 */
const EMPTY_STATE = {
  GAMES101: {
    title: '这里暂时是空的',
    body: 'GAMES101 的课程笔记与作业复盘会落在这一栏。'
  },
  'UE5-Looman': {
    title: '这里暂时是空的',
    body: 'Tom Looman 那门课的章节复盘与作业复盘会落在这一栏。'
  },
  Linux入门: {
    title: '还没开始这门课',
    body: 'AI Infra 第一门。后面几门全都在命令行里发生，所以它排最前。第一篇多半是删错文件或者权限报错的记录。'
  },
  Linux深入: {
    title: '还没开始这块',
    body: '入门学完再往下：系统调用、进程与内存、性能排查这一层。先把入门的坑踩完，再回头看这里为什么这么设计。'
  },
  Docker: {
    title: '还没开始这门课',
    body: '容器化是把服务从「装在我的机器上」变成「装在镜像里」的第一步，AI Infra 部署绕不开它，具体教材还没定。'
  },
  'Transformer 推理机制': {
    title: '还没开始这块',
    body: '目标是搞懂推理时到底在算什么 —— attention 的计算量、KV cache、批处理和量化怎么影响速度，而不是停在调 API 的层面。'
  },
  Python: {
    title: '还没开始这门课',
    body: '前面几门课的小工具、AI Infra 相关的脚本大多会用 Python 写，重点预计会落在标准库和常用第三方库的使用习惯上。'
  },
  Git: {
    title: '还没开始这门课',
    body: '这个博客本身就是个 Git 仓库，还有几个定时任务会自动往里提交 —— 冲突和「东西没了」是常态。第一篇大概率就来自这里。'
  },
  Go: {
    title: '还没开始这门课',
    body: '排在工具之后。写过 C++ 再学它，卡住的地方不会是语法，而是接口和 goroutine 那两章。'
  },
  MySQL: {
    title: '还没开始这门课',
    body: '放最后一门 —— 脱开具体的服务去背 SQL 语法学完就忘，有了 Go 之后才有地方把查询用起来。'
  },
  DSA: {
    title: '还没开始这门课',
    body: '课内第一门，也是后面三门的前置 —— 它们的 Lab 全是 C/C++ 写的。第一篇大概率是递归或者链表的踩坑记录。'
  },
  CSAPP: {
    title: '还没开始这门课',
    body: '排在算法之后。这门课的正文其实是那七个 Lab，所以第一篇会是 Data Lab 的复盘。'
  },
  Life: {
    title: '这里暂时是空的',
    body: '日常琐事、偶尔的感受，还有娜娜莉自己写的随笔。'
  }
}

/* ---------------- 每一栏实际有几篇 ----------------
 *
 * 这个数字以前是**手写**的，而且同一份事实在四个地方各写了一遍：
 * hub 卡片的 stat 行、track 页的「进度」、noimpty-ai.js 的 PERSONA、
 * 还有 noimpty-profile.md。发一篇文章要记得同步四处，漏了不报错、
 * 构建全绿、测试也全过 —— 只有人去看页面才会发现。
 *
 * 真出过事：2026-08-28 发 DSA 开篇那次，首页卡片还写着「还没开始」，
 * 而娜娜莉的人设里硬编码着「AI Infra 一栏一篇都没有」，
 * 她当面否认了刚发布的文章，Linux 第一章也被否认了好几周。
 *
 * 所以数字这部分交给构建时现数。**语义那部分不动** ——
 * 「递归」「第三章已完成」「告一段落」是他学到哪了，数不出来，还得手写。
 */

const statsOf = section => {
  const posts = toArray(hexo.locals.get('posts'))
    .filter(post => taxonomyNames(post.categories).includes(String(section || '').trim()))
    .sort((left, right) => Number(right.date || 0) - Number(left.date || 0))
  const latest = posts[0]
  return {
    n: posts.length,
    latest: latest && latest.date && typeof latest.date.format === 'function'
      ? latest.date.format('MM-DD') : ''
  }
}

/* {% section_stat 分类 %} —— hub 卡片上那一行，短。
 *
 * 分隔符用 | 不用空格：叶子名里本来就有空格（「Transformer 推理机制」）。
 *   {% section_stat Git %}                        → 已写 2 篇
 *   {% section_stat 入门=Linux入门|深入=Linux深入 %}  → 入门 3 篇 · 深入还没开始
 *   {% section_stat GAMES101|UE5-Looman %}         → 已写 16 篇（不带标签就是求和）
 */
hexo.extend.tag.register('section_stat', args => {
  const parts = args.join(' ').split('|').map(x => x.trim()).filter(Boolean)
  const labeled = parts.some(p => p.includes('='))

  if (!labeled) {
    const n = parts.reduce((sum, leaf) => sum + statsOf(leaf).n, 0)
    return escapeHtml(n ? `已写 ${n} 篇` : '还没开始')
  }
  return escapeHtml(parts.map(part => {
    const i = part.indexOf('=')
    const label = i > -1 ? part.slice(0, i).trim() : ''
    const leaf = i > -1 ? part.slice(i + 1).trim() : part
    const { n } = statsOf(leaf)
    if (!n) return label ? `${label}还没开始` : '还没开始'
    return label ? `${label} ${n} 篇` : `已写 ${n} 篇`
  }).join(' · '))
})

/* {% section_progress 分类 %} —— track 页「进度」那一格，可以长一点。
 * 前面的语义照旧手写：<span>递归 · {% section_progress DSA %}</span> */
hexo.extend.tag.register('section_progress', args => {
  const { n, latest } = statsOf(args.join(' '))
  if (!n) return '还没开始'
  return escapeHtml(`已写 ${n} 篇${latest ? `，最近一篇 ${latest}` : ''}`)
})

hexo.extend.tag.register('section_posts', args => {
  const section = args.join(' ').trim()
  const posts = toArray(hexo.locals.get('posts'))
    .filter(post => taxonomyNames(post.categories).includes(section))
    .sort((left, right) => Number(right.date || 0) - Number(left.date || 0))

  if (posts.length === 0) {
    const msg = EMPTY_STATE[section] || { title: '这里暂时是空的', body: '这个板块还没有收录文章。' }
    return `<div class="noimpty-empty-state"><span class="noimpty-empty-state__icon" aria-hidden="true">✦</span><h3>${escapeHtml(msg.title)}</h3><p>${escapeHtml(msg.body)}</p></div>`
  }

  const cards = posts.map(post => {
    const title = escapeHtml(post.title || '未命名文章')
    const href = normalizeWebPath(post.path)
    const cover = post.cover ? withRoot(post.cover) : '/img/cover-blue.svg'
    const date = post.date && typeof post.date.format === 'function' ? post.date.format('YYYY-MM-DD') : ''
    const description = escapeHtml(post.description || '')

    return `<article class="noimpty-post-card">
      <a class="noimpty-post-card__cover" href="${escapeHtml(href)}" style="background-image:url('${escapeHtml(cover)}')" aria-label="阅读：${title}"></a>
      <div class="noimpty-post-card__body">
        <div class="noimpty-post-card__meta"><time>${escapeHtml(date)}</time></div>
        <h3><a href="${escapeHtml(href)}">${title}</a></h3>
        ${description ? `<p class="noimpty-post-card__description">${description}</p>` : ''}
      </div>
    </article>`
  }).join('')

  return `<div class="noimpty-post-grid" data-section="${escapeHtml(section)}">${cards}</div>`
})
