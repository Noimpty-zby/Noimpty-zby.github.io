/* 配图自查：按字号估算文字范围，辅助发现出框和压字，结果仍需在浏览器中确认。
 *
 * 它不渲染，只按字号估算每段文字的包围盒：CJK 字符宽约等于 font-size，
 * 拉丁字符约 0.53×，等宽字体约 0.6×。估算值偏保守（宁可误报也别漏报），
 * 所以报出来的重叠要人眼复核一下再改，别无脑挪。
 *
 *   node tools/checks/svg-check.mjs source/img/posts/<目录>/*.svg
 *
 * 出框和文字互相重叠都会列出来并非零退出。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const CJK = /[⺀-鿿豈-﫿＀-￯　-〿]/

const widthOf = (text, size, mono) => {
  let total = 0
  for (const ch of text) total += CJK.test(ch) ? size : size * (mono ? 0.6 : 0.53)
  return total
}

/* 必须卡住词首。不然取 y 的时候会命中 font-family=" 的结尾 ——
 * 那一串字体名被当成坐标，Number() 出来是 NaN，坐标静默变成 0，
 * 一个本来好好的标签就被报成「出框」。 */
const attr = (tag, name) => {
  const hit = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`))
  return hit ? hit[2] : null
}
const numeric = (value, fallback) => {
  if (value === null || value === undefined) return fallback
  const raw = String(value).trim()
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:px)?$/i.test(raw) ? Number(raw.replace(/px$/i, '')) : NaN
}

/* 字号常常写在 <style> 里的类上，而不是元素的 font-size 属性上。
 * 读不到就按 16 估的话，一张 12px 的图会被整体高估三成 —— 那次全站扫描
 * 报出来的 7 处「出框 / 压字」全是这么来的，一处真问题都没有。 */
const styleRules = svg => {
  const rules = new Map()
  for (const block of svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g))
    for (const rule of block[1].matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      const body = rule[2]
      const size = body.match(/font-size:\s*([^;]+)/)
      const family = body.match(/font-family:\s*([^;]+)/)
      if (!size && !family) continue
      for (const selector of rule[1].split(','))
        for (const cls of selector.trim().matchAll(/\.([\w-]+)/g)) {
          const slot = rules.get(cls[1]) || {}
          if (size) slot.size = size[1].trim()
          if (family) slot.family = family[1]
          rules.set(cls[1], slot)
        }
    }
  return rules
}

export const check = (file) => {
  const svg = readFileSync(file, 'utf8')
  const root = svg.match(/<svg\b([^>]*)>/)?.[1]
  const rawBox = root && attr(root, 'viewBox')
  const box = rawBox?.trim().split(/[\s,]+/).map(value => /px$/i.test(value) ? NaN : numeric(value))
  if (!box || box.length !== 4 || box.some(value => !Number.isFinite(value)) || box[2] <= 0 || box[3] <= 0
    || !Number.isFinite(box[0] + box[2]) || !Number.isFinite(box[1] + box[3])) return [`${file}: 没有可用的 viewBox`]
  const [minX, minY, vbWidth, vbHeight] = box
  const rules = styleRules(svg)

  const labels = [], problems = []
  for (const hit of svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const [, tag, inner] = hit
    const text = inner.replace(/<[^>]*>/g, '').trim()
    if (!text) continue
    // 元素自己写的优先，其次是它 class 命中的规则，最后才退到 16。
    const classes = (attr(tag, 'class') || '').split(/\s+/).filter(Boolean)
    const fromClass = classes.map(c => rules.get(c)).filter(Boolean)
    const size = numeric(attr(tag, 'font-size') ?? fromClass.map(r => r.size).filter(value => value !== undefined).pop(), 16)
    const family = attr(tag, 'font-family') || fromClass.map(r => r.family).filter(Boolean).pop() || ''
    const x = numeric(attr(tag, 'x'), 0)
    const y = numeric(attr(tag, 'y'), 0)
    if (![size, x, y].every(Number.isFinite) || size < 0) {
      problems.push(`${file}: 「${text}」坐标或字号无效`); continue
    }
    if (size === 0) continue
    const anchor = attr(tag, 'text-anchor') || 'start'
    const mono = /mono|courier|consolas/i.test(family)
    const width = widthOf(text, size, mono)
    const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x
    // 基线在 y 上，往上约 0.78×size 是字顶，往下约 0.22×size 是字底。
    const label = { text, size, left, right: left + width, top: y - size * 0.78, bottom: y + size * 0.22 }
    if (![label.left, label.right, label.top, label.bottom].every(Number.isFinite)) {
      problems.push(`${file}: 「${text}」文字范围超出可计算范围`); continue
    }
    labels.push(label)
  }

  for (const label of labels) {
    if (label.left < minX || label.right > minX + vbWidth || label.top < minY || label.bottom > minY + vbHeight)
      problems.push(`${file}: 「${label.text}」出框 (x ${label.left.toFixed(0)}–${label.right.toFixed(0)}，y ${label.top.toFixed(0)}–${label.bottom.toFixed(0)}，画布 ${vbWidth}×${vbHeight}，原点 ${minX},${minY})`)
  }
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i], b = labels[j]
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      /* em 框比实际墨迹高不少，相邻两行贴着排必然算出几像素重叠。
       * 容差按字号取，否则每张多行的图都会报一遍，报到没人再看它。 */
      const slack = Math.max(2, Math.min(a.size, b.size) * 0.25)
      if (overlapX > 1 && overlapY > slack)
        problems.push(`${file}: 「${a.text}」和「${b.text}」压字 (重叠 ${overlapX.toFixed(0)}×${overlapY.toFixed(0)}px)`)
    }
  return problems
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const files = process.argv.slice(2)
  if (!files.length) { console.error('用法: node tools/checks/svg-check.mjs <svg 文件…>'); process.exit(2) }
  const problems = files.flatMap(file => {
    try { return check(file) } catch (error) { return [`${file}: 读取失败：${error.message}`] }
  })
  if (problems.length) {
    problems.forEach(line => console.log('  ✗ ' + line))
    console.log(`\n✗ ${files.length} 张图里有 ${problems.length} 处问题。宽度是估算的，改之前先人眼复核。`)
    process.exit(1)
  }
  console.log(`✓ ${files.length} 张图：文字都在框内，没有互相压字`)
}
