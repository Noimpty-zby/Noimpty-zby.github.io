/* 把看板娘要用的三份运行时搬进 source/lib/l2d/。
 *
 * 为什么自己存一份而不是挂 CDN：这站是上锁的私有站，不该有任何第三方请求 ——
 * 挂 CDN 等于把「谁在什么时候打开了这个博客」告诉别人。
 *
 * 三份分别是：
 *
 *   cubismcore.min.js     Live2D 官方的 Cubism Core。它的文件头写明自己是协议里的
 *                         「Redistributable Code」，随应用分发正是它的用法。
 *                         只有官方这一份能解 .moc3，没有替代品。
 *   pixi.min.js           PixiJS 7，渲染用。
 *   live2d-display.min.js pixi-live2d-display 的 lipsync 分支，把模型接到 Pixi 上，
 *                         顺带管好眨眼、待机动作、视线跟随和嘴型。
 *
 * 一段值得留下的教训：一开始用的是 l2d-widget，一个「一行代码接上看板娘」的库。
 * 它把 Cubism Core 也打包进去了，省掉了这个脚本 —— 但它打出来的那份 Core 是坏的：
 * asm.js 分支在自己的 run() 里就抛 `g[y[...]] is not a function`，wasm 分支要的
 * _em_module.wasm 它又没发布。0.0.2 到 0.1.2 四个版本，一个都渲染不出东西。
 * 换成官方 Core 之后又撞上它框架里 csmGetMocVersion 少传一个参数。
 * 结论：Core 要用官方的，这个脚本要留着。
 *
 *   node tools/vendor-live2d.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const base = fileURLToPath(new URL('../', import.meta.url))
const outDir = base + 'source/lib/l2d/'
mkdirSync(outDir, { recursive: true })

const CORE_URL = 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js'
const kb = s => (s.length / 1024).toFixed(0) + ' KB'

// ── 1. 官方 Cubism Core ──
// 只在本地还没有的时候去取。取回来的东西要当场验一眼，别把一张 404 页面存进仓库。
let core
try {
  core = readFileSync(outDir + 'cubismcore.min.js', 'utf8')
  console.log(`  cubismcore.min.js   已有，跳过下载  ${kb(core)}`)
} catch (_) {
  console.log(`  cubismcore.min.js   下载中 …`)
  const res = await fetch(CORE_URL)
  if (!res.ok) { console.error(`✗ 取不到 Cubism Core：HTTP ${res.status}`); process.exit(1) }
  core = await res.text()
  if (!core.includes('Live2DCubismCore') || !core.includes('Redistributable Code')) {
    console.error('✗ 取回来的不像是 Cubism Core，没往仓库里写'); process.exit(1)
  }
  writeFileSync(outDir + 'cubismcore.min.js', core)
  console.log(`  cubismcore.min.js   ${kb(core)}  ← ${CORE_URL}`)
}

// ── 2、3. 从 node_modules 搬 ──
const carry = (from, to, label) => {
  const text = readFileSync(base + from, 'utf8')
  writeFileSync(outDir + to, text)
  console.log(`  ${to.padEnd(22)}${kb(text)}  ← ${label}`)
  return text
}
const pixiVer = JSON.parse(readFileSync(base + 'node_modules/pixi.js/package.json', 'utf8')).version
const dispPkg = JSON.parse(readFileSync(base + 'node_modules/pixi-live2d-display-lipsyncpatch/package.json', 'utf8'))
const pixi = carry('node_modules/pixi.js/dist/pixi.min.js', 'pixi.min.js', `pixi.js v${pixiVer}`)
const disp = carry('node_modules/pixi-live2d-display-lipsyncpatch/dist/cubism4.min.js', 'live2d-display.min.js',
  `pixi-live2d-display-lipsyncpatch ${dispPkg.version}`)
cpSync(base + 'node_modules/pixi-live2d-display-lipsyncpatch/LICENSE', outDir + 'LICENSE-live2d-display')

/* 最后把三份一起过一遍：不许留下任何会被 fetch 的外部地址。
 * 这是这个脚本存在的另一半理由 —— 搬运只是手段，「搬完之后站里不发外部请求」才是目的。 */
const ALLOW = [
  'http://www.w3.org/',                 // SVG / XML 命名空间，不是请求
  'https://www.live2d.com/eula/',       // 授权声明里的链接
  'https://live2d.github.io/',          // 同上
  'https://github.com/',                // 源码仓库链接
  'http://pixijs.com',                  // 版权声明和启动时那句 console.log
  'https://pixijs.com',
  'http://www.opensource.org/licenses/', // pixi 文件头的 MIT 声明
  'https://mths.be/punycode',           // punycode 的版权注释
  'http://localhost'
]
let leaked = 0
for (const [name, text] of [['cubismcore.min.js', core], ['pixi.min.js', pixi], ['live2d-display.min.js', disp]]) {
  const urls = [...new Set(text.match(/https?:\/\/[a-zA-Z0-9._~/-]+/g) || [])]
    .filter(u => !ALLOW.some(ok => u.startsWith(ok)))
  if (!urls.length) continue
  leaked += urls.length
  console.error(`✗ ${name} 里有没见过的外部地址，逐条确认它不会被 fetch，确认了就加进 ALLOW：`)
  for (const u of urls) console.error('   ' + u)
}
if (leaked) process.exit(1)
console.log('  ✓ 三份都搬好了，没有会被 fetch 的外部地址')
