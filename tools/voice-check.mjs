/* 娜娜莉语音的实机检查：拿真密钥、对真服务、跑真模块。
 *
 * 这个脚本存在的理由很具体 —— 2026-09-20 有两个 bug 同时躺在线上，
 * 而 `npm test` 是全绿的：
 *
 *   1. 补尾音从来没生效过。padWav 只认 `0xFFFFFFFF` 这一种流式占位长度，
 *      而硅基流动每条响应都写成无符号的小负数，于是每次都被判为格式无效、
 *      被兜底吞掉。离线测试用的正是 `0xFFFFFFFF`，永远撞不上真值。
 *   2. CosyVoice2 会把语气提示当正文念出来。9 个字的回复读成 18.69 秒，
 *      短回复上 6/8 复现。离线测试喂的是 mock 音频，听不出它在念什么。
 *
 * 共同点是：**只有对着真服务跑才看得见**。所以这个检查故意不进 `npm test` ——
 * 它要花钱、要联网、结果还带随机性，不适合当门禁。改语音相关代码、换模型、
 * 或者怀疑服务那边变了，手动跑一次。
 *
 *   node tools/voice-check.mjs                 默认 12 次，测失控率和补尾音
 *   node tools/voice-check.mjs -n 20           改次数
 *   node tools/voice-check.mjs --samples out/  额外落盘音频，自己听
 *
 * 密钥从 `NANALY_TTS_KEY` 或 `~/.nanaly-tts-key` 读，不接受命令行参数
 * （命令行会进 shell 历史）。每次调用都花真钱，跑之前看一眼 -n。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'

const MODULES = ['nanaly-provider', 'nanaly-prosody', 'nanaly-audio', 'nanaly-voice']

/* 把浏览器模块搬进 Node。垫片只补这几个模块真正碰到的东西 —— 补多了就不是在
 * 测真链路了。模块以后要是用上新的全局对象，这里会直接抛错，不会静默降级。 */
export const loadModules = (root = 'source/js') => {
  const objects = []
  class ObjectURL extends URL {
    static createObjectURL(blob) { objects.push(blob); return 'blob:voice-check/' + objects.length }
    static revokeObjectURL() {}
  }
  // mount() 只在浏览器里用得上，这里不调它，但顶层求值会碰到 document。
  const stub = () => new Proxy(function () {}, {
    get: (_target, key) => key === 'then' ? undefined : stub(), apply: () => stub(), set: () => true
  })
  const window = {
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    addEventListener: () => {}, fetch: (...args) => fetch(...args)
  }
  const context = vm.createContext({ window, globalThis: window, URL: ObjectURL,
    document: { hidden: false, createElement: () => stub() },
    Blob, AbortController, DOMException, crypto, console, setTimeout, clearTimeout, fetch, TextEncoder, TextDecoder })
  for (const name of MODULES)
    vm.runInContext(readFileSync(join(root, name + '.js'), 'utf8'), context, { filename: name })
  for (const key of ['NANALY_PROVIDER', 'NANALY_PROSODY', 'NANALY_AUDIO', 'NANALY_VOICE'])
    if (!window[key]) throw new Error(key + ' 没有挂上来，垫片可能少了某个全局对象')
  return { window, played: objects }
}

/* 假播放器：立刻「放完」，让 speak() 走完全部句段而不真的出声。 */
const makeAudio = () => {
  const audio = { onended: null, onerror: null, pause: () => {}, removeAttribute: () => {}, load: () => {},
    play: () => { setTimeout(() => audio.onended?.(), 1); return Promise.resolve() } }
  let src
  Object.defineProperty(audio, 'src', { get: () => src, set: value => { src = value } })
  return audio
}

const readKey = () => {
  const file = process.env.NANALY_TTS_KEY_FILE || join(homedir(), '.nanaly-tts-key')
  const key = process.env.NANALY_TTS_KEY || (existsSync(file) ? readFileSync(file, 'utf8').trim() : '')
  if (!key) {
    console.error(`✗ 没有密钥。放一份到 ${file}（chmod 600），或设 NANALY_TTS_KEY。`)
    console.error('  这是博客里 secrets.visionKey 的同一把 —— 浏览器那份是加密存在 localStorage 里的，读不出来。')
    process.exit(2)
  }
  return key
}

const main = async () => {
  const argv = process.argv.slice(2)
  const flag = (name, fallback) => { const i = argv.indexOf(name); return i < 0 ? fallback : (argv[i + 1] ?? true) }
  const rounds = Math.max(1, Number(flag('-n', 12)) || 12)
  const sampleDir = argv.includes('--samples') ? String(flag('--samples', 'voice-samples')) : null

  // 短回复是压力最大的场景：长回复几乎不失控，拿长文本测什么都看不出来。
  const REPLY = '居然一次就跑通了？'
  const QUESTION = '我照你说的改完了，你看看对不对'
  // 正常语速约 0.2 秒一个字。远超这个数就是提示词被念出来了。
  const CEILING = 1.5 + [...REPLY].length * 0.45

  const key = readKey()
  const connection = { key, baseURL: 'https://api.siliconflow.cn/v1', model: process.env.NANALY_TTS_MODEL || 'Pro/moonshotai/Kimi-K2.6' }
  if (sampleDir) mkdirSync(sampleDir, { recursive: true })

  console.log(`\n对着真服务跑 ${rounds} 轮 × 2 条路径。正文「${REPLY}」${[...REPLY].length} 字，正常约 2 秒。`)
  console.log(`超过 ${CEILING.toFixed(1)} 秒记为失控（模型在念语气提示，不是在念回复）。\n`)

  let failures = 0
  for (const emotion of [false, true]) {
    const label = emotion ? '情绪开' : '情绪关'
    let leaked = 0, retried = 0, padded = 0, notices = []
    const durations = [], prompts = new Set()

    for (let round = 0; round < rounds; round++) {
      const { window, played } = loadModules()
      const raw = []
      const controller = window.NANALY_VOICE.create({
        getConnection: () => connection, onNeedKey: () => {}, onUsage: () => {},
        notify: message => notices.push(message), makeAudio,
        fetcher: async (url, init) => {
          const response = await fetch(url, init)
          if (!String(url).includes('/audio/speech')) return response
          const bytes = Buffer.from(await response.arrayBuffer())
          const [prompt, spoken] = String(JSON.parse(init.body).input).split('<|endofprompt|>')
          if (spoken !== undefined) prompts.add(prompt)
          raw.push({ prompted: spoken !== undefined, bytes })
          return new Response(bytes, { status: response.status, headers: { 'content-type': 'audio/wav' } })
        }
      })
      controller.configure({ style: 'cat', speed: 1.04, emotion, effects: false })
      await controller.speak(REPLY, { id: 'check-' + round, context: QUESTION })

      for (const attempt of raw) {
        const seconds = await window.NANALY_AUDIO.measure(new Blob([attempt.bytes], { type: 'audio/wav' }))
        if (attempt.prompted && seconds > CEILING) leaked++
      }
      if (raw.length > 1) retried++
      for (const blob of played) {
        const seconds = await window.NANALY_AUDIO.measure(blob)
        durations.push(seconds)
        // padWav 加 0.35 秒。没变长就是它又被当成格式无效吞掉了。
        if (seconds - (await window.NANALY_AUDIO.measure(new Blob([raw.at(-1).bytes], { type: 'audio/wav' }))) > 0.3) padded++
        if (sampleDir && round === 0)
          writeFileSync(join(sampleDir, `${label}.wav`), Buffer.from(await blob.arrayBuffer()))
      }
    }

    durations.sort((a, b) => a - b)
    const longest = durations.at(-1) ?? 0
    const ok = longest <= CEILING && padded === durations.length
    if (!ok) failures++
    console.log(`【${label}】`)
    console.log(`  提示词         ${[...prompts].map(p => [...p].length).join(' / ')} 字，${[...prompts][0]?.split('。').filter(Boolean).length} 句`)
    console.log(`  首次生成失控   ${leaked}/${rounds}${leaked ? '  ← 提示词在泄漏，兜底替他扛着' : ''}`)
    console.log(`  触发重试       ${retried}/${rounds}`)
    console.log(`  补尾音生效     ${padded}/${durations.length} ${padded === durations.length ? '✓' : '✗ padWav 没跑起来'}`)
    console.log(`  送到播放器     中位 ${durations[durations.length >> 1]?.toFixed(2)}s，最长 ${longest.toFixed(2)}s ${longest <= CEILING ? '✓' : '✗ 失控音频播出去了'}`)
    if (notices.length) console.log(`  提示           ${[...new Set(notices)].join(' / ')}`)
    console.log()
  }

  if (sampleDir) console.log(`音频已写入 ${sampleDir}/，自己听一遍再下结论。\n`)
  if (failures) {
    console.log('✗ 有路径没通过。失控音频播出去说明兜底没接住；补尾音没生效多半是服务换了 WAV 头写法，')
    console.log('  对比 source/js/nanaly-audio.js 里 streamingLength 认的那几种占位长度。')
    process.exit(1)
  }
  console.log('✓ 两条路径都没有失控音频播出，补尾音全部生效')
}

// 被 import 时只导出 loadModules，不跑检查 —— 测试靠它验垫片还能不能把模块启动起来。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
