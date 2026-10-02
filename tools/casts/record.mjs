/**
 * 按场景脚本自动录终端录屏：tmux 当键盘，asciinema 3 录屏，输出 asciicast v2。
 *
 *   node tools/casts/record.mjs tools/casts/scenes/linux-ch6-ctrl-r.mjs
 *
 * 场景文件 export default 一个对象：
 *   name     输出到 source/casts/<name>.cast
 *   cols/rows  终端大小
 *   cwd      家目录下的起始目录
 *   files    { 相对家目录的路径: 内容 }，录之前写好
 *   history  预先放进 ~/.bash_history 的命令，旧的在前
 *   steps    [{ type: '文字' } | { key: 'C-r' } | { wait: 毫秒 }]
 *
 * 录制在一个临时目录里进行：HOME 指向空目录，环境变量用 env -i 清空后重设，
 * 不会录到本机真实的家目录、用户名之外的任何东西。提示符写死成 zby@Noimpty，
 * 和代码小屋终端一致。需要本机有 tmux 和 asciinema（~/.local/bin/asciinema）。
 */
import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const sceneFile = process.argv[2]
if (!sceneFile) { console.error('用法：node tools/casts/record.mjs <场景文件>'); process.exit(1) }
const scene = (await import(pathToFileURL(resolve(sceneFile)).href)).default
const { name, cols = 80, rows = 16, cwd = '', files = {}, history = [], steps = [] } = scene
if (!/^[a-z0-9][a-z0-9/_-]*$/.test(name || '')) throw new Error('场景缺少合法的 name')

const sleep = ms => new Promise(done => setTimeout(done, ms))
// 打字间隔用固定种子的伪随机数，同一个场景每次录出来节奏一样。
let seed = 20261002
const jitter = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }

const work = mkdtempSync(join(tmpdir(), 'noimpty-cast-'))
const home = join(work, 'home')
const start = join(home, cwd)
mkdirSync(start, { recursive: true })
for (const [file, content] of Object.entries(files)) {
  mkdirSync(dirname(join(home, file)), { recursive: true })
  writeFileSync(join(home, file), content)
}
writeFileSync(join(home, '.bash_history'), history.map(line => line + '\n').join(''))
// Ubuntu 的 /etc/bash.bashrc 在没有这个文件时会打印一段 sudo 提示。
writeFileSync(join(home, '.sudo_as_admin_successful'), '')
writeFileSync(join(home, '.bashrc'), [
  "PS1='\\[\\e[32m\\]zby@Noimpty\\[\\e[0m\\]:\\[\\e[34m\\]\\w\\[\\e[0m\\]\\$ '",
  'HISTFILE=~/.bash_history', 'HISTSIZE=1000', 'shopt -s histappend',
  "alias ls='ls --color=auto'",
  `cd ${JSON.stringify(start)}`,
  "printf '\\033[H\\033[2J'"
].join('\n') + '\n')

const socket = 'noimpty-cast-' + process.pid
const tmux = (...args) => execFileSync('tmux', ['-L', socket, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
const shell = `env -i HOME=${home} TERM=xterm-256color PATH=/usr/local/bin:/usr/bin:/bin LANG=C.UTF-8 LC_ALL=C.UTF-8 bash --noprofile --rcfile ${home}/.bashrc -i`
tmux('new-session', '-d', '-s', 'cast', '-x', String(cols), '-y', String(rows), shell)
tmux('set', '-g', 'status', 'off')
tmux('set', '-g', 'escape-time', '0')

const output = join(root, 'source/casts', name + '.cast')
mkdirSync(dirname(output), { recursive: true })
const recorder = spawn('asciinema', ['rec', '--headless', '--window-size', `${cols}x${rows}`, '-f', 'asciicast-v2', '--overwrite', '-q',
  '-c', `tmux -L ${socket} attach -t cast`, output], { stdio: 'inherit' })
const finished = new Promise(done => recorder.on('exit', done))

try {
  await sleep(1200)
  for (const step of steps) {
    if (step.wait) await sleep(step.wait)
    else if (step.key) { tmux('send-keys', '-t', 'cast', step.key); await sleep(120) }
    else if (typeof step.type === 'string') {
      for (const char of step.type) { tmux('send-keys', '-t', 'cast', '-l', char); await sleep(70 + Math.round(jitter() * 90)) }
    }
  }
  await sleep(1500)
} finally {
  // asciinema 边录边写文件。关掉 tmux 之前文件里已有的事件就是录屏的全部内容，
  // 之后 attach 退出时的清屏和 [server exited] 都不要。
  await sleep(300)
  var kept = readFileSync(output, 'utf8').split('\n').filter(Boolean).length - 1
  try { tmux('kill-server') } catch (_) {}
}
await finished

// 去掉 tmux 退出时清屏、打印 [exited] 的那几帧，最后一帧停在场景结束时的样子。
const [header, ...events] = readFileSync(output, 'utf8').split('\n').filter(Boolean)
const frames = events.slice(0, kept).filter(line => JSON.parse(line)[1] === 'o')
const meta = JSON.parse(header)
for (const key of ['env', 'command', 'timestamp']) delete meta[key]
meta.title = scene.title || name
writeFileSync(output, [JSON.stringify(meta), ...frames].join('\n') + '\n')
rmSync(work, { recursive: true, force: true })
console.log(`录好了 ${output.replace(root, '')}：${frames.length} 帧，${frames.length ? JSON.parse(frames.at(-1))[0].toFixed(1) : 0} 秒`)
