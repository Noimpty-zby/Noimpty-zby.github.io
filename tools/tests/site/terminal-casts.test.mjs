/* 终端录屏（{% cast %} + source/casts/*.cast + source/js/noimpty-cast.js）。
 *
 * 录屏文件是 tools/casts/record.mjs 在临时目录里录的。这里盯几件只有回放时才会发现的事：
 *   - 文章里写的每段录屏都真的存在，是播放器认得的 asciicast v2；
 *   - 文件头里没有录制时的环境变量、命令行和时间戳；
 *   - 录屏没有录到本机的真实路径和 tmux 退出时的 [server exited]，最后一帧停在场景结束时；
 *   - 播放器文件和许可证都在 source/lib 里，版本和加载脚本里写的一致。
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

let pass = 0
const check = (name, fn) => { fn(); pass++; console.log(`  ✓ ${name}`) }

const casts = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? casts(join(dir, entry.name)) : entry.name.endsWith('.cast') ? [join(dir, entry.name)] : [])
const files = existsSync('source/casts') ? casts('source/casts') : []

check('文章里引用的录屏都存在，且每个录屏都有文章在用', () => {
  const used = new Set()
  for (const post of readdirSync('source/_posts').filter(name => name.endsWith('.md'))) {
    for (const match of readFileSync(join('source/_posts', post), 'utf8').matchAll(/\{%\s*cast\s+(\S+)/g)) {
      assert.ok(existsSync(join('source/casts', match[1] + '.cast')), `${post}: {% cast ${match[1]} %} 没有对应的录屏文件`)
      used.add(join('source/casts', match[1] + '.cast'))
    }
  }
  for (const file of files) assert.ok(used.has(file), `${file} 没有任何文章引用`)
})

check('录屏是干净的 asciicast v2', () => {
  for (const file of files) {
    const [first, ...events] = readFileSync(file, 'utf8').split('\n').filter(Boolean)
    const header = JSON.parse(first)
    assert.equal(header.version, 2, file)
    assert.ok(header.width >= 40 && header.width <= 120 && header.height >= 8 && header.height <= 40, `${file} 尺寸 ${header.width}x${header.height}`)
    for (const key of ['env', 'command', 'timestamp']) assert.equal(header[key], undefined, `${file} 文件头里留着 ${key}`)
    let last = 0
    for (const line of events) {
      const [time, kind, data] = JSON.parse(line)
      assert.equal(kind, 'o', `${file} 只该有输出事件`)
      assert.ok(time >= last, `${file} 时间倒退`); last = time
      assert.doesNotMatch(data, /\/home\/|\/tmp\/|noimpty-cast-|server exited|sudo_root/, `${file} 录进了不该有的内容`)
    }
    assert.ok(last > 1 && last < 120, `${file} 时长 ${last} 秒`)
  }
})

check('播放器文件随站点分发，版本与加载脚本一致', () => {
  for (const name of ['asciinema-player.min.js', 'asciinema-player.css', 'LICENSE']) assert.ok(existsSync(join('source/lib/asciinema-player', name)), name)
  assert.match(readFileSync('source/lib/asciinema-player/LICENSE', 'utf8'), /Apache License/)
  const pinned = JSON.parse(readFileSync('package.json', 'utf8')).devDependencies['asciinema-player']
  assert.match(readFileSync('source/js/noimpty-cast.js', 'utf8'), new RegExp(`VERSION = '${pinned.replace(/\./g, '\\.')}'`))
})

console.log(`\n${pass} terminal cast checks passed`)
