'use strict'

/**
 * 旧文章地址 → 新地址的跳转页。
 *
 * 重命名文章文件会改变 permalink，旧链接（外链、搜索收录、别人的收藏）
 * 会直接 404。GitHub Pages 是纯静态托管，没有服务端 301，
 * 所以用一张最小的 HTML 做 meta refresh + canonical + JS 兜底。
 *
 * 以后再改文件名，往下面这张表里加一行即可。
 */
const REDIRECTS = {
  // ── 改过文件名的文章 ──────────────────────────────────
  // 旧路径（不含站点 root）                                  新路径
  '2026/07/31/UE5_Chapter01_ActionRoguelike_Project_Setup/': '2026/07/31/UE5-ActionRoguelike-Chapter1/',
  '2026/07/20/homework-third/':                              '2026/07/20/homework-three/',

  // ── 板块改结构留下的旧地址 ────────────────────────────
  // 2026-08-26：方向转去 AI Infra，课外底下改成「游戏开发 / AI Infra」两条线，
  // 原本平铺在 /extra/ 下的两个课程页收进 /extra/gamedev/。
  // 文章的永久链接是按日期生成的，不受影响，动的只有这两个落地页。
  'extra/games101/':                                         'extra/gamedev/games101/',
  'extra/ue5-looman/':                                       'extra/gamedev/ue5-looman/',

  /* ⚠️ 这里原来还有一条：
   *
   *     '2026/08/07/UE5-ActionRoguelike-Chapter2 /'   ← 注意 Chapter2 后面那个空格
   *
   * 那是当年文章文件名手滑多打了一个空格留下的旧地址。已经删掉，原因是它的代价
   * 远大于收益：
   *
   *   生成它就要在 public 下建一个**名字结尾带空格**的目录。
   *   Windows 在解析路径时会把结尾的空格吃掉，于是这个目录建得出来、删不掉 ——
   *   `Remove-Item -Recurse public` 和 `hexo clean` 都会报
   *   「系统找不到指定的文件」，而且每次本地构建都会再造一个。
   *
   * 而它服务的是一个手滑产生的、只存活过几天的地址；现在全站又已经上锁 +
   * robots 拒绝收录，那个地址实际上不会有人来。
   *
   * 真要留的话，得同时接受「本地 public 目录删不掉」这个后遗症；
   * 删的时候得用 [System.IO.Directory]::Delete("\\?\完整路径", $true) 绕过路径规范化。
   */

  // ── 板块重构（Study/Ideas → 课内/课外/策划室）──────────
  //
  // 文章本身的永久链接没变（它是 :year/:month/:day/:title，只改了分类），
  // 所以旧的文章链接照样能打开。变的是**板块页**和**分类页**的地址，
  // 下面这些是外链、收藏和搜索收录里可能存在的老地址。
  //
  // ⚠️ 这些老地址后来又经历了一次改结构（2026-08-26，见上一段），
  //    所以它们的目标直接写**最终地址**，不要指向中间那一版 ——
  //    跳转页是 meta refresh，一环套一环会让人白等两次，
  //    而且中间那一环哪天被删掉，整条链就断在半路。
  'study/':                                                  'extra/',
  'study/games101/':                                         'extra/gamedev/games101/',
  'study/ue5/':                                              'extra/gamedev/ue5-looman/',
  // 竞赛那一栏没有对应的新板块（比赛的事现在归策划室管）
  'study/competition/':                                      'studio/',
  'ideas/':                                                  'studio/',
  'ideas-vault/':                                            'studio/',

  // 分类页的地址跟着 category_map 变了。
  // 2026-08-26 起分类是三级（课外 / 游戏开发 / GAMES101），所以这里也多了一层。
  'categories/study/':                                       'categories/extra/',
  'categories/study/games101/':                              'categories/extra/gamedev/games101/',
  'categories/study/ue5/':                                   'categories/extra/gamedev/ue5-looman/',
  'categories/ideas/':                                       'studio/'
}

const withRoot = value => {
  const root = hexo.config.root || '/'
  const base = root.endsWith('/') ? root : `${root}/`
  return `${base}${String(value || '').replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/')
}

const escapeHtml = value => String(value == null ? '' : value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

hexo.extend.generator.register('noimpty-redirects', () => {
  const siteUrl = String(hexo.config.url || '').replace(/\/$/, '')

  return Object.entries(REDIRECTS).map(([from, to]) => {
    const target = withRoot(to)
    const absolute = siteUrl + target
    const safe = escapeHtml(target)

    return {
      path: `${from.replace(/^\/+/, '')}index.html`,
      data: `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>页面已迁移</title>
<link rel="canonical" href="${escapeHtml(absolute)}">
<meta name="robots" content="noindex, follow">
<meta http-equiv="refresh" content="0; url=${safe}">
<script>location.replace(${JSON.stringify(target)})</script>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;
     background:#100e14;color:#f7eef3;
     font-family:system-ui,-apple-system,"Noto Sans SC","Microsoft YaHei",sans-serif}
a{color:#ff91a8}
</style>
</head>
<body><p>这篇文章换了新地址，正在跳转…… 如果没有自动跳转，<a href="${safe}">点这里</a>。</p></body>
</html>
`
    }
  })
})
