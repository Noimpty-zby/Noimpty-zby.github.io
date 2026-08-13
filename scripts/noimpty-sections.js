'use strict'

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

const sectionOf = item => {
  if (item.private_section) return String(item.private_section).toLowerCase()
  const categories = taxonomyNames(item.categories).map(name => name.toLowerCase())
  if (categories.includes('life')) return 'life'
  if (categories.includes('ideas')) return 'ideas'
  return 'ideas'
}

const protectedPosts = () => toArray(hexo.locals.get('posts'))
  .filter(post => String(post.privacy || '').toLowerCase() === 'protected')

hexo.extend.tag.register('section_posts', args => {
  const section = args.join(' ').trim()
  const posts = toArray(hexo.locals.get('posts'))
    .filter(post => taxonomyNames(post.categories).includes(section))
    .sort((left, right) => Number(right.date || 0) - Number(left.date || 0))

  if (posts.length === 0) {
    // 空状态措辞：说清楚这个板块收什么，而不是说「还没做好」。
    // 有意为之的留白不减分，看起来没做完的页面才减分。
    const messages = {
      Ideas: {
        title: '这里暂时是空的',
        body: 'Ideas 用来存放还没成形的想法、猜想和以后想试的方向。等第一条值得写下来的出现，它会落在这里。'
      },
      UE5: {
        title: '这里暂时是空的',
        body: 'UE5 的学习过程、功能实验与项目实践会记录在这一栏。'
      },
      '竞赛': {
        title: '这里暂时是空的',
        body: '比赛过程、方案整理、问题复盘与阶段总结会记录在这一栏。'
      }
    }
    const fallback = { title: '这里暂时是空的', body: '这个板块还没有收录文章。' }
    const msg = messages[section] || fallback
    return `<div class="noimpty-empty-state"><span class="noimpty-empty-state__icon" aria-hidden="true">✦</span><h3>${escapeHtml(msg.title)}</h3><p>${escapeHtml(msg.body)}</p></div>`
  }

  const cards = posts.map(post => {
    const title = escapeHtml(post.title || '未命名文章')
    const href = normalizeWebPath(post.path)
    const cover = post.cover ? withRoot(post.cover) : '/img/cover-blue.svg'
    const date = post.date && typeof post.date.format === 'function' ? post.date.format('YYYY-MM-DD') : ''
    const description = escapeHtml(post.description || '')
    const privateLabel = String(post.privacy || '').toLowerCase() === 'protected'
      ? '<span class="noimpty-post-card__privacy">Private</span>'
      : ''

    return `<article class="noimpty-post-card">
      <a class="noimpty-post-card__cover" href="${escapeHtml(href)}" style="background-image:url('${escapeHtml(cover)}')" aria-label="阅读：${title}"></a>
      <div class="noimpty-post-card__body">
        <div class="noimpty-post-card__meta"><time>${escapeHtml(date)}</time>${privateLabel}</div>
        <h3><a href="${escapeHtml(href)}">${title}</a></h3>
        ${description ? `<p class="noimpty-post-card__description">${description}</p>` : ''}
      </div>
    </article>`
  }).join('')

  return `<div class="noimpty-post-grid" data-section="${escapeHtml(section)}">${cards}</div>`
})

hexo.extend.generator.register('noimpty-privacy-manifest', locals => {
  const entries = new Map()
  const add = (path, section) => entries.set(normalizeWebPath(path), String(section || 'ideas').toLowerCase())

  // 板块落地页（/ideas/ 与 /life/）单独判断，不走下面这个通用循环。
  const SECTION_LANDING = new Set(['/ideas/', '/life/'])

  toArray(locals.posts)
    .concat(toArray(locals.pages))
    .filter(item => String(item.privacy || '').toLowerCase() === 'protected')
    .filter(item => !SECTION_LANDING.has(normalizeWebPath(item.path)))
    .forEach(item => add(item.path, sectionOf(item)))

  // 这两个板块无条件上锁。
  //
  // 早先的写法是「有文章才锁」，理由是别让访客输密码去看一个空页面。
  // 但主人的意思很明确：Ideas 就是不想开放，哪怕现在是空的 —— 空着也不该被人翻。
  // 而且「空的时候不锁、写了第一篇才突然上锁」这个行为本身就很怪。
  //
  // 想让某个板块重新公开，把对应那几行注释掉即可。
  const LOCKED_SECTIONS = ['ideas', 'life']

  LOCKED_SECTIONS.forEach(name => {
    add(`${name}/`, name)
    add(`categories/${name}/`, name)
    add(`tags/${name}/`, name)
  })

  const payload = {
    entries: Array.from(entries, ([path, section]) => ({ path, section }))
  }

  return {
    path: 'js/protected-manifest.js',
    data: `window.NOIMPTY_PRIVACY = Object.freeze(${JSON.stringify(payload)});\n`
  }
})

// 把加密文章从 RSS/Atom 里剔除，否则私密内容会经 feed 泄漏出去。
hexo.extend.filter.register('after_generate', async () => {
  const feedPath = hexo.config.feed && hexo.config.feed.path
  if (!feedPath) return
  const stream = hexo.route.get(feedPath)
  if (!stream) return

  let xml = ''
  for await (const chunk of stream) xml += chunk.toString()

  const protectedUrls = new Set(protectedPosts().map(post => encodeURI(normalizeWebPath(post.path))))
  if (protectedUrls.size === 0) return

  const root = String(hexo.config.url || '').replace(/\/$/, '')
  const isProtected = href => {
    try { return protectedUrls.has(new URL(href, root + '/').pathname) } catch (_) { return false }
  }

  const filtered = xml.replace(/<entry>[\s\S]*?<\/entry>/g, entry => {
    const m = entry.match(/<id>(.*?)<\/id>/) || entry.match(/<link[^>]*href="(.*?)"/)
    return m && isProtected(m[1]) ? '' : entry
  })

  hexo.route.set(feedPath, filtered)
})

hexo.extend.filter.register('after_generate', async () => {
  const searchPath = hexo.config.search && hexo.config.search.path
  const stream = searchPath && hexo.route.get(searchPath)
  if (!stream) return

  let xml = ''
  for await (const chunk of stream) xml += chunk.toString()

  const protectedUrls = new Set(protectedPosts().map(post => encodeURI(normalizeWebPath(post.path))))
  if (protectedUrls.size === 0) return

  const filtered = xml.replace(/<entry>[\s\S]*?<\/entry>/g, entry => {
    const match = entry.match(/<url>(.*?)<\/url>/)
    return match && protectedUrls.has(match[1]) ? '' : entry
  })

  hexo.route.set(searchPath, filtered)
})
