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
 * 课内那四门都还没开始学，所以它们的空状态是常态，得写得像回事。 */
const EMPTY_STATE = {
  GAMES101: {
    title: '这里暂时是空的',
    body: 'GAMES101 的课程笔记与作业复盘会落在这一栏。'
  },
  'UE5-Looman': {
    title: '这里暂时是空的',
    body: 'Tom Looman 那门课的章节复盘与作业复盘会落在这一栏。'
  },
  'UE5-Ulibarri': {
    title: '还没开始这门课',
    body: '排在 Looman 那门之后。先把工程结构的地基打牢，再学战斗手感和表现层，顺序反过来会写出一堆 Tick 里的 if。'
  },
  DSA: {
    title: '还没开始这门课',
    body: '课内第一门，也是后面三门的前置 —— 它们的 Lab 全是 C/C++ 写的。第一篇大概率是递归或者链表的踩坑记录。'
  },
  CSAPP: {
    title: '还没开始这门课',
    body: '排在算法之后。这门课的正文其实是那七个 Lab，所以第一篇会是 Data Lab 的复盘。'
  },
  'NJU-OS': {
    title: '还没开始这门课',
    body: '要在 CSAPP 之后 —— 不理解虚拟内存和异常控制流，OS 的 Lab 只能照抄。'
  },
  CS144: {
    title: '还没开始这门课',
    body: '八个 checkpoint 从字节流一路写到 IP 路由器。和 OS 互不依赖，看那阵子有没有整块时间决定先做哪个。'
  },
  Life: {
    title: '这里暂时是空的',
    body: '日常琐事、偶尔的感受，还有娜娜莉自己写的随笔。'
  }
}

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
