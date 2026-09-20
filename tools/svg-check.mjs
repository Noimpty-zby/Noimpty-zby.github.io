/* 配图自查：这台机器上没有任何 SVG 渲染器（没有 rsvg-convert / inkscape / chromium），
 * 图画完了看不见。写文章配图时压字、出框全靠这个脚本兜。
 *
 * 它不渲染，只按字号估算每段文字的包围盒：CJK 字符宽约等于 font-size，
 * 拉丁字符约 0.53×，等宽字体约 0.6×。估算值偏保守（宁可误报也别漏报），
 * 所以报出来的重叠要人眼复核一下再改，别无脑挪。
 *
 *   node tools/svg-check.mjs source/img/posts/<目录>/*.svg
 *
 * 出框和文字互相重叠都会列出来并非零退出。
 */
import { readFileSync } from 'node:fs'

const CJK = /[⺀-鿿豈-﫿＀-￯　-〿]/

const widthOf = (text, size, mono) => {
  let total = 0
  for (const ch of text) total += CJK.test(ch) ? size : size * (mono ? 0.6 : 0.53)
  return total
}

const attr = (tag, name) => {
  const hit = tag.match(new RegExp(`${name}="([^"]*)"`))
  return hit ? hit[1] : null
}

export const check = (file) => {
  const svg = readFileSync(file, 'utf8')
  const box = (svg.match(/viewBox="([^"]*)"/) || [])[1]?.trim().split(/\s+/).map(Number)
  if (!box || box.length !== 4) return [`${file}: 没有可用的 viewBox`]
  const [, , vbWidth, vbHeight] = box

  const labels = []
  for (const hit of svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const [, tag, inner] = hit
    const text = inner.replace(/<[^>]*>/g, '').trim()
    if (!text) continue
    const size = Number(attr(tag, 'font-size')) || 16
    const x = Number(attr(tag, 'x')) || 0
    const y = Number(attr(tag, 'y')) || 0
    const anchor = attr(tag, 'text-anchor') || 'start'
    const mono = /mono|courier|consolas/i.test(attr(tag, 'font-family') || '')
    const width = widthOf(text, size, mono)
    const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x
    // 基线在 y 上，往上约 0.78×size 是字顶，往下约 0.22×size 是字底。
    labels.push({ text, left, right: left + width, top: y - size * 0.78, bottom: y + size * 0.22 })
  }

  const problems = []
  for (const label of labels) {
    if (label.left < 0 || label.right > vbWidth || label.top < 0 || label.bottom > vbHeight)
      problems.push(`${file}: 「${label.text}」出框 (x ${label.left.toFixed(0)}–${label.right.toFixed(0)}，y ${label.top.toFixed(0)}–${label.bottom.toFixed(0)}，画布 ${vbWidth}×${vbHeight})`)
  }
  for (let i = 0; i < labels.length; i++)
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i], b = labels[j]
      const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      // 留 1px 容差：相邻文字贴着排是正常的，压进去才是问题。
      if (overlapX > 1 && overlapY > 1)
        problems.push(`${file}: 「${a.text}」和「${b.text}」压字 (重叠 ${overlapX.toFixed(0)}×${overlapY.toFixed(0)}px)`)
    }
  return problems
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const files = process.argv.slice(2)
  if (!files.length) { console.error('用法: node tools/svg-check.mjs <svg 文件…>'); process.exit(2) }
  const problems = files.flatMap(check)
  if (problems.length) {
    problems.forEach(line => console.log('  ✗ ' + line))
    console.log(`\n✗ ${files.length} 张图里有 ${problems.length} 处问题。宽度是估算的，改之前先人眼复核。`)
    process.exit(1)
  }
  console.log(`✓ ${files.length} 张图：文字都在框内，没有互相压字`)
}
