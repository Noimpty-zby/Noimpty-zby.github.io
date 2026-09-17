'use strict'

/**
 * 给我们自己的 js / css 加上内容指纹。
 *
 * 2026-09-17 踩到：日程页改坏了又修好、部署也成功了，主人刷新看到的**还是坏的**——
 * 因为浏览器手上那份 /js/schedule.js 是缓存里的旧文件。
 *
 * 主题自己的资源本来就带版本号（/js/main.js?v=5.7.0），而 _config.butterfly.yml
 * 的 inject 里我们手写的那十六行一个都没有：
 *
 *     <script src="/js/schedule.js"></script>
 *
 * GitHub Pages 给的是 cache-control: max-age=600。十分钟内的普通刷新不会回源，
 * 而 PJAX 换页压根不会重新取脚本 —— 一个开着的标签页可以抱着旧代码很久。
 * 「改好了、部署了、看到的还是旧的」这种事没法靠盯着解决，只能让 URL 变。
 *
 * 做法：渲染 HTML 时把 /js/x.js 和 /css/x.css 重写成 /js/x.js?v=<内容前八位哈希>。
 * 内容没变哈希就不变，所以不会白白让缓存失效。
 *
 * 只管 source/ 下我们自己写的那些。主题的（/js/search/…）在 source/ 里找不到
 * 对应文件，原样放过 —— 它本来就带 ?v=5.7.0。
 *
 * ⚠️ /js/protected-manifest.js 也不带版本号，因为它是构建时生成的、没有源文件。
 * 已知代价：**换暗号之后**，抱着旧 manifest 的浏览器拿到的还是旧的 passHash，
 * 新暗号会开不了门，得硬刷新一次。换暗号本来就要重新部署，所以这条能接受；
 * 真要修的话得让 lockdown 把生成出来的内容哈希传过来。
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

// 一次构建里同一个文件只读一次
const cache = new Map()

const hashOf = rel => {
  if (cache.has(rel)) return cache.get(rel)
  let h = ''
  try {
    h = crypto.createHash('sha1')
      .update(fs.readFileSync(path.join(hexo.source_dir, rel)))
      .digest('hex').slice(0, 8)
  } catch (_) { /* source 里没有这个文件 —— 主题的或生成的，不管 */ }
  cache.set(rel, h)
  return h
}

const RE = /(src|href)="\/((?:js|css)\/[^"?#]+\.(?:js|css))"/g

hexo.extend.filter.register('after_render:html', str =>
  String(str).replace(RE, (whole, attr, rel) => {
    const h = hashOf(rel)
    return h ? `${attr}="/${rel}?v=${h}"` : whole
  }))
