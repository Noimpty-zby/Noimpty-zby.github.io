/* 把终端录屏播放器 asciinema-player 搬进 source/lib/asciinema-player/。
 *
 * 用的是官方打好的单文件版（不需要 Web Worker），随站点本地分发，页面不访问第三方 CDN。
 * 它是 Apache-2.0 许可，所以 LICENSE 一起放进去；build-learning-editor.mjs 只收 MIT，
 * 这份不走那条打包路线。版本由 package.json 的 devDependencies 固定。
 *
 *   node tools/assets/vendor-asciinema.mjs
 */
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const from = join(root, 'node_modules/asciinema-player')
const to = join(root, 'source/lib/asciinema-player')
const manifest = JSON.parse(readFileSync(join(from, 'package.json'), 'utf8'))
if (manifest.license !== 'Apache-2.0') throw new Error('许可证变了，先看清楚再分发：' + manifest.license)

mkdirSync(to, { recursive: true })
for (const [source, target] of [['dist/bundle/asciinema-player.min.js', 'asciinema-player.min.js'], ['dist/bundle/asciinema-player.css', 'asciinema-player.css'], ['LICENSE', 'LICENSE']]) {
  copyFileSync(join(from, source), join(to, target))
}
console.log(`asciinema-player ${manifest.version} → source/lib/asciinema-player/`)
