/* 把看板娘要用的三份运行时搬进 source/lib/l2d/。
 *
 * 运行库随站点本地分发，避免浏览器为了加载这三份依赖而访问第三方 CDN。
 * 此工具检查依赖语法与明文链接，不保证全站或运行时没有其他外部请求。
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
 *   node tools/assets/vendor-live2d.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Script } from 'node:vm'

const base = fileURLToPath(new URL('../../', import.meta.url))
const CORE_URL = 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js'
const MAX_BYTES = 8 * 1024 * 1024
const kb = s => (Buffer.byteLength(s) / 1024).toFixed(0) + ' KB'
const ALLOW = [
  'http://www.w3.org/',                  // SVG / XML 命名空间
  'https://www.live2d.com/eula/',         // 授权声明
  'https://live2d.github.io/',
  'https://github.com/',                 // 源码仓库链接
  'http://pixijs.com',                   // 版权声明、启动提示
  'https://pixijs.com',
  'http://www.opensource.org/licenses/',
  'https://mths.be/punycode',
  'http://localhost'
].map(value => new URL(value))

// 只检查明文 URL，不执行第三方脚本；这不是对动态拼接请求的静态证明。
export const validateRuntime = (name, source) => {
  if (!source || Buffer.byteLength(source) > MAX_BYTES) throw new Error(`${name}: 文件为空或超过 8 MB`)
  const markers = {
    'cubismcore.min.js': ['Live2DCubismCore', 'Redistributable Code'],
    'pixi.min.js': ['PIXI'],
    'live2d-display.min.js': ['Live2DModel']
  }
  if (!markers[name]?.every(marker => source.includes(marker))) throw new Error(`${name}: 不是预期的运行时文件`)
  try { new Script(source, { filename: name }) } catch (error) { throw new Error(`${name}: JavaScript 不完整或语法无效`, { cause: error }) }
  const urls = [...new Set(source.match(/https?:\/\/[a-zA-Z0-9._~:/@%-]+/g) || [])]
  const unknown = urls.filter(value => {
    try {
      const url = new URL(value)
      return !ALLOW.some(allowed => !url.username && !url.password && url.origin === allowed.origin && url.pathname.startsWith(allowed.pathname))
    } catch (_) { return true }
  })
  if (unknown.length) throw new Error(`${name}: 未确认的外部地址：${unknown.join(', ')}`)
}

const readLocal = path => {
  if (statSync(path).size > MAX_BYTES) throw new Error(`${path}: 文件超过 8 MB`)
  return readFileSync(path, 'utf8')
}

export const downloadCore = async (fetchImpl = fetch, timeoutMs = 15000) => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new RangeError('下载时限必须是正整数')
  const controller = new AbortController()
  let timer, reader
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('Cubism Core 下载超时')
      controller.abort(error)
      if (reader) Promise.resolve(reader.cancel(error)).catch(() => {})
      reject(error)
    }, timeoutMs)
  })
  try {
    return await Promise.race([timeout, (async () => {
      const response = await fetchImpl(CORE_URL, { signal: controller.signal })
      controller.signal.throwIfAborted()
      if (!response.ok) throw new Error(`取不到 Cubism Core：HTTP ${response.status}`)
      if (Number(response.headers.get('content-length')) > MAX_BYTES) {
        await response.body?.cancel()
        throw new Error('Cubism Core 下载超过 8 MB')
      }
      if (!response.body) throw new Error('Cubism Core 响应为空')
      reader = response.body.getReader()
      const chunks = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          controller.signal.throwIfAborted()
          if (done) break
          size += value.byteLength
          if (size > MAX_BYTES) throw new Error('Cubism Core 下载超过 8 MB')
          chunks.push(value)
        }
        return Buffer.concat(chunks, size).toString('utf8')
      } catch (error) {
        try { await reader.cancel(error) } catch (_) {}
        throw error
      } finally { reader.releaseLock(); reader = null }
    })()])
  } finally { clearTimeout(timer) }
}

export const vendorLive2D = async ({ root = base, fetchImpl = fetch, timeoutMs = 15000, log = console.log } = {}) => {
  const outDir = join(root, 'source/lib/l2d')
  // 先读取并校验所有依赖、许可证与 Core。任一项失败，都不能覆盖已有库。
  const pixiPkg = JSON.parse(readLocal(join(root, 'node_modules/pixi.js/package.json')))
  const dispPkg = JSON.parse(readLocal(join(root, 'node_modules/pixi-live2d-display-lipsyncpatch/package.json')))
  if (!/^7\./.test(pixiPkg.version || '') || !dispPkg.version) throw new Error('依赖版本无效：需要 PixiJS 7 和 Live2D display')
  const pixi = readLocal(join(root, 'node_modules/pixi.js/dist/pixi.min.js'))
  const disp = readLocal(join(root, 'node_modules/pixi-live2d-display-lipsyncpatch/dist/cubism4.min.js'))
  const license = readLocal(join(root, 'node_modules/pixi-live2d-display-lipsyncpatch/LICENSE'))
  if (!license.trim()) throw new Error('Live2D display 许可证为空')
  validateRuntime('pixi.min.js', pixi)
  validateRuntime('live2d-display.min.js', disp)
  let core, cached = true
  try { core = readLocal(join(outDir, 'cubismcore.min.js')) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    cached = false
    core = await downloadCore(fetchImpl, timeoutMs)
  }
  validateRuntime('cubismcore.min.js', core)
  const files = [['cubismcore.min.js', core], ['pixi.min.js', pixi], ['live2d-display.min.js', disp], ['LICENSE-live2d-display', license]]
  mkdirSync(outDir, { recursive: true })
  const staging = mkdtempSync(join(dirname(outDir), '.l2d-stage-'))
  try {
    for (const [name, source] of files) writeFileSync(join(staging, name), source)
    for (const [name] of files) {
      if (cached && name === 'cubismcore.min.js') continue
      renameSync(join(staging, name), join(outDir, name))
    }
  } finally { rmSync(staging, { recursive: true, force: true }) }
  log(`  cubismcore.min.js   ${cached ? '缓存已校验' : '已下载并校验'}  ${kb(core)}`)
  log(`  pixi.min.js         ${kb(pixi)}  ← pixi.js v${pixiPkg.version}`)
  log(`  live2d-display.min.js ${kb(disp)}  ← pixi-live2d-display-lipsyncpatch ${dispPkg.version}`)
  log('  ✓ 三份都搬好了，语法与明文外部地址检查通过')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await vendorLive2D() } catch (error) { console.error('✗ ' + error.message); process.exitCode = 1 }
}
