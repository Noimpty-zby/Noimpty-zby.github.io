/* 把 Live2D 官方样例模型处理成适合网页加载的一份。
 *
 * 官方包里那张贴图是 4096×4096 的 PNG，7.9 MB。她在页面上只显示三百来像素，
 * 这个分辨率纯属浪费流量 —— 缩到 2048 再转 webp 是 381 KB，省掉 95%，
 * 高分屏下也还有余量。model3.json 里的贴图路径要跟着改。
 *
 * 只搬运行时需要的文件。官方包里那个 68 MB 的 .cmo3 是 Cubism 编辑器工程，
 * 网页一个字节都用不上。
 *
 * 模型本身按 Live2D 的《Free Material License Agreement》使用，ReadMe 一并
 * 拷过来 —— 授权文本得跟着素材走，别只留一堆二进制在那儿。
 *
 *   node tools/build-live2d-model.mjs <官方包的 runtime 目录> <输出名>
 *
 * 用到的 @napi-rs/canvas 是跟着 pdfjs-dist 进来的，package.json 里没单独声明。
 * 哪天 pdfjs 换了实现、它不再被带进来，这个脚本要自己装一个。
 */
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync } from 'node:fs'
import { join, basename, dirname } from 'node:path'
const require = createRequire(new URL('../package.json', import.meta.url))
const { loadImage, createCanvas } = require('@napi-rs/canvas')

const TEX = 2048          // 贴图边长。显示约 300px，2048 在 3 倍屏下仍有富余
const QUALITY = 0.92

const [runtimeDir, name] = process.argv.slice(2)
if (!runtimeDir || !name) {
  console.error('用法: node tools/build-live2d-model.mjs <runtime 目录> <输出名>')
  process.exit(2)
}
const outDir = new URL(`../source/live2d/${name}/`, import.meta.url).pathname
mkdirSync(join(outDir, 'textures'), { recursive: true })

const entries = require('node:fs').readdirSync(runtimeDir)
const modelName = entries.find(f => f.endsWith('.model3.json'))
if (!modelName) throw new Error('runtime 目录里没有 .model3.json')
const model = JSON.parse(readFileSync(join(runtimeDir, modelName), 'utf8'))
const ref = model.FileReferences

let moved = 0
const carry = rel => {
  if (!rel) return
  const from = join(runtimeDir, rel), to = join(outDir, rel)
  if (!existsSync(from)) { console.log(`  ⚠ 缺文件 ${rel}`); return }
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to)
  moved++
}

carry(ref.Moc); carry(ref.Physics); carry(ref.Pose); carry(ref.DisplayInfo)
for (const e of ref.Expressions || []) carry(e.File)
for (const list of Object.values(ref.Motions || {})) for (const m of list) carry(m.File)

// 贴图：缩小 + 转 webp，并改写 model3.json 里的引用
const textures = []
for (const [i, rel] of (ref.Textures || []).entries()) {
  const img = await loadImage(join(runtimeDir, rel))
  const cv = createCanvas(TEX, TEX), c = cv.getContext('2d')
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'
  c.drawImage(img, 0, 0, TEX, TEX)
  const buf = cv.toBuffer('image/webp', QUALITY)
  const out = `textures/texture_${String(i).padStart(2, '0')}.webp`
  writeFileSync(join(outDir, out), buf)
  textures.push(out)
  console.log(`  贴图 ${img.width}×${img.height} → ${TEX}×${TEX} webp  ${(buf.length / 1024).toFixed(0)} KB`)
}
ref.Textures = textures
writeFileSync(join(outDir, modelName), JSON.stringify(model, null, 2) + '\n')

// 授权文本跟着素材走
const readme = join(runtimeDir, '..', 'ReadMe.txt')
if (existsSync(readme)) { cpSync(readme, join(outDir, 'ReadMe.txt')); moved++ }

const total = require('node:child_process').execSync(`du -sb ${outDir}`).toString().split('\t')[0]
console.log(`  搬运 ${moved} 个文件 + ${textures.length} 张贴图`)
console.log(`  ✓ source/live2d/${name}/  合计 ${(total / 1024 / 1024).toFixed(2)} MB`)
