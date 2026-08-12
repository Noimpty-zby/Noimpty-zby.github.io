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
  // 旧路径（不含站点 root）                                  新路径
  '2026/08/07/UE5-ActionRoguelike-Chapter2 /':               '2026/08/07/UE5-ActionRoguelike-Chapter2/',
  '2026/07/31/UE5_Chapter01_ActionRoguelike_Project_Setup/': '2026/07/31/UE5-ActionRoguelike-Chapter1/',
  '2026/07/20/homework-third/':                              '2026/07/20/homework-three/'
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
