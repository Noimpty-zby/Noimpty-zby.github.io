'use strict'

/**
 * 全站上锁。
 *
 * 这个博客没有读者 —— 主人的原话。所以它从「一个公开的学习博客」
 * 改成了「一个只有他自己能看的记录本」，而托管方式没变：
 * 还是公开仓库 + GitHub Pages（免费版只能从公开仓库发布）。
 *
 * 这带来一个必须说清楚的边界：
 *
 *   这是**前端软锁**。文章正文仍然在 HTML 文件里。
 *   会按 F12、会看「查看源代码」、会直接 curl 的人，拿得到内容。
 *   它挡的是「路过的人」和「搜索引擎」，不是「有心的人」。
 *
 *   想要真正挡住，只有两条路（两条都不难，但都要改流程）：
 *     a) 构建时把正文 AES 加密，浏览器里凭暗号解密
 *     b) 仓库转私有 + 换 Cloudflare Pages / Vercel，靠平台鉴权
 *
 * 在软锁的前提下，这个文件负责把**所有不需要打开 HTML 就能拿到内容的口子**堵死。
 * 按危害从大到小：
 *
 *   1. search.xml —— 最大的一个。它按设计就是全站所有文章的**完整正文**，
 *      一个 GET 就全下来了，连翻页都不用。所以这里整体加密。
 *   2. atom.xml / sitemap.xml —— 主动把内容和 URL 清单推出去，和上锁方向相反。
 *      _config.yml 里已经注释掉了，这里再兜一道：就算有人打开也会被清空。
 *   3. robots.txt —— 明确拒绝所有爬虫。这一条挡不住恶意抓取，
 *      但能挡住 Google / Bing 把内容收进索引，那才是「被人搜到」的主要途径。
 *   4. 锁清单 —— 告诉前端哪些路径要弹暗号框。现在是「除了首页和关于，全部」。
 */

const crypto = require('crypto')

// ---------------- 小工具 ----------------

const toArray = collection => {
  if (!collection) return []
  if (Array.isArray(collection)) return collection
  if (typeof collection.toArray === 'function') return collection.toArray()
  if (Array.isArray(collection.data)) return collection.data
  return []
}

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

const readStream = async stream => {
  if (!stream) return null
  let out = ''
  for await (const chunk of stream) out += chunk.toString()
  return out
}

// ---------------- 配置 ----------------

/* 不上锁的路径。**只有首页一个。**
 *
 * 一度把 /about/ 也放在这里，理由是「自我介绍本来就是给人看的」。
 * 后来发现那一页写着「记录图形学、GAMES101 和 UE5 的学习过程」、
 * 「常见内容包括：GAMES101 与计算机图形学笔记 / UE5 的学习过程…」——
 * 比首页卡片上那几段被删掉的介绍漏得还多。一个把里面有什么逐条列出来的页面，
 * 放在锁外面就等于这整套上锁没有意义。
 *
 * 所以现在对外只剩首页：一张大图 + 三个英文单词 + 一句「这里是私人记录」。
 *
 * 想重新公开某一页，把它加回这个集合 —— 但加之前先想清楚那一页上写了什么。
 * tools/leakcheck.mjs 会盯着这里面的每一页。 */
const PUBLIC_PATHS = new Set(['/'])

/* 板块落地页 → 解锁框上显示的名字。
 * 只影响文案（「Private · 课外」），不影响能不能进。 */
const SECTION_LABEL = [
  ['/in-class/', '课内'],
  ['/extra/', '课外'],
  ['/life/', 'Life'],
  ['/studio/', '策划'],
  ['/news/', '资讯'],
  ['/schedule/', '日程'],
  ['/archives/', '归档'],
  ['/categories/', '分类'],
  ['/tags/', '标签']
]

const labelFor = path => {
  const hit = SECTION_LABEL.find(([prefix]) => path === prefix || path.startsWith(prefix))
  if (hit) return hit[1]
  const p = String(path)
  if (p.includes('/in-class/')) return '课内'
  if (p.includes('/extra/')) return '课外'
  if (p.includes('/life/')) return 'Life'
  return '内部'
}

// ---------------- 1. 锁清单 ----------------

hexo.extend.generator.register('noimpty-privacy-manifest', locals => {
  const entries = new Map()
  const add = path => {
    const p = normalizeWebPath(path)
    if (PUBLIC_PATHS.has(p)) return
    entries.set(p, labelFor(p))
  }

  // 全部文章 + 全部页面
  toArray(locals.posts).forEach(item => add(item.path))
  toArray(locals.pages).forEach(item => add(item.path))

  // 索引页。这些不是「页面」，是生成器产出的，locals.pages 里没有。
  ;['archives/', 'categories/', 'tags/'].forEach(add)

  // 按年/月归档、每个分类页、每个标签页 —— 「标签直连」走的就是这些
  toArray(locals.categories).forEach(c => c && c.path && add(c.path))
  toArray(locals.tags).forEach(t => t && t.path && add(t.path))
  const years = new Set()
  toArray(locals.posts).forEach(p => {
    if (!p.date || typeof p.date.format !== 'function') return
    years.add(p.date.format('YYYY'))
    add(`archives/${p.date.format('YYYY')}/`)
    add(`archives/${p.date.format('YYYY/MM')}/`)
  })

  /* 暗号的校验哈希从这里发出去，而不是写死在 privacy-gate.js 里。
   *
   * 写死会有一个很隐蔽的坑：暗号有**两个**用途 ——
   * 一是开门（前端比对哈希），二是解密 search.xml（构建时用它派生密钥）。
   * 两处各存一份的话，你改了 SITE_PASSPHRASE 而忘了改 privacy-gate.js 里的哈希，
   * 结果就是：门用旧暗号能开，但索引是新暗号加密的，搜索永远解不开，
   * 而且报错信息完全指不到这个原因上。
   *
   * 所以统一从 NOIMPTY_PASSPHRASE 派生。没配环境变量时回退到原来那个写死的哈希，
   * 保证本地随手 `npm run build` 一下站点仍然能正常上锁。 */
  const pass = process.env.NOIMPTY_PASSPHRASE || ''
  const FALLBACK_HASH = '5a1eee3bcf723aea5c87c85ee62696443505c86e9f0add455c85252d3412d591'
  const passHash = pass
    ? crypto.createHash('sha256').update(pass, 'utf8').digest('hex')
    : FALLBACK_HASH

  /* 防呆：暗号填错会把你自己锁在门外，而且**看不出来** ——
   * 站点照常构建、照常部署，只是你原来那个暗号突然不认了。
   * 所以这里对一下：环境变量派生出来的哈希和代码里的兜底值不一致时喊一声。
   *
   * 不做成报错，因为「换暗号」是完全合理的操作。
   * 换的时候把下面 FALLBACK_HASH 也同步改掉，这条提示就消失了。 */
  if (pass && passHash !== FALLBACK_HASH) {
    hexo.log.warn('⚠️ NOIMPTY_PASSPHRASE 派生出的哈希和代码里的兜底值对不上。')
    hexo.log.warn('   如果你**不是**有意在换暗号，那就是这个环境变量填错了 ——')
    hexo.log.warn('   照这样部署上去，你原来那个暗号会打不开自己的站。')
    hexo.log.warn(`   期望 ${FALLBACK_HASH.slice(0, 16)}…  实际 ${passHash.slice(0, 16)}…`)
    hexo.log.warn('   确实要换暗号的话，把 scripts/noimpty-lockdown.js 里的 FALLBACK_HASH 也改成新值。')
  }

  const payload = {
    entries: Array.from(entries, ([path, section]) => ({ path, section })),
    // 前端用它做兜底：清单没覆盖到的路径，只要不在白名单里也一律拦下。
    // 少一条漏一条，这种事不能靠「记得加」。
    publicPaths: Array.from(PUBLIC_PATHS),
    lockAllExceptPublic: true,
    passHash,
    // 前端据此提示：索引到底是加密了还是被清空了
    searchEncrypted: !!pass
  }

  return {
    path: 'js/protected-manifest.js',
    data: `window.NOIMPTY_PRIVACY = Object.freeze(${JSON.stringify(payload)});\n`
  }
})

// ---------------- 1.5 首页不列文章 ----------------

/* _config.yml 里把 index_generator.per_page 设成了 0，但那是「不分页」的意思，
 * 不是「不显示」—— hexo-generator-index 会把**全部**文章塞进一页。正好相反。
 *
 * 所以这里直接把首页这条路由顶掉，用同一套模板、但传一个空的文章列表。
 * scripts/ 里的生成器比 node_modules 里的晚跑，同名路径后写的赢，
 * 于是渲染出来的就是「大图 + 空列表」，三个板块入口由 section-hub.js 补上。
 *
 * 为什么不靠 CSS 或 JS 藏起来：藏起来的东西还在 HTML 里。
 * 首页是唯一一个不上锁的页面，它的源码等于对全世界公开。
 */
hexo.extend.generator.register('noimpty-empty-index', locals => ({
  path: 'index.html',
  layout: ['index', 'archive'],
  data: {
    __index: true,
    posts: locals.posts.filter(() => false),
    current: 1,
    current_url: '',
    total: 1,
    prev: 0, prev_link: '',
    next: 0, next_link: ''
  }
}))

// ---------------- 2. robots.txt ----------------

hexo.extend.generator.register('noimpty-robots', () => ({
  path: 'robots.txt',
  data: [
    '# 这个站点是私人记录，不希望被收录。',
    '# robots.txt 靠的是爬虫自觉 —— 主流搜索引擎会遵守，恶意抓取不会。',
    'User-agent: *',
    'Disallow: /',
    ''
  ].join('\n')
}))

// ---------------- 3. search.xml 加密 ----------------

/* 密钥派生。Node 侧和浏览器侧必须完全一致，否则解不开。
 * 浏览器侧在 source/js/noimpty-search.js 里，改这边记得同步改那边。 */
const SALT = 'noimpty-search-v1'
const ITER = 120000

const deriveKey = passphrase =>
  crypto.pbkdf2Sync(String(passphrase), SALT, ITER, 32, 'sha256')

const encrypt = (plaintext, passphrase) => {
  const key = deriveKey(passphrase)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  // WebCrypto 的 AES-GCM 要求密文和认证标签拼在一起，Node 是分开给的
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64')
}

hexo.extend.filter.register('after_generate', async () => {
  const searchPath = hexo.config.search && hexo.config.search.path
  if (!searchPath) return

  const xml = await readStream(hexo.route.get(searchPath))
  if (xml == null) return

  const pass = process.env.NOIMPTY_PASSPHRASE || ''

  if (!pass) {
    // 没给暗号就不能加密。这时候**清空**而不是原样输出 ——
    // 忘了配环境变量的代价应该是「搜索用不了」，不是「全站正文裸奔」。
    hexo.route.set(searchPath, '<?xml version="1.0" encoding="utf-8"?>\n<search></search>\n')
    hexo.log.warn('没有 NOIMPTY_PASSPHRASE，search.xml 已清空（站内搜索会用不了）')
    hexo.log.warn('  本地：NOIMPTY_PASSPHRASE=你的暗号 npm run build')
    hexo.log.warn('  线上：在仓库 Secrets 里加 SITE_PASSPHRASE')
    return
  }

  hexo.route.set(searchPath, JSON.stringify({
    v: 1,
    alg: 'AES-GCM',
    kdf: `PBKDF2-SHA256/${ITER}`,
    data: encrypt(xml, pass)
  }))
  hexo.log.info(`search.xml 已加密（原文 ${(xml.length / 1024).toFixed(0)} KB）`)
})

// ---------------- 4. feed / sitemap 兜底 ----------------

/* hexo-generator-feed 会往每个页面的 <head> 里塞一条
 *   <link rel="alternate" type="application/atom+xml" href="/atom.xml">
 *
 * 就算把 _config.yml 里的 feed 整段注释掉，它也会按默认值照塞不误 ——
 * 于是每一页都在向爬虫宣告「这里有个订阅源」，而那个文件已经被下面删掉了。
 * 结果是 75 个页面各挂一条死链，同时又给爬虫指了一条路。
 *
 * 在渲染后的 HTML 上直接抹掉。写在这里而不是去改配置，是因为
 * 「有没有 feed」这件事应该由 lockdown 一个地方说了算，
 * 不该分散在插件的默认值里 —— 那种地方最容易在升级依赖时悄悄变回来。
 */
hexo.extend.filter.register('after_render:html', str =>
  str.replace(/<link[^>]+rel="alternate"[^>]*type="application\/(?:atom|rss)\+xml"[^>]*>/gi, '')
    .replace(/<link[^>]+type="application\/(?:atom|rss)\+xml"[^>]*rel="alternate"[^>]*>/gi, ''))

hexo.extend.filter.register('after_generate', () => {
  /* path 不一定是字符串：hexo-generator-feed 支持同时生成 atom + rss2，
   * 那时候 config.feed.path 是一个数组。直接丢给 route.get 会抛
   * 「path must be a string」，整个构建就挂了 —— 踩过一次。 */
  const kill = (raw, what) => {
    const paths = (Array.isArray(raw) ? raw : [raw]).filter(p => typeof p === 'string' && p)
    for (const path of paths) {
      if (!hexo.route.get(path)) continue
      hexo.route.remove(path)
      hexo.log.warn(`${what}（${path}）已被 lockdown 移除 —— 全站上锁期间它不该存在`)
    }
  }
  kill(hexo.config.feed && hexo.config.feed.path, 'RSS/Atom')
  kill(hexo.config.sitemap && hexo.config.sitemap.path, '站点地图')

  // 生成器可能用了别的默认文件名（配置项没写全时）。这两个名字兜一道。
  kill(['atom.xml', 'rss2.xml', 'feed.xml'], 'RSS/Atom')
  kill(['sitemap.xml'], '站点地图')
})
